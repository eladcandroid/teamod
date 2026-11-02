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
    await screens.press('work', 'add', undefined, viewport);
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
