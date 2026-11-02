import type { AppState, View } from '../core/store.js';
import type { TermHub } from './term-hub.js';
import { Draw, type Effects, type Node, type Surface, autoFocused, dim, inert } from './tree.js';

/** The native panes: each opens on demand and holds its own routes. */
export const PANES = ['work', 'task', 'team', 'board', 'sentinel', 'settings'] as const;
export type PaneId = (typeof PANES)[number];
export const isPane = (id: string): id is PaneId => (PANES as readonly string[]).includes(id);

/** Where a screen draws: a pane, the band above the prompt, or an answer in the transcript. */
export type SiteId = PaneId | 'band' | `rich:${string}`;
export const isSite = (id: string): id is SiteId => id === 'band' || id.startsWith('rich:') || isPane(id);
const isRich = (id: SiteId): id is `rich:${string}` => id.startsWith('rich:');
/** A pane to go to from a site that isn't one. */
const roomFor = (site: SiteId): PaneId => (isPane(site) ? site : 'work');

export const PANE_TITLES: Readonly<Record<PaneId, string>> = {
  work: 'Work',
  task: 'Task',
  team: 'Team',
  board: 'Board',
  sentinel: 'Sentinel',
  settings: 'Settings',
};

/** Where a pane is: which screen, a route's name and its plain parameters. Any pane can show any screen. */
export interface Route {
  /** Left out: the screen the pane is named for. */
  readonly screen?: PaneId;
  readonly name: string;
  readonly params?: Readonly<Record<string, string>>;
}

export interface Viewport {
  readonly surface: Surface;
  readonly columns: number;
  readonly rows: number;
}

/** What the bridge gives every screen. */
export interface ScreenHost {
  getState(): AppState | undefined;
  call(method: string, args: readonly unknown[]): Promise<unknown>;
  /** The drawn views may have changed: compare them and say so. */
  markDirty(): void;
  /** Tell the core what this session looks at (read counts, whether to notify). */
  look(channel: string | undefined): void;
  /** This session's open terminals. */
  readonly terminals?: TermHub;
}

/** One drawing of a screen: the state, the viewport, and how to act. */
export interface Ctx extends Viewport {
  readonly state: AppState;
  readonly draw: Draw;
  readonly route: Route;
  /** The pane or band this draw is for. */
  readonly pane: SiteId;
  /** The screen drawn in it. */
  readonly screen: PaneId | 'band';
  readonly nav: Nav;
  /** Go somewhere within this screen, here. */
  go(route: Route): void;
  /** Show another screen in this pane, at its home or a route of it. */
  show(screen: PaneId, route?: Route): void;
  /** Call the engine. Refreshes follow from the state it changes. */
  call(method: string, ...args: unknown[]): Promise<unknown>;
  /** A value from the engine that isn't in the state, fetched once then kept (redrawn when it lands). */
  load<T>(key: string, loader: () => Promise<T>, opts?: { readonly ttlMs?: number }): Loaded<T>;
  /** A press's own memory on this screen (a field's draft, a row folded open). */
  local<T>(key: string, initial: T): [T, (next: T) => void];
  /** Say this after the press (`toast`, `open`, `copy`). */
  effect(effects: Effects): void;
  /** Forget a loaded value so the next draw fetches it again. */
  refresh(key: string): void;
  /** Tell the core which conversation this session has open. */
  look(channel: string | undefined): void;
  /** This session's open terminals (none in a test that doesn't give them). */
  readonly terminals?: TermHub;
}

export interface Loaded<T> {
  readonly value?: T;
  readonly error?: string;
  readonly loading: boolean;
}

export interface Nav {
  go(pane: SiteId, route: Route): void;
  back(pane: SiteId): void;
  canGoBack(pane: SiteId): boolean;
  routeOf(pane: SiteId): Route;
}

export type Screen = (ctx: Ctx) => Node;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Answers kept for pressing what they draw. */
const MAX_ANSWERS = 200;

interface Cached {
  value?: unknown;
  error?: string;
  at: number;
  pending: boolean;
}

export const HOME_ROUTE: Readonly<Record<PaneId | 'band', Route>> = {
  band: { name: 'band' },
  work: { name: 'projects' },
  task: { name: 'none' },
  team: { name: 'friends' },
  board: { name: 'tasks' },
  sentinel: { name: 'list' },
  settings: { name: 'home' },
};

/** Where the engine's own idea of a place is drawn. */
export function routeOfView(view: View): Route | undefined {
  switch (view.kind) {
    case 'workspace':
      return { screen: 'task', name: view.tab === 'review' ? 'changes' : view.tab === 'files' ? 'files' : view.tab === 'terminal' ? 'terminal' : 'ws', params: { id: view.id } };
    case 'project':
      return { screen: 'work', name: 'project', params: { id: view.id } };
    case 'overview':
      return { screen: 'work', name: 'overview' };
    case 'search':
      return { screen: 'work', name: 'search' };
    case 'usage':
      return { screen: 'work', name: 'usage' };
    case 'claude_code':
      return { screen: 'work', name: 'activity' };
    case 'assistant':
      return { screen: 'work', name: 'assistant' };
    case 'requests':
      return { screen: 'team', name: 'requests' };
    case 'conversation':
      return { screen: 'team', name: 'conversation', params: { id: view.id } };
    case 'tasks':
      return { screen: 'board', name: 'tasks' };
    case 'task':
      return { screen: 'board', name: 'task', params: { id: view.id } };
    case 'plans':
      return { screen: 'board', name: 'plans' };
    case 'plan':
      return { screen: 'board', name: 'plan', params: { id: view.id } };
    case 'issues':
      return { screen: 'board', name: 'issues' };
    case 'gh_issue':
      return { screen: 'board', name: 'issue', params: { project: view.projectId, number: String(view.number) } };
    case 'actions':
      return { screen: 'board', name: 'actions' };
    case 'gh_run':
      return { screen: 'board', name: 'run', params: { project: view.projectId, run: String(view.runId) } };
    default:
      return undefined;
  }
}

/** Every pane's place and memory for one session, and how a press finds its handler again. */
export class Screens {
  private readonly routes = new Map<SiteId, Route[]>();
  private readonly cache = new Map<string, Cached>();
  private readonly memory = new Map<string, unknown>();
  private effects: Effects = {};
  private lastPane: PaneId = 'work';
  private readonly answers = new Map<`rich:${string}`, string>();

  constructor(
    private readonly host: ScreenHost,
    private readonly screens: Readonly<Record<PaneId | 'band', Screen>>,
    private readonly drawAnswer: (ctx: Ctx, answer: string) => Node = () => dim('Nothing to draw.'),
  ) {}

  readonly nav: Nav = {
    go: (pane, route) => {
      const stack = this.routes.get(pane) ?? [];
      this.routes.set(pane, [...stack, route].slice(-30));
      this.host.markDirty();
    },
    back: (pane) => {
      const stack = this.routes.get(pane) ?? [];
      this.routes.set(pane, stack.slice(0, -1));
      this.host.markDirty();
    },
    canGoBack: (pane) => (this.routes.get(pane)?.length ?? 0) > 0,
    routeOf: (pane) => this.routes.get(pane)?.at(-1) ?? (isRich(pane) ? HOME_ROUTE.band : HOME_ROUTE[pane]),
  };

  private context(pane: SiteId, state: AppState, viewport: Viewport, draw: Draw): Ctx {
    const route = this.nav.routeOf(pane);
    const screen: PaneId | 'band' = route.screen ?? (isRich(pane) ? 'band' : pane);
    const elsewhere = pane === 'band' || isRich(pane);
    return {
      ...viewport,
      state,
      draw,
      pane,
      screen,
      route,
      nav: this.nav,
      go: (next) => this.nav.go(pane, { ...(screen === 'band' ? {} : { screen }), ...next }),
      show: (shown, next) => {
        // The band and the transcript have no room for a screen: it opens in a pane.
        this.nav.go(roomFor(pane), { ...(next ?? HOME_ROUTE[shown]), screen: shown });
        if (elsewhere) this.effects = { ...this.effects, open: roomFor(pane) };
      },
      call: (method, ...args) => this.host.call(method, args),
      load: <T,>(key: string, loader: () => Promise<T>, opts: { ttlMs?: number } = {}) => this.loaded(key, loader, opts.ttlMs),
      local: <T,>(key: string, initial: T) => this.localValue(key, initial),
      effect: (effects) => {
        this.effects = { ...this.effects, ...effects };
      },
      refresh: (key) => {
        this.cache.delete(key);
        this.host.markDirty();
      },
      look: (channel) => this.host.look(channel),
      ...(this.host.terminals ? { terminals: this.host.terminals } : {}),
    };
  }

  private loaded<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Loaded<T> {
    const found = this.cache.get(key);
    const stale = found !== undefined && ttlMs !== undefined && Date.now() - found.at > ttlMs;
    if (!found || (stale && !found.pending)) {
      const entry: Cached = { ...found, at: Date.now(), pending: true };
      this.cache.set(key, entry);
      void loader()
        .then((value) => {
          entry.value = value;
          delete entry.error;
        })
        .catch((err: unknown) => {
          entry.error = errorText(err);
        })
        .finally(() => {
          entry.pending = false;
          entry.at = Date.now();
          this.host.markDirty();
        });
      return { ...(found?.value !== undefined ? { value: found.value as T } : {}), loading: true };
    }
    return { ...(found.value !== undefined ? { value: found.value as T } : {}), ...(found.error ? { error: found.error } : {}), loading: found.pending };
  }

  private localValue<T>(key: string, initial: T): [T, (next: T) => void] {
    const value = this.memory.has(key) ? (this.memory.get(key) as T) : initial;
    return [
      value,
      (next) => {
        this.memory.set(key, next);
        this.host.markDirty();
      },
    ];
  }

  private drawn(pane: SiteId, viewport: Viewport): { tree: Node; draw: Draw } {
    const draw = new Draw();
    const state = this.host.getState();
    if (!state) return { tree: dim('Connecting to the engine...'), draw };
    try {
      const ctx = this.context(pane, state, viewport, draw);
      const answer = isRich(pane) ? this.answers.get(pane) : undefined;
      if (isRich(pane) && answer === undefined) return { tree: dim('This answer is gone from memory.'), draw };
      return { tree: inert(answer !== undefined ? this.drawAnswer(ctx, answer) : this.screens[ctx.screen](ctx)), draw };
    } catch (err) {
      // Never a dead end: Back and Work still work from a screen that failed.
      const rescue = new Draw();
      const out = [dim(`This screen failed: ${errorText(err)}`)];
      if (this.nav.canGoBack(pane)) out.push(rescue.button('back', 'Back', () => this.nav.back(pane), { plain: true, hotkey: 'b' }));
      if (isPane(pane)) out.push(rescue.button('screen:work', 'Work', () => this.nav.go(pane, { ...HOME_ROUTE.work, screen: 'work' }), { plain: true, hotkey: 'w' }));
      return { tree: inert({ k: 'box', dir: 'column', children: out }), draw: rescue };
    }
  }

  /** An answer from the transcript that holds more than Markdown: remembered so its controls can be pressed. */
  remember(answer: string, site: `rich:${string}`): void {
    this.answers.delete(site);
    this.answers.set(site, answer);
    if (this.answers.size > MAX_ANSWERS) this.answers.delete(this.answers.keys().next().value!);
  }

  /**
   * The engine moved somewhere (a worktree you started, a task it opened): show it where you last
   * pressed. A view with no screen of ours stays where it is.
   */
  follow(view: View): void {
    const route = routeOfView(view);
    if (route) this.nav.go(this.lastPane, route);
  }

  /** A pane's tree as it stands. */
  view(pane: SiteId, viewport: Viewport): Node {
    return this.drawn(pane, viewport).tree;
  }

  /** Run a control's handler; a key gone since the last draw (the row went) is no error. */
  async press(pane: SiteId, key: string, value: string | undefined, viewport: Viewport): Promise<Effects & { readonly ok: boolean; readonly error?: string }> {
    if (isPane(pane)) this.lastPane = pane;
    const handler = this.drawn(pane, viewport).draw.handlers.get(key);
    if (!handler) return { ok: false, error: 'That is no longer there.' };
    this.effects = {};
    const before = new Set(autoFocused(this.drawn(pane, viewport).tree));
    try {
      await handler(value);
      this.host.markDirty();
      const brought = autoFocused(this.drawn(pane, viewport).tree).find((field) => !before.has(field));
      return { ok: true, ...this.effects, ...(brought ? { focus: brought } : {}) };
    } catch (err) {
      return { ok: false, error: errorText(err), ...this.effects };
    }
  }
}
