import { ASSISTANT_TITLE } from '../../shared/assistant.js';
import { type WorkspaceState, activityOf, stateOf } from '../../ui/workspace-models.js';
import { worktreeOrigin } from '../../workspaces/origin.js';
import type { Project, Workspace } from '../../workspaces/types.js';
import type { AppState } from '../../core/store.js';
import type { Ctx, Loaded, Route } from '../screens.js';
import { type Node, type Span, col, dim, row, span, text } from '../tree.js';
import { ago, card, icon, meta, openWorkspace, pill, type Place, type Tone } from './common.js';

/** What the Work screen's rows share. Settings uses the windows, the two-press buttons and the fields too. */

/** A project's work in progress: yours, not a sub-agent's, not archived, not the main checkout. */
export const activeOf = (project: Project): Workspace[] =>
  project.workspaces.filter((w) => !w.archived && w.kind !== 'main' && worktreeOrigin(w) !== 'agent');

/** The places of the Work screen, and how many unread notices wait in the inbox. */
export function placesOf(ctx: Ctx): readonly Place[] {
  const unread = ctx.state.inbox.filter((n) => !n.read).length;
  return [
    { id: 'projects', label: 'Projects', hotkey: 'p', route: { name: 'projects' } },
    { id: 'worktrees', label: 'Worktrees', hotkey: 'r', route: { name: 'worktrees' } },
    { id: 'overview', label: 'Overview', hotkey: 'v', route: { name: 'overview' } },
    { id: 'search', label: 'Search', hotkey: 's', route: { name: 'search' } },
    { id: 'usage', label: 'Usage', hotkey: 'u', route: { name: 'usage' } },
    { id: 'activity', label: 'Activity', hotkey: 'y', route: { name: 'activity' } },
    { id: 'inbox', label: unread ? `Inbox (${unread})` : 'Inbox', hotkey: 'i', route: { name: 'inbox' } },
    { id: 'assistant', label: ASSISTANT_TITLE, hotkey: 'm', route: { name: 'assistant' } },
  ];
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** "just now", "5m ago". */
export const agoWords = (ts: number): string => {
  const words = ago(ts);
  return words === 'now' ? 'just now' : `${words} ago`;
};

/** A page's own title, bold, with a line or two about it under it. */
export const heading = (words: string, ...about: ReadonlyArray<string | undefined | false>): Node => col([text(words, { weight: 'bold' }), ...about.map((a) => (a ? dim(a) : undefined))]);

/** How many things a list draws as cards; past that, the same things as compact rows. */
export const CARD_LIMIT = 8;

const STATE_TONE: Readonly<Record<WorkspaceState['tone'], Tone>> = { error: 'error', warn: 'warn', claude: 'accent', info: 'ok', ok: 'ok', muted: 'quiet' };

/** A worktree's or chat's state as a colored pill: `● Ready to merge · 2 commits`. */
export function wsPill(state: AppState, ws: Workspace): Span {
  const st = stateOf(state, ws, 0);
  return pill(st.label, STATE_TONE[st.tone], st.icon);
}

/** The border of a worktree's card: only for what needs you, failed, or is ready. */
export function wsTone(state: AppState, ws: Workspace): Tone | undefined {
  const tone = stateOf(state, ws, 0).tone;
  return tone === 'error' ? 'error' : tone === 'warn' ? 'warn' : tone === 'info' ? 'ok' : undefined;
}

/** A worktree's row: its name and its state. It opens in this pane. */
export function workspaceRow(ctx: Ctx, ws: Workspace): Node {
  const unread = ctx.state.unread[`ws:${ws.id}`];
  const press = ctx.draw.button(`ws:${ws.id}`, ws.name, () => openWorkspace(ctx, ws.id), { plain: true, spans: [span(`${ws.name}  `), wsPill(ctx.state, ws), ...(unread ? [span(`  ${unread} new`, { color: 'claude' })] : [])] });
  // A desktop: its branch's picture beside it, the row lit under the pointer.
  return ctx.surface === 'terminal' ? press : row([icon(ws.kind === 'chat' ? 'chat' : 'branch'), press], { gap: 1, wrap: false, key: `wsrow:${ws.id}`, hover: true, padX: 1 });
}

/**
 * How long ago, for a time that may be missing (a worktree made outside teamod) or in seconds
 * rather than milliseconds: never "20761d" for a time that isn't one.
 */
function whenOf(ts: number | undefined): string | undefined {
  if (!ts || ts <= 0) return undefined;
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return ms < Date.UTC(2015, 0, 1) || ms > Date.now() + 86_400_000 ? undefined : ago(ms);
}

/** A worktree or chat in progress, as a card: its name, its state and when, what was said last, and Open. */
export function workspaceCard(ctx: Ctx, ws: Workspace): Node {
  const act = activityOf(ctx.state.log, `ws:${ws.id}`);
  const unread = ctx.state.unread[`ws:${ws.id}`];
  const open = (): void => openWorkspace(ctx, ws.id);
  const last = act.last ? act.last.slice(0, Math.max(30, ctx.columns - 12)) : undefined;
  return card(
    [
      row([ctx.draw.button(`ws:${ws.id}`, ws.name, open, { plain: true, spans: [span(ws.name, { weight: 'bold' })] }), ctx.draw.button(`ws:${ws.id}:open`, 'Open', open, { plain: true, spans: [span('Open ›', { color: 'claude' })] })], { justify: 'space-between', gap: 2 }),
      meta(wsPill(ctx.state, ws), ws.kind !== 'chat' && whenOf(act.lastTs ?? ws.createdAt), unread ? span(`${unread} new`, { color: 'claude' }) : undefined),
      last ? dim(last) : undefined,
    ],
    { tone: wsTone(ctx.state, ws) },
  );
}

/** Open a worktree the engine may have opened already: its intent arrives before the call's answer, and one Back should do. */
export function openOnce(ctx: Ctx, id: string): void {
  const now = ctx.nav.routeOf(ctx.pane);
  if (now.screen === 'task' && now.params?.id === id) return;
  openWorkspace(ctx, id);
}

/** A list too long for one draw: how many rows it holds at a time. */
export const PAGE_ROWS = 50;

export interface Windowed<T> {
  readonly shown: readonly T[];
  /** More and Earlier, when there's more than one page; undefined otherwise. */
  readonly controls: Node | undefined;
}

/**
 * One page of a long list, with presses for the pages either side. Never grows: a draw stays small
 * however long the list. `keys`: this page's only list, so More and Earlier get their letters.
 */
export function windowed<T>(ctx: Ctx, key: string, items: readonly T[], opts: { readonly size?: number; readonly keys?: boolean } = {}): Windowed<T> {
  const size = opts.size ?? PAGE_ROWS;
  const [asked, setOffset] = ctx.local(`window:${key}`, 0);
  const last = Math.max(0, Math.floor((items.length - 1) / size) * size);
  const offset = Math.min(asked, last);
  const end = offset + size;
  const more = Math.max(0, items.length - end);
  if (offset === 0 && more === 0) return { shown: items, controls: undefined };
  return {
    shown: items.slice(offset, end),
    controls: row([
      offset > 0 && ctx.draw.button(`${key}:earlier`, `Earlier (${offset})`, () => setOffset(Math.max(0, offset - size)), { plain: true, dim: true, ...(opts.keys ? { hotkey: 'q' } : {}) }),
      more > 0 && ctx.draw.button(`${key}:more`, `More (${more})`, () => setOffset(end), { plain: true, ...(opts.keys ? { hotkey: 'j' } : {}) }),
      dim(`${offset + 1} to ${Math.min(end, items.length)} of ${items.length}`),
    ]),
  };
}

/** How long a two-press button stays armed. */
const ARMED_MS = 15_000;

/**
 * Something that can't be undone, in place: the first press only arms it and says so; the second,
 * soon after, does it. A later press arms it again rather than acting on an old intent.
 */
export function twoPress(ctx: Ctx, key: string, label: string, run: () => unknown | Promise<unknown>): Node {
  const [armedAt, setArmedAt] = ctx.local(`armed:${key}`, 0);
  const armed = armedAt > 0 && Date.now() - armedAt < ARMED_MS;
  const shown = armed ? `Press Again to ${label}` : label;
  return ctx.draw.button(
    key,
    shown,
    async () => {
      if (!armed) {
        setArmedAt(Date.now());
        return;
      }
      setArmedAt(0);
      await run();
    },
    { plain: true, ...(armed ? { spans: [span(shown, { color: 'error' })] } : { dim: true }) },
  );
}

/** Ask first, on a page of its own (work-confirm.ts). */
export const askFirst = (ctx: Ctx, act: string, params: Readonly<Record<string, string>> = {}): void => ctx.go({ name: 'confirm', params: { act, ...params } });

/** Back through this pane's places to `name`: what's in between may be gone. */
export function backTo(ctx: Ctx, name: string): void {
  while (ctx.nav.canGoBack(ctx.pane) && ctx.nav.routeOf(ctx.pane).name !== name) ctx.nav.back(ctx.pane);
}

/** A value fetched again (`refresh`) stays on the screen while it is, rather than blinking away. */
export function steady<T>(ctx: Ctx, key: string, loader: () => Promise<T>, opts?: { readonly ttlMs?: number }): Loaded<T> {
  const loaded = ctx.load<T>(key, loader, opts);
  const [kept, keep] = ctx.local<T | undefined>(`steady:${key}`, undefined);
  if (loaded.value !== undefined && loaded.value !== kept) keep(loaded.value);
  return loaded.value === undefined && kept !== undefined ? { ...loaded, value: kept } : loaded;
}

/** A loaded value's state, in words: nothing once it's there. */
export function loadingWords<T>(loaded: Loaded<T>, words = 'Loading...', failed = 'That didn’t work'): Node | undefined {
  if (loaded.error) return text(`${failed}: ${loaded.error}`, { color: 'error' });
  return loaded.value === undefined && loaded.loading ? dim(words) : undefined;
}

/** A choice of a few: the one chosen stands out. */
export function segments<T extends string>(ctx: Ctx, key: string, options: ReadonlyArray<{ readonly value: T; readonly label: string; readonly hotkey?: string }>, value: T, set: (next: T) => void): Node {
  return row(
    options.map((o) => ctx.draw.button(`${key}:${o.value}`, o.label, () => set(o.value), { plain: true, ...(o.value === value ? {} : { dim: true }), ...(o.hotkey ? { hotkey: o.hotkey } : {}) })),
    { gap: 2 },
  );
}

/** A press that opens a search field; while something's searched for, says what and clears. */
export function findField(ctx: Ctx, key: string, placeholder: string, hotkey = 'f'): { readonly query: string; readonly node: Node } {
  const [query, setQuery] = ctx.local(`${key}:query`, '');
  const [open, setOpen] = ctx.local(`${key}:finding`, false);
  if (open) {
    return {
      query,
      node: ctx.draw.input(
        `${key}:box`,
        (value) => {
          setOpen(false);
          setQuery(value?.trim() ?? '');
        },
        { placeholder, value: query, submitLabel: 'find', autoFocus: true },
      ),
    };
  }
  if (query) return { query, node: row([dim(`Showing “${query}”`), ctx.draw.button(`${key}:clear`, 'Clear', () => setQuery(''), { plain: true, hotkey })]) };
  return { query, node: ctx.draw.button(`${key}:find`, 'Find', () => setOpen(true), { plain: true, dim: true, hotkey }) };
}

/**
 * One value you change: a row until pressed, then a field holding it (or, `secret`, an empty one: what
 * you type is never drawn again). Only one thing to submit on the page at a time, so nothing typed is lost.
 */
export function field(
  ctx: Ctx,
  key: string,
  label: string,
  value: string,
  save: (next: string) => unknown | Promise<unknown>,
  opts: { readonly placeholder?: string; readonly detail?: string; readonly none?: string; readonly secret?: boolean; readonly hotkey?: string } = {},
): Node {
  const [open, setOpen] = ctx.local(`field:${key}`, false);
  if (open) {
    return col([
      ctx.draw.input(
        `${key}:box`,
        async (typed) => {
          setOpen(false);
          await save(typed?.trim() ?? '');
        },
        { label, ...(opts.secret ? {} : { value }), ...(opts.placeholder ? { placeholder: opts.placeholder } : {}), submitLabel: 'save', autoFocus: true },
      ),
      ctx.draw.button(`${key}:cancel`, 'Cancel', () => setOpen(false), { plain: true, dim: true }),
    ]);
  }
  return col([
    ctx.draw.button(key, label, () => setOpen(true), { plain: true, ...(opts.hotkey ? { hotkey: opts.hotkey } : {}), spans: [span(`${label}: `, { dim: true }), span(value || (opts.none ?? 'none'), value ? {} : { dim: true })] }),
    opts.detail ? dim(opts.detail) : undefined,
  ]);
}

/** Committed work not in its base yet, nothing uncommitted, no conflict, the agent not working, no PR that already ended. */
export function isReady(state: Pick<AppState, 'log' | 'conflicts' | 'prs'>, ws: Workspace): boolean {
  const pr = state.prs[ws.id];
  if (pr && pr.state !== 'OPEN') return false;
  return ws.kind === 'worktree' && !ws.archived && !state.conflicts[ws.id]?.length && !activityOf(state.log, `ws:${ws.id}`).running && !ws.status?.changed && (ws.status?.ahead ?? 0) > 0;
}

/** Each of these, for a press over many: what failed says why, and the rest go on. Sequential: one at a time, for what takes the disk's attention. */
export async function eachOf(ids: readonly string[], work: (id: string) => Promise<unknown>, how: 'together' | 'sequential' = 'together'): Promise<string | undefined> {
  const failed: string[] = [];
  const one = (id: string): Promise<void> => work(id).then(
    () => undefined,
    (err: unknown) => void failed.push(errorText(err)),
  );
  if (how === 'together') await Promise.all(ids.map(one));
  else for (const id of ids) await one(id);
  return failed.length ? failed.join(' ') : undefined;
}

/** Each thing once: a key on a screen can't be drawn twice. */
export const uniqueBy = <T>(items: readonly T[], key: (item: T) => string): T[] => [...new Map(items.map((item) => [key(item), item])).values()];

/** Plain routes in one place: the worktree's page, a project's. */
export const projectRoute = (id: string): Route => ({ name: 'project', params: { id } });
export const worktreeRoute = (id: string): Route => ({ name: 'worktree', params: { id } });
