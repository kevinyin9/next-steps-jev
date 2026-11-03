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

function world(on: any, http: (e: any) => unknown, env: Record<string, string> = { TYPESAFE_API_KEY: 'k' }) {
  const calls: any[] = []
  mock.env(on, env)
  clock = mock.clock(on)
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('command.list', () => ({ value: [] }))
  forks = 0
  on('model.fork', () => {
    forks++
    return { value: { isAnswered: true, text: FORK_REPLY, usage: USAGE } }
  })
  on('http.fetch', (_: unknown, e: any) => {
    calls.push(e)
    return http(e)
  })
  on('prompt.suggest', () => ({ isShown: true }))
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
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
  expect(shown[3]).toBe('dismiss')
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
