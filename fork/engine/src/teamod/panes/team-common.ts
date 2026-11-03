import type { TaskView } from '../../core/gateway/model.js';
import type { AppState } from '../../core/store.js';
import { defaultTrust } from '../../core/trust.js';
import type { PersonView, PresenceState } from '../../net/mesh/views.js';
import type { TrustLevel } from '../../shared/settings-schema.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, col, dim, inert, row, span, text } from '../tree.js';

export { inert };
import { type Place, type Tone, chrome, peerText, pill } from './common.js';

/** How many rows a list shows before More, and the most one draw ever holds. */
export const ROWS = 30;
export const MAX_ROWS = 100;

/** A request that waits for your answer: their ask, your agent's ask of someone new, their agent's question. */
export const needsYou = (t: Pick<TaskView, 'direction' | 'state' | 'question'>): boolean => (t.direction === 'sent' ? t.state === 'confirm' || Boolean(t.question) : t.state === 'awaiting_approval');

function placesOf(state: AppState): readonly Place[] {
  const { friends, groups } = state.network;
  const unread = friends.reduce((n, f) => n + f.unread, 0) + groups.reduce((n, g) => n + (g.active ? g.unread : 0), 0);
  const waiting = state.gateway.tasks.filter(needsYou).length;
  return [
    { id: 'people', label: 'People', hotkey: 'p', route: { name: 'friends' } },
    { id: 'chats', label: unread ? `Chats (${unread})` : 'Chats', hotkey: 'c', route: { name: 'chats' } },
    { id: 'requests', label: waiting ? `Requests (${waiting})` : 'Requests', hotkey: 'r', route: { name: 'requests' } },
    { id: 'sharing', label: 'Sharing', hotkey: 's', route: { name: 'sharing' } },
    { id: 'boards', label: 'Boards', hotkey: 'e', route: { name: 'boards' } },
    { id: 'dialogues', label: 'Dialogues', hotkey: 'd', route: { name: 'dialogues' } },
  ];
}

/** The top of every Team screen. */
export const top = (ctx: Ctx, here?: string): Node => chrome(ctx, placesOf(ctx.state), here);

/** A list's rows, a window at a time: never the whole of a long list in one draw. */
export function listOf<T>(ctx: Ctx, key: string, items: readonly T[], draw: (item: T, index: number) => Node | undefined, size = ROWS): Node {
  const [limit, setLimit] = ctx.local(`${key}:shown`, size);
  const end = Math.min(limit, items.length);
  const start = Math.max(0, end - MAX_ROWS);
  const rest = items.length - end;
  return col([
    start > 0 && ctx.draw.button(`${key}:above`, `Earlier (${start})`, () => setLimit(Math.max(size, limit - size)), { plain: true, dim: true }),
    ...items.slice(start, end).map((item, i) => draw(item, start + i)),
    rest > 0 && ctx.draw.button(`${key}:more`, `More (${rest})`, () => setLimit(limit + size), { plain: true, dim: true }),
  ]);
}

/** One of a few values, the one in force not dimmed. */
export const choice = (ctx: Ctx, key: string, label: string, on: boolean, press: () => unknown, hotkey?: string): Node =>
  ctx.draw.button(key, label, press, { plain: true, ...(on ? {} : { dim: true }), ...(hotkey ? { hotkey } : {}) });

/** One that's on or off, ticked: `✓ Knock first`. Its label keeps the `[x]` it had, for keys and readers. */
export const tick = (ctx: Ctx, key: string, label: string, on: boolean, press: () => unknown): Node =>
  ctx.draw.button(key, `${on ? '[x]' : '[ ]'} ${label}`, press, { plain: true, spans: [span(on ? '✓ ' : '○ ', on ? { color: 'success' } : { dim: true }), span(label, on ? { weight: 'bold' } : { dim: true })] });

/** What takes something away says so once more, in place, before it does. */
export function confirmPress(ctx: Ctx, key: string, label: string, words: string, run: () => unknown, hotkey?: string): Node {
  const [asking, setAsking] = ctx.local(`${key}:asking`, false);
  if (!asking) return ctx.draw.button(key, label, () => setAsking(true), { plain: true, dim: true, ...(hotkey ? { hotkey } : {}) });
  return col([
    text(words),
    row([
      ctx.draw.button(
        `${key}:yes`,
        label,
        async () => {
          setAsking(false);
          await run();
        },
        {},
      ),
      ctx.draw.button(`${key}:no`, 'Cancel', () => setAsking(false), { plain: true, dim: true }),
    ]),
  ]);
}

export const errorWords = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^(Error|Something went wrong): /, '');

export const failed = (words: string | undefined): Node | undefined => (words ? text(words, { color: 'error' }) : undefined);

export const peerMd = peerText;

/**
 * Someone's words cut to one line, for `md`: made safe whole first, then links kept as their words,
 * so cutting it can't leave half a link. Drawn as theirs, never translated.
 */
export const peerLine = (raw: string, max = 120): string => {
  const flat = peerText(raw)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const MAX_PICTURE = 3 * 1024 * 1024;

/**
 * A picture someone sent, only once it's asked for, and only where the surface can draw it as
 * itself: a PNG on the terminal. The rest stay on this computer to open.
 */
export function picture(ctx: Ctx, key: string, alt: string, load: () => Promise<{ readonly mime: string; readonly b64: string }>): Node {
  const [shown, setShown] = ctx.local(`${key}:shown`, false);
  if (!shown) return ctx.draw.button(key, 'Show Picture', () => setShown(true), { plain: true, dim: true });
  const loaded = ctx.load(`team:picture:${key}`, load);
  if (loaded.error) return text(loaded.error, { color: 'error' });
  if (!loaded.value) return dim('Loading...');
  if (loaded.value.mime !== 'image/png' || ctx.surface !== 'terminal') return dim(`${alt}: this surface can’t draw it. Open it to see it.`);
  if (loaded.value.b64.length > MAX_PICTURE) return dim(`${alt}: too big to draw here. Open it to see it.`);
  return { k: 'image', key: `picture:${key}`, png: loaded.value.b64, columns: Math.min(60, Math.max(10, ctx.columns - 2)), rows: Math.min(20, Math.max(6, ctx.rows - 8)), alt };
}

/** Where a conversation is shown. */
export function openConversation(ctx: Ctx, id: string): void {
  ctx.look(id);
  ctx.go({ name: 'conversation', params: { id } });
}

/** The network is off: said, with the way to the one place that turns it on. */
export const networkOff = (ctx: Ctx, what: string): Node =>
  col([dim(`${what} need the network, and it’s off. It turns on from People.`), ctx.draw.button('off:people', 'Go to People', () => ctx.go({ name: 'friends' }), { plain: true })]);

// ---- people

export const shownState = (p: Pick<PersonView, 'online' | 'presence'>): PresenceState => (p.online && p.presence.state !== 'offline' ? p.presence.state : 'offline');

export const STATE_WORDS: Readonly<Record<PresenceState, string>> = { online: 'Online', away: 'Away', dnd: 'Do Not Disturb', offline: 'Offline' };

/** "Away · in a meeting", "Offline"; or what keeps your two computers from linking. */
export function presenceWords(p: Pick<PersonView, 'online' | 'presence' | 'update'>): string {
  if (p.update === 'them') return 'Offline to you · they need to update';
  if (p.update === 'you') return 'Update to reach them';
  const state = shownState(p);
  const note = state !== 'offline' ? p.presence.note?.trim() : undefined;
  return [STATE_WORDS[state], note].filter(Boolean).join(' · ');
}

const PRESENCE_TONE: Readonly<Record<PresenceState, Tone>> = { online: 'ok', away: 'warn', dnd: 'error', offline: 'quiet' };

/** Someone's presence as a colored pill: `● Online`, `● Away · at lunch`. */
export const presencePill = (p: Pick<PersonView, 'online' | 'presence' | 'update'>): Span => pill(presenceWords(p), p.update ? 'warn' : PRESENCE_TONE[shownState(p)]);

/** A card's name that opens it when pressed: bold, the rest of the line after it. */
export const nameButton = (ctx: Ctx, key: string, name: string, go: () => unknown, rest: readonly Span[] = [], opts: { readonly hotkey?: string } = {}): Node =>
  ctx.draw.button(key, name, go, { plain: true, ...(opts.hotkey ? { hotkey: opts.hotkey } : {}), spans: [span(name, { weight: 'bold' }), ...rest] });

export function presenceSpan(p: Pick<PersonView, 'online' | 'presence' | 'update'>): Span {
  const state = shownState(p);
  const style = p.update ? { color: 'warning' } : state === 'online' ? { color: 'success' } : state === 'away' ? { color: 'warning' } : state === 'dnd' ? { color: 'error' } : { dim: true };
  return span(presenceWords(p), style);
}

/** How much you trust someone, as their card sets it. */
export const levelOf = (state: AppState, peerId: string): TrustLevel => state.levels[peerId] ?? state.remembered[peerId]?.trust ?? defaultTrust(state);

/** Whoever this is, by what this computer knows of them. */
export function nameOf(state: AppState, peerId: string): string {
  const known = state.network.friends.find((f) => f.peerId === peerId)?.name ?? state.peers.find((p) => p.peerId === peerId)?.name ?? state.remembered[peerId]?.name;
  if (known) return known;
  for (const g of state.network.groups) {
    const m = g.members.find((x) => x.peerId === peerId);
    if (m) return m.name;
  }
  return 'someone';
}

export const byName = <T extends { readonly name: string }>(a: T, b: T): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** A typed path as the engine takes it: whole, with ~ for your home. */
export function wholePath(state: AppState, typed: string): string {
  const p = typed.trim();
  const whole = p === '~' ? state.home : p.startsWith('~/') ? `${state.home}${p.slice(1)}` : p;
  if (!whole.startsWith('/')) throw new Error('Give the whole path, starting with / or ~/.');
  return whole;
}

/** Once each, by what names them: a list a teammate had a hand in can't make two controls share a key. */
export const uniqueBy = <T>(items: readonly T[], keyOf: (item: T) => string): T[] => [...new Map(items.map((item) => [keyOf(item), item])).values()];
