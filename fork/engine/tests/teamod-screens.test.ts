import { describe, expect, it } from 'vitest';
import { initialState } from '../src/core/store.js';
import type { AppState } from '../src/core/store.js';
import { bandActive, statusLine, withAnswer } from '../src/teamod/panes/band.js';
import { SCREENS } from '../src/teamod/panes/index.js';
import { type ScreenHost, Screens } from '../src/teamod/screens.js';
import { flat, labelled, start, viewport, words } from './teamod-helpers.js';

const project = (id: string, name: string, workspaces: unknown[] = []): AppState['projects'][number] => ({ id, name, root: `/r/${name}`, base: 'main', workspaces }) as AppState['projects'][number];
const worktree = { id: 'w1', projectId: 'p1', projectRoot: '/r/alpha', name: 'add-login', path: '/r/w1', kind: 'worktree', createdAt: 1, external: false };

const approval = { id: 'a1', kind: 'tool', title: 'Run the tests', detail: 'npm test', channel: 'ws:w1', askedAt: 5 };

describe('the Work screen', () => {
  it('lists projects with work first, and says when there are none', () => {
    const { screens } = start();
    expect(words(screens.view('work', viewport))).toContain('No projects yet');

    const { screens: full } = start({ projects: [project('p2', 'quiet'), project('p1', 'alpha', [worktree])] });
    const tree = words(full.view('work', viewport));
    expect(tree.indexOf('alpha')).toBeLessThan(tree.indexOf('quiet'));
    expect(tree).toContain('add-login');
  });

  it('adds a project: a press opens the field, Enter calls the engine', async () => {
    const { screens, calls } = start();
    expect(await screens.press('work', 'add', undefined, viewport)).toEqual({ ok: true, focus: 'add-path' });
    expect(flat(screens.view('work', viewport)).some((n) => n.k === 'input' && n.key === 'add-path')).toBe(true);
    await screens.press('work', 'add-path', ' /r/new ', viewport);
    expect(calls).toEqual([['projects.add', ['/r/new']]]);
    expect(flat(screens.view('work', viewport)).some((n) => n.k === 'input')).toBe(false);
  });

  it('opens a worktree in this same pane, without asking for another', async () => {
    const { screens, calls } = start({ projects: [project('p1', 'alpha', [worktree])] });
    const pressed = await screens.press('work', 'ws:w1', undefined, viewport);
    expect(pressed).toEqual({ ok: true });
    expect(calls).toContainEqual(['workspaces.load', ['w1']]);
    expect(words(screens.view('work', viewport))).toContain('add-login');
    expect(labelled(screens.view('work', viewport), 'Work')).toBeDefined();
  });

  it('switches screens in the pane, and every screen can come back', async () => {
    const { screens } = start();
    await screens.press('work', 'screen:team', undefined, viewport);
    expect(words(screens.view('work', viewport))).toContain('Team');
    await screens.press('work', 'screen:work', undefined, viewport);
    expect(words(screens.view('work', viewport))).toContain('No projects yet');
  });
});

describe('the Task screen', () => {
  const chat = { id: 'm1', type: 'chat', channel: 'ws:w1', from: 'me', name: 'elad', text: 'Add login', ts: 1, byAgent: false };
  const run = { id: 'r1', type: 'agent', channel: 'ws:w1', subagents: [], requestId: 'q1', owner: 'me', ownerName: 'elad', requesterName: 'elad', status: 'tool', text: '', steps: ['Read file.ts'], ts: 2 };

  it('shows the conversation, and offers Stop only while it runs', async () => {
    const { screens, calls, set } = start({ projects: [project('p1', 'alpha', [worktree])], log: [chat, run] as unknown as AppState['log'] });
    await screens.press('work', 'ws:w1', undefined, viewport);
    const tree = screens.view('work', viewport);
    expect(words(tree)).toContain('Add login');
    expect(words(tree)).toContain('Read file.ts');
    expect(labelled(tree, 'Stop')).toBeDefined();
    await screens.press('work', 'stop', undefined, viewport);
    expect(calls).toContainEqual(['host.stopRun', ['ws:w1']]);

    set({ log: [chat, { ...run, status: 'done', text: 'All done' }] as unknown as AppState['log'] });
    const after = screens.view('work', viewport);
    expect(words(after)).toContain('All done');
    expect(labelled(after, 'Stop')).toBeUndefined();
  });

  it('holds only a page of a long conversation, with Earlier for the rest', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ ...chat, id: `m${i}`, text: `message ${i}` }));
    const { screens } = start({ projects: [project('p1', 'alpha', [worktree])], log: many as unknown as AppState['log'] });
    await screens.press('work', 'ws:w1', undefined, viewport);
    expect(words(screens.view('work', viewport))).not.toContain('message 5\n');
    await screens.press('work', 'earlier', undefined, viewport);
    expect(words(screens.view('work', viewport))).toContain('message 45');
  });

  it('heads the chat with a card: its name, its state and its branch', async () => {
    const ready = { ...worktree, branch: 'elad/add-login', status: { ahead: 1, changed: 0 } };
    const { screens } = start({ projects: [project('p1', 'alpha', [ready])], log: [chat] as unknown as AppState['log'] });
    await screens.press('work', 'ws:w1', undefined, viewport);
    const tree = screens.view('work', viewport);
    const head = flat(tree).find((n) => n.k === 'box' && n.border === 'round');
    expect(head && words(head)).toContain('add-login');
    expect(head && words(head)).toContain('Ready to merge · 1 commit');
    expect(head && words(head)).toContain('elad/add-login');
    expect(words(tree)).toContain('elad · ');
  });

  describe('every page of it', () => {
    const ready = { ...worktree, branch: 'elad/add-login', status: { ahead: 1, changed: 0 } };
    const session = {
      id: 's1',
      workspaceId: 'w1',
      status: 'working',
      agents: [
        { id: 'a1', description: 'Review the change', type: 'code-reviewer', background: false, status: 'running', startedAt: 1, lastAt: 2, step: 'Reading a.ts' },
        { id: 'a2', description: 'Lint it', type: 'general-purpose', background: false, status: 'failed', startedAt: 1, lastAt: 2 },
      ],
      tasks: [{ id: 't1', kind: 'command', description: 'Start the server', command: 'npm run dev', status: 'running', startedAt: 1 }],
    };
    const full = {
      selfId: 'me',
      projects: [project('p1', 'alpha', [ready])],
      log: [{ ...chat, from: 'me' }, { ...run, status: 'done', text: 'Done.', subagents: [{ kind: 'task', status: 'running' }] }],
      prs: { w1: { number: 7, url: 'u', state: 'OPEN', title: 'Add login', draft: true, checks: 'failing', review: 'APPROVED', conflicts: true, mergeState: 'behind' } },
      review: { workspaceId: 'w1', data: { base: 'main', commits: [], files: [{ path: 'a.ts', added: 2, removed: 1, state: 'modified' }] }, selected: 0, loading: false, diff: '+a' },
      conflicts: { w1: ['a.ts'] },
      terminals: { w1: 'zsh' },
      termExits: { w1: 1 },
      claudeCode: { sessions: [session] },
      btw: { 'ws:w1': { question: 'What is it?', state: 'done', text: 'A thing.' } },
      context: { 'ws:w1': { used: 10, window: 100 } },
      envAsks: { w1: [{ file: '.env', binary: false, added: ['KEY'], changed: [], removed: [] }] },
    } as unknown as Partial<AppState>;
    const pages: Array<[string, Record<string, string>]> = [
      ['ws', { id: 'w1' }],
      ['steps', { id: 'w1', channel: 'ws:w1', item: 'r1' }],
      ['steps', { id: 'w1', channel: 'ws:w1', item: 'r1', step: 's1' }],
      ['edit', { id: 'w1', line: 'm1' }],
      ['model', { id: 'w1' }],
      ['more', { id: 'w1' }],
      ['remove', { id: 'w1' }],
      ['agents', { id: 'w1' }],
      ['cc-agent', { id: 'w1', session: 's1', agent: 'a1' }],
      ['cc-step', { id: 'w1', session: 's1', agent: 'a1', seq: '1' }],
      ['cc-output', { id: 'w1', session: 's1', agent: 'a1', path: '/r/w1/a.ts' }],
      ['cc-task', { id: 'w1', session: 's1', task: 't1' }],
      ['changes', { id: 'w1' }],
      ['merge', { id: 'w1' }],
      ['merge-pr', { id: 'w1' }],
      ['pr', { id: 'w1' }],
      ['history', { id: 'w1' }],
      ['commit', { id: 'w1', hash: 'abc' }],
      ['files', { id: 'w1' }],
      ['file', { id: 'w1', path: 'a.ts' }],
      ['file', { id: 'w1', path: 'a.png' }],
      ['file', { id: 'w1', path: 'a.pdf' }],
      ['scratch', { id: 'w1' }],
      ['terminal', { id: 'w1' }],
      ['scripts', { id: 'w1' }],
    ];
    const answer = (t: ReturnType<typeof start>): void => {
      t.answers.set('agent.steps', () => ({ steps: [{ id: 's1', title: 'Read', label: 'Read a.ts', status: 'done' }, { id: 's2', title: 'Bash', label: 'Run the tests', status: 'error', parent: 'x' }] }));
      t.answers.set('agent.step', () => ({ id: 's1', title: 'Bash', input: { command: 'npm test' }, output: '1 failing', isError: true, truncated: true }));
      t.answers.set('claudeCode.steps', () => ({ steps: [{ seq: 1, kind: 'tool', text: 'Read a.ts', status: 'error', detail: true }] }));
      t.answers.set('claudeCode.outputs', () => ({ outputs: [{ path: '/r/w1/a.ts', how: 'wrote' }] }));
      t.answers.set('claudeCode.step', () => ({ id: 'x', title: 'Read', label: 'Read a.ts', output: 'a', isError: true }));
      t.answers.set('claudeCode.output', () => ({ kind: 'text', text: 'a', truncated: true }));
      t.answers.set('claudeCode.taskOutput', () => ({ text: 'ready', truncated: true }));
      t.answers.set('git.mergePreview', () => ({ from: 'elad/add-login', into: 'main', folder: '/r/alpha', folderOn: 'dev', folderChanges: ['x'], uncommitted: 2, commits: [], commitCount: 3, files: 2, insertions: 5, deletions: 1, newOnTarget: 0, conflicts: ['a.ts'] }));
      t.answers.set('workbench.prConversation', () => ({ more: true, reviews: [{ author: 'mia', state: 'CHANGES_REQUESTED', body: 'Fix it' }], comments: [{ author: 'mia', body: 'Hi' }], threads: [{ id: 'th', path: 'a.ts', line: 3, resolved: true, outdated: true, diffHunk: '+a', comments: [{ author: 'mia', body: 'Why?' }] }] }));
      t.answers.set('git.filters', () => ({ authors: [{ email: 'e@x', name: 'Elad' }] }));
      t.answers.set('git.log', () => ({ commits: [{ hash: 'abc', short: 'abc', subject: 'Add login' }] }));
      t.answers.set('git.commit', () => ({ commit: { subject: 'Add login', author: { name: 'Elad' }, date: 1, body: 'Why' }, files: [{ path: 'a.ts', added: 1, removed: 0, diff: '+a' }, { path: 'b.ts', added: 0, removed: 0 }] }));
      t.answers.set('files.read', () => ({ content: 'const a = 1;', truncated: true }));
      t.answers.set('files.readImageFile', () => ({ data: 'AAAA', mediaType: 'image/png' }));
      t.answers.set('workspaces.scratch', () => ({ files: [{ path: 'shot.png', size: 2048, mtime: 1 }] }));
    };
    const THEME = new Set(['success', 'error', 'warning', 'claude']);

    it.each(pages.map(([name, params]) => ({ name, params })))('$name $params is tidy: one main action, theme colors, no emoji', async ({ name, params }) => {
      const t = start(full);
      answer(t);
      await t.screens.press('work', 'ws:w1', undefined, viewport);
      t.screens.nav.go('work', { screen: 'task', name, params } as never);
      t.screens.view('work', viewport);
      await t.settle();
      const tree = t.screens.view('work', viewport);
      expect(words(tree)).not.toContain('This screen failed');
      const nodes = flat(tree);
      expect(nodes.some((n) => n.k === 'button' && n.key === 'place:chat')).toBe(true);
      expect(nodes.filter((n) => n.k === 'button' && n.primary).length).toBeLessThanOrEqual(1);
      const spans = nodes.flatMap((n) => (n.k === 'text' ? n.spans : n.k === 'button' ? (n.spans ?? []) : []));
      for (const s of spans) if (s.color) expect(THEME.has(s.color), s.color).toBe(true);
      expect(spans.map((s) => s.t).join(' ')).not.toMatch(/\p{Extended_Pictographic}/u);
    });
  });
});

describe('the band', () => {
  it('is empty with nothing waiting', () => {
    const { screens } = start();
    expect(screens.view('band', viewport)).toEqual({ k: 'box', children: [] });
    expect(bandActive(initialState('room') as unknown as AppState)).toBe(false);
  });

  it('answers an approval with exactly the call the item names', async () => {
    const { screens, calls } = start({ approvals: [approval] as unknown as AppState['approvals'] });
    const tree = screens.view('band', viewport);
    expect(words(tree)).toContain('Run the tests');
    expect(labelled(tree, 'Approve')).toBeDefined();
    await screens.press('band', 'need:approval:a1:act:0', undefined, viewport);
    expect(calls).toEqual([['host.answerApproval', ['yes', 'a1']]]);
  });

  it('walks several, one at a time', async () => {
    const second = { ...approval, id: 'a2', title: 'Push the branch', askedAt: 6 };
    const { screens } = start({ approvals: [approval, second] as unknown as AppState['approvals'] });
    expect(words(screens.view('band', viewport))).toContain('1 of 2');
    await screens.press('band', 'need:next', undefined, viewport);
    const tree = words(screens.view('band', viewport));
    expect(tree).toContain('Push the branch');
    expect(tree).toContain('2 of 2');
  });

  it('never needs a digit: a bare digit in the prompt would answer it by accident', () => {
    const { screens } = start({ approvals: [approval] as unknown as AppState['approvals'] });
    const hotkeys = flat(screens.view('band', viewport)).flatMap((n) => (n.k === 'button' && n.hotkey ? [n.hotkey] : []));
    expect(hotkeys.length).toBeGreaterThan(0);
    expect(hotkeys.filter((key) => /\d/.test(key))).toEqual([]);
  });

  it('puts an answer where an item says, leaving the item alone', () => {
    const args = ['q1', { answers: {} }];
    expect(withAnswer(args, [1, 'answers', 'Which store?'], 'Postgres')).toEqual(['q1', { answers: { 'Which store?': 'Postgres' } }]);
    expect(args).toEqual(['q1', { answers: {} }]);
  });
});

describe('the status line', () => {
  it('says what works and what waits, and nothing when neither', () => {
    expect(statusLine(initialState('room') as unknown as AppState)).toBeUndefined();
    const state = { ...initialState('room'), approvals: [approval], log: [{ id: 'r', type: 'agent', channel: 'ws:w1', status: 'tool', subagents: [], steps: [], text: '' }] };
    expect(statusLine(state as unknown as AppState)).toBe('1 working · 1 needs you');
  });
});

describe('a screen that fails', () => {
  it('says so in the pane instead of taking the session down', () => {
    const host: ScreenHost = { getState: () => initialState('room') as unknown as AppState, call: async () => undefined, markDirty: () => undefined, look: () => undefined };
    const screens = new Screens(host, { ...SCREENS, work: () => { throw new Error('boom'); } });
    expect(words(screens.view('work', viewport))).toContain('boom');
  });
});

describe('every key on a screen', () => {
  it('is a letter or digit the surfaces take', () => {
    const { screens } = start({ projects: [project('p1', 'alpha', [worktree])], approvals: [approval] as unknown as AppState['approvals'] });
    for (const site of ['work', 'task', 'team', 'board', 'sentinel', 'settings', 'band'] as const) {
      const hotkeys = flat(screens.view(site, viewport)).flatMap((n) => (n.k === 'button' && n.hotkey ? [n.hotkey] : []));
      expect(hotkeys.filter((key) => !/^[a-z0-9]$/.test(key))).toEqual([]);
      expect(new Set(hotkeys).size).toBe(hotkeys.length);
    }
  });
});
