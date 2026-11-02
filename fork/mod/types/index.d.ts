/** How to reach this session's bridge. The key stays in session memory, never in `$.store`. */
export type Link = { socket: string; key: string; connected: boolean }

/** Why the mod has no link yet: nothing yet, engine not set up, or the bridge failed. */
export type LinkProblem = { kind: 'setup' | 'failed'; text: string }

/** The Work pane's view, as the bridge builds it (src/teamod/views.ts). */
export type WorkProject = {
  id: string
  name: string
  root: string
  worktrees: number
  error?: string
}
export type WorkView = { projects: WorkProject[] }

declare module 'claude-code' {
  interface PluginState {
    teamod: {
      link: Shaped<Link | null>
      problem: Shaped<LinkProblem | null>
      /** Bumped per route on the bridge's `dirty`; a render reads it to redraw. */
      revs: Shaped<Record<string, number>>
      isAdding: boolean
      spikeKeys: Shaped<string[]>
    }
  }
}
