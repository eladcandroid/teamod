import { formatBytes } from '../../shared/format.js';
import type { AgentRef } from '../../protocol.js';
import { type CardWindow, type ProviderCard, friendRooms, providerCards, shortTokens } from '../../ui/usage-cards.js';
import { activityOf } from '../../ui/workspace-models.js';
import { worktreeOrigin } from '../../workspaces/origin.js';
import { type DayTotal, dailyTotals, tokensOf } from '../../workspaces/usage-days.js';
import type { Project, Workspace } from '../../workspaces/types.js';
import type { AppState } from '../../core/store.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, row, span, title } from '../tree.js';
import { back, chrome, empty, page } from './common.js';
import { agoWords, placesOf, plural, projectRoute, segments, windowed } from './work-common.js';

/** Usage: your plans' limits and friends', tokens and cost per day, and the disk your worktrees take. */

/** Two weeks of days: this week against the one before. */
const DAYS = 14;
const WEEK = 7;

const sum = (days: readonly DayTotal[], k: 'tokens' | 'cost'): number => days.reduce((n, d) => n + d[k], 0);

/** "$0.25", "$14", "<$0.01". */
export function costWords(usd: number): string {
  if (usd <= 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`;
}

/** Change against the week before; nothing when there's no week before to compare. */
function weekChange(now: number, before: number): string | undefined {
  if (before <= 0 || now <= 0) return undefined;
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? 'Same as the week before' : `${Math.abs(pct)}% ${pct > 0 ? 'more' : 'less'} than the week before`;
}

const dayWords = (d: DayTotal, today: boolean): string => (today ? 'Today' : new Date(d.date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }));

/** Agent tokens and cost this week, against the week before, a line per day. */
function activityCard(state: AppState): Node {
  const usages = state.projects.flatMap((p) => p.workspaces.map((w) => w.usage));
  const days = dailyTotals(usages, Date.now(), DAYS);
  const week = days.slice(-WEEK);
  const before = days.slice(0, DAYS - WEEK);
  const today = days.at(-1);
  const allTokens = usages.reduce((n, u) => n + tokensOf(u), 0);
  const allCost = usages.reduce((n, u) => n + (u?.cost ?? 0), 0);
  const hasDays = usages.some((u) => u?.days && Object.keys(u.days).length);
  const change = weekChange(sum(week, 'tokens'), sum(before, 'tokens'));
  if (!allTokens) return col([title('Agents this week'), dim('Nothing yet. Tokens and cost add up here as your agent works in your projects.')]);
  if (!hasDays) return col([title('Agents so far'), line(`${shortTokens(allTokens)} tokens`, span(`  ${costWords(allCost)}`, { dim: true })), dim('A day-by-day list starts with your agent’s next run.')]);
  return col([
    title('Agents this week'),
    line(`${shortTokens(sum(week, 'tokens'))} tokens`, span(`  ${costWords(sum(week, 'cost'))}`, { dim: true }), span(`  ${shortTokens(allTokens)}, ${costWords(allCost)} all time`, { dim: true })),
    today ? dim(`Today ${shortTokens(today.tokens)}, ${costWords(today.cost)}${change ? `. ${change}` : ''}`) : undefined,
    ...days
      .filter((d) => d.tokens > 0)
      .reverse()
      .map((d) => line(span(dayWords(d, d === today).padEnd(14), { dim: true }), span(shortTokens(d.tokens).padEnd(8)), span(costWords(d.cost), { dim: true }))),
  ]);
}

const resetWords = (w: CardWindow, now: number): string => (w.resetsAt && w.resetsAt > now ? `resets ${new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : `${100 - w.pct}% left`);

const windowColor = (pct: number): { color?: string; dim?: boolean } => (pct >= 90 ? { color: 'error' } : pct >= 70 ? { color: 'warning' } : {});

/** One provider: its plan's windows, or a local model's tokens and speed; and making it your default. */
function providerCard(ctx: Ctx, card: ProviderCard, now: number): Node {
  const agent: AgentRef | null = card.agent.runtime === 'claude' ? null : { runtime: card.agent.runtime, label: card.agent.label, ...(card.agent.model ? { model: card.agent.model } : {}) };
  return col([
    row([
      line(span(card.agent.label, { weight: 'semibold' }), card.plan ? span(`  ${card.plan}`, { dim: true }) : undefined, card.updatedAt ? span(`  updated ${agoWords(card.updatedAt)}`, { dim: true }) : undefined),
      card.isDefault ? dim('Default') : ctx.draw.button(`default:${card.key}`, 'Make Default', () => ctx.call('session.setPrefs', { defaultAgent: agent }), { plain: true, dim: true }),
    ]),
    !card.signedIn ? dim(`Not signed in. Sign in to ${card.agent.label} on this computer to use it.`) : undefined,
    card.signedIn && card.shape === 'quota' ? col(card.windows.map((w) => line(span(`${w.label}  `, { dim: true }), span(`${w.pct}% used`, windowColor(w.pct)), span(`  ${resetWords(w, now)}`, { dim: true })))) : undefined,
    card.signedIn && card.shape === 'tokens'
      ? line(span(card.tokens ? `${shortTokens(card.tokens.input + card.tokens.output)} tokens` : 'No tokens yet'), span(card.tokensPerSec !== undefined ? `  ${Math.round(card.tokensPerSec)} tokens a second` : '', { dim: true }))
      : undefined,
    card.signedIn && card.shape === 'empty' ? dim(`${card.agent.label}’s usage shows up here after its next run.`) : undefined,
  ]);
}

function plansCard(ctx: Ctx, now: number): Node {
  const state = ctx.state;
  const selfId = state.self?.peerId ?? state.selfId;
  const me = state.peers.find((p) => p.peerId === selfId) ?? state.self;
  const cards = providerCards(me, state.prefs.defaultAgent);
  const rooms = friendRooms(state.peers, selfId);
  return col(
    [
      title('Plan limits'),
      ...cards.map((c) => providerCard(ctx, c, now)),
      rooms.length > 0 && dim('Friends'),
      ...rooms.slice(0, 20).map((r) => line(span(r.name), span(`  ${r.agent.label}  `, { dim: true }), span(r.windows.map((w) => `${w.short} ${w.pct}%`).join('  ')))),
    ],
    { gap: 1 },
  );
}

/** A project's row: worktree bytes (the main folder is the project itself, so it isn't counted), tokens and cost. */
interface ProjectLine {
  readonly project: Project;
  readonly disk: number;
  readonly tokens: number;
  readonly cost: number;
  readonly lastActive: number;
  readonly agents: number;
}

type Sort = 'size' | 'tokens' | 'recent';

const counted = (w: Workspace): boolean => !w.archived && (w.kind === 'worktree' || (w.kind === 'chat' && !w.projectRoot));

function projectLines(state: AppState, sort: Sort): ProjectLine[] {
  const lines = state.projects.map((project): ProjectLine => {
    const live = project.workspaces.filter((w) => !w.archived);
    return {
      project,
      disk: project.workspaces.filter(counted).reduce((n, w) => n + (state.disk[w.id] ?? 0), 0),
      // Tokens and cost count archived workspaces too: they were spent.
      tokens: project.workspaces.reduce((n, w) => n + tokensOf(w.usage), 0),
      cost: project.workspaces.reduce((n, w) => n + (w.usage?.cost ?? 0), 0),
      lastActive: Math.max(0, ...live.map((w) => Math.max(activityOf(state.log, `ws:${w.id}`).lastTs ?? 0, w.usage?.lastAt ?? 0, w.createdAt ?? 0))),
      agents: live.filter((w) => worktreeOrigin(w) === 'agent').length,
    };
  });
  const order: Readonly<Record<Sort, (a: ProjectLine, b: ProjectLine) => number>> = {
    size: (a, b) => b.disk - a.disk || b.tokens - a.tokens,
    tokens: (a, b) => b.tokens - a.tokens || b.disk - a.disk,
    recent: (a, b) => b.lastActive - a.lastActive,
  };
  return lines.filter((l) => l.disk || l.tokens || l.lastActive).sort(order[sort]);
}

export function usagePage(ctx: Ctx): Node {
  const now = Date.now();
  const measure = ctx.load('usage:measured', () => ctx.call('workbench.measureDisk'), { ttlMs: 120_000 });
  const [sort, setSort] = ctx.local<Sort>('usage:sort', 'size');
  const rows = projectLines(ctx.state, sort);
  const window = windowed(ctx, 'usage', rows, { size: 30, keys: true });
  const total = rows.reduce((n, r) => n + r.disk, 0);
  const anyProject = ctx.state.projects.some((p) => p.root);
  return page(
    chrome(ctx, placesOf(ctx), 'usage'),
    back(ctx),
    plansCard(ctx, now),
    activityCard(ctx.state),
    col([
      title('Disk'),
      !anyProject && empty('Nothing to measure yet. Add your projects: the disk their worktrees take and what your agent uses in them show up here.'),
      anyProject && row([line(`Worktrees take ${formatBytes(total)}`), measure.loading ? dim('Measuring...') : ctx.draw.button('usage:measure', 'Measure Again', () => ctx.refresh('usage:measured'), { plain: true, dim: true, hotkey: 'e' }), ctx.draw.button('usage:worktrees', 'Free Up Space', () => ctx.go({ name: 'worktrees' }), { plain: true, hotkey: 'a' })]),
      measure.error ? dim(`Couldn’t measure disk space: ${measure.error}`) : undefined,
    ]),
    rows.length > 0 && segments(ctx, 'usage:sort', [{ value: 'size' as const, label: 'By Size' }, { value: 'tokens' as const, label: 'By Tokens' }, { value: 'recent' as const, label: 'Latest' }], sort, setSort),
    ...window.shown.map((r) => {
      const words = `  ${formatBytes(r.disk)}  ${shortTokens(r.tokens)} tokens  ${costWords(r.cost)}  ${r.lastActive ? agoWords(r.lastActive) : ''}${r.agents ? `  ${plural(r.agents, 'sub-agent worktree')}` : ''}`;
      return r.project.root ? ctx.draw.button(`usage:${r.project.id}`, r.project.name, () => ctx.go(projectRoute(r.project.id)), { plain: true, spans: [span(r.project.name), span(words, { dim: true })] }) : line(span('Chats'), span(words, { dim: true }));
    }),
    window.controls,
  );
}
