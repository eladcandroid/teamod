import { type CcAgent, type CcSession, sessionApp, sessionLive } from '../../core/claude-code/model.js';
import { planTitle } from '../../core/plans/model.js';
import { planOf } from '../../core/plans/owner.js';
import { snippet } from '../../core/search.js';
import type { AppState } from '../../core/store.js';
import { formatBytes } from '../../shared/format.js';
import { activityOf } from '../../ui/workspace-models.js';
import { worktreeOrigin } from '../../workspaces/origin.js';
import type { Project, Workspace } from '../../workspaces/types.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, col, dim, line, row, span, text } from '../tree.js';
import { actions, ago, back, card, chrome, empty, homePath, meta, openWorkspace, page, section } from './common.js';
import { agoWords, askFirst, findField, isReady, placesOf, plural, projectRoute, segments, windowed, wsPill } from './work-common.js';

/** Overview, Search and Activity: what's happening everywhere, and finding anything anyone said. */

// ---------------------------------------------------------------- overview

type Filter = 'all' | 'active' | 'needs' | 'ready' | 'archived';
type Sort = 'recent' | 'name' | 'size';

const FILTER_LABELS: Readonly<Record<Filter, string>> = { all: 'All', active: 'Active', needs: 'Needs You', ready: 'Ready to Merge', archived: 'Archived' };
const FILTERS: readonly Filter[] = ['all', 'active', 'needs', 'ready', 'archived'];

interface Item {
  readonly ws: Workspace;
  readonly project: Project;
  readonly archived: boolean;
  /** Waiting on you: an approval, a merge conflict, or failing checks. */
  readonly needs: boolean;
  readonly ready: boolean;
  readonly last?: string;
  readonly when: number;
  readonly size?: number;
  /** What needs you first: 0 conflict or approval, 1 failing checks, 2 working, 3 unread, 4 the rest, 5 archived. */
  readonly rank: number;
  /** The plan it stands for: one row, where the plan's conversation is. */
  readonly plan?: { readonly id: string; readonly title: string };
}

const inOverview = (w: Workspace): boolean => w.kind !== 'main' && (w.archived === true || worktreeOrigin(w) !== 'agent');

function itemOf(state: AppState, project: Project, ws: Workspace): Item {
  const act = activityOf(state.log, `ws:${ws.id}`);
  const archived = ws.archived === true;
  const conflict = Boolean(state.conflicts[ws.id]?.length);
  const failing = state.prs[ws.id]?.checks === 'failing' && state.prs[ws.id]?.state === 'OPEN';
  const rank = archived ? 5 : conflict || act.awaiting ? 0 : failing ? 1 : act.running ? 2 : state.unread[`ws:${ws.id}`] ? 3 : 4;
  const size = archived && ws.kind === 'worktree' ? undefined : state.disk[ws.id];
  return { ws, project, archived, needs: !archived && (conflict || act.awaiting || failing), ready: isReady(state, ws), when: act.lastTs ?? ws.createdAt, rank, ...(act.last ? { last: act.last } : {}), ...(size !== undefined ? { size } : {}) };
}

/** Every worktree and chat, archived ones too: a live plan once, where its conversation is, not its tasks' worktrees. */
function overviewItems(state: AppState): Item[] {
  return state.projects.flatMap((p) =>
    p.workspaces.filter(inOverview).flatMap((w) => {
      const plan = w.archived ? undefined : planOf(state, w.id);
      if (!plan) return [itemOf(state, p, w)];
      return plan.home === `ws:${w.id}` ? [{ ...itemOf(state, p, w), ready: false, plan: { id: plan.id, title: planTitle(plan) } }] : [];
    }),
  );
}

const inFilter = (item: Item, filter: Filter): boolean => (filter === 'all' ? true : filter === 'active' ? !item.archived : filter === 'needs' ? item.needs : filter === 'ready' ? item.ready : item.archived);

const matches = (item: Item, query: string): boolean => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [item.plan?.title ?? '', item.ws.name, item.ws.branch ?? '', item.project.root ? item.project.name : 'Chats', item.last ?? ''].join('\n').toLowerCase();
  return words.every((w) => hay.includes(w));
};

const byName = (a: Item, b: Item): number => a.ws.name.localeCompare(b.ws.name, undefined, { numeric: true, sensitivity: 'base' });

function sorted(items: readonly Item[], sort: Sort): Item[] {
  const list = [...items];
  if (sort === 'name') return list.sort(byName);
  if (sort === 'size') return list.sort((a, b) => (b.size ?? -1) - (a.size ?? -1) || byName(a, b));
  return list.sort((a, b) => a.rank - b.rank || b.when - a.when || byName(a, b));
}

type OverviewRow = { readonly kind: 'project'; readonly project: Project; readonly count: number } | { readonly kind: 'item'; readonly item: Item };

/** By project, live ones first, then the archived ones: flat, so one window counts them all. */
function overviewRows(items: readonly Item[], sort: Sort): OverviewRow[] {
  const groups = new Map<string, { project: Project; items: Item[] }>();
  for (const i of items) {
    const g = groups.get(i.project.id) ?? { project: i.project, items: [] };
    g.items.push(i);
    groups.set(i.project.id, g);
  }
  return [...groups.values()].flatMap((g) => [
    { kind: 'project' as const, project: g.project, count: g.items.length },
    ...sorted(g.items.filter((i) => !i.archived), sort).map((item) => ({ kind: 'item' as const, item })),
    ...sorted(g.items.filter((i) => i.archived), sort).map((item) => ({ kind: 'item' as const, item })),
  ]);
}

function overviewHead(ctx: Ctx, p: Project, count: number): Node {
  if (!p.root) return line(span('Chats', { weight: 'bold' }), span(`  ${count}`, { dim: true }));
  return ctx.draw.button(`project:${p.id}`, p.name, () => ctx.go(projectRoute(p.id)), { plain: true, spans: [span(p.name, { weight: 'bold' }), span(`  ${count}`, { dim: true }), span('  ›', { dim: true })] });
}

function overviewItem(ctx: Ctx, item: Item): Node {
  const { ws, plan, last, when } = item;
  const name = plan?.title ?? ws.name;
  const open = (): void => (plan ? ctx.show('board', { name: 'plan', params: { id: plan.id } }) : openWorkspace(ctx, ws.id));
  const spans: readonly Span[] = [span(name, item.archived ? { dim: true } : { weight: 'semibold' }), span('  '), wsPill(ctx.state, ws), span(`  ${ago(when)}${item.size !== undefined ? ` · ${formatBytes(item.size)}` : ''}`, { dim: true })];
  const rowNode = ctx.draw.button(`ws:${ws.id}`, name, open, { plain: true, ...(item.archived ? { dim: true } : {}), spans });
  return col([
    item.archived
      ? row([
          rowNode,
          ws.archive || ws.branch || ws.kind !== 'worktree' ? ctx.draw.button(`ws:${ws.id}:restore`, 'Restore', () => ctx.call('workspaces.restore', ws.id), { plain: true }) : undefined,
          ctx.draw.button(`ws:${ws.id}:delete`, 'Delete', () => askFirst(ctx, 'delete', { ids: ws.id }), { plain: true, dim: true }),
        ], { gap: 2 })
      : rowNode,
    last && !item.archived ? dim(`  ${last.slice(0, Math.max(40, ctx.columns - 10))}`) : undefined,
  ]);
}

/** The window's rows, a card a project: its name on top, what's in it as rows. */
function overviewCards(ctx: Ctx, rows: readonly OverviewRow[]): Node[] {
  const out: Node[] = [];
  let head: Node | undefined;
  let body: Node[] = [];
  const flush = (): void => {
    if (head || body.length) out.push(card([head, col(body, { top: head ? 1 : 0 })]));
    head = undefined;
    body = [];
  };
  for (const entry of rows) {
    if (entry.kind === 'project') {
      flush();
      head = overviewHead(ctx, entry.project, entry.count);
    } else body.push(overviewItem(ctx, entry.item));
  }
  flush();
  return out;
}

/** What the Overview says when nothing's in a segment. */
const EMPTY: Readonly<Record<Filter, string>> = {
  all: 'No worktrees or chats yet. Start a worktree for a task, or a chat to ask anything.',
  active: 'Nothing active. Everything here is archived. Start a worktree, or restore one from Archived.',
  needs: 'Nothing needs you. Approvals, merge conflicts and failing checks show up here.',
  ready: 'Nothing ready to merge. Worktrees with committed work that isn’t in main yet show up here.',
  archived: 'Nothing archived yet. Archiving a worktree frees its folder. Its branch and conversation stay here, ready to restore.',
};

export function overviewPage(ctx: Ctx): Node {
  const all = overviewItems(ctx.state);
  const [filter, setFilter] = ctx.local<Filter>('overview:filter', 'all');
  const [sort, setSort] = ctx.local<Sort>('overview:sort', 'recent');
  const find = findField(ctx, 'overview', 'Find by name, branch, project or last message');
  const narrowed = all.filter((i) => matches(i, find.query));
  const rows = overviewRows(narrowed.filter((i) => inFilter(i, filter)), sort);
  const window = windowed(ctx, 'overview', rows, { keys: true });
  const count = (f: Filter): number => narrowed.filter((i) => inFilter(i, f)).length;
  return page(
    chrome(ctx, placesOf(ctx), 'overview'),
    back(ctx),
    segments(ctx, 'overview:filter', FILTERS.map((f) => ({ value: f, label: `${FILTER_LABELS[f]} ${count(f)}` })), filter, setFilter),
    row([segments(ctx, 'overview:sort', [{ value: 'recent' as const, label: 'Recent' }, { value: 'name' as const, label: 'Name' }, { value: 'size' as const, label: 'Size' }], sort, setSort), find.node]),
    rows.length === 0 && empty(find.query ? `No results for “${find.query}”.` : EMPTY[filter]),
    col(overviewCards(ctx, window.shown)),
    window.controls,
  );
}

// ---------------------------------------------------------------- search

/** Search every conversation (yours and the ones shared with you), and go to a result. */
export function searchPage(ctx: Ctx): Node {
  const search = ctx.state.search;
  const hits = search.hits.map((hit, index) => ({ hit, index }));
  const window = windowed(ctx, 'search', hits, { size: 30, keys: true });
  return page(
    chrome(ctx, placesOf(ctx), 'search'),
    back(ctx),
    ctx.draw.input(
      'search:box',
      async (value) => {
        await ctx.call('workbench.search', value?.trim() ?? '');
      },
      { placeholder: 'Search every conversation', value: search.query, submitLabel: 'search', autoFocus: true },
    ),
    !search.query && empty('Find anything anyone said: the room, your worktrees (archived ones too), and those shared with you.'),
    search.query && !hits.length ? empty(`Nothing says “${search.query}”.`) : undefined,
    search.query && hits.length > 0
      ? section(
          `${hits.length}${hits.length >= 200 ? '+' : ''} in ${plural(search.searched, 'conversation')}`,
          [
            card([
              col(
                window.shown.map(({ hit, index }) => {
                  const part = snippet(hit, Math.max(40, ctx.columns - 10));
                  return col([
                    ctx.draw.button(`hit:${index}`, hit.place, () => ctx.call('workbench.openHit', index), {
                      plain: true,
                      spans: [span(hit.place, { weight: 'semibold' }), ...(hit.archived ? [span('  archived', { dim: true })] : []), span(hit.who ? `  ${hit.who}` : '', { dim: true }), span(`  ${ago(hit.ts)}`, { dim: true })],
                    }),
                    line(span(part.before, { dim: true }), span(part.match, { weight: 'bold', color: 'claude' }), span(part.after, { dim: true })),
                  ]);
                }),
                { gap: 1 },
              ),
            ]),
            window.controls,
          ],
        )
      : undefined,
  );
}

// ---------------------------------------------------------------- activity

const since = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

function sessionWords(s: CcSession, now = Date.now()): Span {
  const running = s.agents.filter((a) => a.status === 'running').length;
  if (s.status === 'working') return span(running ? `Working, ${plural(running, 'agent')} running` : 'Working', { color: 'claude' });
  if (running) return span(`Waiting for ${plural(running, 'agent')}`, { color: 'claude' });
  if (s.status === 'waiting') return span('Waiting for you', { color: 'success' });
  return span(`Quiet for ${since(now - s.lastAt)}`, { dim: true });
}

const AGENT_STATUS: Readonly<Record<CcAgent['status'], { readonly words: string; readonly style: Omit<Span, 't'> }>> = {
  running: { words: 'Running', style: { color: 'claude' } },
  finished: { words: 'Finished', style: { color: 'success' } },
  failed: { words: 'Failed', style: { color: 'error' } },
  stopped: { words: 'Stopped', style: { dim: true } },
  idle: { words: 'Idle', style: { color: 'warning' } },
};

/** Where it runs: the worktree's name, else the folder. */
function placeOf(ctx: Ctx, s: CcSession): string {
  const ws = s.workspaceId ? ctx.state.projects.flatMap((p) => p.workspaces).find((w) => w.id === s.workspaceId) : undefined;
  return ws ? ws.name : homePath(ctx.state, s.cwd) || 'Unknown folder';
}

/** The chat it opens in: of a worktree or chat here, never a main folder (it has no conversation of its own). */
function chatOf(ctx: Ctx, s: CcSession): string | undefined {
  const ws = s.workspaceId ? ctx.state.projects.flatMap((p) => p.workspaces).find((w) => w.id === s.workspaceId) : undefined;
  return ws && !ws.archived && ws.kind !== 'main' ? ws.id : undefined;
}

function summaryOf(sessions: readonly CcSession[]): string {
  const running = sessions.reduce((n, s) => n + s.agents.filter((a) => a.status === 'running').length, 0);
  const live = sessions.filter(sessionLive).length;
  if (running) return `${plural(running, 'agent')} running${live > 1 ? ` in ${plural(live, 'session')}` : ''}`;
  if (live) return `${plural(live, 'session')} working`;
  return 'Nothing running right now';
}

type ActivityRow = { readonly kind: 'head'; readonly key: string; readonly name: string; readonly words: string; readonly projectId?: string } | { readonly kind: 'session'; readonly session: CcSession };

/** Sessions by project (folders outside every project last): flat, so one window counts them all. */
function activityRows(ctx: Ctx, sessions: readonly CcSession[]): ActivityRow[] {
  const groups = new Map<string, { projectId?: string; name: string; sessions: CcSession[] }>();
  for (const s of sessions) {
    const project = s.projectId ? ctx.state.projects.find((p) => p.id === s.projectId) : undefined;
    const key = project ? `p:${project.id}` : `d:${s.cwd}`;
    const g = groups.get(key) ?? { ...(project ? { projectId: project.id } : {}), name: project?.name ?? (s.cwd.split('/').filter(Boolean).pop() || 'Other'), sessions: [] };
    g.sessions.push(s);
    groups.set(key, g);
  }
  const running = (s: CcSession): number => s.agents.filter((a) => a.status === 'running').length;
  return [...groups]
    .sort(([, a], [, b]) => Number(Boolean(b.projectId)) - Number(Boolean(a.projectId)) || a.name.localeCompare(b.name))
    .flatMap(([key, g]) => {
      const inOrder = [...g.sessions].sort((a, b) => running(b) - running(a) || Number(sessionLive(b)) - Number(sessionLive(a)) || b.lastAt - a.lastAt);
      const busy = inOrder.reduce((n, s) => n + running(s), 0);
      return [{ kind: 'head' as const, key, name: g.name, words: busy ? `${busy} running` : plural(g.sessions.length, 'session'), ...(g.projectId ? { projectId: g.projectId } : {}) }, ...inOrder.map((session) => ({ kind: 'session' as const, session }))];
    });
}

/** One session, as far as the state says: read-only, it keeps running where it is. */
function sessionPage(ctx: Ctx, id: string): Node {
  const session = ctx.state.claudeCode.sessions.find((s) => s.id === id);
  if (!session) return page(chrome(ctx, placesOf(ctx), 'activity'), back(ctx), empty('This session went quiet. Sessions show while they work, and for a while after.'));
  const chat = chatOf(ctx, session);
  const window = windowed(ctx, `session:${id}`, session.agents, { size: 30, keys: true });
  const tasks = session.tasks ?? [];
  return page(
    chrome(ctx, placesOf(ctx), 'activity'),
    back(ctx, 'Activity'),
    card(
      [
        meta(sessionWords(session), placeOf(ctx, session), sessionApp(session), session.model),
        session.step ? dim(session.step) : undefined,
        meta(plural(session.steps, 'step'), session.tokens ? `${session.tokens} tokens of context` : undefined, `last wrote ${agoWords(session.lastAt)}`),
        chat ? actions(ctx.draw.button('session:chat', 'Open Chat', () => openWorkspace(ctx, chat), { primary: true, hotkey: 'a' })) : dim('It runs in a terminal or another app, and shows here live.'),
      ],
      { title: session.title, ...(session.status === 'waiting' ? { tone: 'ok' as const } : {}) },
    ),
    session.agents.length > 0 &&
      section(
        'Agents',
        [
          ...window.shown.map((a) => {
            const status = AGENT_STATUS[a.status];
            return col([line(span(a.description, { weight: 'semibold' }), span(`  ${status.words}`, status.style), span(`  ${a.type} · ${since((a.status === 'running' ? Date.now() : (a.endedAt ?? a.lastAt)) - a.startedAt)}`, { dim: true })), a.step ? dim(`  ${a.step}`) : undefined]);
          }),
          window.controls,
        ],
        session.agents.length,
      ),
    tasks.length > 0 &&
      section(
        'In the background',
        tasks.slice(0, 20).map((t) => {
          const status = AGENT_STATUS[t.status];
          return line(span(t.description), span(`  ${status.words}`, status.style));
        }),
        tasks.length,
      ),
  );
}

/** Every session running outside on this computer, by project, with what it's doing. Read-only. */
export function activityPage(ctx: Ctx): Node {
  const id = ctx.route.params?.session;
  if (id) return sessionPage(ctx, id);
  const sessions = ctx.state.claudeCode.sessions;
  const rows = activityRows(ctx, sessions);
  const window = windowed(ctx, 'activity', rows, { keys: true });
  const cards: Node[] = [];
  let group: Node[] = [];
  const flush = (): void => {
    if (group.length) cards.push(card(group));
    group = [];
  };
  for (const entry of window.shown) {
    if (entry.kind === 'head') {
      flush();
      group.push(line(span(entry.name, { weight: 'bold' }), span(`  ${entry.words}`, { dim: true })));
      continue;
    }
    const s = entry.session;
    group.push(
      col(
        [
          ctx.draw.button(`session:${s.id}`, s.title, () => ctx.go({ name: 'activity', params: { session: s.id } }), { plain: true, spans: [span(s.title, { weight: 'semibold' }), span('  ›', { dim: true })] }),
          meta(sessionWords(s), placeOf(ctx, s), s.own && 'a worktree’s own', s.agent && sessionApp(s), s.agents.length > 0 && plural(s.agents.length, 'agent')),
        ],
        { top: 1 },
      ),
    );
  }
  flush();
  return page(
    chrome(ctx, placesOf(ctx), 'activity'),
    back(ctx),
    sessions.length === 0
      ? empty('No sessions right now. When you run an agent in a terminal or another app, its sessions and their agents show here live.')
      : col([text(summaryOf(sessions), { weight: 'bold' }), dim('Every session on this computer, and the agents they started. They keep running where they are.')]),
    col(cards),
    window.controls,
  );
}
