import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Link, LinkProblem, View, Viewport } from '../types'

const link = atom({ plugin: 'teamod', key: 'link' } as const, null, {
  shape: 'link-1',
})
const problem = atom({ plugin: 'teamod', key: 'problem' } as const, null, {
  shape: 'problem-1',
})
const revs = atom({ plugin: 'teamod', key: 'revs' } as const, {}, {
  shape: 'revs-1',
})

export const TITLES: Readonly<Record<string, string>> = {
  work: 'Work',
  task: 'Task',
  team: 'Team',
  board: 'Board',
  sentinel: 'Sentinel',
  settings: 'Settings',
}

/** Each read subscribes the drawing that makes it. */
export function readLink($: EngineInterface): Promise<Link | null> {
  return read($, link)
}

export function readProblem($: EngineInterface): Promise<LinkProblem | null> {
  return read($, problem)
}

/** Read while drawing a site, so the bridge's `dirty` redraws it. */
export async function readRev($: EngineInterface, site: string): Promise<number> {
  return (await read($, revs))[site] ?? 0
}

/** Where the engine is, as `/teamod setup` wrote it. */
type Runtime = { node: string; cli: string }

const asRuntime = (text: string): Runtime | undefined => {
  try {
    const value = JSON.parse(text) as Partial<Runtime>
    if (typeof value.node === 'string' && typeof value.cli === 'string') {
      return { node: value.node, cli: value.cli }
    }
  } catch {
    return undefined
  }

  return undefined
}

export async function homeOf($: EngineInterface): Promise<string> {
  // Never TEAMOD_HOME: inside teamod's own terminal it names the person's real teamod.
  const set = await $.env.get('TEAMOD_HOME')
  if (set) return set
  const home = await $.env.get('HOME')

  return `${home ?? ''}/.teamod`
}

export async function runtimeOf($: EngineInterface): Promise<Runtime | undefined> {
  try {
    return asRuntime(await $.fs.read(`${await homeOf($)}/runtime.json`))
  } catch {
    return undefined
  }
}

type Line =
  | { t: 'ready'; socket: string; key: string }
  | { t: 'dirty'; routes: string[] }
  | { t: 'connected'; connected: boolean }
  | { t: 'status'; text?: string }
  | { t: 'toast'; text: string }
  | { t: 'open'; pane: string }
  | { t: 'error'; text: string }

function setProblem($: EngineInterface, value: LinkProblem | null): Promise<unknown> {
  return update($, problem, () => value)
}

async function apply($: EngineInterface, line: Line): Promise<void> {
  switch (line.t) {
    case 'ready':
      await setProblem($, null)
      await update($, link, () => ({
        socket: line.socket,
        key: line.key,
        connected: true,
      }))
      await registerTools($).catch(err => {
        $.ui.log(`teamod tools: ${String(err)}`, { to: 'debug' })
      })

      return
    case 'dirty':
      await update($, revs, current => {
        const next = { ...current }
        for (const site of line.routes) next[site] = (next[site] ?? 0) + 1

        return next
      })

      return
    case 'connected':
      await update($, link, current =>
        current ? { ...current, connected: line.connected } : current,
      )

      return
    case 'status':
      $.ui.status(line.text)

      return
    case 'toast':
      $.ui.toast(line.text)

      return
    case 'open':
      await $.ui.open({ id: line.pane, title: TITLES[line.pane] ?? line.pane })

      return
    case 'error':
      await setProblem($, { kind: 'failed', text: line.text })
  }
}

// A reload ends the child with the module and starts this over, which is right.
let isBridgeUp = false

/** Starts the bridge unless this copy of the module already did. */
export async function ensureBridge($: EngineInterface): Promise<void> {
  if (isBridgeUp) return
  isBridgeUp = true
  try {
    await runBridge($)
  } finally {
    isBridgeUp = false
  }
}

/**
 * Runs the bridge for the session's life. Its stdout carries small lines only;
 * a piece may end mid-line, so they are put back together here.
 */
async function runBridge($: EngineInterface): Promise<void> {
  const runtime = await runtimeOf($)
  if (!runtime) {
    await setProblem($, {
      kind: 'setup',
      text: 'The teamod engine is not set up yet. Run /teamod setup.',
    })

    return
  }
  const home = await homeOf($)
  let rest = ''
  try {
    const bridge = $.process.spawn({
      argv: [runtime.node, runtime.cli, 'bridge'],
      env: { TEAMOD_HOME: home },
    })
    for await (const { stream, text } of bridge) {
      if (stream !== 'stdout') {
        $.ui.log(`teamod bridge: ${text.trimEnd()}`, { to: 'debug' })
        continue
      }
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      for (const raw of lines) {
        if (!raw.trim()) continue
        try {
          await apply($, JSON.parse(raw) as Line)
        } catch (err) {
          $.ui.log(`teamod bridge line: ${String(err)}`, { to: 'debug' })
        }
      }
    }
    await update($, link, () => null)
    await setProblem($, { kind: 'failed', text: 'The teamod bridge stopped.' })
  } catch (err) {
    await update($, link, () => null)
    await setProblem($, {
      kind: 'failed',
      text: `The teamod bridge could not run: ${String(err)}`,
    })
  }
}

async function request(
  $: EngineInterface,
  current: Link,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<unknown> {
  const response = await $.http.fetch(`http://bridge${path}`, {
    ...init,
    socketPath: current.socket,
    headers: {
      authorization: `Bearer ${current.key}`,
      'content-type': 'application/json',
    },
  })
  if (!response.ok) throw new Error(`bridge answered ${response.status}`)

  return JSON.parse(response.text) as unknown
}

/** One site's tree for this viewport; `undefined` while there is no link. */
export async function viewOf(
  $: EngineInterface,
  site: string,
  viewport: Viewport,
): Promise<View | undefined> {
  const current = await readLink($)
  if (!current) return undefined
  const query = new URLSearchParams({
    surface: viewport.surface,
    columns: String(viewport.columns),
    rows: String(viewport.rows),
  })

  return (await request($, current, `/view/${site}?${query.toString()}`)) as View
}

/** The pane closed: nothing to tell the mod about it any more. */
export async function forgetView($: EngineInterface, site: string): Promise<void> {
  const current = await readLink($)
  if (current) await request($, current, `/view/${site}`, { method: 'DELETE' })
}

type Pressed = { ok: boolean; error?: string; open?: string; toast?: string; copy?: string }

/** A press of the person's: only ever from a control they acted on. */
export async function press(
  $: EngineInterface,
  site: string,
  key: string,
  value: string | undefined,
  viewport: Viewport,
): Promise<void> {
  const current = await readLink($)
  if (!current) {
    $.ui.toast('teamod is not connected.')

    return
  }
  const body = JSON.stringify({ site, key, ...(value !== undefined ? { value } : {}), viewport })
  try {
    const answer = (await request($, current, '/press', { method: 'POST', body })) as Pressed
    if (answer.error) $.ui.toast(answer.error)
    if (answer.toast) $.ui.toast(answer.toast)
    if (answer.copy) await $.ui.copy({ text: answer.copy, surface: viewport.surface as 'terminal' })
    if (answer.open) {
      await $.ui.open({ id: answer.open, title: TITLES[answer.open] ?? answer.open, focus: true })
    }
  } catch (err) {
    $.ui.toast(`That did not work: ${String(err)}`)
  }
}

type Tools = { tools: { name: string; description: string; inputSchema: Record<string, unknown> }[] }

/** The engine's tools, for the model of this session: each call goes through the engine's gate. */
async function registerTools($: EngineInterface): Promise<void> {
  const current = await readLink($)
  if (!current) return
  const { tools } = (await request($, current, '/tools')) as Tools
  for (const tool of tools) {
    await $.tool.register({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })
  }
}

/** One of those tools, called by this session's model. */
export async function runTool(
  $: EngineInterface,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const current = await readLink($)
  if (!current) return { text: 'teamod is not connected.', isError: true }

  return (await request($, current, '/tool', {
    method: 'POST',
    body: JSON.stringify({ name, args }),
  })) as { text: string; isError: boolean }
}

type Commanded = { open?: string; title?: string; text?: string }

/** `/teamod <words>`, as the bridge reads them. */
export async function commandOf(
  $: EngineInterface,
  words: string,
): Promise<Commanded | undefined> {
  const current = await readLink($)
  if (!current) return undefined

  return (await request($, current, '/command', {
    method: 'POST',
    body: JSON.stringify({ text: words }),
  })) as Commanded
}
