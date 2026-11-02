import { parseCriterion } from '../../core/board/criteria.js';
import { type Assignee, type BoardState, type Issue, type IssueStatus, PRIORITY_INFO, boardName, boardOf, byRank, filterIssues, isOpen, isOwnBoard, reposOf, showsOn } from '../../core/board/model.js';

/**
 * The Tasks screens' pure parts: which tasks a view shows and in what order, the boards there are,
 * who a task can be for, and words for dates. The Mac app has these for itself in its own package.
 */

export type Scope = 'mine' | 'active' | 'backlog' | 'all' | 'archived';

export const SCOPES: ReadonlyArray<{ readonly value: Scope; readonly label: string; readonly hotkey: string; readonly hint: string }> = [
  { value: 'mine', label: 'My Tasks', hotkey: '1', hint: 'Yours, on every board: open, and what finished this week' },
  { value: 'active', label: 'Active', hotkey: '2', hint: 'Ready, In Progress and In Review' },
  { value: 'backlog', label: 'Backlog', hotkey: '3', hint: 'Not planned yet' },
  { value: 'all', label: 'All', hotkey: '4', hint: 'Everything open, and what finished this week' },
  { value: 'archived', label: 'Archive', hotkey: '5', hint: 'Finished tasks you archived: their words and history kept' },
];

/** Where a task can be moved by hand, in the order a board reads. Merged into Plan is the plan's to say. */
export const MOVES: readonly IssueStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];

/** The status before or after this one on the board. */
export function statusBeside(status: IssueStatus, by: -1 | 1): IssueStatus | undefined {
  if (status === 'in_plan') return by < 0 ? 'in_review' : 'done';
  return MOVES[MOVES.indexOf(status) + by];
}

/** A column's own order, what Up and Down change. */
export const boardOrder = (a: Issue, b: Issue): number => byRank(a, b) || PRIORITY_INFO[a.priority].rank - PRIORITY_INFO[b.priority].rank;

/** The neighbours a card put at `index` sits between (in the column without it). */
export function neighbours(cards: readonly Issue[], lifted: string, index: number): { readonly before?: string; readonly after?: string } {
  const rest = cards.filter((c) => c.id !== lifted);
  const before = rest[index - 1];
  const after = rest[index];
  return { ...(before ? { before: before.id } : {}), ...(after ? { after: after.id } : {}) };
}

/**
 * The tasks to show, sub-tasks left tucked under their epics unless you opened that epic out, and
 * how many were. A sub-task stays when its epic isn't shown, and words find everything.
 */
export function untucked(issues: readonly Issue[], opened: readonly string[], query = ''): { readonly shown: readonly Issue[]; readonly hidden: number; readonly tucked: readonly string[] } {
  if (query.trim()) return { shown: issues, hidden: 0, tucked: [] };
  const here = new Set(issues.map((i) => i.id));
  const open = new Set(opened);
  const byId = new Map(issues.map((i) => [i.id, i]));
  const away = (i: Issue): boolean => {
    const seen = new Set<string>();
    for (let up = i.parent; up && here.has(up) && !seen.has(up); up = byId.get(up)?.parent) {
      seen.add(up);
      if (!open.has(up)) return true;
    }
    return false;
  };
  const shown = issues.filter((i) => !away(i));
  if (shown.length === issues.length) return { shown: issues, hidden: 0, tucked: [] };
  return { shown, hidden: issues.length - shown.length, tucked: [...new Set(issues.filter(away).flatMap((i) => (i.parent ? [i.parent] : [])))] };
}

export const assigneeKey = (a: Assignee | undefined): string => (a ? `person:${a.id}` : '');

/** Whether a task is for `who` ('' anyone, 'nobody' no one yet, 'private' only you see it, else an assignee key). */
export const isFor = (issue: Issue, who: string): boolean => (!who ? true : who === 'nobody' ? !issue.assignee : who === 'private' ? Boolean(issue.private) : assigneeKey(issue.assignee) === who);

export interface TaskFilter {
  readonly scope: Scope;
  /** One board's (a repo's own also shows what runs in its repo from other boards); none: every board's. */
  readonly board?: string;
  readonly who?: string;
  readonly repos?: readonly string[];
}

export function scoped(board: BoardState, f: TaskFilter, selfId: string, query = '', now = Date.now()): Issue[] {
  return filterIssues(board, { scope: f.scope, selfId, now, ...(f.board ? { boardId: f.board, visiting: true } : {}), ...(f.repos?.length ? { repos: f.repos } : {}), ...(query.trim() ? { query } : {}) }).filter((i) => isFor(i, f.who ?? ''));
}

/** How many unfinished tasks each scope has, and how many are archived: the tabs' counts. */
export function scopeCounts(board: BoardState, f: Omit<TaskFilter, 'scope'>, selfId: string, now = Date.now()): Readonly<Record<Scope, number>> {
  const count = (scope: Scope): number => scoped(board, { ...f, scope }, selfId, '', now).filter((i) => isOpen(i.status)).length;
  return { mine: scoped(board, { scope: 'mine' }, selfId, '', now).filter((i) => isOpen(i.status)).length, active: count('active'), backlog: count('backlog'), all: count('all'), archived: scoped(board, { ...f, scope: 'archived' }, selfId, '', now).length };
}

/** Done tasks a board shows, not archived yet: what Archive Done takes. */
export const doneCount = (board: BoardState, boardId: string): number => board.issues.filter((i) => i.status === 'done' && showsOn(i, boardId) && i.archivedAt === undefined).length;

export interface BoardChoice {
  readonly id: string;
  readonly name: string;
  /** The repos it covers (project ids), its own first; those no longer here left out. */
  readonly repos: readonly string[];
  /** A board of its own, not one repo's. */
  readonly own: boolean;
}

/** Every repo's own board, then boards of their own by name. */
export function boardChoices(board: BoardState, projects: ReadonlyArray<{ readonly id: string; readonly name: string }>): BoardChoice[] {
  const name = (id: string): string | undefined => projects.find((p) => p.id === id)?.name;
  const here = (repos: readonly string[]): string[] => repos.filter((r) => projects.some((p) => p.id === r));
  const repoBoards = projects.map((p) => ({ id: p.id, name: boardName(board, p.id, name), repos: here(reposOf(board, p.id)), own: false }));
  const made = Object.keys(board.projects)
    .filter(isOwnBoard)
    .map((id) => ({ id, name: boardName(board, id, name), repos: here(reposOf(board, id)), own: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...repoBoards, ...made];
}

/** The board to show: the one you last picked while it covers the repo you're in, else that repo's, else the busiest. */
export function boardToShow(board: BoardState, boards: readonly BoardChoice[], lastRepo: string, lastBoard: string): BoardChoice | undefined {
  const known = (id: string): BoardChoice | undefined => (id ? boards.find((b) => b.id === id) : undefined);
  const last = known(lastBoard);
  if (last && (!lastRepo || last.repos.includes(lastRepo))) return last;
  const open = (id: string): number => board.issues.filter((i) => showsOn(i, id) && isOpen(i.status)).length;
  return known(lastRepo) ?? last ?? [...boards].sort((a, b) => open(b.id) - open(a.id))[0];
}

/** The repos a board shows tasks from: the ones it covers, and any its tasks still run in. */
export function boardRepos(board: BoardState, boardId: string, projects: ReadonlyArray<{ readonly id: string }>): string[] {
  const running = board.issues.filter((i) => showsOn(i, boardId)).map((i) => i.projectId);
  return [...new Set([...reposOf(board, boardId), ...running])].filter((r) => projects.some((p) => p.id === r));
}

/** Whether you work alone on a project: no teammates and no task there for anyone but you. Then who a task is for isn't shown. */
export function isSolo(board: BoardState, projectId: string, selfId: string, others: number): boolean {
  if (others > 0) return false;
  return !board.issues.some((i) => (i.projectId === projectId || boardOf(i) === projectId) && i.assignee && i.assignee.id !== selfId);
}

export interface Person {
  readonly id: string;
  readonly name: string;
}

/** The people a board's tasks are for, you first: the Whose Tasks filter. */
export function assigneesIn(board: BoardState, boardId: string, selfId: string): ReadonlyArray<{ readonly key: string; readonly label: string }> {
  const seen = new Map<string, Assignee>();
  for (const i of board.issues) if (showsOn(i, boardId) && i.assignee) seen.set(assigneeKey(i.assignee), i.assignee);
  const mine = (a: Assignee): number => (a.id === selfId ? 0 : 1);
  return [...seen.entries()].sort(([, a], [, b]) => mine(a) - mine(b) || a.name.localeCompare(b.name)).map(([key, a]) => ({ key, label: a.id === selfId ? 'You' : a.name }));
}

/** Who a task can be for: you, then the project's teammates. Someone it's already for stays in the list. */
export function assigneeChoices(self: Person, people: readonly Person[], current?: Assignee): ReadonlyArray<{ readonly key: string; readonly label: string; readonly assignee: Assignee }> {
  const all = current && current.id !== self.id && !people.some((p) => p.id === current.id) ? [...people, { id: current.id, name: current.name }] : people;
  const others = all.filter((p) => p.id !== self.id).sort((a, b) => a.name.localeCompare(b.name));
  return [{ key: `person:${self.id}`, label: 'You', assignee: { kind: 'person', id: self.id, name: self.name } }, ...others.map((p) => ({ key: `person:${p.id}`, label: p.name, assignee: { kind: 'person' as const, id: p.id, name: p.name } }))];
}

/** A due date in words: "Today", "Tomorrow", "In 3 days", "2 days late", "Nov 3". */
export function dueText(day: string, now = Date.now()): { readonly text: string; readonly late: boolean } {
  const [y, m, d] = day.split('-').map(Number);
  const due = new Date(y!, m! - 1, d!).getTime();
  const today = new Date(new Date(now).toDateString()).getTime();
  const days = Math.round((due - today) / 86_400_000);
  if (days === 0) return { text: 'Today', late: false };
  if (days === 1) return { text: 'Tomorrow', late: false };
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} late`, late: true };
  if (days < 7) return { text: `In ${days} days`, late: false };
  return { text: new Date(due).toLocaleDateString([], { month: 'short', day: 'numeric' }), late: false };
}

/** Tick or untick the n-th checkbox in Markdown. Ticking drops its reason: it's met now. */
export function toggleCheck(words: string, index: number): string {
  let n = -1;
  return words
    .split('\n')
    .map((text) => {
      const m = /^(\s*[-*]\s+\[)([ xX])(\].*)$/.exec(text);
      if (!m) return text;
      n++;
      if (n !== index) return text;
      if (m[2] !== ' ') return `${m[1]} ${m[3]}`;
      const c = parseCriterion(text);
      return c?.reason ? `${m[1]}x] ${c.text}` : `${m[1]}x${m[3]}`;
    })
    .join('\n');
}
