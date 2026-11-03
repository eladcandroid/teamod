import { labelTitle } from '../../core/board/labels.js';
import { type BoardState, type Issue, type IssueStatus, type Priority, ISSUE_STATUSES, PRIORITY_INFO, PROVIDER_INFO, type ProjectSync, STATUS_INFO, asksPrivate, boardName, boardOf, isEpic, isOpen, isOwnBoard, isVisiting, issueById, openBlockers, progressOf, reposOf, showsOn, worktreeOf, worksOn } from '../../core/board/model.js';
import { planEpicOf, shownBody } from '../../core/plans/model.js';
import type { AgentRef } from '../../protocol.js';
import { agentName } from '../../shared/agent-label.js';
import { activityOf } from '../../ui/workspace-models.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, col, dim, row, span, title } from '../tree.js';
import { MAIN_KEY, MORE_KEY, agentRows, asking, choices, field, lookedProject, myAgent, openStarted, prop, realProjects, sharedWith, subPage, toggle, top, windowed } from './board-common.js';
import { type BoardChoice, type Person, type Scope, SCOPES, assigneeChoices, assigneesIn, boardChoices, boardOrder, boardRepos, boardToShow, doneCount, dueText, isSolo, neighbours, scopeCounts, scoped, statusBeside, untucked } from './board-model.js';
import { ago, card, empty, findWorkspace, page, section } from './common.js';

/** The statuses a scope shows as groups, in order. */
function statusesFor(scope: Scope): readonly IssueStatus[] {
  switch (scope) {
    case 'active':
      return ['todo', 'in_progress', 'in_review', 'in_plan'];
    case 'backlog':
      return ['backlog'];
    case 'archived':
      return ['done', 'canceled'];
    default:
      return ISSUE_STATUSES;
  }
}

/** How a status reads on a row or a page: only what's at work or wrong gets a color. */
export const statusStyle = (status: IssueStatus): Omit<Span, 't'> => (status === 'in_progress' ? { color: 'claude' } : status === 'done' ? { color: 'success' } : status === 'canceled' || status === 'backlog' ? { dim: true } : {});

/** Urgent and High stand out; the rest stay quiet. */
export const priorityStyle = (priority: Priority): Omit<Span, 't'> => (priority === 'urgent' ? { color: 'error' } : priority === 'high' ? { color: 'warning' } : { dim: true });

/** You and your teammates on a project: who a task can be for. */
export const selfOf = (ctx: Ctx): Person => ({ id: ctx.state.selfId, name: ctx.state.self?.name ?? ctx.state.network?.self?.name ?? 'You' });
export const matesOf = (ctx: Ctx, projectId: string): readonly Person[] => (ctx.state.team.teams[projectId]?.mates ?? []).map((m) => ({ id: m.peerId, name: m.name }));

export const soloOn = (ctx: Ctx, projectId: string): boolean => isSolo(ctx.state.board, projectId, ctx.state.selfId, matesOf(ctx, projectId).length);

export interface BoardHere {
  readonly boards: readonly BoardChoice[];
  readonly here: BoardChoice | undefined;
}

/** The board shown: the one you picked while it covers the repo you're in, else that repo's, else the busiest. */
export function boardHere(ctx: Ctx): BoardHere {
  const boards = boardChoices(ctx.state.board, realProjects(ctx));
  const [picked] = ctx.local('board:board', '');
  return { boards, here: boardToShow(ctx.state.board, boards, lookedProject(ctx), picked) };
}

const repoName = (ctx: Ctx, id: string): string | undefined => ctx.state.projects.find((p) => p.id === id)?.name;

/** What a row shows besides its title: what it's part of, what stands in its way, who's on it. */
export function issueMeta(ctx: Ctx, issue: Issue, showing?: string): Span[] {
  const board = ctx.state.board;
  const open = STATUS_INFO[issue.status].open;
  const bits: Span[] = [];
  const add = (words: string, style: Omit<Span, 't'> = { dim: true }): void => void bits.push(span(`  ${words}`, style));
  if (issue.priority !== 'none') add(`● ${PRIORITY_INFO[issue.priority].label}`, priorityStyle(issue.priority));
  if (issue.private) add('Private');
  if (issue.drafting) add('The agent is writing...', { color: 'claude' });
  if (issue.needsChecks && open) add('Needs its checks', { color: 'warning' });
  const plan = issue.plan ? ctx.state.plans.plans.find((p) => p.id === issue.plan?.id) : undefined;
  const milestone = plan && shownBody(plan)?.milestones.find((m) => m.id === issue.plan?.milestone)?.title;
  if (milestone) add(milestone);
  if (issue.origin === 'plan' && !issue.plan) {
    const epic = planEpicOf(ctx.state.plans, issue.id);
    if (epic) add(epic.milestone ? 'Milestone' : 'Plan');
  }
  const blockers = open ? openBlockers(board, issue) : [];
  if (blockers.length) add(`Blocked by ${blockers.map((b) => b.key).join(', ')}`, { color: 'warning' });
  const epicKey = issue.parent ? issueById(board, issue.parent)?.key : undefined;
  if (epicKey) add(`Part of ${epicKey}`);
  const progress = progressOf(board, issue);
  if (progress.total) add(`${progress.done}/${progress.total}`);
  if (issue.github) add(`#${issue.github.number}`);
  if (showing && isVisiting(issue, showing)) add(`On ${boardName(board, boardOf(issue), (id) => repoName(ctx, id))}`);
  else if (reposOf(board, boardOf(issue)).length > 1) add(repoName(ctx, issue.projectId) ?? 'Repo');
  for (const label of issue.labels.slice(0, 3)) add(labelTitle(label));
  if (issue.due) {
    const due = dueText(issue.due);
    add(due.text, due.late && open ? { color: 'error' } : { dim: true });
  }
  const last = worktreeOf(issue);
  const place = last ? findWorkspace(ctx.state, last) : undefined;
  if (place && !place.archived && activityOf(ctx.state.log, `ws:${place.id}`).running) add('Working', { color: 'claude' });
  if (issue.pr) add(`PR #${issue.pr.number}`);
  if (issue.assignee && !soloOn(ctx, issue.projectId)) add(issue.assignee.id === ctx.state.selfId ? 'You' : issue.assignee.name);
  add(ago(issue.updatedAt));
  return bits;
}

/** A task in a list: a press opens its page. */
export function taskRow(ctx: Ctx, issue: Issue, showing?: string): Node {
  const closed = !STATUS_INFO[issue.status].open;
  return ctx.draw.button(`task:${issue.id}`, `${issue.key} ${issue.title}`, () => ctx.go({ name: 'task', params: { id: issue.id } }), {
    plain: true,
    spans: [span(`${issue.key}  `, { dim: true }), span(issue.title, closed ? { dim: true } : {}), ...issueMeta(ctx, issue, showing)],
  });
}

/** Move mode: the board's columns as presses, in place of dragging a card. */
function moveRow(ctx: Ctx, issue: Issue, column: readonly Issue[]): Node {
  const before = statusBeside(issue.status, -1);
  const after = statusBeside(issue.status, 1);
  const at = column.findIndex((c) => c.id === issue.id);
  const go = (to: IssueStatus, words: string): Node => ctx.draw.button(`move:${issue.id}:${to}`, words, () => ctx.call('board.move', issue.id, to), { plain: true });
  return row(
    [
      before && go(before, `‹ ${STATUS_INFO[before].label}`),
      after && go(after, `${STATUS_INFO[after].label} ›`),
      at > 0 && ctx.draw.button(`move:${issue.id}:up`, 'Up', () => ctx.call('board.move', issue.id, issue.status, neighbours(column, issue.id, at - 1)), { plain: true, dim: true }),
      at >= 0 && at < column.length - 1 && ctx.draw.button(`move:${issue.id}:down`, 'Down', () => ctx.call('board.move', issue.id, issue.status, neighbours(column, issue.id, at + 1)), { plain: true, dim: true }),
    ],
    { padX: 2 },
  );
}

interface Filters {
  readonly who: string;
  readonly repos: readonly string[];
  readonly worktree: string;
  readonly people: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  readonly hasPrivate: boolean;
  readonly boardRepos: readonly string[];
  readonly worktrees: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly setWho: (next: string) => void;
  readonly setRepos: (next: readonly string[]) => void;
  readonly setWorktree: (next: string) => void;
}

/** Whose tasks, which repos, which worktree: each only when the board has more than one to tell apart. */
function filtersOf(ctx: Ctx, here: BoardChoice): Filters {
  const board = ctx.state.board;
  const [who, setWho] = ctx.local('board:who', '');
  const [repos, setRepos] = ctx.local<readonly string[]>('board:repos', []);
  const [worktree, setWorktree] = ctx.local('board:worktree', '');
  const solo = soloOn(ctx, here.id);
  const people = solo ? [] : assigneesIn(board, here.id, ctx.state.selfId);
  const hasPrivate = board.issues.some((i) => showsOn(i, here.id) && i.private && !i.archivedAt);
  const allRepos = boardRepos(board, here.id, realProjects(ctx));
  const ids = new Set(board.issues.filter((i) => showsOn(i, here.id) && !i.archivedAt).flatMap((i) => [worktreeOf(i), i.worktrees.at(-1)]).filter((w): w is string => Boolean(w)));
  const worktrees = ctx.state.projects.filter((p) => allRepos.includes(p.id)).flatMap((p) => p.workspaces).filter((w) => ids.has(w.id) && !w.archived).map((w) => ({ id: w.id, name: w.name }));
  return {
    who: !solo && (who === 'nobody' || (who === 'private' && hasPrivate) || people.some((p) => p.key === who)) ? who : '',
    repos: allRepos.length > 1 ? repos.filter((r) => allRepos.includes(r)) : [],
    worktree: worktrees.some((w) => w.id === worktree) ? worktree : '',
    people,
    hasPrivate,
    boardRepos: allRepos,
    worktrees,
    setWho,
    setRepos,
    setWorktree,
  };
}

interface Group {
  readonly key: string;
  readonly boardId: string;
  readonly boardName?: string;
  readonly status: IssueStatus;
  readonly items: readonly Issue[];
}

const groupsIn = (boardId: string, name: string | undefined, statuses: readonly IssueStatus[], issues: readonly Issue[], moving: boolean): Group[] =>
  statuses.map((status) => {
    const items = issues.filter((i) => i.status === status);
    return { key: `${boardId}:${status}`, boardId, ...(name ? { boardName: name } : {}), status, items: moving ? [...items].sort(boardOrder) : items };
  });

const syncWords = (sync: ProjectSync): string => {
  const name = PROVIDER_INFO[sync.provider].label;
  return sync.error?.code === 'auth' ? `${name}: needs a new key` : sync.syncing ? `${name}: syncing...` : sync.syncedAt ? `${name} · ${ago(sync.syncedAt)}` : name;
};

/**
 * Tasks: one board at a time (the switcher changes it), My Tasks across every board, as a list
 * grouped by status. A row opens its page, a group's header folds it, Move puts the board's columns
 * under each row.
 */
export function tasksPage(ctx: Ctx): Node {
  const board = ctx.state.board;
  if (!board.enabled) return page(top(ctx, 'tasks'), empty('Tasks are off: the engine isn’t running its board.'));
  const { boards, here } = boardHere(ctx);
  if (!here) return page(top(ctx, 'tasks'), empty('No projects yet. Tasks belong to a project: add one in Work, then plan its work here.'));
  const selfId = ctx.state.selfId;
  const [scope, setScope] = ctx.local<Scope>('board:scope', 'active');
  const [query, setQuery] = ctx.local('board:query', '');
  const [finding, setFinding] = ctx.local('board:finding', false);
  const [moving, setMoving] = ctx.local('board:moving', false);
  const [folded, setFolded] = ctx.local<readonly IssueStatus[]>('board:folded', ['canceled']);
  const [opened, setOpened] = ctx.local<readonly string[]>('board:opened', []);
  const filters = filtersOf(ctx, here);
  const mine = scope === 'mine';
  const archive = scope === 'archived';
  const onBoard = { board: here.id, who: filters.who, repos: filters.repos };
  const found = (mine ? scoped(board, { scope }, selfId, query) : scoped(board, { ...onBoard, scope }, selfId, query)).filter((i) => !filters.worktree || worksOn(i, filters.worktree));
  const tuck = untucked(found, opened, query);
  const counts = scopeCounts(board, onBoard, selfId);
  const statuses = statusesFor(scope);
  const groups = mine ? boards.flatMap((b) => groupsIn(b.id, boards.length > 1 ? b.name : undefined, statuses, tuck.shown.filter((i) => boardOf(i) === b.id), moving)) : groupsIn(here.id, undefined, statuses, tuck.shown, moving);
  const list = windowed(ctx, 'tasks:rows', groups.flatMap((g) => (folded.includes(g.status) ? [] : g.items)));
  const inWindow = new Set(list.rows.map((i) => i.id));
  const showEmpty = scope === 'active' || scope === 'backlog';
  const sync = !here.own ? board.sync?.[here.id] : undefined;
  const newTask = (status?: IssueStatus): void => ctx.go({ name: 'new-task', params: { board: here.id, ...(filters.repos.length === 1 ? { project: filters.repos[0]! } : {}), ...(status ? { status } : {}), ...(scope === 'backlog' && !status ? { status: 'backlog' } : {}) } });

  const groupNode = (g: Group): Node | undefined => {
    const isFolded = folded.includes(g.status);
    const rows = g.items.filter((i) => inWindow.has(i.id));
    if (!isFolded && !rows.length && (g.items.length || !showEmpty || g.status === 'in_plan')) return undefined;
    if (isFolded && !g.items.length) return undefined;
    const done = g.status === 'done' && !archive ? doneCount(board, g.boardId) : 0;
    // A status: its heading and count (a press folds it), then its tasks as compact rows in one card.
    return col([
      row(
        [
          ctx.draw.button(`group:${g.key}`, `${STATUS_INFO[g.status].label} ${g.items.length}`, () => setFolded(isFolded ? folded.filter((s) => s !== g.status) : [...folded, g.status]), {
            plain: true,
            spans: [span(STATUS_INFO[g.status].label, { weight: 'bold', ...statusStyle(g.status) }), span(`  ${g.items.length}`, { dim: true }), ...(isFolded ? [span('  folded', { dim: true })] : []), ...(g.boardName ? [span(`  ${g.boardName}`, { dim: true })] : [])],
          }),
          row(
            [
              !archive && !mine && ctx.draw.button(`group:${g.key}:new`, 'New', () => newTask(g.status), { plain: true, dim: true }),
              done > 0 &&
                ctx.draw.button(`group:${g.key}:archive`, `Archive ${done}`, async () => {
                  await ctx.call('board.archiveDone', g.boardId);
                  ctx.effect({ toast: 'Done tasks are in the Archive' });
                }, { plain: true, dim: true }),
            ],
            { gap: 2 },
          ),
        ],
        { justify: 'space-between' },
      ),
      rows.length > 0 &&
        card(
          rows.map((i) => {
            const tasks = isEpic(board, i) ? board.issues.filter((k) => k.parent === i.id).length : 0;
            const away = !opened.includes(i.id);
            return col([
              tasks
                ? row([
                    taskRow(ctx, i, mine ? undefined : here.id),
                    ctx.draw.button(`tuck:${i.id}`, away ? `Show ${tasks} sub-task${tasks === 1 ? '' : 's'}` : 'Tuck Sub-tasks', () => setOpened(away ? [...opened, i.id] : opened.filter((o) => o !== i.id)), { plain: true, dim: true }),
                  ])
                : taskRow(ctx, i, mine ? undefined : here.id),
              moving && !archive && moveRow(ctx, i, g.items),
            ]);
          }),
        ),
    ]);
  };

  const shownOpen = found.filter((i) => isOpen(i.status)).length;
  const repoFilter = filters.repos.length ? (filters.repos.length === 1 ? (repoName(ctx, filters.repos[0]!) ?? '1 repo') : `${filters.repos.length} repos`) : undefined;
  const whoFilter = filters.who === 'nobody' ? 'No one yet' : filters.who === 'private' ? 'Private' : filters.people.find((p) => p.key === filters.who)?.label;
  const worktreeFilter = filters.worktrees.find((w) => w.id === filters.worktree)?.name;
  const narrowed = [...(mine ? [] : [whoFilter, repoFilter]), worktreeFilter, query ? `“${query}”` : undefined].filter(Boolean).join(' · ');
  const nothing = !board.issues.some((i) => showsOn(i, here.id));
  return page(
    top(ctx, 'tasks'),
    row(
      [
        row(
          [
            ctx.draw.button('board:pick', here.name, () => ctx.go({ name: 'boards' }), { plain: true, hotkey: 'c', spans: [span(here.name, { weight: 'bold' }), span('  Change', { dim: true })] }),
            sync && ctx.draw.button('board:sync', syncWords(sync), () => ctx.go({ name: 'sync', params: { project: here.id } }), { plain: true, ...(sync.error ? { spans: [span(syncWords(sync), { color: 'warning' })] } : { dim: true }) }),
          ],
          { gap: 2 },
        ),
        ctx.draw.button('tasks:new', 'New Task', () => newTask(), { primary: true, hotkey: 'n' }),
      ],
      { justify: 'space-between' },
    ),
    row(
      SCOPES.map((s) => ctx.draw.button(`scope:${s.value}`, s.label, () => setScope(s.value), { plain: true, hotkey: s.hotkey, spans: [span(s.label, s.value === scope ? { color: 'claude', weight: 'bold' } : { dim: true }), span(` ${counts[s.value]}`, { dim: true })] })),
      { gap: 2 },
    ),
    finding
      ? ctx.draw.input(
          'tasks:filter',
          (value) => {
            setQuery(value?.trim() ?? '');
            setFinding(false);
          },
          { label: 'Filter', value: query, placeholder: 'Words in the title, key, labels or brief', submitLabel: 'find', autoFocus: true },
        )
      : undefined,
    narrowed.length > 0 &&
      row([
        dim(`Only ${narrowed}`),
        ctx.draw.button('tasks:everything', 'Show Everything', () => {
          setQuery('');
          filters.setWho('');
          filters.setRepos([]);
          filters.setWorktree('');
        }, { plain: true, dim: true }),
      ]),
    nothing && !mine
      ? empty(here.repos.length > 1 ? `Plan the work: tasks here run in ${here.repos.map((r) => repoName(ctx, r)).join(', ')}, each in the repo you pick.` : 'Plan the work: write down what needs doing, and start it when you’re ready.')
      : !found.length
        ? empty(archive && !query ? 'The Archive is empty. Archive Done tasks from the Done group: they come here, their words kept.' : query ? 'Nothing matches. Try fewer words.' : (SCOPES.find((s) => s.value === scope)?.hint ?? 'Nothing here.'))
        : col([list.earlier, ...groups.map(groupNode), list.more], { gap: 1 }),
    archive && counts.archived > 0 && emptyArchive(ctx, here.id, counts.archived),
    found.length > 0 && dim(archive ? `${found.length} archived` : `${shownOpen} open · ${found.length} shown${tuck.hidden ? ` · ${tuck.hidden} sub-task${tuck.hidden === 1 ? '' : 's'} tucked under their epics` : ''}`),
    row([
      tuck.hidden > 0 && ctx.draw.button('tuck:all', 'Show All Sub-tasks', () => setOpened([...new Set([...opened, ...tuck.tucked])]), { plain: true, dim: true }),
      ctx.draw.button('tasks:find', 'Filter', () => setFinding(!finding), { plain: true, hotkey: 'f', dim: true }),
      !archive && ctx.draw.button('tasks:moving', moving ? 'Moving' : 'Move', () => setMoving(!moving), { plain: true, hotkey: 'v', ...(moving ? {} : { dim: true }) }),
      ctx.draw.button('tasks:more', 'More', () => ctx.go({ name: 'tasks-more' }), { plain: true, hotkey: MORE_KEY, dim: true }),
    ]),
  );
}

/** The Archive, gone for good, after asking. */
function emptyArchive(ctx: Ctx, boardId: string, archived: number): Node {
  return asking(ctx, 'tasks:empty-archive', {
    label: 'Empty Archive',
    question: `Delete ${archived} archived ${archived === 1 ? 'task' : 'tasks'} for good?`,
    detail: 'Their briefs, history and what’s left of their proof go away. This can’t be undone.',
    confirm: 'Empty Archive',
    danger: true,
    run: async () => {
      await ctx.call('board.emptyArchive', boardId);
      ctx.effect({ toast: 'The Archive is empty' });
    },
  });
}

/** What's advanced about a board, out of the way: its settings, Linear, whose tasks. */
export function tasksMorePage(ctx: Ctx): Node {
  const board = ctx.state.board;
  const { here } = boardHere(ctx);
  if (!here) return subPage(ctx, 'tasks', 'Tasks', empty('No projects yet.'));
  const filters = filtersOf(ctx, here);
  const [folded, setFolded] = ctx.local<readonly IssueStatus[]>('board:folded', ['canceled']);
  const sync = !here.own ? board.sync?.[here.id] : undefined;
  const done = doneCount(board, here.id);
  const picked = (id: string): boolean => filters.repos.includes(id);
  const go = (key: string, label: string, name: string, params: Readonly<Record<string, string>>): Node => ctx.draw.button(key, label, () => ctx.go({ name, params }), { plain: true });
  const places = windowed(ctx, 'more:worktrees', filters.worktrees);
  const whoChoices = [{ value: '', label: 'Everyone' }, ...filters.people.map((p) => ({ value: p.key, label: p.label })), { value: 'nobody', label: 'No one yet' }, ...(filters.hasPrivate ? [{ value: 'private', label: 'Private' }] : [])];
  return subPage(
    ctx,
    'tasks',
    'Tasks',
    card(
      [
        go('more:settings', here.repos.length > 1 ? 'Repos on This Board' : 'Board Settings', 'board-settings', { board: here.id }),
        go('more:about', here.own ? 'About This Board' : 'About This Project', 'about', { project: here.id }),
        go('more:labels', 'Labels', 'labels', { project: here.id }),
        !here.own && go('more:sync', sync ? 'Linear Sync' : 'Sync with Linear', 'sync', { project: here.id }),
        sync && !sync.syncing && ctx.draw.button('more:sync-now', 'Sync Now', () => ctx.call('board.syncNow', here.id), { plain: true }),
      ],
      { title: here.name },
    ),
    card(
      [
        toggle(ctx, 'more:auto-tasks', 'Open a Task for Every New Worktree', board.autoTasks, () => ctx.call('board.setAutoTasks', !board.autoTasks)),
        toggle(ctx, 'more:canceled', 'Show Canceled Tasks', !folded.includes('canceled'), () => setFolded(folded.includes('canceled') ? folded.filter((s) => s !== 'canceled') : [...folded, 'canceled'])),
        done > 0 &&
          ctx.draw.button('more:archive-done', `Archive ${done} Done Task${done === 1 ? '' : 's'}`, async () => {
            await ctx.call('board.archiveDone', here.id);
            ctx.effect({ toast: 'Done tasks are in the Archive' });
          }, { plain: true }),
      ],
      { title: 'Options' },
    ),
    (filters.people.length > 0 || Boolean(filters.who) || filters.boardRepos.length > 1 || filters.worktrees.length > 0) &&
      card(
        [
          (filters.people.length > 0 || Boolean(filters.who)) && field('Whose tasks', choices(ctx, 'who', whoChoices, filters.who, (value) => filters.setWho(value))),
          filters.boardRepos.length > 1 &&
            field(
              'Repos',
              row(filters.boardRepos.map((r) => toggle(ctx, `repo:${r}`, repoName(ctx, r) ?? r, picked(r), () => filters.setRepos(picked(r) ? filters.repos.filter((x) => x !== r) : [...filters.repos, r])))),
            ),
          filters.worktrees.length > 0 &&
            field(
              'Worktree',
              row([
                ctx.draw.button('worktree:all', 'Every worktree', () => filters.setWorktree(''), { plain: true, ...(filters.worktree ? { dim: true } : {}) }),
                places.earlier,
                ...places.rows.map((w) => ctx.draw.button(`worktree:${w.id}`, w.name, () => filters.setWorktree(w.id), { plain: true, ...(filters.worktree === w.id ? {} : { dim: true }) })),
                places.more,
              ]),
            ),
        ],
        { title: 'Show Only' },
      ),
    isOwnBoard(here.id) && boardDelete(ctx, board, here),
  );
}

/** A board you made, gone: its tasks go home to the boards of the repos they run in. */
export function boardDelete(ctx: Ctx, board: BoardState, here: BoardChoice): Node {
  const tasks = board.issues.filter((i) => boardOf(i) === here.id).length;
  return asking(ctx, 'board:delete', {
    label: 'Delete Board',
    question: `Delete the ${here.name} board?`,
    detail: tasks ? `Its ${tasks === 1 ? 'task goes' : `${tasks} tasks go`} back to the board of the repo ${tasks === 1 ? 'it runs' : 'each runs'} in, keys kept. The repos aren’t touched.` : 'Nothing is on it. The repos it covered keep their own boards.',
    confirm: 'Delete Board',
    danger: true,
    run: async () => {
      await ctx.call('board.removeBoard', here.id);
      ctx.effect({ toast: 'The board is gone' });
      ctx.go({ name: 'tasks' });
    },
  });
}

/** The priority scale, left to right. */
const SCALE: readonly Priority[] = ['none', 'low', 'medium', 'high', 'urgent'];

/**
 * A new task: say what you want in one box and your agent writes its title and goal (or write them
 * yourself), and how much it matters. The box can ask for several tasks, or an epic with its parts.
 * It goes on the board you're on, in the column you opened it from, in the repo you pick. Start
 * makes the worktree and puts your agent on it.
 */
export function newTaskPage(ctx: Ctx): Node {
  const params = ctx.route.params ?? {};
  const board = ctx.state.board;
  const projects = realProjects(ctx);
  const { here } = boardHere(ctx);
  if (!projects.length || !here) return subPage(ctx, 'tasks', 'Tasks', empty('Tasks belong to a project. Add a project in Work first.'));
  const parent = params.parent ? issueById(board, params.parent) : undefined;
  const onBoard = parent ? boardOf(parent) : (params.board ?? here.id);
  const covered = reposOf(board, onBoard).filter((r) => projects.some((p) => p.id === r));
  const repos = parent && !covered.includes(parent.projectId) ? [...covered, parent.projectId] : covered;
  const [repoPick, setRepo] = ctx.local('new-task:repo', '');
  const repo = repos.includes(repoPick) ? repoPick : ([params.project, parent?.projectId, lookedProject(ctx)].find((r): r is string => Boolean(r && repos.includes(r))) ?? repos[0]);
  if (!repo) return subPage(ctx, 'tasks', 'Tasks', empty('This board covers no repos here. Add one in its settings.'));
  const column = (params.status ?? parent?.status ?? 'todo') as IssueStatus;
  const [mine, setMine] = ctx.local('new-task:mine', false);
  const [titled, setTitled] = ctx.local('new-task:title', '');
  const [priority, setPriority] = ctx.local<Priority>('new-task:priority', 'none');
  const [assignee, setAssignee] = ctx.local('new-task:assignee', '');
  const [agent, setAgent] = ctx.local<AgentRef | null>('new-task:agent', null);
  const [only, setOnly] = ctx.local<boolean | null>('new-task:only', null);
  const [startIt, setStart] = ctx.local('new-task:start', false);
  const who = assigneeChoices(selfOf(ctx), matesOf(ctx, repo));
  const shared = sharedWith(ctx, repo);
  const forced = Boolean(parent?.private);
  const reset = (): void => {
    setRepo('');
    setMine(false);
    setTitled('');
    setPriority('none');
    setAssignee('');
    setAgent(null);
    setOnly(null);
    setStart(false);
  };
  const create = async (fields: { readonly describe?: string; readonly title?: string; readonly goal?: string }): Promise<void> => {
    const person = who.find((c) => c.key === assignee)?.assignee;
    const isPrivate = forced || (only ?? (fields.describe ? asksPrivate(fields.describe) : false));
    const created = (await ctx.call('board.create', {
      projectId: repo,
      board: onBoard,
      ...fields,
      status: startIt ? 'todo' : column,
      priority,
      ...(person ? { assignee: person } : {}),
      ...(parent ? { parent: parent.id } : {}),
      ...(agent ? { agent } : {}),
      private: isPrivate,
    })) as Issue | undefined;
    const wanted = startIt;
    reset();
    ctx.nav.back(ctx.pane);
    if (!created) return;
    if (!wanted) {
      ctx.effect({ toast: `Created ${created.key}${created.private ? ', private' : ''}` });
      return;
    }
    const ws = await ctx.call('board.start', created.id, { claude: true });
    if (typeof ws === 'string') openStarted(ctx, ws);
  };
  const where = [boardName(board, onBoard, (id) => repoName(ctx, id)), STATUS_INFO[startIt ? 'todo' : column].label].join(' · ');
  return subPage(
    ctx,
    'tasks',
    'Tasks',
    col([title(parent ? `New Sub-task of ${parent.key}` : 'New Task'), dim(parent ? `Under “${parent.title}” · ${where}` : where)]),
    mine
      ? col([
          ctx.draw.input('new-task:title', (value) => setTitled(value?.trim() ?? ''), { label: 'Title', value: titled, placeholder: 'Rate-limit the login endpoint', submitLabel: 'next', autoFocus: !titled }),
          titled.length > 0 &&
            ctx.draw.input(
              'new-task:goal',
              async (value) => {
                await create({ title: titled, ...(value?.trim() ? { goal: value.trim() } : {}) });
              },
              { label: 'Goal', placeholder: 'What it’s for and what done looks like. Markdown.', rows: 4, submitLabel: 'create', autoFocus: true },
            ),
          titled.length > 0 && ctx.draw.button('new-task:create', startIt ? 'Create and Start' : 'Create Task', () => create({ title: titled }), { primary: true, hotkey: MAIN_KEY }),
        ])
      : ctx.draw.input(
          'new-task:describe',
          async (value) => {
            const words = value?.trim();
            if (words) await create({ describe: words });
          },
          { placeholder: soloOn(ctx, repo) ? 'Say what you want done: one task, or a few. Your agent writes them.' : 'Say what you want done: one task, or a few and who each is for. Your agent writes them.', rows: 3, submitLabel: startIt ? 'create and start' : 'create', autoFocus: true },
        ),
    ctx.draw.button('new-task:mode', mine ? 'Let your agent write the title and goal' : 'Write title and goal myself', () => setMine(!mine), { plain: true, dim: true }),
    card(
      [
        col(
          [
            repos.length > 1 && field('Repo', choices(ctx, 'new-task:repo', repos.map((r) => ({ value: r, label: repoName(ctx, r) ?? r })), repo, (r) => setRepo(r))),
            field('Priority', choices(ctx, 'new-task:priority', SCALE.map((p) => ({ value: p, label: p === 'none' ? 'None' : PRIORITY_INFO[p].label })), priority, (p) => setPriority(p))),
            (Boolean(shared) || forced) &&
              field(
                'Who sees it',
                choices(ctx, 'new-task:sees', [...(forced ? [] : [{ value: 'team' as const, label: 'Your Team' }]), { value: 'only' as const, label: 'Only You' }], forced || only === true ? 'only' : 'team', (v) => setOnly(v === 'only')),
                forced ? dim('Its parent is private, so it is too.') : only === true ? undefined : dim(`Seen by ${shared ?? 'no one else'}, and whoever they team up with.`),
              ),
            !soloOn(ctx, repo) && field('Assignee', choices(ctx, 'new-task:assignee', [{ value: '', label: 'No one' }, ...who.map((c) => ({ value: c.key, label: c.label }))], assignee, (a) => setAssignee(a))),
            prop(ctx, 'new-task:agent', 'Agent', agent ? agentName(agent, { model: true }) : `Your agent (${agentName(myAgent(ctx))})`, () => ctx.go({ name: 'new-task-agent', params })),
            toggle(ctx, 'new-task:start', 'Start with your agent: a new worktree, with your agent working on it', startIt, () => setStart(!startIt)),
          ],
          { gap: 1 },
        ),
      ],
      { title: 'Details' },
    ),
  );
}

/** Who works a new task when it starts: its worktree runs this agent and model. */
export function newTaskAgentPage(ctx: Ctx): Node {
  const [agent, setAgent] = ctx.local<AgentRef | null>('new-task:agent', null);
  return subPage(
    ctx,
    'tasks',
    'New Task',
    title('Agent'),
    dim('Who works on it when it starts: its worktree runs this agent and model.'),
    ...agentRows(ctx, 'new-task-agent', agent ?? undefined, (picked) => {
      setAgent(picked ?? null);
      ctx.nav.back(ctx.pane);
    }),
  );
}

/** The boards there are: a press shows one, and New Board makes one over a few repos. */
export function boardsPage(ctx: Ctx): Node {
  const board = ctx.state.board;
  const { boards, here } = boardHere(ctx);
  const [, setPicked] = ctx.local('board:board', '');
  const list = windowed(ctx, 'boards', boards);
  const hint = (b: BoardChoice): string => {
    const open = board.issues.filter((i) => showsOn(i, b.id) && isOpen(i.status) && !i.archivedAt).length;
    return [b.repos.length > 1 ? `${b.repos.length} repos` : '', open ? `${open} open` : ''].filter(Boolean).join(' · ');
  };
  return subPage(
    ctx,
    'tasks',
    'Tasks',
    ctx.draw.button('boards:new', 'New Board', () => ctx.go({ name: 'board-new' }), { primary: true, hotkey: 'n' }),
    boards.length === 0 && empty('No boards yet. Every project has its own: add one in Work.'),
    boards.length > 0 &&
      section(
        'Boards',
        [
          card([
            list.earlier,
            ...list.rows.map((b) =>
              ctx.draw.button(
                `boards:pick:${b.id}`,
                b.name,
                () => {
                  setPicked(b.id);
                  ctx.nav.back(ctx.pane);
                },
                { plain: true, spans: [span(b.id === here?.id ? '● ' : '  ', { color: 'claude' }), span(b.name, b.id === here?.id ? { weight: 'bold' } : {}), span(`  ${hint(b)}`, { dim: true })] },
              ),
            ),
            list.more,
          ]),
        ],
        boards.length,
      ),
    here && ctx.draw.button('boards:settings', `${here.name} Settings`, () => ctx.go({ name: 'board-settings', params: { board: here.id } }), { plain: true, dim: true }),
  );
}
