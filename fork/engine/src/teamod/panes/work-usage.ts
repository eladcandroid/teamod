import { formatBytes } from '../../shared/format.js';
import type { AgentRef } from '../../protocol.js';
import { type CardWindow, type ProviderCard, friendRooms, providerCards, shortTokens } from '../../ui/usage-cards.js';
import { activityOf } from '../../ui/workspace-models.js';
import { worktreeOrigin } from '../../workspaces/origin.js';
import { type DayTotal, dailyTotals, tokensOf } from '../../workspaces/usage-days.js';
import type { Project, Workspace } from '../../workspaces/types.js';
import type { AppState } from '../../core/store.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, row, span, text } from '../tree.js';
import { actions, back, card, chrome, empty, meta, page, section } from './common.js';
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
  if (!allTokens) return section('Agents this week', [card([dim('Nothing yet. Tokens and cost add up here as your agent works in your projects.')])]);
  if (!hasDays) return section('Agents so far', [card([line(span(`${shortTokens(allTokens)} tokens`, { weight: 'bold' }), span(`  ${costWords(allCost)}`, { dim: true })), dim('A day-by-day list starts with your agent’s next run.')])]);
  return section('Agents this week', [
    card([
      line(span(`${shortTokens(sum(week, 'tokens'))} tokens`, { weight: 'bold' }), span(`  ${costWords(sum(week, 'cost'))}`, { dim: true })),
      meta(`${shortTokens(allTokens)}, ${costWords(allCost)} all time`, change),
      col(
        days
          .filter((d) => d.tokens > 0)
          .reverse()
          .map((d) => line(span(dayWords(d, d === today).padEnd(14), d === today ? {} : { dim: true }), span(shortTokens(d.tokens).padEnd(8)), span(costWords(d.cost), { dim: true }))),
        { top: 1 },
      ),
    ]),
  ]);
}

const resetWords = (w: CardWindow, now: number): string => (w.resetsAt && w.resetsAt > now ? `resets ${new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : `${100 - w.pct}% left`);

/** How full a window is, in ten cells. */
const meter = (pct: number): string => {
  const full = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return `${'█'.repeat(full)}${'░'.repeat(10 - full)}`;
};

const windowColor = (pct: number): { color?: string; dim?: boolean } => (pct >= 90 ? { color: 'error' } : pct >= 70 ? { color: 'warning' } : {});

/** One provider: its plan's windows, or a local model's tokens and speed; and making it your default. */
function providerCard(ctx: Ctx, it: ProviderCard, now: number): Node {
  const agent: AgentRef | null = it.agent.runtime === 'claude' ? null : { runtime: it.agent.runtime, label: it.agent.label, ...(it.agent.model ? { model: it.agent.model } : {}) };
  return card([
    row([
      line(span(it.agent.label, { weight: 'bold' }), it.plan ? span(`  ${it.plan}`, { dim: true }) : undefined, it.updatedAt ? span(`  updated ${agoWords(it.updatedAt)}`, { dim: true }) : undefined),
      it.isDefault ? text('✓ Default', { color: 'success' }) : ctx.draw.button(`default:${it.key}`, 'Make Default', () => ctx.call('session.setPrefs', { defaultAgent: agent }), { plain: true, dim: true }),
    ], { justify: 'space-between', gap: 2 }),
    !it.signedIn ? dim(`Not signed in. Sign in to ${it.agent.label} on this computer to use it.`) : undefined,
    it.signedIn && it.shape === 'quota' ? col(it.windows.map((w) => line(span(`${w.label}  `, { dim: true }), span(`${meter(w.pct)} `, windowColor(w.pct)), span(`${w.pct}% used`, windowColor(w.pct)), span(`  ${resetWords(w, now)}`, { dim: true })))) : undefined,
    it.signedIn && it.shape === 'tokens'
      ? line(span(it.tokens ? `${shortTokens(it.tokens.input + it.tokens.output)} tokens` : 'No tokens yet'), span(it.tokensPerSec !== undefined ? `  ${Math.round(it.tokensPerSec)} tokens a second` : '', { dim: true }))
      : undefined,
    it.signedIn && it.shape === 'empty' ? dim(`${it.agent.label}’s usage shows up here after its next run.`) : undefined,
  ]);
}

function plansCard(ctx: Ctx, now: number): Node {
  const state = ctx.state;
  const selfId = state.self?.peerId ?? state.selfId;
  const me = state.peers.find((p) => p.peerId === selfId) ?? state.self;
  const cards = providerCards(me, state.prefs.defaultAgent);
  const rooms = friendRooms(state.peers, selfId);
  return col([
    section('Plan limits', cards.map((c) => providerCard(ctx, c, now))),
    rooms.length > 0 && section('Friends', [card(rooms.slice(0, 20).map((r) => line(span(r.name), span(`  ${r.agent.label}  `, { dim: true }), span(r.windows.map((w) => `${w.short} ${w.pct}%`).join('  ')))))], rooms.length),
  ]);
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
    section('Disk', [
      !anyProject && empty('Nothing to measure yet. Add your projects: the disk their worktrees take and what your agent uses in them show up here.'),
      anyProject &&
        card([
          line(span(`Worktrees take ${formatBytes(total)}`, { weight: 'bold' })),
          measure.error ? dim(`Couldn’t measure disk space: ${measure.error}`) : undefined,
          actions(
            ctx.draw.button('usage:worktrees', 'Free Up Space', () => ctx.go({ name: 'worktrees' }), { plain: true, hotkey: 'a', spans: [span('Free Up Space ›', { color: 'claude' })] }),
            measure.loading ? dim('Measuring...') : ctx.draw.button('usage:measure', 'Measure Again', () => ctx.refresh('usage:measured'), { plain: true, dim: true, hotkey: 'e' }),
          ),
        ]),
    ]),
    rows.length > 0 &&
      section('By project', [
        segments(ctx, 'usage:sort', [{ value: 'size' as const, label: 'By Size' }, { value: 'tokens' as const, label: 'By Tokens' }, { value: 'recent' as const, label: 'Latest' }], sort, setSort),
        card(
          window.shown.map((r) => {
            const facts = meta(formatBytes(r.disk), `${shortTokens(r.tokens)} tokens`, costWords(r.cost), r.lastActive ? agoWords(r.lastActive) : undefined, r.agents ? plural(r.agents, 'sub-agent worktree') : undefined);
            return col([
              r.project.root ? ctx.draw.button(`usage:${r.project.id}`, r.project.name, () => ctx.go(projectRoute(r.project.id)), { plain: true, spans: [span(r.project.name, { weight: 'semibold' }), span('  ›', { dim: true })] }) : text('Chats', { weight: 'semibold' }),
              facts,
            ]);
          }),
        ),
        window.controls,
      ], rows.length),
  );
}
