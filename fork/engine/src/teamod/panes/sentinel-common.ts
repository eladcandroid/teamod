import { convTopic, needsYou } from '../../companion/needs-you.js';
import { RUN_STATE_INFO, type RunState, type Sentinel, type SentinelPatch, type StepState } from '../../core/sentinel/model.js';
import type { DomainState } from '../../core/store.js';
import type { Ctx, Loaded, Route } from '../screens.js';
import { type Node, type Span, col, dim, span, text } from '../tree.js';
import { type Place, type Tone, actions, card, chrome, openWorkspace, pill } from './common.js';
import { type Choice, STEP_STATE_WORDS } from './sentinel-model.js';

/** What every Sentinel screen shares: its places, how a long list is windowed, its fields, where to go after. */

// ---------------------------------------------------------------- the cards' small parts

const RUN_TONE: Readonly<Record<RunState, Tone>> = { done: 'ok', failed: 'error', running: 'accent', queued: 'accent', 'needs-you': 'warn', skipped: 'quiet', stopped: 'quiet' };
const RUN_ICON: Readonly<Record<RunState, string>> = { done: '✓', failed: '✗', running: '●', queued: '○', 'needs-you': '●', skipped: '–', stopped: '■' };

/** How a run went, as a pill: `✓ Done`, `✗ Failed`. */
export const runPill = (state: RunState): Span => pill(RUN_STATE_INFO[state].label, RUN_TONE[state], RUN_ICON[state]);

/** A run's card border: only what needs a look (failed, or waiting for you) is coloured. */
export const runTone = (state: RunState): Tone | undefined => (state === 'failed' ? 'error' : state === 'needs-you' ? 'warn' : undefined);

const STEP_TONE: Readonly<Record<StepState, Tone>> = { done: 'ok', failed: 'error', running: 'accent', waiting: 'quiet', skipped: 'quiet' };
const STEP_ICON: Readonly<Record<StepState, string>> = { done: '✓', failed: '✗', running: '●', waiting: '○', skipped: '–' };

/** How a run's step went, as a pill. */
export const stepPill = (state: StepState): Span => pill(STEP_STATE_WORDS[state], STEP_TONE[state], STEP_ICON[state]);

/** A card's title with a count beside it: `Steps  3`. */
export const counted = (title: string, count?: number): Span[] => [span(title, { weight: 'bold' }), ...(count !== undefined ? [span(`  ${count}`, { dim: true })] : [])];

/** A row in a list that opens something: a dim marker before it. */
export const marked = (words: string, mark = '›'): Span[] => [span(`${mark} `, { dim: true }), span(words)];

export type Here = 'sentinels' | 'dashboards' | 'chat';

const PLACES: readonly Place[] = [
  { id: 'sentinels', label: 'Sentinels', hotkey: 's', route: { name: 'list' } },
  { id: 'dashboards', label: 'Dashboards', hotkey: 'd', route: { name: 'dashboards' } },
  { id: 'chat', label: 'Chat', hotkey: 'c', route: { name: 'chat' } },
];

export const top = (ctx: Ctx, here?: Here): Node => chrome(ctx, PLACES, here);

/** A draw holds this many rows of a list at most: More moves along it. */
export const MOST_ROWS = 100;
const PAGE_ROWS = 40;

export interface Window<T> {
  readonly shown: readonly T[];
  /** Before the shown rows. */
  readonly before?: Node;
  /** After them. */
  readonly after?: Node;
}

/**
 * A long list, a piece at a time. `newest`: it reads toward its end (a conversation), so it starts
 * there and Earlier goes back; otherwise it starts at the top and More goes on. Either way the rows
 * left behind fall out of the draw, so it never holds more than MOST_ROWS.
 */
export function windowed<T>(ctx: Ctx, key: string, items: readonly T[], opts: { readonly page?: number; readonly newest?: boolean } = {}): Window<T> {
  const page = opts.page ?? PAGE_ROWS;
  const [wanted, setWanted] = ctx.local(`sn:window:${key}`, page);
  const n = items.length;
  const seen = Math.max(page, Math.min(wanted, n));
  const more = (label: string, id: string, to: number): Node => ctx.draw.button(`${key}:${id}`, label, () => setWanted(to), { plain: true, dim: true });
  if (opts.newest) {
    const first = Math.max(0, n - seen);
    const end = Math.min(n, first + MOST_ROWS);
    return {
      shown: items.slice(first, end),
      ...(first > 0 ? { before: more(`Earlier (${first})`, 'earlier', seen + page) } : {}),
      ...(end < n ? { after: more(`Later (${n - end})`, 'later', seen - page) } : {}),
    };
  }
  const end = Math.min(n, seen);
  const first = Math.max(0, end - MOST_ROWS);
  return {
    shown: items.slice(first, end),
    ...(first > 0 ? { before: more(`Earlier (${first})`, 'earlier', seen - page) } : {}),
    ...(end < n ? { after: more(`More (${n - end})`, 'more', seen + page) } : {}),
  };
}

/** What a fetched value has to say for itself while there's none to draw: an error, or that it's coming. */
export function loadNote<T>(loaded: Loaded<T>, loading = 'Loading...'): Node | undefined {
  if (loaded.error) return text(loaded.error, { color: 'error' });
  return loaded.value === undefined && loaded.loading ? dim(loading) : undefined;
}

/** A choice, on its own row. What's set now stays in the list even when it isn't one of the usual; picking it again does nothing. */
export function pick(ctx: Ctx, key: string, label: string, options: readonly Choice[], value: string, onPick: (value: string) => unknown): Node {
  const all = options.some((o) => o.value === value) ? options : [...options, { value, label: value || 'None' }];
  return ctx.draw.select(key, all, (v) => (v !== undefined && v !== value ? onPick(v) : undefined), { label, value });
}

/** A text field, on its own row: Enter saves. */
export function field(ctx: Ctx, key: string, label: string, value: string, onSave: (value: string) => unknown, opts: { readonly placeholder?: string; readonly rows?: number; readonly submitLabel?: string; readonly autoFocus?: true } = {}): Node {
  return ctx.draw.input(key, (v) => (v !== undefined && v !== value ? onSave(v) : undefined), { label, value, submitLabel: 'save', ...opts });
}

/**
 * Off a page whose subject just went: back past every route of Sentinel's that `gone` says was about
 * it (and the question that asked), to where the person came from.
 */
export function leave(ctx: Ctx, gone: (route: Route) => boolean = () => false): void {
  while (ctx.nav.canGoBack(ctx.pane)) {
    const route = ctx.nav.routeOf(ctx.pane);
    if ((route.screen ?? ctx.pane) !== 'sentinel' || (route.name !== 'ask' && !gone(route))) return;
    ctx.nav.back(ctx.pane);
  }
}

/** How a sentinel's fields save: at once, as on the Mac. */
export const saver = (ctx: Ctx, s: Sentinel) => (patch: SentinelPatch): Promise<unknown> => ctx.call('sentinel.update', s.id, patch);

export const openSentinel = (ctx: Ctx, id: string): void => ctx.go({ name: 'page', params: { id } });
export const openRun = (ctx: Ctx, run: { readonly id: string; readonly sentinelId: string }): void => ctx.go({ name: 'run', params: { run: run.id, id: run.sentinelId } });

/** A conversation: a worktree's or project chat's opens on the Task screen, anything else as a read here. */
export function openChannel(ctx: Ctx, channel: string): void {
  if (channel.startsWith('ws:')) openWorkspace(ctx, channel.slice(3));
  else ctx.go({ name: 'session', params: { channel } });
}

/** A web link's node; anything else isn't a link. */
export const webLink = (href: string, words: string): Node => (/^https?:\/\//i.test(href) ? { k: 'link', href, text: words } : dim(words));

/** What a conversation waits on you for (its approvals), with what you can answer, here where you're reading it. */
export function attention(ctx: Ctx, channel: string | undefined): Node | undefined {
  const topic = channel ? convTopic(channel) : undefined;
  if (!topic) return undefined;
  const needs = needsYou(ctx.state as unknown as DomainState).filter((n) => n.topic === topic);
  if (!needs.length) return undefined;
  return col(
    needs.slice(0, 5).map((need) =>
      card(
        [
          text(need.title),
          need.detail ? dim(need.detail.split('\n').slice(0, 2).join(' ').slice(0, 200)) : undefined,
          need.answer ? dim('Answer it in the band above the prompt.') : undefined,
          need.actions.length > 0 && actions(undefined, ...need.actions.map((action, i) => ctx.draw.button(`attention:${need.id}:${i}`, action.label, () => ctx.call(action.method, ...action.args), { plain: true }))),
        ],
        { title: [span('● Needs you', { color: 'warning', weight: 'bold' })], tone: 'warn' },
      ),
    ),
    { gap: 1 },
  );
}
