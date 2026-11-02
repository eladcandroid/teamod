import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Link, LinkProblem } from '../types'

const link = atom({ plugin: 'teamod', key: 'link' } as const, null, {
  shape: 'link-1',
})
const problem = atom({ plugin: 'teamod', key: 'problem' } as const, null, {
  shape: 'problem-1',
})
const revs = atom({ plugin: 'teamod', key: 'revs' } as const, {}, {
  shape: 'revs-1',
})

/** Each read subscribes the drawing that makes it. */
export function readLink($: EngineInterface): Promise<Link | null> {
  return read($, link)
}

export function readProblem($: EngineInterface): Promise<LinkProblem | null> {
  return read($, problem)
}

/** Read while drawing a route, so the bridge's `dirty` redraws it. */
export async function readRev($: EngineInterface, route: string): Promise<number> {
  return (await read($, revs))[route] ?? 0
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
  | { t: 'error'; text: string }

function setProblem($: EngineInterface, value: LinkProblem | null): Promise<unknown> {
  return update($, problem, () => value)
}

async function apply($: EngineInterface, line: Line): Promise<void> {
  if (line.t === 'ready') {
    await setProblem($, null)
    await update($, link, () => ({
      socket: line.socket,
      key: line.key,
      connected: true,
    }))
  } else if (line.t === 'dirty') {
    await update($, revs, current => {
      const next = { ...current }
      for (const route of line.routes) next[route] = (next[route] ?? 0) + 1

      return next
    })
  } else if (line.t === 'connected') {
    await update($, link, current =>
      current ? { ...current, connected: line.connected } : current,
    )
    await update($, revs, current => {
      const next = { ...current }
      for (const route of Object.keys(next)) next[route] = (next[route] ?? 0) + 1

      return next
    })
  } else {
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

/** One route's view; `undefined` while there is no link. */
export async function viewOf<T>($: EngineInterface, route: string): Promise<T | undefined> {
  const current = await read($, link)
  if (!current) return undefined

  return (await request($, current, `/view/${route}`)) as T
}

export type CallResult = { ok: true; value: unknown } | { ok: false; error: string }

/** One API method, called for a press of the person's. */
export async function call(
  $: EngineInterface,
  method: string,
  args: readonly unknown[] = [],
): Promise<CallResult> {
  const current = await read($, link)
  if (!current) return { ok: false, error: 'teamod is not connected' }

  return (await request($, current, '/call', {
    method: 'POST',
    body: JSON.stringify({ method, args }),
  })) as CallResult
}
