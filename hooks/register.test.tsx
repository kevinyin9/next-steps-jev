import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'next-steps-jev',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isCollapsed: false,
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
// The last prompt as it reached the hooks beneath this plugin.
let reached = ''
// This session's file as Claude Code keeps it (null: none found), and what the fork was asked.
let sessionJson: object | null = null
let forkPrompts: string[] = []

function world(
  on: any,
  http: (e: any) => unknown,
  env: Record<string, string> = { TYPESAFE_API_KEY: 'k' },
  enabledPlugins: Record<string, boolean> = {},
) {
  const calls: any[] = []
  mock.env(on, { USERPROFILE: '/home', ...env })
  sessionJson = null
  on('session.id', () => ({ value: 's1' }))
  on('fs.list', () => ({
    value: sessionJson === null ? [] : [{ name: '98356.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }],
  }))
  on('fs.read', () => ({ value: JSON.stringify(sessionJson) }))
  on('command.run', () => ({ text: '' }))
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
  forkPrompts = []
  on('model.fork', (_: unknown, e: any) => {
    forks++
    forkPrompts.push(e.prompt)
    return { value: { isAnswered: true, text: forkReply, usage: USAGE } }
  })
  on('http.fetch', (_: unknown, e: any) => {
    calls.push(e)
    return http(e)
  })
  on('prompt.suggest', () => ({ isShown: true }))
  filled = []
  reached = ''
  on('prompt.submit', (_: unknown, e: any) => {
    reached = e.text
    return { text: e.text }
  })
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
  await finish($)
  await labels($)
  await $.prompt.submit({ text: 'run the tests' } as any)
  expect(await stats($)).toContain('選了 Jev 第一名 1 次')
})

test('typing something else counts as not chosen', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
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
      '輸入 1 到 3 直接送出那一句。一次送好幾句：4=1+2、5=2+3、6=1+3、7=1+2+3。',
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

test('/jev-next after a press brings the offer back, and only the choice made again counts', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await pressAfterOffer($, 'pick-1')
  expect(await next($)).toContain('已叫回剛才的建議')
  expect(await stats($)).toContain('還沒有紀錄')
  expect((await labels($))[1]).toBe('commit  40')
  await pressAfterOffer($, 'pick-2')
  expect(await stats($)).toContain('只選一個：1 次，其中選了 Jev 第一名 0 次')
})

test('/jev-next brings back nothing once a new answer has ended', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await pressAfterOffer($, 'pick-1')
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2' })
  expect(await next($)).toContain('目前沒有建議')
})

test('/jev-next does not count as answering the offer', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await labels($)
  await $.prompt.submit({ text: '/jev-next', command: 'jev-next' } as any)
  await next($)
  await $.prompt.submit({ text: 'run the tests' } as any)
  expect(await stats($)).toContain('選了 Jev 第一名 1 次')
})

const PHONE = { kind: 'bridge' }
const TYPED = { kind: 'composer' }

// What reached the model for a prompt, as the hooks beneath this plugin saw it.
async function send($: any, text: string, origin: object): Promise<string> {
  await $.prompt.submit({ text, origin } as any)
  return reached
}

test('from the phone, 2 alone sends the second suggestion and counts as that pick', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await labels($)
  expect(await send($, '2', PHONE)).toBe('commit this')
  expect(await stats($)).toContain('只選一個：1 次，其中選了 Jev 第一名 0 次')
})

test('a digit sent from the phone by mistake: /jev-next brings the offer back and takes the pick out', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await labels($)
  await send($, '2', PHONE)
  await $.turn.start({ turnId: 't2' } as any)
  expect(await next($)).toContain('2. commit  40')
  expect(await stats($)).toContain('還沒有紀錄')
  expect(await send($, '1', PHONE)).toBe('run the tests')
  expect(await stats($)).toContain('選了 Jev 第一名 1 次')
})

// Jev's answers for the single steps and for steps together, by question id.
const okWith = (scores: number[], together: Record<string, number>) => {
  const reply = ok(scores)
  const body = JSON.parse(reply.value.text)
  for (const [id, score] of Object.entries(together)) body.answers[id] = { type: 'score', score }
  return { value: { ...reply.value, text: JSON.stringify(body) } }
}

test('Jev scores 4 to 7 as well, each by the steps it puts together', async ($, on) => {
  // On screen: 1 tests (step 2), 2 commit (step 3), 3 indent (step 1).
  const calls = world(on, () =>
    okWith([0.56, 3.34, 1.58], { together_2_3: 3, together_1_3: 2, together_1_2: 1, together_1_2_3: 0 }),
  )
  await finish($)
  const shown = await labels($)
  expect(shown.slice(3, 7)).toEqual(['1+2  75', '2+3  50', '1+3  25', '1+2+3  0'])
  expect(Object.keys(JSON.parse(calls[0].init.body).questions)).toEqual([
    'step_1', 'step_2', 'step_3', 'together_1_2', 'together_2_3', 'together_1_3', 'together_1_2_3',
  ])
  expect(await next($)).toContain('4=1+2（75）、5=2+3（50）、6=1+3（25）、7=1+2+3（0）')
})

test('the star and the colored ground go to the highest score of all keys, a combination included', async ($, on) => {
  // On screen: 1 tests 84 (step 2), 2 commit 40 (step 3); so 1+2 on screen is together_2_3.
  world(on, () => okWith([0.56, 3.34, 1.58], { together_2_3: 4 }))
  await finish($)
  const shown = await labels($)
  expect(shown[0]).toBe('tests  84')
  expect(shown[3]).toBe('1+2  100 ★ 建議')
  const ui = await $.ui.mount(BAND)
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  const grounded = texts.filter((t: any) => t.props?.backgroundColor !== undefined)
  expect(grounded.map((t: any) => [t.text, t.props.backgroundColor])).toEqual([['1+2  100 ★ 建議', 'success']])
  expect(await next($)).toContain('4=1+2（100 ★）')
})

test('a combination below the best single gets no star', async ($, on) => {
  world(on, () => okWith([0.56, 3.34, 1.58], { together_2_3: 3 }))
  await finish($)
  const shown = await labels($)
  expect([shown[0], shown[3]]).toEqual(['tests  84 ★ 建議', '1+2  75'])
})

test('a missing score for steps together leaves that key unscored', async ($, on) => {
  world(on, () => okWith([0.56, 3.34, 1.58], { together_2_3: 3, together_1_3: 9 }))
  await finish($)
  const shown = await labels($)
  expect(shown.slice(3, 7)).toEqual(['1+2  75', '2+3', '1+3', '1+2+3'])
})

test('from the phone, 6 sends 1+3 as one numbered prompt', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await labels($)
  expect(await send($, ' 6 ', PHONE)).toBe(['1. run the tests', '2. reformat everything'].join('\n'))
})

const MONITOR = { kind: 'task-notification' }

test('a Monitor event turn leaves the offer standing, unrecorded and not asked for again', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  const before = await labels($)
  await send($, 'Monitor event: build finished', MONITOR)
  await $.turn.start({ text: 'Monitor event: build finished', turnId: 't2' })
  await $.turn.complete({ reason: 'answer', answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't2' })
  expect(await labels($)).toEqual(before)
  expect(forkPrompts.length).toBe(1)
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(stored.get('picks-v1')).toBeUndefined()
})

test('after a short Monitor event answer, /jev-next still prints the offer', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await labels($)
  await send($, 'Monitor event: tick', MONITOR)
  await $.turn.start({ text: 'Monitor event: tick', turnId: 't2' })
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2' })
  expect(await next($)).toContain('1. tests  84 ★ 建議')
})

test('a background subagent running after the answer leaves the offer standing', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  const before = await labels($)
  await $.turn.start({ text: 'look into it', turnId: 'a1', agentId: 'agent-1' })
  await $.turn.complete({ reason: 'answer', answer: ANSWER, durationMs: 1, isAborted: false, turnId: 'a1', agentId: 'agent-1' })
  expect(await labels($)).toEqual(before)
  expect(forkPrompts.length).toBe(1)
})

test('a turn the person starts after one still hides the offer and asks again', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await labels($)
  await send($, 'Monitor event: build finished', MONITOR)
  await $.turn.start({ text: '', turnId: 't2' })
  await send($, 'something else', TYPED)
  await $.turn.start({ text: 'something else', turnId: 't3' })
  const ui = await $.ui.mount(BAND)
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  await ui.unmount()
  await $.turn.complete({ reason: 'answer', answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't3' })
  await labels($)
  expect(forkPrompts.length).toBe(2)
})

test('a digit typed at the terminal is sent as typed', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await finish($)
  await labels($)
  expect(await send($, '2', TYPED)).toBe('2')
})

test('from the phone, a digit with no suggestion behind it is sent as typed', async ($, on) => {
  world(on, () => ok([1, 2]))
  forkReply = JSON.stringify([
    { label: 'tests', prompt: 'run the tests' },
    { label: 'commit', prompt: 'commit this' },
  ])
  await finish($)
  await labels($)
  expect(await send($, '3', PHONE)).toBe('3')
  expect(await send($, '5', PHONE)).toBe('5')
})

test('from the phone, with nothing offered, a digit is sent as typed', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  await $.session.start(TERMINAL)
  expect(await send($, '1', PHONE)).toBe('1')
})

test("this plugin's own commands are never suggested", async ($, on) => {
  world(on, () => ok([3, 2]))
  forkReply = JSON.stringify([
    { label: 'see them', prompt: '/jev-next' },
    { label: 'stats', prompt: '/jev-stats reset' },
    { label: 'tests', prompt: 'run the tests' },
    { label: 'commit', prompt: 'commit this' },
  ])
  await finish($)
  const shown = await labels($)
  expect(shown.slice(0, 2)).toEqual(['tests  75 ★ 建議', 'commit  50'])
})

// Renaming the session. On screen, as Jev ranks FORK_REPLY: tests, commit, indent.
const NAMED_REPLY = (name: string) =>
  JSON.stringify({ next: JSON.parse(FORK_REPLY), name })
const DERIVED = { sessionId: 's1', name: 'user-5d', nameSource: 'derived' }
const CHOSEN = { sessionId: 's1', name: '股票回測', nameSource: 'user' }

const renameLabel = (shown: string[]) => shown.find(label => label.startsWith('改名成'))

async function renames(): Promise<unknown> {
  await new Promise(resolve => setTimeout(resolve, 30))
  return stored.get('renames-v1')
}

test('a session with a placeholder name is offered one on 8, without asking Jev', async ($, on) => {
  const calls = world(on, () => ok([0.56, 3.34, 1.58]))
  sessionJson = DERIVED
  forkReply = NAMED_REPLY('「next-steps 改名」')
  await finish($)
  expect(renameLabel(await labels($))).toBe('改名成「next-steps 改名」')
  expect(forkPrompts[0]).toContain('The session has no real name yet.')
  expect(Object.keys(JSON.parse(calls[0].init.body).questions)).not.toContain('rename')
})

test('the rename sits on key 8, a digit, since a letter never reaches the band from the prompt box', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  sessionJson = DERIVED
  forkReply = NAMED_REPLY('next-steps 改名')
  await finish($)
  await labels($)
  const ui = await $.ui.mount(BAND)
  const buttons = await ui.findAll({ type: 'Button' })
  await ui.unmount()
  const keys = buttons.map((b: any) => b.props?.hotkey)
  expect(buttons.find((b: any) => b.props?.label?.startsWith('改名成'))?.props?.hotkey).toBe('8')
  expect(new Set(keys).size).toBe(keys.length)
})

test('8 puts /rename in the prompt box and keeps the suggestions; sending it as is counts as accepted', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  sessionJson = DERIVED
  forkReply = NAMED_REPLY('next-steps 改名')
  await finish($)
  await pressAfterOffer($, 'rename')
  expect(filled).toEqual(['/rename next-steps 改名'])
  const after = await labels($)
  expect(after[0]).toBe('tests  84 ★ 建議')
  expect(renameLabel(after)).toBeUndefined()
  await $.command.run({ command: 'rename', args: 'next-steps 改名' } as any)
  expect(await renames()).toEqual([{ from: 'user-5d', proposed: 'next-steps 改名', chose: 'accepted' }])
})

test('a rewritten name is kept as the name you wanted', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  sessionJson = DERIVED
  forkReply = NAMED_REPLY('next-steps 改名')
  await finish($)
  await labels($)
  await $.command.run({ command: 'rename', args: ' 外掛改名 ' } as any)
  expect(await renames()).toEqual([
    { from: 'user-5d', proposed: 'next-steps 改名', chose: 'edited', final: '外掛改名' },
  ])
  expect(await stats($)).toContain('建議「next-steps 改名」，你改成「外掛改名」')
})

test('a chosen name is offered a replacement only when Jev scores the rename high enough', async ($, on) => {
  const calls = world(on, () => okWith([0.56, 3.34, 1.58], { rename: 3 }))
  sessionJson = CHOSEN
  forkReply = NAMED_REPLY('next-steps 外掛')
  await finish($)
  expect(renameLabel(await labels($))).toBe('改名成「next-steps 外掛」  75')
  expect(forkPrompts[0]).toContain('It is now named "股票回測"')
  const body = JSON.parse(calls[0].init.body)
  expect(body.state.session_name).toBe('股票回測')
  expect(body.state.proposed_session_name).toBe('next-steps 外掛')
})

test('a rename Jev scores below the bar is not offered', async ($, on) => {
  world(on, () => okWith([0.56, 3.34, 1.58], { rename: 2 }))
  sessionJson = CHOSEN
  forkReply = NAMED_REPLY('next-steps 外掛')
  await finish($)
  expect(renameLabel(await labels($))).toBeUndefined()
})

test('the same name again, or an old-style reply with no name, offers nothing', async ($, on) => {
  const calls = world(on, () => ok([0.56, 3.34, 1.58]))
  sessionJson = CHOSEN
  forkReply = NAMED_REPLY('股票回測')
  await finish($)
  expect(renameLabel(await labels($))).toBeUndefined()
  expect(Object.keys(JSON.parse(calls[0].init.body).questions)).not.toContain('rename')
})

test('a name passed over is recorded, and no name is asked for over the next answers', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  sessionJson = DERIVED
  forkReply = NAMED_REPLY('next-steps 改名')
  await finish($)
  await labels($)
  await $.turn.complete({ reason: 'answer', answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't2' })
  await labels($)
  expect(await renames()).toEqual([{ from: 'user-5d', proposed: 'next-steps 改名', chose: 'ignored' }])
  expect(forkPrompts[1]).not.toContain('name this whole session')
})

test('a /rename with nothing offered is recorded as your own name', async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  sessionJson = CHOSEN
  await $.session.start(TERMINAL)
  await $.command.run({ command: 'rename', args: '回測 v2' } as any)
  expect(await renames()).toEqual([{ from: '股票回測', chose: 'manual', final: '回測 v2' }])
  expect(await stats($)).toContain('「股票回測」改成「回測 v2」')
})

test('with suggestRename off, no name is asked for or offered', { options: { suggestRename: false } }, async ($, on) => {
  world(on, () => ok([0.56, 3.34, 1.58]))
  sessionJson = DERIVED
  forkReply = NAMED_REPLY('next-steps 改名')
  await finish($)
  expect(renameLabel(await labels($))).toBeUndefined()
  expect(forkPrompts[0]).not.toContain('name this whole session')
})
