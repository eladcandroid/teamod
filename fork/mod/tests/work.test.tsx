import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'teamod',
  component: 'Pane',
  requestId: 'work',
  props: {
    title: 'Work',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const LINK = { socket: '/tmp/x.sock', key: 'k', connected: true }
const WORK = { projects: [{ id: 'p', name: 'alpha', root: '/r/alpha', worktrees: 2 }] }

type Fetched = { url: string; init?: { method?: string; body?: string } }

const engine = (on: On, asked: Fetched[] = []) => {
  on('state.get', (_, e) => {
    if (e.key === 'link') return { value: { value: { shape: 'link-1', value: LINK }, version: 1 } }

    return { value: { value: undefined, version: 0 } }
  })
  on('state.set', () => ({ value: { isSet: true, version: 1 } }))
  on('http.fetch', (_, e) => {
    asked.push({ url: e.url, init: e.init })
    const text = e.url.endsWith('/call') ? '{"ok":true}' : JSON.stringify(WORK)

    return { value: { status: 200, ok: true, headers: {}, text } }
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the Work pane lists projects on ${surface}`, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /alpha$/ }))?.text).toBe('alpha')
    expect((await ui.find({ type: 'Text', text: /2 worktrees/ }))?.text).toBe('/r/alpha · 2 worktrees')
    await ui.unmount()
  })
}

test('the Work pane says what to do before the engine is set up', async ($, on) => {
  on('state.get', (_, e) => {
    if (e.key === 'problem') {
      return { value: { value: { shape: 'problem-1', value: { kind: 'setup', text: 'Run /teamod setup.' } }, version: 1 } }
    }

    return { value: { value: undefined, version: 0 } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Run /teamod setup.')
  await ui.unmount()
})

test('the mod stays out of a lane the engine runs', async ($, on) => {
  const registered: string[] = []
  on('env.get', (_, e) => ({ value: e.name === 'TEAMOD_DAEMON' ? '1' : undefined }))
  on('command.register', (_, e) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual([])
})
