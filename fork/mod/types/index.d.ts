/** How to reach this session's bridge. The key stays in session memory, never in `$.store`. */
export type Link = { socket: string; key: string; connected: boolean }

/** Why the mod has no link yet: nothing yet, engine not set up, or the bridge failed. */
export type LinkProblem = { kind: 'setup' | 'failed'; text: string }

/** Where a tree is drawn, as the bridge is told it. */
export type Viewport = { surface: string; columns: number; rows: number }

export type Span = {
  t: string
  dim?: boolean
  color?: string
  weight?: 'semibold' | 'bold'
}

/** A screen from the bridge, as data (engine/src/teamod/tree.ts). */
export type Node =
  | {
      k: 'box'
      dir?: 'row' | 'column'
      gap?: number
      pad?: number
      padX?: number
      top?: number
      grow?: number
      width?: number | string
      height?: number
      justify?: string
      wrap?: boolean
      border?: string
      children: Node[]
    }
  | { k: 'text'; spans: Span[] }
  | {
      k: 'button'
      key: string
      label: string
      hotkey?: string
      plain?: boolean
      primary?: boolean
      dim?: boolean
      spans?: Span[]
    }
  | {
      k: 'input'
      key: string
      label?: string
      placeholder?: string
      value?: string
      rows?: number
      submitLabel?: string
      autoFocus?: boolean
    }
  | {
      k: 'select'
      key: string
      label?: string
      value?: string
      options: { value: string; label: string }[]
    }
  | { k: 'md'; text: string }
  | {
      k: 'code'
      source: string
      language?: string
      path?: string
      diff?: boolean
      startLine?: number
    }
  | { k: 'link'; href: string; text: string }
  | { k: 'image'; key?: string; png: string; columns: number; rows: number; alt: string }
  | {
      k: 'svg'
      source: string
      alt: string
      width?: number
      height?: number
      interactive?: boolean
    }
  | { k: 'term'; key: string; term: string; height?: number }

export type View = { tree: Node; active?: boolean }

declare module 'claude-code' {
  interface PluginState {
    teamod: {
      link: Shaped<Link | null>
      problem: Shaped<LinkProblem | null>
      /** Bumped per site on the bridge's `dirty`; a render reads it to redraw. */
      revs: Shaped<Record<string, number>>
      spikeKeys: Shaped<string[]>
    }
  }
}
