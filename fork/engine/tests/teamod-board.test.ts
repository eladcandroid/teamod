import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppState } from '../src/core/store.js';
import { type Method, parseArgs } from '../src/ipc/api.js';
import { SURFACE } from '../src/teamod/coverage.js';
import { writtenParts } from '../src/teamod/panes/board-common.js';
import { peerText } from '../src/teamod/panes/common.js';
import type { Node } from '../src/teamod/tree.js';
import { type Started, flat, labelled, start, viewport, words } from './teamod-helpers.js';

const SELF = 'me';

const project = (id: string, name: string, workspaces: unknown[] = []): AppState['projects'][number] => ({ id, name, root: `/r/${name}`, base: 'main', workspaces }) as AppState['projects'][number];

const issue = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'i1',
  key: 'BOB-1',
  number: 1,
  projectId: 'p1',
  title: 'Add login',
  status: 'todo',
  priority: 'none',
  labels: [],
  blockedBy: [],
  related: [],
  rank: 1000,
  brief: {},
  revisions: [],
  worktrees: [],
  proof: [],
  activity: [],
  createdAt: 1,
  updatedAt: 1,
  createdBy: { kind: 'person', id: SELF, name: 'elad' },
  origin: 'manual',
  ...over,
});

const boardOf = (issues: ReadonlyArray<Record<string, unknown>>, extra: Record<string, unknown> = {}): AppState['board'] => ({ enabled: true, issues, projects: {}, autoTasks: false, ...extra }) as unknown as AppState['board'];

const planTask = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({ id, title: `Task ${id}`, acceptance: [], blockedBy: [], ...over });
const milestone = (id: string, tasks: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> => ({ id, title: `Milestone ${id}`, criteria: [], tasks, ...over });

const planOf = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'pl1',
  projectId: 'p1',
  home: 'ws:h1',
  status: 'draft',
  draft: { title: 'Payments', goal: 'Take cards', milestones: [milestone('m1', [planTask('t1')], { criteria: ['A card goes through'] })] },
  draftRev: 1,
  autonomy: 'gated',
  maxParallel: 3,
  testsAt: 'milestone',
  paused: false,
  runs: {},
  activity: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});
const plansOf = (plans: ReadonlyArray<Record<string, unknown>>, style = ''): AppState['plans'] => ({ enabled: true, plans, style }) as unknown as AppState['plans'];

const repo = { host: 'github.com', owner: 'acme', repo: 'api', url: 'https://github.com/acme/api' };
const ghIssue = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  number: 48,
  title: 'Login 500s',
  state: 'open',
  url: 'https://github.com/acme/api/issues/48',
  author: 'ata',
  labels: [{ name: 'bug', color: 'd73a4a' }],
  assignees: [],
  comments: 1,
  createdAt: 1,
  updatedAt: 2,
  body: 'It fails.',
  thread: [{ author: 'bob', body: 'Me too, see [the log](file:///etc/passwd) and [the docs](https://example.com/docs)', createdAt: 2, url: 'https://github.com/acme/api/issues/48#c1' }],
  ...over,
});

const ghRun = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 7,
  workflow: 'CI',
  path: '.github/workflows/ci.yml',
  title: 'Fix the login',
  number: 12,
  attempt: 1,
  event: 'push',
  status: 'completed',
  conclusion: 'failure',
  branch: 'main',
  sha: 'abcdef1234',
  actor: 'ata',
  prs: [],
  url: 'https://github.com/acme/api/actions/runs/7',
  createdAt: 1,
  startedAt: 1,
  updatedAt: 2,
  ...over,
});
const ghJob = { id: 70, name: 'test', status: 'completed', conclusion: 'failure', startedAt: 1, completedAt: 2, url: 'https://github.com/acme/api/actions/runs/7/job/70', steps: [{ number: 1, name: 'npm test', status: 'completed', conclusion: 'failure', startedAt: 1, completedAt: 2 }] };

/** A session with one project and its board, on the screen for the route asked for. */
function boardSession(over: Partial<AppState> = {}): Started {
  return start({ selfId: SELF, projects: [project('p1', 'alpha')], board: boardOf([issue()]), plans: plansOf([]), ...over } as Partial<AppState>);
}

const go = (s: Started, name: string, params?: Record<string, string>): Node => {
  s.screens.nav.go('board', { name, ...(params ? { params } : {}) });
  return s.screens.view('board', viewport);
};

const press = async (s: Started, key: string, value?: string): Promise<void> => {
  const pressed = await s.screens.press('board', key, value, viewport);
  if (!pressed.ok) throw new Error(`${key}: ${pressed.error}`);
};

const see = (s: Started): Node => s.screens.view('board', viewport);

const keyOf = (node: Node): string | undefined => (node.k === 'button' || node.k === 'input' || node.k === 'select' ? node.key : undefined);
const hasKey = (tree: Node, key: string): boolean => flat(tree).some((n) => keyOf(n) === key);
const primaries = (tree: Node): string[] => flat(tree).flatMap((n) => (n.k === 'button' && n.primary ? [n.label] : []));

/** Everything a session asked of the engine, as the API would take it. */
const everyCallFits = (s: Started): void => {
  for (const [method, args] of s.calls) expect(() => parseArgs(method as Method, [...args]), `${method} ${JSON.stringify(args)}`).not.toThrow();
};

const THE_TOP = new Set(['w', 'k', 't', 'o', 'l', 'g', 'b', 's', 'p', 'i', 'a']);
const THEME = new Set(['success', 'error', 'warning', 'claude']);

/** What holds for every draw of the screen. */
function isTidy(tree: Node, where: string): void {
  expect(words(tree), where).not.toContain('This screen failed');
  const buttons = flat(tree).flatMap((n) => (n.k === 'button' ? [n] : []));
  const hotkeys = buttons.flatMap((b) => (b.hotkey ? [b.hotkey] : []));
  expect(new Set(hotkeys).size, `${where}: ${hotkeys.join(' ')}`).toBe(hotkeys.length);
  for (const b of buttons) {
    if (b.hotkey && THE_TOP.has(b.hotkey)) expect(/^(screen:|place:|back$)/.test(b.key), `${where}: ${b.key} takes ${b.hotkey}`).toBe(true);
  }
  expect(primaries(tree).length, `${where}: ${primaries(tree).join(', ')}`).toBeLessThanOrEqual(1);
  const spans = flat(tree).flatMap((n) => (n.k === 'text' ? n.spans : n.k === 'button' ? (n.spans ?? []) : []));
  for (const s of spans) if (s.color) expect(THEME.has(s.color), `${where}: ${s.color}`).toBe(true);
  const words_ = spans.map((s) => s.t).join(' ');
  expect(/\p{Extended_Pictographic}/u.test(words_.replace(/[#*0-9©®™↔-⇿←-↙]/g, '')), `${where}: ${words_}`).toBe(false);
}

describe('every method of the Board', () => {
  it('is wired in the source, or left out with a reason', () => {
    const dir = 'src/teamod/panes';
    const source = readdirSync(dir)
      .filter((name) => /^board(-.*)?\.ts$/.test(name))
      .map((name) => readFileSync(path.join(dir, name), 'utf8'))
      .join('\n');
    const mine = Object.entries(SURFACE).flatMap(([method, s]) => ('on' in s && s.on === 'board' ? [method] : []));
    expect(mine.length).toBe(68);
    expect(mine.filter((method) => !source.includes(`'${method}'`))).toEqual([]);
  });

  it('never says Claude where it means the agent', () => {
    const dir = 'src/teamod/panes';
    for (const name of readdirSync(dir).filter((n) => /^board(-.*)?\.ts$/.test(n))) {
      const said = readFileSync(path.join(dir, name), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .filter((l) => /['`"][^'`"]*\bClaude\b/.test(l));
      expect(said, name).toEqual([]);
    }
  });
});

describe('Tasks', () => {
  it('says when the board is off, and when there are no projects', () => {
    const off = start({ selfId: SELF } as Partial<AppState>);
    expect(words(off.screens.view('board', viewport))).toContain('Tasks are off');
    const none = start({ selfId: SELF, board: boardOf([]) } as Partial<AppState>);
    expect(words(none.screens.view('board', viewport))).toContain('No projects yet');
  });

  it('shows places on top of every page, and each scope its tasks, grouped by status', async () => {
    const s = boardSession({ board: boardOf([issue(), issue({ id: 'i2', key: 'BOB-2', title: 'Later thing', status: 'backlog' }), issue({ id: 'i3', key: 'BOB-3', title: 'Mine now', status: 'in_progress', assignee: { kind: 'person', id: SELF, name: 'elad' } }), issue({ id: 'i4', key: 'BOB-4', title: 'Put away', status: 'done', archivedAt: 5 })]) });
    const active = see(s);
    for (const place of ['Tasks', 'Plans', 'Issues', 'Actions']) expect(labelled(active, place)).toBeDefined();
    expect(labelled(active, 'Ready 1')).toBeDefined();
    expect(words(active)).toContain('Add login');
    expect(words(active)).toContain('Mine now');
    expect(words(active)).not.toContain('Later thing');
    await press(s, 'scope:backlog');
    expect(words(see(s))).toContain('Later thing');
    expect(words(see(s))).not.toContain('Add login');
    await press(s, 'scope:mine');
    expect(words(see(s))).toContain('Mine now');
    expect(words(see(s))).not.toContain('Add login');
    await press(s, 'scope:all');
    expect(words(see(s))).toContain('Later thing');
    await press(s, 'scope:archived');
    expect(words(see(s))).toContain('Put away');
    expect(words(see(s))).not.toContain('Add login');
    isTidy(see(s), 'the archive');
  });

  it('folds a group, and says what a filter finds', async () => {
    const s = boardSession({ board: boardOf([issue(), issue({ id: 'i2', key: 'BOB-2', title: 'Other one' })]) });
    await press(s, 'group:p1:todo');
    expect(words(see(s))).not.toContain('Add login');
    await press(s, 'group:p1:todo');
    await press(s, 'tasks:find');
    await press(s, 'tasks:filter', 'other');
    expect(words(see(s))).not.toContain('Add login');
    expect(words(see(s))).toContain('Other one');
    expect(words(see(s))).toContain('Only “other”');
    await press(s, 'tasks:find');
    await press(s, 'tasks:filter', 'nothing like this');
    expect(words(see(s))).toContain('Nothing matches');
    await press(s, 'tasks:everything');
    expect(words(see(s))).toContain('Add login');
  });

  it('creates a task from a description, in the column it was opened from', async () => {
    const s = boardSession();
    s.answers.set('board.create', () => issue({ id: 'i9', key: 'BOB-9' }));
    await press(s, 'group:p1:in_progress:new');
    expect(words(see(s))).toContain('In Progress');
    await press(s, 'new-task:describe', '  Rate limit the logins  ');
    expect(s.calls).toContainEqual(['board.create', [{ projectId: 'p1', board: 'p1', describe: 'Rate limit the logins', status: 'in_progress', priority: 'none', private: false }]]);
    expect(labelled(see(s), 'New Task')).toBeDefined();
    everyCallFits(s);
  });

  it('creates one you wrote yourself, with what you picked, and can start it right away', async () => {
    const s = boardSession({ runtimes: [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true }] } as Partial<AppState>);
    s.answers.set('board.create', () => issue({ id: 'i9', key: 'BOB-9' }));
    s.answers.set('board.start', () => 'w9');
    await press(s, 'tasks:new');
    await press(s, 'new-task:mode');
    await press(s, 'new-task:title', 'Rate limit');
    await press(s, 'new-task:priority:high');
    await press(s, 'new-task:agent');
    await press(s, 'new-task-agent:codex:');
    await press(s, 'new-task:start');
    expect(primaries(see(s))).toEqual(['Create and Start']);
    await press(s, 'new-task:goal', '10 tries a minute');
    expect(s.calls).toContainEqual(['board.create', [{ projectId: 'p1', board: 'p1', title: 'Rate limit', goal: '10 tries a minute', status: 'todo', priority: 'high', agent: { runtime: 'codex', label: 'Codex' }, private: false }]]);
    expect(s.calls).toContainEqual(['board.start', ['i9', { claude: true }]]);
    expect(s.calls).toContainEqual(['workspaces.load', ['w9']]);
    everyCallFits(s);
  });

  it('keeps a private ask private, and a sub-task under its parent', async () => {
    const s = boardSession();
    s.answers.set('board.create', () => issue({ id: 'i9', key: 'BOB-9' }));
    go(s, 'new-task', { parent: 'i1', board: 'p1', project: 'p1' });
    expect(words(see(s))).toContain('New Sub-task of BOB-1');
    await press(s, 'new-task:describe', 'Keep it private: just for me');
    expect(s.calls).toContainEqual(['board.create', [{ projectId: 'p1', board: 'p1', describe: 'Keep it private: just for me', status: 'todo', priority: 'none', parent: 'i1', private: true }]]);
  });

  it('moves a task with buttons, in place of dragging its card', async () => {
    const s = boardSession({ board: boardOf([issue({ rank: 1000 }), issue({ id: 'i2', key: 'BOB-2', rank: 2000 }), issue({ id: 'i3', key: 'BOB-3', rank: 3000 })]) });
    await press(s, 'tasks:moving');
    await press(s, 'move:i2:in_progress');
    expect(s.calls).toContainEqual(['board.move', ['i2', 'in_progress']]);
    await press(s, 'move:i2:up');
    expect(s.calls).toContainEqual(['board.move', ['i2', 'todo', { after: 'i1' }]]);
    await press(s, 'move:i2:down');
    expect(s.calls).toContainEqual(['board.move', ['i2', 'todo', { before: 'i3' }]]);
    expect(hasKey(see(s), 'move:i1:up')).toBe(false);
    expect(hasKey(see(s), 'move:i3:down')).toBe(false);
    everyCallFits(s);
  });

  it('moves one from its page', async () => {
    const s = boardSession();
    go(s, 'task', { id: 'i1' });
    expect(hasKey(see(s), 'move:i1:todo')).toBe(false);
    await press(s, 'move:i1:in_review');
    expect(s.calls).toContainEqual(['board.move', ['i1', 'in_review']]);
  });

  it('starts a task: a worktree, its agent on it, and you there', async () => {
    const s = boardSession();
    s.answers.set('board.start', () => 'w1');
    go(s, 'task', { id: 'i1' });
    expect(primaries(see(s))).toEqual(['Start']);
    await press(s, 'start:i1');
    expect(s.calls).toContainEqual(['board.start', ['i1', { claude: true }]]);
    expect(s.calls).toContainEqual(['workspaces.load', ['w1']]);
    expect(s.screens.nav.routeOf('board')).toMatchObject({ screen: 'task', name: 'ws', params: { id: 'w1' } });
  });

  it('starts with its own agent, or another for this start, or a worktree alone', async () => {
    const codex = { runtime: 'codex', label: 'Codex' };
    const s = boardSession({ board: boardOf([issue({ agent: codex })]), runtimes: [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true }, { id: 'local', label: 'Local model', available: false, why: 'Not set up' }] } as Partial<AppState>);
    go(s, 'task', { id: 'i1' });
    await press(s, 'start:i1');
    expect(s.calls).toContainEqual(['board.start', ['i1', { claude: true, agent: codex }]]);
    go(s, 'task-start-with', { id: 'i1' });
    expect(words(see(s))).toContain('Not set up');
    await press(s, 'start-with:i1:claude:');
    expect(s.calls).toContainEqual(['board.start', ['i1', { claude: true, agent: { runtime: 'claude', label: 'Claude' } }]]);
    go(s, 'task-more', { id: 'i1' });
    await press(s, 'more:i1:start-bare');
    expect(s.calls).toContainEqual(['board.start', ['i1', {}]]);
    everyCallFits(s);
  });

  it('offers Open Worktree instead of Start once one does it, and how it ended once finished', async () => {
    const ws = { id: 'w1', projectId: 'p1', name: 'bob-1', kind: 'worktree', path: '/w1', createdAt: 1 };
    const s = boardSession({ projects: [project('p1', 'alpha', [ws])], board: boardOf([issue({ status: 'in_progress', worktrees: ['w1'], branch: 'bob-1' })]) });
    const doing = go(s, 'task', { id: 'i1' });
    expect(primaries(doing)).toEqual(['Open Worktree']);
    expect(words(doing)).toContain('on bob-1');
    s.set({ board: boardOf([issue({ status: 'done', worktrees: ['w1'], branch: 'bob-1' })]) });
    expect(words(see(s))).toContain('Done');
    expect(labelled(see(s), 'Start')).toBeUndefined();
  });

  it('keeps the code in a task’s brief, and no way out of it to this computer', () => {
    const goal = ['Call the handlers.', '', '```ts', 'const out = fns[i](x);', '```', '', 'See [the file](file:///etc/passwd) and [the docs](https://example.com/docs).'].join('\n');
    const s = boardSession({ board: boardOf([issue({ brief: { goal } })]) });
    const tree = go(s, 'task', { id: 'i1' });
    const blocks = flat(tree).flatMap((n) => (n.k === 'code' ? [n] : []));
    expect(blocks).toEqual([{ k: 'code', source: 'const out = fns[i](x);', language: 'ts' }]);
    const prose = flat(tree).flatMap((n) => (n.k === 'md' ? [n.text] : [])).join('\n');
    expect(prose).toContain('Call the handlers.');
    expect(prose).toContain('[the docs](https://example.com/docs)');
    expect(prose).toContain('the file');
    expect(prose).not.toContain('file:///etc/passwd');
  });

  it('cuts written text at its fences, whatever the fence', () => {
    expect(writtenParts('a\n~~~\n[x](file:///y)\n~~~\nb')).toEqual([{ prose: 'a' }, { source: '[x](file:///y)' }, { prose: 'b' }]);
    expect(writtenParts('```js\nopen\nto the end')).toEqual([{ source: 'open\nto the end', language: 'js' }]);
    expect(writtenParts('```` \n```\nnot closed by less\n````')).toEqual([{ source: '```\nnot closed by less' }]);
    expect(writtenParts('``` not`a`fence\n[x](file:///y)')).toEqual([{ prose: peerText('``` not`a`fence\n[x](file:///y)') }]);
    expect(writtenParts('![a](file:///y)\n```\n![a](file:///y)\n```')).toEqual([{ prose: peerText('![a](file:///y)') }, { source: '![a](file:///y)' }]);
  });

  it('edits a brief’s section, ticks a criterion, and puts an old version back', async () => {
    const revisions = [{ id: 'r1', at: 2, by: { kind: 'person', id: SELF, name: 'elad' }, section: 'goal', before: 'Old goal', after: 'New goal', reason: 'Clearer' }];
    const s = boardSession({ board: boardOf([issue({ brief: { goal: 'New goal', acceptance: '- [ ] It works\n- [x] It builds\n- [ ] It ships — deferred: later' }, revisions })]) });
    const tree = go(s, 'task', { id: 'i1' });
    expect(words(tree)).toContain('1 of 3 · 1 deferred');
    expect(words(tree)).toContain('Deferred: later');
    await press(s, 'check:i1:0');
    expect(s.calls).toContainEqual(['board.editBrief', ['i1', 'acceptance', '- [x] It works\n- [x] It builds\n- [ ] It ships — deferred: later', 'ticked a criterion']]);
    await press(s, 'brief:context:add');
    await press(s, 'brief:i1:context', 'Where the code is');
    expect(s.calls).toContainEqual(['board.editBrief', ['i1', 'context', 'Where the code is']]);
    expect(s.screens.nav.routeOf('board').name).toBe('task');
    await press(s, 'brief:goal:history');
    expect(words(see(s))).toContain('Old goal');
    await press(s, 'history:r1:restore');
    expect(s.calls).toContainEqual(['board.restoreRevision', ['i1', 'r1']]);
    everyCallFits(s);
  });

  it('holds on to a section you wrote when it wouldn’t save', async () => {
    const s = boardSession();
    s.answers.set('board.editBrief', () => {
      throw new Error('Too long');
    });
    go(s, 'task-brief', { id: 'i1', section: 'goal' });
    const pressed = await s.screens.press('board', 'brief:i1:goal', 'My words', viewport);
    expect(pressed).toMatchObject({ ok: false, error: 'Too long' });
    expect(flat(see(s)).find((n) => n.k === 'input' && n.key === 'brief:i1:goal')).toMatchObject({ value: 'My words' });
  });

  it('comments, relates, and changes each property from its row', async () => {
    const s = boardSession({ board: boardOf([issue(), issue({ id: 'i2', key: 'BOB-2', title: 'Other one' })]) });
    go(s, 'task', { id: 'i1' });
    await press(s, 'task:i1:comment', 'Looks right');
    expect(s.calls).toContainEqual(['board.comment', ['i1', 'Looks right']]);
    await press(s, 'rel:blocked_by:add');
    await press(s, 'relate:i1:blocked_by:i2');
    expect(s.calls).toContainEqual(['board.relate', ['i1', 'blocked_by', 'i2', true]]);
    await press(s, 'prop:i1:priority');
    await press(s, 'edit:i1:priority:urgent');
    expect(s.calls).toContainEqual(['board.update', ['i1', { priority: 'urgent' }]]);
    await press(s, 'prop:i1:estimate');
    await press(s, 'edit:i1:estimate:5');
    expect(s.calls).toContainEqual(['board.update', ['i1', { estimate: 5 }]]);
    await press(s, 'prop:i1:due');
    const badDate = await s.screens.press('board', 'edit:i1:due', 'soon', viewport);
    expect(badDate).toMatchObject({ ok: false });
    await press(s, 'edit:i1:due', '2026-12-01');
    expect(s.calls).toContainEqual(['board.update', ['i1', { due: '2026-12-01' }]]);
    await press(s, 'prop:i1:labels');
    await press(s, 'edit:i1:label:bug');
    expect(s.calls).toContainEqual(['board.update', ['i1', { labels: ['bug'] }]]);
    s.screens.nav.back('board');
    await press(s, 'prop:i1:parent');
    await press(s, 'edit:i1:parent:i2');
    expect(s.calls).toContainEqual(['board.update', ['i1', { parent: 'i2' }]]);
    everyCallFits(s);
  });

  it('adds a sub-task and proof, and takes them back', async () => {
    const proof = { id: 'pf1', kind: 'url', title: 'Preview', url: 'https://x.example/p', at: 1, by: { kind: 'person', id: SELF, name: 'elad' } };
    const s = boardSession({ board: boardOf([issue({ proof: [proof] }), issue({ id: 'i2', key: 'BOB-2', title: 'A part', parent: 'i1' })]) });
    go(s, 'task', { id: 'i1' });
    expect(words(see(s))).toContain('A part');
    await press(s, 'task:i1:subtask', 'Another part');
    expect(s.calls).toContainEqual(['board.create', [{ projectId: 'p1', title: 'Another part', parent: 'i1', status: 'todo' }]]);
    await press(s, 'kid:i2:remove');
    expect(s.calls).toContainEqual(['board.update', ['i2', { parent: null }]]);
    await press(s, 'proof:pf1:remove');
    expect(s.calls).toContainEqual(['board.removeProof', ['i1', 'pf1']]);
    await press(s, 'proof:add');
    await press(s, 'proof:link', 'preview.example.com/a');
    expect(s.calls).toContainEqual(['board.addProof', ['i1', { kind: 'url', title: 'preview.example.com', url: 'https://preview.example.com/a' }]]);
    await press(s, 'file:add');
    await press(s, 'proof:path', '/tmp/shot.png');
    expect(s.calls).toContainEqual(['board.addProof', ['i1', { kind: 'image', title: 'shot.png', path: '/tmp/shot.png', context: true }]]);
    everyCallFits(s);
  });

  it('archives what’s finished, brings it back, and asks before deleting', async () => {
    const s = boardSession({ board: boardOf([issue({ status: 'done' }), issue({ id: 'i2', key: 'BOB-2', status: 'done', archivedAt: 5, title: 'Old one' })]) });
    go(s, 'task-more', { id: 'i1' });
    await press(s, 'more:i1:archive');
    expect(s.calls).toContainEqual(['board.archive', ['i1']]);
    await press(s, 'task:i1:delete');
    expect(s.calls.some(([m]) => m === 'board.remove')).toBe(false);
    expect(words(see(s))).toContain('Delete BOB-1?');
    await press(s, 'task:i1:delete:yes');
    expect(s.calls).toContainEqual(['board.remove', ['i1']]);
    go(s, 'task', { id: 'i2' });
    expect(words(see(s))).toContain('Archived');
    await press(s, 'task:i2:unarchive');
    expect(s.calls).toContainEqual(['board.unarchive', ['i2']]);
    go(s, 'tasks');
    await press(s, 'scope:archived');
    await press(s, 'tasks:empty-archive');
    expect(s.calls.some(([m]) => m === 'board.emptyArchive')).toBe(false);
    await press(s, 'tasks:empty-archive:yes');
    expect(s.calls).toContainEqual(['board.emptyArchive', ['p1']]);
    go(s, 'tasks-more');
    await press(s, 'more:archive-done');
    expect(s.calls).toContainEqual(['board.archiveDone', ['p1']]);
    everyCallFits(s);
  });

  it('settles a task whose worktree went away, and makes one private or shares it', async () => {
    const team = { enabled: true, offers: [], teams: { p1: { projectId: 'p1', repo: 'acme/api', mates: [{ peerId: 'ata', name: 'Ata', since: 1 }] } }, working: {}, waiting: {}, assigned: [], plans: [], planShares: {}, knocks: [], myKnocks: [] };
    const s = boardSession({ team, board: boardOf([issue({ worktreeGone: true }), issue({ id: 'i2', key: 'BOB-2', private: true })]) } as Partial<AppState>);
    go(s, 'task', { id: 'i1' });
    await press(s, 'task:i1:gone:backlog');
    expect(s.calls).toContainEqual(['board.settleGone', ['i1', 'backlog']]);
    go(s, 'task-more', { id: 'i1' });
    await press(s, 'more:i1:private');
    expect(s.calls).toContainEqual(['board.setPrivate', ['i1', true]]);
    go(s, 'task', { id: 'i2' });
    await press(s, 'task:i2:share');
    expect(s.calls).toContainEqual(['board.setPrivate', ['i2', false]]);
    go(s, 'task-edit', { id: 'i1', field: 'assignee' });
    await press(s, 'edit:i1:assignee:person:ata');
    expect(s.calls).toContainEqual(['board.update', ['i1', { assignee: { kind: 'person', id: 'ata', name: 'Ata' } }]]);
    everyCallFits(s);
  });

  it('picks who works it when it starts', async () => {
    const s = boardSession({ runtimes: [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true, models: [{ value: 'gpt-5', label: 'GPT-5' }] }] } as Partial<AppState>);
    s.answers.set('board.setAgent', () => 'Codex works BOB-1 when it starts');
    go(s, 'task-agent', { id: 'i1' });
    const pressed = await s.screens.press('board', 'agent:i1:codex:gpt-5', undefined, viewport);
    expect(pressed).toMatchObject({ ok: true, toast: 'Codex works BOB-1 when it starts' });
    expect(s.calls).toContainEqual(['board.setAgent', ['i1', { runtime: 'codex', label: 'Codex', model: 'gpt-5' }]]);
    go(s, 'task-agent', { id: 'i1' });
    await press(s, 'agent:i1:yours');
    expect(s.calls).toContainEqual(['board.setAgent', ['i1', null]]);
    everyCallFits(s);
  });

  it('tucks an epic’s sub-tasks under it until you open it out', async () => {
    const s = boardSession({ board: boardOf([issue({ title: 'The epic' }), issue({ id: 'i2', key: 'BOB-2', title: 'Its part', parent: 'i1' })]) });
    expect(words(see(s))).not.toContain('Its part');
    expect(words(see(s))).toContain('1 sub-task tucked');
    expect(words(see(s))).toContain('0/1');
    await press(s, 'tuck:i1');
    expect(words(see(s))).toContain('Its part');
    await press(s, 'tuck:i1');
    await press(s, 'tuck:all');
    expect(words(see(s))).toContain('Its part');
  });

  it('holds only a part of a long list, however far you read', async () => {
    const many = Array.from({ length: 330 }, (_, i) => issue({ id: `i${i}`, key: `BOB-${i}`, number: i, title: `Task number ${i}`, rank: i }));
    const s = boardSession({ board: boardOf(many) });
    const rows = (): string[] => flat(see(s)).flatMap((n) => (n.k === 'button' && /^task:i\d+$/.test(n.key) ? [n.key] : []));
    expect(rows().length).toBe(50);
    expect(hasKey(see(s), 'tasks:rows:earlier')).toBe(false);
    await press(s, 'tasks:rows:more');
    expect(rows().length).toBe(100);
    for (let i = 0; i < 5; i++) {
      await press(s, 'tasks:rows:more');
      expect(rows().length).toBeLessThanOrEqual(100);
    }
    expect(rows()).toContain('task:i329');
    expect(hasKey(see(s), 'tasks:rows:more')).toBe(false);
    await press(s, 'tasks:rows:earlier');
    expect(rows().length).toBeLessThanOrEqual(100);
    expect(rows()).toContain('task:i270');
    expect(hasKey(see(s), 'tasks:rows:more')).toBe(true);
  });

  it('switches boards, and makes one over a few repos', async () => {
    const s = boardSession({ projects: [project('p1', 'alpha'), project('p2', 'beta')], board: boardOf([issue(), issue({ id: 'i2', key: 'BET-1', title: 'In beta', projectId: 'p2' })]) });
    expect(words(see(s))).toContain('Add login');
    await press(s, 'board:pick');
    await press(s, 'boards:pick:p2');
    expect(words(see(s))).toContain('In beta');
    expect(words(see(s))).not.toContain('Add login');
    s.answers.set('board.createBoard', () => 'board_x');
    await press(s, 'board:pick');
    await press(s, 'boards:new');
    await press(s, 'board-new:name', 'Launch');
    await press(s, 'board-new:repo:p1');
    await press(s, 'board-new:repo:p2');
    await press(s, 'board-new:prefix', 'lnch');
    const bad = await s.screens.press('board', 'board-new:prefix', 'x', viewport);
    expect(bad).toMatchObject({ ok: false });
    await press(s, 'board-new:create');
    expect(s.calls).toContainEqual(['board.createBoard', [{ name: 'Launch', repos: ['p1', 'p2'], prefix: 'LNCH' }]]);
    everyCallFits(s);
  });

  it('changes a board’s name, repos and keys, and deletes one of its own', async () => {
    const s = boardSession({ projects: [project('p1', 'alpha'), project('p2', 'beta')], board: boardOf([issue({ board: 'board_x', projectId: 'p1' })], { projects: { board_x: { prefix: 'LNCH', next: 2, name: 'Launch', repos: ['p1'] } } }) });
    const tree = go(s, 'board-settings', { board: 'board_x' });
    expect(words(tree)).toContain('Launch Board');
    await press(s, 'board-settings:repo:p2');
    expect(s.calls).toContainEqual(['board.editBoard', ['board_x', { repos: ['p1', 'p2'] }]]);
    await press(s, 'board-settings:name', 'Launch 2');
    expect(s.calls).toContainEqual(['board.editBoard', ['board_x', { name: 'Launch 2' }]]);
    await press(s, 'board-settings:prefix', 'ln2');
    expect(s.calls).toContainEqual(['board.setPrefix', ['board_x', 'LN2']]);
    await press(s, 'board:delete');
    expect(words(see(s))).toContain('Delete the Launch board?');
    await press(s, 'board:delete:yes');
    expect(s.calls).toContainEqual(['board.removeBoard', ['board_x']]);
    everyCallFits(s);
  });

  it('keeps the project’s context and its own labels', async () => {
    const s = boardSession({ board: boardOf([issue()], { projects: { p1: { prefix: 'BOB', next: 2, labels: [{ name: 'perf', icon: 'gauge', color: 'teal' }] } } }) });
    s.answers.set('board.createLabel', () => ({ name: 'dark-mode' }));
    go(s, 'about', { project: 'p1' });
    await press(s, 'about:context', 'A login service.');
    expect(s.calls).toContainEqual(['board.setContext', ['p1', 'A login service.']]);
    go(s, 'labels', { project: 'p1' });
    expect(words(see(s))).toContain('Perf');
    await press(s, 'labels:remove:perf');
    expect(s.calls).toContainEqual(['board.removeLabel', ['p1', 'perf']]);
    await press(s, 'labels:name', 'bug');
    expect(words(see(s))).toContain('called that already');
    await press(s, 'labels:name', 'Dark Mode');
    await press(s, 'labels:icon:star');
    await press(s, 'labels:color:purple');
    await press(s, 'labels:create');
    expect(s.calls).toContainEqual(['board.createLabel', ['p1', { name: 'dark-mode', icon: 'star', color: 'purple' }]]);
    go(s, 'labels', { project: 'p1', issue: 'i1' });
    await press(s, 'labels:name', 'Fast');
    await press(s, 'labels:create');
    expect(s.calls).toContainEqual(['board.update', ['i1', { labels: ['dark-mode'] }]]);
    everyCallFits(s);
  });

  it('turns a new task for every worktree on and off, and whose tasks show', async () => {
    const team = { enabled: true, offers: [], teams: {}, working: {}, waiting: {}, assigned: [], plans: [], planShares: {}, knocks: [], myKnocks: [] };
    const s = boardSession({ team, board: boardOf([issue({ assignee: { kind: 'person', id: 'ata', name: 'Ata' } }), issue({ id: 'i2', key: 'BOB-2', title: 'Nobody’s' })]) } as Partial<AppState>);
    go(s, 'tasks-more');
    await press(s, 'more:auto-tasks');
    expect(s.calls).toContainEqual(['board.setAutoTasks', [true]]);
    await press(s, 'who:person:ata');
    s.screens.nav.back('board');
    expect(words(see(s))).toContain('Add login');
    expect(words(see(s))).not.toContain('Nobody’s');
    expect(words(see(s))).toContain('Only Ata');
    everyCallFits(s);
  });
});

describe('Linear', () => {
  const key = `lin_api_${'a'.repeat(30)}`;

  it('checks a key, lists its teams, and connects, never drawing the key', async () => {
    const s = boardSession();
    s.answers.set('board.syncTeams', () => ({ ok: true, workspace: 'Acme', teams: [{ id: 't1', key: 'ENG', name: 'Engineering' }, { id: 't2', key: 'OPS', name: 'Ops' }] }));
    s.answers.set('board.syncConnect', () => ({ ok: true, team: 'Engineering' }));
    go(s, 'sync', { project: 'p1' });
    await press(s, 'sync:key', 'not a key');
    expect(words(see(s))).toContain('starts with lin_api_');
    expect(s.calls.filter(([m]) => m === 'board.syncTeams')).toEqual([]);
    await press(s, 'sync:key', key);
    expect(s.calls).toContainEqual(['board.syncTeams', ['linear', key]]);
    expect(words(see(s))).toContain('Engineering (ENG)');
    expect(JSON.stringify(see(s))).not.toContain(key);
    await press(s, 'sync:team:t2');
    await press(s, 'sync:push');
    await press(s, 'sync:connect');
    expect(s.calls).toContainEqual(['board.syncConnect', ['p1', { provider: 'linear', key, teamId: 't2', auto: true, pushExisting: true }]]);
    everyCallFits(s);
  });

  it('says why a key or a team won’t do', async () => {
    const s = boardSession();
    s.answers.set('board.syncTeams', () => ({ ok: false, error: 'Linear said no' }));
    go(s, 'sync', { project: 'p1' });
    await press(s, 'sync:key', key);
    expect(words(see(s))).toContain('Linear said no');
    s.answers.set('board.syncTeams', () => ({ ok: true, teams: [{ id: 't1', key: 'ENG', name: 'Engineering' }] }));
    s.answers.set('board.syncConnect', () => ({ ok: false, error: 'No such team' }));
    await press(s, 'sync:key', key);
    await press(s, 'sync:connect');
    expect(words(see(s))).toContain('No such team');
  });

  it('once connected, syncs now, turns Autosync, and disconnects after asking', async () => {
    const sync = { provider: 'linear', workspace: 'Acme', team: 'Engineering', teamKey: 'ENG', auto: true, syncedAt: 1, linked: 3, error: { code: 'auth', message: 'The key was revoked', at: 1 } };
    const s = boardSession({ board: boardOf([issue()], { sync: { p1: sync } }) });
    expect(labelled(see(s), 'Linear: needs a new key')).toBeDefined();
    await press(s, 'board:sync');
    expect(words(see(s))).toContain('3 tasks linked');
    expect(words(see(s))).toContain('The key was revoked');
    await press(s, 'sync:now');
    expect(s.calls).toContainEqual(['board.syncNow', ['p1']]);
    await press(s, 'sync:autosync');
    expect(s.calls).toContainEqual(['board.syncAuto', ['p1', false]]);
    await press(s, 'sync:disconnect');
    await press(s, 'sync:disconnect:yes');
    expect(s.calls).toContainEqual(['board.syncDisconnect', ['p1']]);
    await press(s, 'sync:change');
    expect(hasKey(see(s), 'sync:key')).toBe(true);
    everyCallFits(s);
  });
});

describe('Plans', () => {
  const active = (over: Record<string, unknown> = {}): Record<string, unknown> => {
    const body = { title: 'Payments', goal: 'Take cards', milestones: [milestone('m1', [planTask('t1', { issueId: 'i1' }), planTask('t2', { issueId: 'i2', blockedBy: ['t1'] })], { criteria: ['A card goes through'] })] };
    return planOf({ status: 'active', draft: undefined, body, autonomy: 'step', approvedAt: 1, ...over });
  };
  const tasks = (first = 'todo', second = 'todo'): AppState['board'] => boardOf([issue({ title: 'Task t1', status: first, plan: { id: 'pl1', milestone: 'm1', task: 't1' } }), issue({ id: 'i2', key: 'BOB-2', title: 'Task t2', status: second, plan: { id: 'pl1', milestone: 'm1', task: 't2' } })]);

  it('says when plans are off, and lists a project’s with what each waits for', async () => {
    const off = start({ selfId: SELF, projects: [project('p1', 'alpha')] } as Partial<AppState>);
    off.screens.nav.go('board', { name: 'plans' });
    expect(words(off.screens.view('board', viewport))).toContain('Plans are off');
    const s = boardSession({ projects: [project('p1', 'alpha'), project('p2', 'beta')], board: tasks(), plans: plansOf([active(), planOf({ id: 'pl2', projectId: 'p1', draft: { title: 'Draft one', goal: 'g', milestones: [milestone('m1', [planTask('x')])] } }), planOf({ id: 'pl3', projectId: 'p2', draft: { title: 'In beta', goal: 'g', milestones: [] } })]) });
    await press(s, 'place:plans');
    const words_ = words(see(s));
    expect(words_).toContain('Payments');
    expect(words_).toContain('Draft one');
    expect(words_).toContain('1 milestone · 1 task · draft');
    expect(words_).not.toContain('In beta');
    await press(s, 'project:pick');
    await press(s, 'pick:p2');
    expect(words(see(s))).toContain('In beta');
    isTidy(see(s), 'plans');
  });

  it('starts a new plan, how it runs and who works it, and opens it', async () => {
    const s = boardSession({ runtimes: [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true }], plans: plansOf([active()]) } as Partial<AppState>);
    s.answers.set('plans.create', () => ({ id: 'pl1' }));
    go(s, 'plans');
    await press(s, 'plans:new');
    await press(s, 'plan-new:autonomy:autopilot');
    await press(s, 'plan-new:tests:end');
    await press(s, 'plan-new:agent');
    await press(s, 'plan-new-agent:codex:');
    await press(s, 'plan-new:goal', 'Let customers pay');
    expect(s.calls).toContainEqual(['plans.create', [{ projectId: 'p1', goal: 'Let customers pay', autonomy: 'autopilot', testsAt: 'end', agent: { runtime: 'codex', label: 'Codex' } }]]);
    expect(s.screens.nav.routeOf('board')).toMatchObject({ name: 'plan', params: { id: 'pl1' } });
    s.screens.nav.back('board');
    expect(s.screens.nav.routeOf('board').name).toBe('plans');
    everyCallFits(s);
  });

  it('plans in a conversation you have open', async () => {
    const chat = { id: 'c1', projectId: 'p1', name: 'A chat', kind: 'chat', path: '/c1', createdAt: 1 };
    const s = boardSession({ projects: [project('p1', 'alpha', [chat])], plans: plansOf([planOf()]) });
    s.answers.set('plans.here', () => ({ id: 'pl1' }));
    go(s, 'plan-new', { project: 'p1' });
    await press(s, 'plan-new:here');
    await press(s, 'plan-here:c1');
    expect(s.calls).toContainEqual(['plans.here', ['ws:c1', 'gated']]);
    expect(s.screens.nav.routeOf('board')).toMatchObject({ name: 'plan', params: { id: 'pl1' } });
    everyCallFits(s);
  });

  it('approves a draft, the one main action; never approved, it can be discarded', async () => {
    const s = boardSession({ plans: plansOf([planOf()]) });
    const tree = go(s, 'plan', { id: 'pl1' });
    expect(words(tree)).toContain('Approve the plan: 1 milestone · 1 task');
    expect(words(tree)).toContain('Passes when');
    expect(primaries(tree)).toEqual(['Approve Plan']);
    expect(s.calls).toContainEqual(['workspaces.load', ['h1']]);
    const pressed = await s.screens.press('board', 'plan:pl1:approve', undefined, viewport);
    expect(pressed).toMatchObject({ ok: true, toast: 'Plan approved: its tasks are on the board' });
    expect(s.calls).toContainEqual(['plans.approve', ['pl1']]);
    await press(s, 'plan:pl1:more');
    await press(s, 'more:pl1:discard');
    await press(s, 'more:pl1:discard:yes');
    expect(s.calls).toContainEqual(['plans.discard', ['pl1']]);
    everyCallFits(s);
  });

  it('approves with another agent on its work', async () => {
    const s = boardSession({ runtimes: [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true }], plans: plansOf([planOf()]) } as Partial<AppState>);
    go(s, 'plan-more', { id: 'pl1' });
    await press(s, 'more:pl1:approve-with');
    await press(s, 'plan-agent:pl1:codex:');
    const at = s.calls.findIndex(([m]) => m === 'plans.setWorkAgent');
    expect(s.calls[at]).toEqual(['plans.setWorkAgent', ['pl1', { runtime: 'codex', label: 'Codex' }]]);
    expect(s.calls[at + 1]).toEqual(['plans.approve', ['pl1']]);
    everyCallFits(s);
  });

  it('says while your agent writes the first plan', () => {
    const s = boardSession({ plans: plansOf([planOf({ draft: undefined, createdAt: Date.now() })]) });
    const tree = go(s, 'plan', { id: 'pl1' });
    expect(words(tree)).toContain('Your agent is starting on the plan');
    expect(primaries(tree)).toEqual([]);
  });

  it('sets how it runs after saying what changes, for the plan or one milestone', async () => {
    const s = boardSession({ board: tasks(), plans: plansOf([active({ autonomy: 'gated' })]) });
    go(s, 'plan', { id: 'pl1' });
    await press(s, 'plan:pl1:mode');
    expect(words(see(s))).toContain('runs on Check-ins now');
    expect(hasKey(see(s), 'plan-mode:pl1:switch')).toBe(false);
    await press(s, 'plan-mode:pl1:autopilot');
    expect(words(see(s))).toContain('From now on the agent passes milestones itself');
    expect(primaries(see(s))).toEqual(['Switch to Autopilot']);
    await press(s, 'plan-mode:pl1:switch');
    expect(s.calls).toContainEqual(['plans.setAutonomy', ['pl1', 'autopilot']]);
    go(s, 'plan-mode', { id: 'pl1', milestone: 'm1' });
    await press(s, 'plan-mode:pl1:step');
    await press(s, 'plan-mode:pl1:switch');
    expect(s.calls).toContainEqual(['plans.setAutonomy', ['pl1', 'step', 'm1']]);
    everyCallFits(s);
  });

  it('shows the outline, and starts and resumes tasks', async () => {
    const s = boardSession({ board: tasks(), plans: plansOf([active()]) });
    const tree = go(s, 'plan', { id: 'pl1' });
    expect(words(tree)).toContain('Milestone m1');
    expect(words(tree)).toContain('Task t1');
    expect(words(tree)).toContain('Waits on “Task t1”');
    expect(primaries(tree)).toEqual(['Start “Task t1”']);
    await press(s, 'plan:pl1:start');
    expect(s.calls).toContainEqual(['plans.startTask', ['pl1', 't1']]);
    await press(s, 'plan-task:t1:start');
    await press(s, 'plan-task:t1');
    expect(words(see(s))).toContain('Task t1');
    expect(primaries(see(s))).toEqual(['Start']);
    await press(s, 'plan-task:t1:start');
    s.set({ board: boardOf([issue({ title: 'Task t1', status: 'in_progress', worktrees: ['w1'], plan: { id: 'pl1', milestone: 'm1', task: 't1' } }), issue({ id: 'i2', key: 'BOB-2', title: 'Task t2', plan: { id: 'pl1', milestone: 'm1', task: 't2' } })]) });
    expect(primaries(see(s))).toEqual(['Resume']);
    await press(s, 'plan-task:t1:resume');
    expect(s.calls).toContainEqual(['plans.resumeTask', ['pl1', 't1']]);
    everyCallFits(s);
  });

  it('changes the outline: renames, moves, takes out, and what waits on what', async () => {
    const body = { title: 'Payments', goal: 'g', milestones: [milestone('m1', [planTask('t1'), planTask('t2')]), milestone('m2', [planTask('t3')])] };
    const s = boardSession({ plans: plansOf([planOf({ draft: body })]) });
    go(s, 'plan-task', { id: 'pl1', task: 't1' });
    await press(s, 'plan-task:t1:rename', 'A better name');
    expect(s.calls).toContainEqual(['plans.edit', ['pl1', [{ op: 'update_task', id: 't1', patch: { title: 'A better name' } }]]]);
    await press(s, 'plan-task:t1:move:m2');
    expect(s.calls).toContainEqual(['plans.edit', ['pl1', [{ op: 'move_task', id: 't1', milestone: 'm2' }]]]);
    await press(s, 'plan-task:t1:waits:t2');
    expect(s.calls).toContainEqual(['plans.edit', ['pl1', [{ op: 'block', id: 't1', by: 't2', on: true }]]]);
    await press(s, 'plan-task:t1:who');
    expect(s.calls).toContainEqual(['plans.edit', ['pl1', [{ op: 'update_task', id: 't1', patch: { assignee: 'me' } }]]]);
    await press(s, 'plan-task:t1:remove');
    await press(s, 'plan-task:t1:remove:yes');
    expect(s.calls).toContainEqual(['plans.edit', ['pl1', [{ op: 'remove_task', id: 't1' }]]]);
    go(s, 'plan-gate', { id: 'pl1', milestone: 'm1' });
    await press(s, 'gate:m1:rename', 'The API');
    expect(s.calls).toContainEqual(['plans.edit', ['pl1', [{ op: 'update_milestone', id: 'm1', title: 'The API' }]]]);
    await press(s, 'gate:m1:criteria', 'It works\n\nIt ships');
    expect(s.calls).toContainEqual(['plans.edit', ['pl1', [{ op: 'update_milestone', id: 'm1', criteria: ['It works', 'It ships'] }]]]);
    await press(s, 'gate:m1:remove');
    await press(s, 'gate:m1:remove:yes');
    expect(s.calls).toContainEqual(['plans.edit', ['pl1', [{ op: 'remove_milestone', id: 'm1' }]]]);
    go(s, 'plan-more', { id: 'pl1' });
    await press(s, 'more:pl1:rename', 'Card payments');
    expect(s.calls).toContainEqual(['plans.edit', ['pl1', [{ op: 'retitle', title: 'Card payments' }]]]);
    everyCallFits(s);
  });

  it('passes a milestone, checks it again, and sends it back with what’s missing', async () => {
    const runs = { m1: { checkAsked: 5, check: { at: 6, by: { kind: 'claude', owner: SELF, ownerName: 'elad' }, verdict: 'pass', notes: 'All **good**' } } };
    const s = boardSession({ board: tasks('in_review', 'in_review'), plans: plansOf([active({ runs })]) });
    const tree = go(s, 'plan', { id: 'pl1' });
    expect(primaries(tree)).toEqual(['Pass Milestone']);
    await press(s, 'plan:pl1:pass:m1');
    expect(s.calls).toContainEqual(['plans.pass', ['pl1', 'm1']]);
    s.set({ plans: plansOf([active({ runs: { m1: { checkAsked: 5, check: { ...runs.m1.check, verdict: 'fail', notes: 'Refunds are off' } } } })]) });
    expect(primaries(see(s))).toEqual(['Not Yet']);
    await press(s, 'plan:pl1:not-yet:m1');
    await press(s, 'plan-send-back:m1', 'Refunds don’t show');
    expect(s.calls).toContainEqual(['plans.sendBack', ['pl1', 'm1', 'Refunds don’t show']]);
    await press(s, 'milestone:m1');
    expect(words(see(s))).toContain('Refunds are off');
    await press(s, 'gate:m1:recheck');
    expect(s.calls).toContainEqual(['plans.recheck', ['pl1', 'm1']]);
    await press(s, 'gate:m1:pass');
    go(s, 'plan-more', { id: 'pl1' });
    await press(s, 'more:pl1:recheck');
    await press(s, 'more:pl1:pass-anyway');
    everyCallFits(s);
  });

  it('pauses, runs so many at once, tests when you say, and keeps your style', async () => {
    const s = boardSession({ board: tasks(), plans: plansOf([active()], 'Small tasks') });
    go(s, 'plan-more', { id: 'pl1' });
    await press(s, 'more:pl1:pause');
    expect(s.calls).toContainEqual(['plans.setPaused', ['pl1', true]]);
    await press(s, 'more:pl1:parallel:6');
    expect(s.calls).toContainEqual(['plans.setParallel', ['pl1', 6]]);
    await press(s, 'more:pl1:tests:end');
    expect(s.calls).toContainEqual(['plans.setTestsAt', ['pl1', 'end']]);
    await press(s, 'more:pl1:agent');
    await press(s, 'plan-agent:pl1:yours');
    expect(s.calls).toContainEqual(['plans.setWorkAgent', ['pl1', null]]);
    await press(s, 'more:pl1:style');
    expect(flat(see(s)).find((n) => n.k === 'input')).toMatchObject({ value: 'Small tasks' });
    await press(s, 'plan-style:style', 'Smaller tasks');
    expect(s.calls).toContainEqual(['plans.setStyle', ['Smaller tasks']]);
    await press(s, 'more:pl1:remove');
    await press(s, 'more:pl1:remove:yes');
    expect(s.calls).toContainEqual(['plans.remove', ['pl1']]);
    expect(s.screens.nav.routeOf('board').name).toBe('plans');
    s.set({ plans: plansOf([active({ paused: true })]) });
    expect(primaries(go(s, 'plan', { id: 'pl1' }))).toEqual(['Resume']);
    await press(s, 'plan:pl1:resume');
    expect(s.calls).toContainEqual(['plans.setPaused', ['pl1', false]]);
    everyCallFits(s);
  });

  it('ships: the pull request, merging it, main brought in, a conflict and what went wrong', async () => {
    const shipping = (over: Record<string, unknown>): Record<string, unknown> => active({ status: 'done', branch: 'plan/payments', runs: { m1: { passedAt: 5 } }, ...over });
    const s = boardSession({ board: tasks('in_plan', 'in_plan'), plans: plansOf([shipping({})]) });
    const opening = go(s, 'plan', { id: 'pl1' });
    expect(primaries(opening)).toEqual(['Open PR']);
    s.answers.set('plans.openPr', () => {
      throw new Error('gh is not signed in');
    });
    await press(s, 'plan:pl1:open-pr');
    expect(words(see(s))).toContain('Couldn’t open the plan’s pull request');
    expect(words(see(s))).toContain('gh is not signed in');
    s.answers.set('plans.openPr', () => ({ id: 'pl1' }));
    await press(s, 'plan:pl1:retry');
    expect(words(see(s))).not.toContain('gh is not signed in');
    const pr = { number: 9, url: 'https://github.com/acme/api/pull/9', state: 'OPEN', title: 'Payments', draft: false, checks: 'passing' };
    s.set({ plans: plansOf([shipping({ pr })]) });
    expect(primaries(see(s))).toEqual(['Merge on GitHub']);
    await press(s, 'plan:pl1:merge');
    expect(s.calls).toContainEqual(['plans.mergePr', ['pl1', {}]]);
    s.set({ plans: plansOf([shipping({ pr: { ...pr, checks: 'pending' } })]) });
    expect(primaries(see(s))).toEqual(['Merge When Checks Pass']);
    await press(s, 'plan:pl1:merge-auto');
    expect(s.calls).toContainEqual(['plans.mergePr', ['pl1', { auto: true }]]);
    await press(s, 'plan:pl1:more');
    await press(s, 'more:pl1:merge-now');
    await press(s, 'more:pl1:bring-main');
    expect(s.calls).toContainEqual(['plans.bringInMain', ['pl1']]);
    await press(s, 'more:pl1:merge-local');
    await press(s, 'more:pl1:merge-local:yes');
    expect(s.calls).toContainEqual(['plans.mergeLocal', ['pl1']]);
    s.screens.nav.back('board');
    s.set({ plans: plansOf([shipping({ pr: { ...pr, conflicts: true } })]) });
    expect(primaries(see(s))).toEqual(['Resolve Conflicts']);
    await press(s, 'plan:pl1:resolve');
    const stuck = { at: 1, main: 'origin/main', conflict: { at: 1, dir: '/tmp/x', files: ['a.ts', 'b.ts'], stuck: true } };
    s.set({ plans: plansOf([shipping({ pr, mainMerge: stuck })]) });
    expect(words(see(s))).toContain('Conflict: needs you');
    expect(words(see(s))).toContain('a.ts, b.ts');
    expect(primaries(see(s))).toEqual(['Ask Claude Again']);
    await press(s, 'plan:pl1:ask-again');
    expect(s.calls).toContainEqual(['plans.retryConflicts', ['pl1']]);
    await press(s, 'plan:pl1:conflict-show');
    expect(s.calls).toContainEqual(['plans.showConflict', ['pl1']]);
    everyCallFits(s);
  });

  it('offers to tidy up, and says what the plan did', async () => {
    const activity = [{ id: 'e1', at: 2, by: { kind: 'teamod' }, kind: 'passed', text: 'passed “API”' }, { id: 'e2', at: 3, by: { kind: 'person', id: SELF, name: 'elad' }, kind: 'autonomy', text: 'switched to Autopilot' }];
    const s = boardSession({ board: boardOf([issue({ title: 'Task t1', status: 'in_review', branch: 'bob-1', worktrees: ['w1'], plan: { id: 'pl1', milestone: 'm1', task: 't1' } })]), plans: plansOf([active({ branch: 'plan/payments', runs: { m1: { passedAt: 5 } }, activity, body: { title: 'P', goal: 'g', milestones: [milestone('m1', [planTask('t1', { issueId: 'i1' })])] } })]) });
    go(s, 'plan', { id: 'pl1' });
    expect(words(see(s))).toContain('Tidy up 1 merged task worktree?');
    await press(s, 'plan:pl1:tidy-yes');
    expect(s.calls).toContainEqual(['plans.tidyUp', ['pl1', true]]);
    await press(s, 'plan:pl1:tidy-no');
    expect(s.calls).toContainEqual(['plans.tidyUp', ['pl1', false]]);
    await press(s, 'plan:pl1:feed');
    expect(words(see(s))).toContain('switched to Autopilot');
    expect(words(see(s))).toContain('You');
    everyCallFits(s);
  });

  it('applies or discards an agent’s changes to an approved plan', async () => {
    const changed = { title: 'Payments', goal: 'g', milestones: [milestone('m1', [planTask('t1', { issueId: 'i1', goal: 'A new goal' }), planTask('t2', { issueId: 'i2', blockedBy: ['t1'] }), planTask('t9')], { criteria: ['A card goes through'] })] };
    const s = boardSession({ board: tasks(), plans: plansOf([active({ draft: changed })]) });
    const tree = go(s, 'plan', { id: 'pl1' });
    expect(words(tree)).toContain('Your agent proposes changes');
    expect(words(tree)).toContain('1 new · 1 changed');
    expect(words(tree)).toContain('Changed');
    expect(primaries(tree)).toEqual(['Apply Changes']);
    await press(s, 'plan:pl1:apply');
    expect(s.calls).toContainEqual(['plans.approve', ['pl1']]);
    await press(s, 'plan:pl1:discard-changes');
    expect(s.calls).toContainEqual(['plans.discard', ['pl1']]);
  });
});

describe('Issues', () => {
  const issuesOf = (over: Record<string, unknown> = {}): unknown => ({ kind: 'github', repo, issues: [ghIssue()], more: false, fetchedAt: 1, ...over });

  it('says when a project has no GitHub repository, and when gh isn’t set up', async () => {
    const s = boardSession();
    s.answers.set('issues.list', () => ({ kind: 'none' }));
    go(s, 'issues');
    expect(words(see(s))).toContain('Asking GitHub');
    await s.settle();
    expect(words(see(s))).toContain('This project isn’t on GitHub');
    s.answers.set('issues.list', () => ({ kind: 'no_gh', repo }));
    await press(s, 'issues:state:closed');
    await s.settle();
    expect(words(see(s))).toContain('Connect GitHub');
    expect(words(see(s))).toContain('gh auth login');
  });

  it('says what GitHub answered, and asks again when told', async () => {
    const s = boardSession();
    s.answers.set('issues.list', () => {
      throw new Error('gh is broken');
    });
    go(s, 'issues');
    await s.settle();
    expect(words(see(s))).toContain('Couldn’t read the issues');
    expect(words(see(s))).toContain('gh is broken');
    s.answers.set('issues.list', () => issuesOf());
    await press(s, `issues:p1:open::retry`);
    see(s);
    await s.settle();
    const tree = see(s);
    expect(words(tree)).toContain('Login 500s');
    expect(words(tree)).toContain('1 comment');
    expect(words(tree)).toContain('acme/api');
    await press(s, 'issues:refresh');
    see(s);
    expect(words(see(s))).toContain('Login 500s');
    await s.settle();
    expect(s.calls).toContainEqual(['issues.list', ['p1', { state: 'open', force: true }]]);
    everyCallFits(s);
  });

  it('searches GitHub, and lists closed ones', async () => {
    const s = boardSession();
    s.answers.set('issues.list', () => issuesOf());
    go(s, 'issues');
    await s.settle();
    await press(s, 'issues:find');
    await press(s, 'issues:search', ' label:bug   login ');
    see(s);
    await s.settle();
    expect(s.calls).toContainEqual(['issues.list', ['p1', { state: 'open', search: 'label:bug login' }]]);
    await press(s, 'issues:state:closed');
    see(s);
    await s.settle();
    expect(s.calls).toContainEqual(['issues.list', ['p1', { state: 'closed', search: 'label:bug login' }]]);
    everyCallFits(s);
  });

  it('holds only a part of a long list', async () => {
    const s = boardSession();
    s.answers.set('issues.list', () => issuesOf({ issues: Array.from({ length: 200 }, (_, i) => ghIssue({ number: i + 1 })) }));
    go(s, 'issues');
    await s.settle();
    const rows = (): number => flat(see(s)).filter((n) => n.k === 'button' && /^issue:\d+$/.test(n.key)).length;
    expect(rows()).toBe(50);
    await press(s, 'issues:p1:open::more');
    await press(s, 'issues:p1:open::more');
    expect(rows()).toBeLessThanOrEqual(100);
  });

  it('opens one: what it says, drawn only, and its comments', async () => {
    const s = boardSession();
    s.answers.set('issues.get', () => ({ repo, issue: ghIssue() }));
    go(s, 'issue', { project: 'p1', number: '48' });
    expect(words(see(s))).toContain('Asking GitHub for issue #48');
    await s.settle();
    const tree = see(s);
    expect(words(tree)).toContain('Login 500s');
    expect(words(tree)).toContain('It fails.');
    const said = flat(tree).flatMap((n) => (n.k === 'md' ? [n.text] : [])).join('\n');
    expect(said).toContain('[the docs](https://example.com/docs)');
    expect(said).not.toContain('file:///etc/passwd');
    isTidy(tree, 'an issue');
  });

  it('says when it can’t read one', async () => {
    const s = boardSession();
    s.answers.set('issues.get', () => {
      throw new Error('This project isn’t on GitHub');
    });
    go(s, 'issue', { project: 'p1', number: '48' });
    await s.settle();
    expect(words(see(s))).toContain('Couldn’t read #48');
    expect(words(see(s))).toContain('This project isn’t on GitHub');
  });

  it('makes a task of one, with a note and a look at the code', async () => {
    const s = boardSession();
    s.answers.set('issues.get', () => ({ repo, issue: ghIssue() }));
    s.answers.set('issues.toTask', () => ({ task: 'i9', key: 'BOB-9' }));
    go(s, 'issue', { project: 'p1', number: '48' });
    await s.settle();
    see(s);
    await press(s, 'issue:p1:48:way:task');
    expect(primaries(see(s))).toEqual(['Make Task']);
    const made = await s.screens.press('board', 'issue:p1:48:go', undefined, viewport);
    expect(made).toMatchObject({ ok: true, toast: '#48 is on the board as BOB-9' });
    expect(s.calls).toContainEqual(['issues.toTask', ['p1', 48]]);
    await press(s, 'issue:p1:48:look');
    await press(s, 'issue:p1:48:note', 'Behind the proxy');
    expect(s.calls).toContainEqual(['issues.toTask', ['p1', 48, { look: true, note: 'Behind the proxy' }]]);
    everyCallFits(s);
  });

  it('investigates, then fixes, and shows how it’s going', async () => {
    const ws = { id: 'w1', projectId: 'p1', name: 'fix-login', kind: 'worktree', path: '/w1', createdAt: 1 };
    const task = (over: Record<string, unknown> = {}): Record<string, unknown> => issue({ status: 'in_progress', worktrees: ['w1'], github: { repo: 'acme/api', number: 48, url: 'u', step: 'investigate', investigated: true }, ...over });
    const s = boardSession({ board: boardOf([]), projects: [project('p1', 'alpha', [ws])] });
    s.answers.set('issues.get', () => ({ repo, issue: ghIssue() }));
    s.answers.set('issues.investigate', () => ({ task: 'i1', key: 'BOB-1', ws: 'w1' }));
    go(s, 'issue', { project: 'p1', number: '48' });
    await s.settle();
    await press(s, 'issue:p1:48:go');
    expect(s.calls).toContainEqual(['issues.investigate', ['p1', 48]]);
    s.set({ board: boardOf([task({ brief: { context: 'It fails because of **the proxy**' }, revisions: [{ id: 'r1', at: 1, by: { kind: 'claude', owner: SELF, ownerName: 'elad' }, section: 'context', before: '', after: 'x' }] })]), log: [{ id: 'r', type: 'agent', channel: 'ws:w1', status: 'started', steps: [], subagents: [], text: '', ts: 1 }] as unknown as AppState['log'] });
    expect(words(see(s))).toContain('The agent is investigating');
    expect(primaries(see(s))).toEqual(['Open the Conversation']);
    s.set({ log: [] });
    expect(words(see(s))).toContain('The agent investigated');
    expect(words(see(s))).toContain('the proxy');
    expect(primaries(see(s))).toEqual(['Fix It']);
    await press(s, 'issue:48:fix');
    expect(s.calls).toContainEqual(['issues.fix', ['p1', 48]]);
    await press(s, 'issue:48:more');
    await press(s, 'issue:p1#48:post');
    expect(words(see(s))).toContain('Post the findings on #48?');
    await press(s, 'issue:p1#48:post:yes');
    expect(s.calls).toContainEqual(['issues.comment', ['p1', 48, '**Findings**\n\nIt fails because of **the proxy**']]);
    s.screens.nav.back('board');
    s.set({ board: boardOf([task({ status: 'in_review', pr: { number: 3, url: 'https://github.com/acme/api/pull/3', state: 'OPEN', title: 'Fix', draft: false, checks: 'passing' } })]) });
    expect(words(see(s))).toContain('Its pull request is open');
    s.set({ board: boardOf([task({ status: 'done' })]) });
    expect(words(see(s))).toContain('Done in BOB-1');
    everyCallFits(s);
  });

  it('asks first when a teammate is on it', async () => {
    const team = { enabled: true, offers: [], teams: { p1: { projectId: 'p1', repo: 'acme/api', mates: [{ peerId: 'ata', name: 'Ata', since: 1 }] } }, working: { i1: [{ peerId: 'ata', name: 'Ata' }] }, waiting: {}, assigned: [], plans: [], planShares: {}, knocks: [], myKnocks: [] };
    const s = boardSession({ team, board: boardOf([issue({ github: { repo: 'acme/api', number: 48, url: 'u' } })]) } as Partial<AppState>);
    s.answers.set('issues.get', () => ({ repo, issue: ghIssue() }));
    go(s, 'issue', { project: 'p1', number: '48' });
    await s.settle();
    await press(s, 'issue:p1:48:way:fix');
    await press(s, 'issue:p1:48:note', 'Quick');
    expect(s.calls.some(([m]) => m === 'issues.fix')).toBe(false);
    expect(words(see(s))).toContain('Ata is working on #48');
    await press(s, 'issue:p1:48:anyway');
    expect(s.calls).toContainEqual(['issues.fix', ['p1', 48, { note: 'Quick', anyway: true }]]);
    everyCallFits(s);
  });

  it('comments, keeping your words if GitHub says no', async () => {
    const s = boardSession();
    s.answers.set('issues.get', () => ({ repo, issue: ghIssue() }));
    go(s, 'issue', { project: 'p1', number: '48' });
    await s.settle();
    see(s);
    s.answers.set('issues.comment', () => {
      throw new Error('GitHub said no');
    });
    const refused = await s.screens.press('board', 'issue:p1#48:comment', 'Thanks', viewport);
    expect(refused).toMatchObject({ ok: false, error: 'GitHub said no' });
    expect(flat(see(s)).find((n) => n.k === 'input' && n.key === 'issue:p1#48:comment')).toMatchObject({ value: 'Thanks' });
    s.answers.set('issues.comment', () => 'https://github.com/x');
    const posted = await s.screens.press('board', 'issue:p1#48:comment', 'Thanks', viewport);
    expect(posted).toMatchObject({ ok: true, toast: 'Posted on #48' });
    expect(s.calls).toContainEqual(['issues.comment', ['p1', 48, 'Thanks']]);
    see(s);
    await s.settle();
    expect(s.calls).toContainEqual(['issues.get', ['p1', 48, { force: true }]]);
    everyCallFits(s);
  });

  it('lists open pull requests: one on a worktree opens it, any other goes to GitHub', async () => {
    const ws = { id: 'w1', projectId: 'p1', name: 'fix-login', kind: 'worktree', path: '/w1', createdAt: 1, branch: 'fix-login' };
    const pull = (number: number, branch: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({ number, title: `Pull ${number}`, url: `https://github.com/acme/api/pull/${number}`, author: 'ata', branch, draft: false, checks: 'failing', review: 'REVIEW_REQUIRED', createdAt: 1, updatedAt: 2, ...over });
    const s = boardSession({ projects: [project('p1', 'alpha', [ws])] });
    s.answers.set('issues.pulls', () => ({ kind: 'github', repo, pulls: [pull(1, 'fix-login'), pull(2, 'other', { draft: true })], total: 5, fetchedAt: 1 }));
    go(s, 'pulls', { project: 'p1' });
    await s.settle();
    const tree = see(s);
    expect(words(tree)).toContain('Needs a review');
    expect(words(tree)).toContain('Draft');
    expect(words(tree)).toContain('5 open; the latest 2 are here');
    expect(flat(tree).some((n) => n.k === 'link' && n.href === 'https://github.com/acme/api/pull/2')).toBe(true);
    await press(s, 'pull:1');
    expect(s.screens.nav.routeOf('board')).toMatchObject({ screen: 'task', name: 'ws', params: { id: 'w1' } });
    everyCallFits(s);
  });
});

describe('Actions', () => {
  const runsOf = (runs: unknown[], over: Record<string, unknown> = {}): unknown => ({ kind: 'github', repo, runs, more: false, fetchedAt: 1, ...over });

  it('says when a project has no GitHub repository', async () => {
    const s = boardSession();
    s.answers.set('ci.runs', () => ({ kind: 'none' }));
    go(s, 'actions');
    await s.settle();
    expect(words(see(s))).toContain('This project isn’t on GitHub');
    expect(s.calls.some(([m]) => m === 'ci.workflows')).toBe(false);
  });

  it('lists runs, running ones first, and filters by workflow and branch', async () => {
    const s = boardSession();
    s.answers.set('ci.runs', () => runsOf([ghRun(), ghRun({ id: 8, title: 'Running now', status: 'in_progress', conclusion: undefined, createdAt: 0 })]));
    s.answers.set('ci.workflows', () => ({ repo, workflows: [{ id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active', url: 'https://github.com/x', file: 'on: push' }] }));
    go(s, 'actions');
    await s.settle();
    const said = words(see(s));
    expect(said.indexOf('Running now')).toBeLessThan(said.indexOf('Fix the login'));
    expect(said).toContain('watching, every few seconds');
    see(s);
    await s.settle();
    await press(s, 'actions:filter');
    await press(s, 'actions:flow:.github/workflows/ci.yml');
    see(s);
    await s.settle();
    expect(s.calls).toContainEqual(['ci.runs', ['p1', { workflow: '.github/workflows/ci.yml' }]]);
    await press(s, 'actions:branch', 'main');
    see(s);
    await s.settle();
    expect(s.calls).toContainEqual(['ci.runs', ['p1', { workflow: '.github/workflows/ci.yml', branch: 'main' }]]);
    await press(s, 'actions:refresh');
    see(s);
    await s.settle();
    expect(s.calls).toContainEqual(['ci.runs', ['p1', { workflow: '.github/workflows/ci.yml', branch: 'main', force: true }]]);
    everyCallFits(s);
  });

  it('re-runs what failed, and all of it from More', async () => {
    const s = boardSession();
    s.answers.set('ci.run', () => ({ repo, run: { ...ghRun(), jobs: [ghJob] } }));
    go(s, 'run', { project: 'p1', run: '7' });
    expect(words(see(s))).toContain('Asking GitHub');
    await s.settle();
    const tree = see(s);
    expect(words(tree)).toContain('1 job · 1 failed');
    expect(words(tree)).toContain('npm test');
    expect(primaries(tree)).toEqual(['Re-run Failed Jobs']);
    const pressed = await s.screens.press('board', 'run:7:rerun-failed', undefined, viewport);
    expect(pressed).toMatchObject({ ok: true, toast: 'Running the failed jobs again' });
    expect(s.calls).toContainEqual(['ci.rerun', ['p1', 7, { failed: true }]]);
    see(s);
    await s.settle();
    expect(s.calls).toContainEqual(['ci.run', ['p1', 7, { force: true }]]);
    await press(s, 'run:7:more');
    await press(s, 'run:7:rerun-all');
    expect(s.calls).toContainEqual(['ci.rerun', ['p1', 7]]);
    everyCallFits(s);
  });

  it('cancels a run that’s going, after asking', async () => {
    const s = boardSession();
    s.answers.set('ci.run', () => ({ repo, run: { ...ghRun({ status: 'in_progress', conclusion: undefined }), jobs: [] } }));
    go(s, 'run', { project: 'p1', run: '7' });
    await s.settle();
    expect(words(see(s))).toContain('Waiting for a runner');
    expect(labelled(see(s), 'Re-run Failed Jobs')).toBeUndefined();
    await press(s, 'run:7:cancel');
    expect(s.calls.some(([m]) => m === 'ci.cancel')).toBe(false);
    await press(s, 'run:7:cancel:yes');
    expect(s.calls).toContainEqual(['ci.cancel', ['p1', 7]]);
    everyCallFits(s);
  });

  it('opens where a failed job failed', async () => {
    const s = boardSession();
    s.answers.set('ci.run', () => ({ repo, run: { ...ghRun(), jobs: [ghJob] } }));
    s.answers.set('ci.log', () => 'Error: expected 200, got 500');
    go(s, 'run', { project: 'p1', run: '7' });
    await s.settle();
    await press(s, 'job:70:log');
    expect(s.screens.nav.routeOf('board').name).toBe('log');
    await s.settle();
    expect(flat(see(s)).some((n) => n.k === 'code' && n.source.includes('expected 200'))).toBe(true);
    expect(s.calls).toContainEqual(['ci.log', ['p1', 70]]);
    everyCallFits(s);
  });

  it('says while it reads a log, and when it can’t', async () => {
    const s = boardSession();
    s.answers.set('ci.log', () => {
      throw new Error('The log is gone');
    });
    expect(words(go(s, 'log', { project: 'p1', run: '7', job: '70' }))).toContain('Reading the log');
    await s.settle();
    expect(words(see(s))).toContain('Couldn’t read the log');
    expect(words(see(s))).toContain('The log is gone');
  });

  it('shows each workflow, its last run and its YAML', async () => {
    const s = boardSession();
    s.answers.set('ci.workflows', () => ({ repo, workflows: [{ id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active', url: 'https://github.com/x', file: 'on: push' }, { id: 2, name: 'Old', path: '.github/workflows/old.yml', state: 'disabled_manually', url: 'https://github.com/y' }] }));
    s.answers.set('ci.runs', () => runsOf([ghRun()]));
    go(s, 'workflows', { project: 'p1' });
    await s.settle();
    const tree = see(s);
    expect(words(tree)).toContain('Turned off');
    expect(words(tree)).toContain('Fix the login');
    expect(words(tree)).not.toContain('on: push');
    await press(s, 'workflow:.github/workflows/ci.yml:yaml');
    expect(flat(see(s)).find((n) => n.k === 'code')).toMatchObject({ source: 'on: push', language: 'yaml' });
    everyCallFits(s);
  });
});

describe('every page of the Board', () => {
  it('draws, with its keys its own and one main action at most', async () => {
    const ws = { id: 'w1', projectId: 'p1', name: 'bob-1', kind: 'worktree', path: '/w1', createdAt: 1, branch: 'bob-1' };
    const by = { kind: 'person', id: SELF, name: 'elad' };
    const rich = issue({ brief: { goal: 'A goal', acceptance: '- [ ] It works' }, labels: ['bug'], due: '2026-11-30', estimate: 3, activity: [{ id: 'a1', at: 1, by, kind: 'comment', text: 'commented', body: 'Hello' }, { id: 'a2', at: 1, by, kind: 'status', text: 'moved this' }], proof: [{ id: 'p1', kind: 'text', title: 'It ran', body: 'ok', at: 1, by }, { id: 'p2', kind: 'file', title: 'notes.txt', path: '/r/notes.txt', context: true, at: 1, by }], revisions: [{ id: 'r1', at: 1, by, section: 'goal', before: 'x', after: 'A goal' }], blockedBy: ['i2'], related: ['i2'], parent: 'i3', github: { repo: 'acme/api', number: 48, url: 'https://github.com/acme/api/issues/48' }, link: { provider: 'linear', id: 'l1', key: 'ENG-1', url: 'https://linear.app/x', local: {}, remote: {} } });
    const body = { title: 'P', goal: 'g', milestones: [milestone('m1', [planTask('t1', { issueId: 'i1', goal: 'Do it', context: 'Here', acceptance: ['Works'], touches: ['a.ts'] })], { goal: 'A goal', criteria: ['Works'] })] };
    const s = boardSession({
      projects: [project('p1', 'alpha', [ws]), project('p2', 'beta')],
      board: boardOf([rich, issue({ id: 'i2', key: 'BOB-2', title: 'Other' }), issue({ id: 'i3', key: 'BOB-3', title: 'An epic' })], { projects: { board_x: { prefix: 'LNCH', next: 1, name: 'Launch', repos: ['p1', 'p2'] } }, sync: { p1: { provider: 'linear', team: 'E', teamKey: 'E', auto: true, linked: 1 } } }),
      plans: plansOf([planOf({ status: 'active', draft: undefined, body, approvedAt: 1 })]),
    });
    s.answers.set('issues.list', () => ({ kind: 'github', repo, issues: [ghIssue()], more: true, fetchedAt: 1 }));
    s.answers.set('issues.get', () => ({ repo, issue: ghIssue() }));
    s.answers.set('issues.pulls', () => ({ kind: 'github', repo, pulls: [], total: 0, fetchedAt: 1 }));
    s.answers.set('ci.runs', () => ({ kind: 'github', repo, runs: [ghRun()], more: true, fetchedAt: 1 }));
    s.answers.set('ci.run', () => ({ repo, run: { ...ghRun(), jobs: [ghJob] } }));
    s.answers.set('ci.workflows', () => ({ repo, workflows: [] }));
    s.answers.set('ci.log', () => '');
    const routes: ReadonlyArray<readonly [string, Record<string, string>?]> = [
      ['tasks'],
      ['tasks-more'],
      ['boards'],
      ['board-new'],
      ['board-settings', { board: 'p1' }],
      ['board-settings', { board: 'board_x' }],
      ['about', { project: 'p1' }],
      ['labels', { project: 'p1' }],
      ['sync', { project: 'p1' }],
      ['sync', { project: 'p2' }],
      ['new-task', { board: 'p1' }],
      ['new-task-agent', { board: 'p1' }],
      ['task', { id: 'i1' }],
      ['task-more', { id: 'i1' }],
      ...['title', 'priority', 'assignee', 'labels', 'estimate', 'due', 'parent', 'repo', 'nothing'].map((field) => ['task-edit', { id: 'i1', field }] as const),
      ['task-brief', { id: 'i1', section: 'goal' }],
      ['task-history', { id: 'i1', section: 'goal' }],
      ['task-relate', { id: 'i1', rel: 'related' }],
      ['task-proof', { id: 'i1', as: 'proof' }],
      ['task-proof', { id: 'i1', as: 'file' }],
      ['task-agent', { id: 'i1' }],
      ['task-start-with', { id: 'i1' }],
      ['task', { id: 'gone' }],
      ['pick-project', { here: 'p1', place: 'plans' }],
      ['plans'],
      ['plan', { id: 'pl1' }],
      ['plan', { id: 'gone' }],
      ['plan-new', { project: 'p1' }],
      ['plan-new-agent', { project: 'p1' }],
      ['plan-here', { project: 'p1' }],
      ['plan-style'],
      ['plan-mode', { id: 'pl1' }],
      ['plan-more', { id: 'pl1' }],
      ['plan-feed', { id: 'pl1' }],
      ['plan-branch', { id: 'pl1' }],
      ['plan-agent', { id: 'pl1' }],
      ['plan-gate', { id: 'pl1', milestone: 'm1' }],
      ['plan-gate', { id: 'pl1', milestone: 'gone' }],
      ['plan-send-back', { id: 'pl1', milestone: 'm1' }],
      ['plan-task', { id: 'pl1', task: 't1' }],
      ['plan-task', { id: 'pl1', task: 'gone' }],
      ['plan-task-with', { id: 'pl1', task: 't1' }],
      ['issues'],
      ['issue', { project: 'p1', number: '48' }],
      ['issue-more', { project: 'p1', number: '48' }],
      ['pulls', { project: 'p1' }],
      ['actions'],
      ['workflows', { project: 'p1' }],
      ['run', { project: 'p1', run: '7' }],
      ['run-more', { project: 'p1', run: '7' }],
      ['log', { project: 'p1', run: '7', job: '70' }],
    ];
    for (const [name, params] of routes) {
      const where = `${name} ${JSON.stringify(params ?? {})}`;
      isTidy(go(s, name, params), where);
      await s.settle();
      isTidy(see(s), where);
    }
    for (const surface of ['desktop', 'mobile'] as const) {
      s.screens.nav.go('board', { name: 'tasks' });
      expect(words(s.screens.view('board', { ...viewport, surface }))).toContain('An epic');
    }
  });

  it('shows on the engine’s own routes', () => {
    const s = boardSession({ plans: plansOf([planOf()]) });
    expect(words(go(s, 'plan', { id: 'pl1' }))).toContain('Payments');
    expect(words(go(s, 'plans'))).toContain('Payments');
    expect(words(go(s, 'tasks'))).toContain('Add login');
  });
});
