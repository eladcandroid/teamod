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
const WORK = {
  tree: {
    k: 'box',
    dir: 'column',
    children: [
      { k: 'text', spans: [{ t: 'alpha' }] },
      { k: 'text', spans: [{ t: '/r/alpha · 2 worktrees', dim: true }] },
      { k: 'button', key: 'add', label: 'Add Project', hotkey: 'a' },
      { k: 'input', key: 'path', label: 'Folder', placeholder: '/path' },
      { k: 'md', text: '**hello**' },
      { k: 'code', source: '@@ -1 +1 @@\n-a\n+b\n', diff: true },
      { k: 'select', key: 'pick', options: [{ value: 'a', label: 'A' }], value: 'a' },
      { k: 'box', dir: 'row', bg: 'strong', border: 'round', padX: 1, children: [{ k: 'icon', name: 'work', tone: 'accent' }, { k: 'button', key: 'screen:work', label: 'Work', plain: true }] },
      {
        k: 'box',
        dir: 'column',
        card: true,
        key: 'card:alpha',
        hover: true,
        border: 'round',
        padX: 1,
        children: [
          { k: 'box', dir: 'row', children: [{ k: 'avatar', name: 'cc-zol' }, { k: 'text', spans: [{ t: 'cc-zol', weight: 'bold' }] }] },
          { k: 'text', spans: [{ t: '● Ready to merge', color: 'success', tone: 'ok' }] },
        ],
      },
    ],
  },
}

type Fetched = { url: string; init?: { method?: string; body?: string } }

const engine = (on: On, asked: Fetched[] = []) => {
  on('state.get', (_, e) => {
    if (e.key === 'link') return { value: { value: { shape: 'link-1', value: LINK }, version: 1 } }

    return { value: { value: undefined, version: 0 } }
  })
  on('state.set', () => ({ value: { isSet: true, version: 1 } }))
  on('http.fetch', (_, e) => {
    asked.push({ url: e.url, init: e.init })
    const text = e.url.endsWith('/press') ? '{"ok":true}' : JSON.stringify(WORK)

    return { value: { status: 200, ok: true, headers: {}, text } }
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the Work pane lists projects on ${surface}`, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /alpha$/ }))?.text).toBe('alpha')
    expect((await ui.find({ type: 'Text', text: /2 worktrees/ }))?.text).toBe('/r/alpha · 2 worktrees')
    expect(await ui.find({ type: 'Input', key: 'path' })).toBeDefined()
    expect(await ui.find({ type: 'Select', key: 'pick' })).toBeDefined()
    if (surface === 'desktop') {
      // Pictures as pictures, the state as a chip without the terminal's dot.
      expect((await ui.findAll({ type: 'Svg' })).length).toBe(2)
      expect((await ui.find({ type: 'Text', text: /Ready to merge/ }))?.text).toBe(' Ready to merge ')
    } else {
      expect((await ui.find({ type: 'Text', text: '◆' }))?.text).toBe('◆')
      expect((await ui.find({ type: 'Text', text: /Ready to merge/ }))?.text).toBe('● Ready to merge')
    }
    await ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a press goes to the bridge by key on ${surface}`, async ($, on) => {
    const asked: Fetched[] = []
    engine(on, asked)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'add' })
    const sent = asked.find(one => one.url.endsWith('/press'))
    expect(JSON.parse(sent?.init?.body ?? '{}')).toMatchObject({ site: 'work', key: 'add' })
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

/** Lets work a hook left running unawaited get as far as it can. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 200; turn += 1) await Promise.resolve()
}

const spawnCounter = (on: On): { count: number } => {
  const spawned = { count: 0 }
  on('env.get', () => ({ value: undefined }))
  on('fs.read', () => ({ value: JSON.stringify({ node: 'node', cli: '/cli.js' }) }))
  on('process.spawn', async function* () {
    spawned.count += 1

    return { value: { code: 0, signal: null } }
  })

  return spawned
}

test('a desktop session starts the bridge when it attaches, once', async ($, on) => {
  const spawned = spawnCounter(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  expect(spawned.count).toBe(0)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:other' })
  await settle()
  expect(spawned.count).toBe(1)
})

test('a `-p` run starts no bridge', async ($, on) => {
  const spawned = spawnCounter(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await settle()
  expect(spawned.count).toBe(0)
})

test('a terminal draws through its module on each surface that has one', async ($, on) => {
  on('state.get', (_, e) => {
    if (e.key === 'link') return { value: { value: { shape: 'link-1', value: LINK }, version: 1 } }

    return { value: { value: undefined, version: 0 } }
  })
  on('http.fetch', () => ({
    value: {
      status: 200,
      ok: true,
      headers: {},
      text: JSON.stringify({ tree: { k: 'term', key: 'term:w1', term: 'w1', height: 10 } }),
    },
  }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Client' })).toBeDefined()
    await ui.unmount()
  }
})
