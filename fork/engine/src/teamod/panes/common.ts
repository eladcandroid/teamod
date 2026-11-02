import type { AppState } from '../../core/store.js';
import type { Workspace } from '../../workspaces/types.js';
import { stateOf } from '../../ui/workspace-models.js';
import type { Ctx, PaneId, Route } from '../screens.js';
import { type Node, type Span, col, dim, row, span } from '../tree.js';

/** The screens, in the order they read: one tap or one key from anywhere. */
const SCREENS: ReadonlyArray<{ readonly id: PaneId; readonly label: string; readonly hotkey: string }> = [
  { id: 'work', label: 'Work', hotkey: 'w' },
  { id: 'task', label: 'Task', hotkey: 'k' },
  { id: 'team', label: 'Team', hotkey: 't' },
  { id: 'board', label: 'Board', hotkey: 'o' },
  { id: 'sentinel', label: 'Sentinel', hotkey: 'l' },
  { id: 'settings', label: 'Settings', hotkey: 'g' },
];

export interface Place {
  readonly id: string;
  readonly label: string;
  readonly hotkey: string;
  readonly route: Route;
}

/** The top of every screen: which screen, and the places within this one. */
export function chrome(ctx: Ctx, places: readonly Place[] = [], here?: string): Node {
  return col([
    row(
      SCREENS.map((s) =>
        ctx.draw.button(`screen:${s.id}`, s.label, () => ctx.show(s.id), { hotkey: s.hotkey, plain: true, ...(s.id === ctx.screen ? {} : { dim: true }) }),
      ),
      { gap: 2 },
    ),
    places.length > 0 &&
      row(
        places.map((p) => ctx.draw.button(`place:${p.id}`, p.label, () => ctx.go(p.route), { hotkey: p.hotkey, plain: true, ...(p.id === here ? {} : { dim: true }) })),
        { gap: 2 },
      ),
  ]);
}

/** Back, when this pane has somewhere to go back to. */
export function back(ctx: Ctx, label = 'Back'): Node | undefined {
  return ctx.nav.canGoBack(ctx.pane) ? ctx.draw.button('back', `‹ ${label}`, () => ctx.nav.back(ctx.pane), { plain: true, hotkey: 'b', dim: true }) : undefined;
}

export const page = (...children: ReadonlyArray<Node | false | undefined | null>): Node => col(children, { gap: 1 });

export const empty = (words: string): Node => dim(words);

/** A workspace's state in a word or two, coloured for the surface's own theme. */
export function statusOf(state: AppState, ws: Workspace): Span {
  const st = stateOf(state, ws, 0);
  const color = st.tone === 'error' ? 'error' : st.tone === 'warn' ? 'warning' : st.tone === 'ok' ? 'success' : undefined;
  return span(`${st.icon} ${st.label}`, color ? { color } : { dim: true });
}

/**
 * Where a workspace is shown: the Task screen, in this pane. From the band, which has no room for
 * it, in the Work pane (opened if it wasn't).
 */
export function openWorkspace(ctx: Ctx, id: string): void {
  void ctx.call('workspaces.load', id);
  ctx.look(`ws:${id}`);
  ctx.show('task', { name: 'ws', params: { id } });
}

export function findWorkspace(state: AppState, id: string): Workspace | undefined {
  for (const project of state.projects) {
    const found = project.workspaces.find((w) => w.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Short for a time gone by. */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

/**
 * What someone else wrote, ready for `md`: it's drawn, never acted on, and a link in it can only go
 * to the web, so a teammate's message can't point a press at a file on this computer.
 */
export const peerText = (raw: string): string =>
  raw
    .replace(/!\[/g, '[')
    .replace(/<\/?(?:a|img|iframe|script|style|link|object|embed|video|audio|source)\b[^>]*>/gi, '')
    .replace(/\]\(\s*(?!<?https?:)[^)]*\)/gi, ']')
    .replace(/^ {0,3}\[[^\]\n]+\]:[ \t]*(?!<?https?:)\S.*$/gim, '')
    .replace(/<((?!https?:)[a-z][a-z0-9+.-]*:[^>\s]*)>/gi, '$1');

export const homePath = (state: AppState, p: string): string => (state.home && p.startsWith(state.home) ? `~${p.slice(state.home.length)}` : p);
