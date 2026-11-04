import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'teamod',
  component: 'Pane',
  requestId: 'settings',
  props: { title: 'Settings', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const LINK = { socket: '/tmp/x.sock', key: 'k', connected: true }

const serve = (on: On, tree: unknown, asked: string[] = []) => {
  on('state.get', (_, e) => (e.key === 'link' ? { value: { value: { shape: 'link-1', value: LINK }, version: 1 } } : { value: { value: undefined, version: 0 } }))
  on('state.set', () => ({ value: { isSet: true, version: 1 } }))
  on('http.fetch', (_, e) => {
    asked.push(`${e.url} ${e.init?.body ?? ''}`)

    return { value: { status: 200, ok: true, headers: {}, text: e.url.endsWith('/press') ? '{"ok":true}' : JSON.stringify({ tree }) } }
  })
}

const projects = Array.from({ length: 73 }, (_, i) => ({ value: `p${i}`, label: `project-${i}` }))

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a choice among 73 projects still draws on ${surface}`, async ($, on) => {
    serve(on, { k: 'box', dir: 'column', children: [{ k: 'select', key: 'scope', label: 'Variables for', value: 'p70', options: [...projects, projects[3]] }] })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Select', key: 'scope' })).toBeDefined()
    await ui.unmount()
  })
}

test('a drawing Claude Code refuses shows the way back, not a blank pane', async ($, on) => {
  const asked: string[] = []
  serve(on, { k: 'box', dir: 'column', children: [{ k: 'svg', source: `<svg xmlns="http://www.w3.org/2000/svg"><!--${'x'.repeat(140000)}--></svg>`, alt: 'big' }] }, asked)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /couldn’t be drawn/ })).toBeDefined()
  await ui.press({ key: 'fallback:back' })
  expect(asked.some(a => a.includes('/press') && a.includes('"key":"back"'))).toBe(true)
  await ui.unmount()
})
