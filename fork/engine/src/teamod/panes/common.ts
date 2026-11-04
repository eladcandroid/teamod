import type { AppState } from '../../core/store.js';
import type { Workspace } from '../../workspaces/types.js';
import { stateOf } from '../../ui/workspace-models.js';
import type { Ctx, PaneId, Route } from '../screens.js';
import { type IconName, type Node, type Span, type Tone, col, dim, line, row, span, text } from '../tree.js';

/** The screens, in the order they read: one tap or one key from anywhere. */
const SCREENS: ReadonlyArray<{ readonly id: PaneId; readonly label: string; readonly hotkey: string; readonly icon: string }> = [
  { id: 'work', label: 'Work', hotkey: 'w', icon: '◆' },
  { id: 'task', label: 'Task', hotkey: 'k', icon: '▸' },
  { id: 'team', label: 'Team', hotkey: 't', icon: '◉' },
  { id: 'board', label: 'Board', hotkey: 'o', icon: '▤' },
  { id: 'sentinel', label: 'Sentinel', hotkey: 'l', icon: '◷' },
  { id: 'settings', label: 'Settings', hotkey: 'g', icon: '✱' },
];

/** Columns under which a desktop's header is two choices instead of rows of tabs. */
const NARROW = 80;

/** Each screen's picture on a desktop. */
const SCREEN_ICONS: Readonly<Record<PaneId, IconName>> = { work: 'work', task: 'task', team: 'team', board: 'board', sentinel: 'sentinel', settings: 'settings' };

export interface Place {
  readonly id: string;
  readonly label: string;
  readonly hotkey: string;
  readonly route: Route;
}

/**
 * The top of every screen: the screens as tabs (this one marked), the places within it as a quiet
 * row under them, and the Keys switch that shows or hides every hotkey.
 */
export function chrome(ctx: Ctx, places: readonly Place[] = [], here?: string): Node {
  // The terminal draws a control's spans (icons, the marked tab); a desktop draws its own buttons
  // from the label alone, and spaces them itself.
  const terminal = ctx.surface === 'terminal';
  const tabs = SCREENS.map((s) => {
    const current = s.id === ctx.screen;
    const press = ctx.draw.button(`screen:${s.id}`, s.label, () => ctx.show(s.id), {
      hotkey: s.hotkey,
      plain: true,
      ...(terminal
        ? { spans: current ? [span(` ${s.icon} ${s.label} `, { inverse: true, weight: 'bold' })] : [span(`${s.icon} ${s.label}`, { dim: true })] }
        : { pill: current ? ('on' as const) : ('off' as const), ...(current ? {} : { dim: true }) }),
    });
    return press;
  });
  const placeRow =
    places.length > 0 &&
    row(
      places.map((p) =>
        ctx.draw.button(`place:${p.id}`, p.label, () => ctx.go(p.route), {
          hotkey: p.hotkey,
          plain: true,
          ...(terminal
            ? { spans: p.id === here ? [span(p.label, { color: 'claude', weight: 'bold' })] : [span(p.label, { dim: true })] }
            : { pill: p.id === here ? ('on' as const) : ('off' as const), ...(p.id === here ? {} : { dim: true }) }),
        }),
      ),
      terminal ? { gap: 3, top: 1 } : { gap: 1 },
    );
  // A desktop: the screens as pill tabs (the whole pill presses), the places as smaller ones under
  // them. Where those would wrap (a narrow pane), one row of two choices instead: screen, place.
  if (!terminal && ctx.columns < NARROW) {
    return row(
      [
        ctx.draw.select('nav:screen', SCREENS.map((s) => ({ value: s.id, label: s.label })), (next) => (next && next !== ctx.screen ? ctx.show(next as PaneId) : undefined), { value: ctx.screen }),
        places.length > 0 &&
          ctx.draw.select('nav:place', places.map((p) => ({ value: p.id, label: p.label })), (next) => {
            const place = places.find((p) => p.id === next);
            return place && place.id !== here ? ctx.go(place.route) : undefined;
          }, here ? { value: here } : {}),
      ],
      { gap: 1, wrap: false },
    );
  }
  if (!terminal) return col([row(tabs, { gap: 1 }), placeRow], { gap: 1 });
  const keys = ctx.draw.button('keys', ctx.prefs.keys ? 'Hide keys' : 'Keys', () => ctx.setPrefs({ keys: !ctx.prefs.keys }), { plain: true, hotkey: '0', dim: true });
  return col([row([row(tabs, { gap: 2 }), keys], { justify: 'space-between', wrap: false }), placeRow, rule(ctx)]);
}

/** A hairline across the pane. */
export const rule = (ctx: Ctx): Node =>
  // A desktop wraps a row of characters wider than its pane: it gets space instead.
  ctx.surface === 'terminal' ? dim('─'.repeat(Math.max(8, Math.min(ctx.columns - 2, 200)))) : col([], { top: 1 });

export type { Tone };
// Only the theme's own status colors: they follow the person's theme, light or dark.
const TONE_COLOR: Readonly<Record<Tone, string | undefined>> = { ok: 'success', warn: 'warning', error: 'error', accent: 'claude', info: 'claude', quiet: undefined };

/**
 * A card: one thing (a worktree, a task, a teammate, an automation) in a rounded box. Quiet by
 * default; `tone` colors the border for the one that needs attention. `title` is its name, bold.
 */
export function card(children: ReadonlyArray<Node | false | undefined | null>, opts: { readonly title?: string | readonly Span[]; readonly tone?: Tone; readonly key?: string } = {}): Node {
  const color = opts.tone ? TONE_COLOR[opts.tone] : undefined;
  const head = opts.title === undefined ? undefined : typeof opts.title === 'string' ? text(opts.title, { weight: 'bold' }) : line(...opts.title);
  return col([head, ...children], { card: true, hover: Boolean(opts.key), ...(opts.key ? { key: opts.key } : {}), border: 'round', padX: 1, ...(color ? { borderColor: color } : { borderDim: true }) });
}

/** A state in a word or two, colored: `● Ready to merge`. */
export const pill = (label: string, tone: Tone = 'quiet', icon = '●'): Span => span(`${icon} ${label}`, { tone, ...(TONE_COLOR[tone] ? { color: TONE_COLOR[tone] } : { dim: true }) });

/** A small picture: a screen's, a folder's, a branch's. A desktop draws it; the terminal a glyph. */
export const icon = (name: IconName, tone?: Tone): Node => ({ k: 'icon', name, ...(tone ? { tone } : {}) });

/** A project's or a person's badge, on surfaces that draw pictures (none on the terminal). */
export const avatar = (ctx: Ctx, name: string, size?: number): Node | undefined => (ctx.surface === 'terminal' ? undefined : { k: 'avatar', name, ...(size ? { size } : {}) });

/** Small print after a name: parts joined by a dim dot. */
export function meta(...parts: ReadonlyArray<string | Span | false | undefined | null>): Node {
  const kept = parts.filter((p): p is string | Span => Boolean(p));
  return line(...kept.flatMap((p, i) => [...(i ? [span(' · ', { dim: true, size: 'footnote' })] : []), typeof p === 'string' ? span(p, { dim: true, size: 'footnote' }) : { size: 'footnote' as const, ...p }]));
}

/** A labelled group of rows: its heading dim and bold, a count beside it if given. */
export function section(title: string, children: ReadonlyArray<Node | false | undefined | null>, count?: number): Node {
  return col([line(span(title, { weight: 'bold', size: 'heading' }), count !== undefined && span(`  ${count}`, { dim: true, size: 'heading' })), ...children], { top: 1 });
}

/** A label and its value on one row. */
export const field = (label: string, value: string | Span): Node => line(span(`${label}  `, { dim: true }), value);

/** The actions under a thing: the main one first, drawn as the button to press; the rest quiet. */
export function actions(main: Node | false | undefined | null, ...rest: ReadonlyArray<Node | false | undefined | null>): Node {
  return row([main, ...rest], { gap: 2, top: 1 });
}

/** Back, when this pane has somewhere to go back to. */
export function back(ctx: Ctx, label = 'Back'): Node | undefined {
  return ctx.nav.canGoBack(ctx.pane) ? ctx.draw.button('back', `‹ ${label}`, () => ctx.nav.back(ctx.pane), { plain: true, hotkey: 'b', dim: true, ...(ctx.surface === 'terminal' ? {} : { pill: 'off' as const }) }) : undefined;
}

/** A screen's sections, a blank row apart (a section's own space above it is that row, not a second). */
export const page = (...children: ReadonlyArray<Node | false | undefined | null>): Node =>
  col(
    children.map((c) => (c && c.k === 'box' && c.top === 1 ? { ...c, top: 0 } : c)),
    { gap: 1 },
  );

export const empty = (words: string): Node => col([dim(words)], { top: 1 });

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
