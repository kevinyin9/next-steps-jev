import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'next-steps-jev',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const ANSWER = 'x'.repeat(100)
const FORK_REPLY = JSON.stringify([
  { label: 'indent', prompt: 'reformat everything' },
  { label: 'tests', prompt: 'run the tests' },
  { label: 'commit', prompt: 'commit this' },
])
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

let clock: any
let forks = 0
let filled: string[] = []
let forkReply = FORK_REPLY
const stored = new Map<string, unknown>()

function world(
  on: any,
  http: (e: any) => unknown,
  env: Record<string, string> = { TYPESAFE_API_KEY: 'k' },
  enabledPlugins: Record<string, boolean> = {},
) {
  const calls: any[] = []
  mock.env(on, env)
  stored.clear()
  on('store.get', (_: unknown, e: any) => ({ value: stored.get(e.key) }))
  on('store.set', (_: unknown, e: any) => {
    stored.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: any) => {
    stored.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  on('command.register', () => ({ value: { command: 'jev-stats' } }))
  clock = mock.clock(on)
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('command.list', () => ({ value: [] }))
  forks = 0
  forkReply = FORK_REPLY
  on('model.fork', () => {
    forks++
    return { value: { isAnswered: true, text: forkReply, usage: USAGE } }
  })
  on('http.fetch', (_: unknown, e: any) => {
    calls.push(e)
    return http(e)
  })
  on('prompt.suggest', () => ({ isShown: true }))
  filled = []
  on('prompt.fill', (_: unknown, e: any) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_: unknown, e: any) => e)
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  // The engine answers with whole settings; `$.settings.read({ key })` picks the key out.
  on('settings.read', () => ({ value: { enabledPlugins } }))
  return calls
}

const TERMINAL = { cwd: '/', surface: 'terminal', isInteractive: true } as const

const ok = (scores: number[]) => ({
  value: {
    status: 200,
    ok: true,
    headers: {},
    text: JSON.stringify({
      answers: Object.fromEntries(scores.map((score, i) => [`step_${i + 1}`, { type: 'score', score }])),
    }),
  },
})

async function finish($: any, turnId = 't1', extra: object = {}, session: object = TERMINAL) {
  await $.session.start(session)
  await $.turn.complete({ reason: 'answer', answer: ANSWER, durationMs: 1, isAborted: false, turnId, ...extra })
}

async function labels($: any): Promise<string[]> {
  // The fork and Jev run detached from the turn; give them time to land.
  for (let i = 0; i < 50; i++) {
    const ui = await $.ui.mount(BAND)
    const buttons = await ui.findAll({ type: 'Button' })
    await ui.unmount()
    if (buttons.length > 0) return buttons.map((b: any) => b.props?.label ?? b.text)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return []
}

test('best step goes first with its score and the recommendation', async ($, on) => {
  const calls = world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  const shown = await labels($)
  expect(shown[0]).toBe('tests  84 ★ 建議')
  expect(shown[1]).toBe('commit  40')
  expect(shown[2]).toBe('indent  14')
  expect(shown.slice(3)).toEqual(['1+2', '2+3', '1+3', '1+2+3', 'dismiss'])
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe('https://api.typesafe.ai/v1/systemone')
  expect(calls[0].init.headers.Authorization).toBe('Bearer k')
})

test('all three poor: scores show, nothing is recommended', async ($, on) => {
  world(on, () => ok([0.36, 0.63, 0.01]))
  await finish($)
  const shown = await labels($)
  expect(shown[0]).toBe('tests  16')
  expect(shown.join(' ')).not.toContain('建議')
})

test('no key: no request leaves, suggestions still show', async ($, on) => {
  const calls = world(on, () => ok([1, 2, 3]), {})
  await finish($)
  const shown = await labels($)
  expect(shown[0]).toBe('indent')
  expect(calls).toHaveLength(0)
})

test('a key saved in the plugin options is used over the environment', { options: { typesafeApiKey: 'saved' } }, async ($, on) => {
  const calls = world(on, () => ok([1, 2, 3]))
  await finish($)
  await labels($)
  expect(calls[0].init.headers.Authorization).toBe('Bearer saved')
})

async function warnings($: any): Promise<string[]> {
  await labels($)
  const ui = await $.ui.mount(BAND)
  const found = await ui.findAll({ type: 'Text', text: /原版 next-steps/ })
  await ui.unmount()
  return found.map((f: any) => f.text)
}

test('original next-steps on: warn above the options with its exact id', async ($, on) => {
  world(on, () => ok([1, 2, 3]), undefined, { 'next-steps@claude-community': true })
  await finish($)
  const found = await warnings($)
  expect(found).toHaveLength(1)
  expect(found[0]).toContain('claude plugin disable next-steps@claude-community --scope user')
})

test('original next-steps off: no warning', async ($, on) => {
  world(on, () => ok([1, 2, 3]), undefined, { 'next-steps@claude-community': false })
  await finish($)
  expect(await warnings($)).toHaveLength(0)
})

test('this plugin being on is not mistaken for the original', async ($, on) => {
  world(on, () => ok([1, 2, 3]), undefined, { 'next-steps-jev@next-steps-jev': true })
  await finish($)
  expect(await warnings($)).toHaveLength(0)
})

test('Jev refuses: suggestions show in the original order', async ($, on) => {
  world(on, () => ({ value: { status: 401, ok: false, headers: {}, text: 'nope' } }))
  await finish($)
  const shown = await labels($)
  expect(shown[0]).toBe('indent')
})

test('a malformed score is not shown as a number', async ($, on) => {
  world(on, () => ok([1, 99, 2]))
  await finish($)
  const shown = await labels($)
  expect(shown[0]).toBe('indent')
})

test('Jev never answers: after the time limit the suggestions show anyway', async ($, on) => {
  world(on, () => new Promise(() => undefined))
  await finish($)
  await new Promise(resolve => setTimeout(resolve, 30))
  await clock.advance(3000)
  const shown = await labels($)
  expect(shown[0]).toBe('indent')
})

test('a scheduled run (claude -p) sends nothing and asks the model nothing', async ($, on) => {
  const calls = world(on, () => ok([1, 2, 3]))
  await finish($, 't3', {}, { cwd: '/', surface: null, isInteractive: false })
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(calls).toHaveLength(0)
  expect(forks).toBe(0)
})

test('the desktop app, which draws no buttons, sends nothing', async ($, on) => {
  const calls = world(on, () => ok([1, 2, 3]))
  await finish($, 't4', {}, { cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(calls).toHaveLength(0)
})

test("a subagent's end sends nothing to Jev", async ($, on) => {
  const calls = world(on, () => ok([1, 2, 3]))
  await finish($, 't2', { agentId: 'a1' })
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(calls).toHaveLength(0)
})

async function pressAfterOffer($: any, key: string): Promise<void> {
  await labels($)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key })
  await ui.unmount()
  for (let i = 0; i < 50 && filled.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 5))
}

test('1+2+3 fills one numbered draft, best first', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await pressAfterOffer($, 'combo-1-2-3')
  expect(filled).toEqual([['1. run the tests', '2. commit this', '3. reformat everything'].join('\n')])
})

test('1+3 skips the middle step', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await pressAfterOffer($, 'combo-1-3')
  expect(filled).toEqual([['1. run the tests', '2. reformat everything'].join('\n')])
})

test('combinations sit on keys 4 to 7', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await labels($)
  const ui = await $.ui.mount(BAND)
  const buttons = await ui.findAll({ type: 'Button' })
  await ui.unmount()
  const hotkeys = Object.fromEntries(buttons.map((b: any) => [b.props?.label, b.props?.hotkey]))
  expect([hotkeys['1+2'], hotkeys['2+3'], hotkeys['1+3'], hotkeys['1+2+3']]).toEqual(['4', '5', '6', '7'])
})

test('two suggestions offer only 1+2', async ($, on) => {
  world(on, () => ok([3, 1]))
  forkReply = JSON.stringify([
    { label: 'tests', prompt: 'run the tests' },
    { label: 'commit', prompt: 'commit this' },
  ])
  await finish($)
  const shown = await labels($)
  expect(shown.slice(2)).toEqual(['1+2', 'dismiss'])
})

async function stats($: any): Promise<string> {
  // The outcome is written detached from the press; give it time to land.
  await new Promise(resolve => setTimeout(resolve, 30))
  const run = await $.command.run({ command: 'jev-stats', args: '' })
  return run?.text ?? ''
}

test('pressing Jev’s first place is counted as such', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await pressAfterOffer($, 'pick-1')
  const text = await stats($)
  expect(text).toContain('最近 1 次')
  expect(text).toContain('選了 Jev 第一名 1 次（100%）')
  expect(text).toContain('隨便選的話，大約會是 33%')
})

test('pressing the third is a pick that missed the first place', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await pressAfterOffer($, 'pick-3')
  const text = await stats($)
  expect(text).toContain('選了 Jev 第一名 0 次（0%）')
  expect(text).toContain('你選的建議平均 14 分，沒選的平均 62 分')
})

test('0 is counted as dismissed', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await labels($)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'dismiss' })
  await ui.unmount()
  expect(await stats($)).toContain('按 0 關掉：1 次')
})

test('sending the top prompt unchanged (as Tab does) counts as choosing it', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  await finish($)
  await labels($)
  await $.prompt.submit({ text: 'run the tests' } as any)
  expect(await stats($)).toContain('選了 Jev 第一名 1 次')
})

test('typing something else counts as not chosen', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  await finish($)
  await labels($)
  await $.prompt.submit({ text: 'something of my own' } as any)
  expect(await stats($)).toContain('沒選，自己打別的：1 次')
})

test('the record holds scores and places, never prompt text', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await pressAfterOffer($, 'combo-1-3')
  await new Promise(resolve => setTimeout(resolve, 30))
  const held = stored.get('picks-v1')
  expect(held).toEqual([{ scores: [84, 40, 14], chose: 'picked', places: [0, 2] }])
})

test('an offer without scores is not recorded', async ($, on) => {
  world(on, () => ok([1, 2, 3]), {})
  await finish($)
  await pressAfterOffer($, 'pick-1')
  expect(await stats($)).toContain('還沒有紀錄')
})

test('reset clears the record', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await pressAfterOffer($, 'pick-1')
  await new Promise(resolve => setTimeout(resolve, 30))
  await $.command.run({ command: 'jev-stats', args: 'reset' } as any)
  expect(await stats($)).toContain('還沒有紀錄')
})

async function next($: any): Promise<string> {
  const run = await $.command.run({ command: 'jev-next', args: '' } as any)
  return run?.text ?? ''
}

test('/jev-next prints the offer as text, best first, with the full prompts', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await labels($)
  expect(await next($)).toBe(
    [
      '下一步建議',
      ['1. tests  84 ★ 建議', 'run the tests'].join('\n'),
      ['2. commit  40', 'commit this'].join('\n'),
      ['3. indent  14', 'reformat everything'].join('\n'),
    ].join('\n\n'),
  )
})

test('/jev-next carries the Jev note', async ($, on) => {
  world(on, () => ok([1, 2, 3]), {})
  await finish($)
  await labels($)
  const text = await next($)
  expect(text.startsWith('下一步建議（Jev 未評分：找不到金鑰，請設定 TYPESAFE_API_KEY）')).toBe(true)
  expect(text).toContain(['1. indent', 'reformat everything'].join('\n'))
})

test('/jev-next with nothing offered says so', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await $.session.start(TERMINAL)
  expect(await next($)).toContain('目前沒有建議')
})

test('/jev-next after the offer was used says nothing is offered', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await pressAfterOffer($, 'pick-1')
  expect(await next($)).toContain('目前沒有建議')
})

test('/jev-next does not count as answering the offer', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  await finish($)
  await labels($)
  await $.prompt.submit({ text: '/jev-next', command: 'jev-next' } as any)
  await next($)
  await $.prompt.submit({ text: 'run the tests' } as any)
  expect(await stats($)).toContain('選了 Jev 第一名 1 次')
})
