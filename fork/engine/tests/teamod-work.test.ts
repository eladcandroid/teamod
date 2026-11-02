import { afterEach, describe, expect, it } from 'vitest';
import type { AppState } from '../src/core/store.js';
import type { Node } from '../src/teamod/tree.js';
import { type Method, parseArgs } from '../src/ipc/api.js';
import { flat, labelled, start as startScreens, viewport, words } from './teamod-helpers.js';

const project = (id: string, name: string, workspaces: unknown[] = [], extra: Record<string, unknown> = {}): AppState['projects'][number] => ({ id, name, root: `/r/${name}`, base: 'origin/main', workspaces, ...extra }) as AppState['projects'][number];
const worktree = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, projectId: 'p1', projectRoot: '/r/alpha', name: id, path: `/r/${id}`, kind: 'worktree', createdAt: 1, external: false, branch: `teamod/${id}`, ...extra });
const sync = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ branch: 'main', upstream: 'origin/main', remote: 'origin', local: true, ahead: 0, behind: 2, onDefault: true, dirty: 0, ...extra });

/** Every call a test made, checked the way the daemon checks it: what crosses the socket, against the API's own arguments. */
const started: Array<ReturnType<typeof startScreens>> = [];
const start = (state?: Partial<AppState>): ReturnType<typeof startScreens> => {
  const s = startScreens(state);
  started.push(s);
  return s;
};
afterEach(() => {
  for (const s of started.splice(0)) {
    for (const [method, args] of s.calls) {
      const sent = (JSON.parse(JSON.stringify(args)) as unknown[]).map((v) => (v === null ? undefined : v));
      expect(() => parseArgs(method as Method, sent), `${method} ${JSON.stringify(args)}`).not.toThrow();
    }
  }
});

const hotkeys = (tree: Node): string[] => flat(tree).flatMap((n) => (n.k === 'button' && n.hotkey ? [n.hotkey] : []));
const inputs = (tree: Node): string[] => flat(tree).flatMap((n) => (n.k === 'input' ? [n.key] : []));
const buttons = (tree: Node): string[] => flat(tree).flatMap((n) => (n.k === 'button' ? [n.key] : []));
const said = (calls: Array<[string, readonly unknown[]]>, method: string): Array<readonly unknown[]> => calls.filter(([m]) => m === method).map(([, args]) => args);

const go = (s: ReturnType<typeof start>, name: string, params?: Record<string, string>): void => s.screens.nav.go('work', { name, ...(params ? { params } : {}) });
const press = (s: ReturnType<typeof start>, key: string, value?: string): ReturnType<ReturnType<typeof start>['screens']['press']> => s.screens.press('work', key, value, viewport);
const view = (s: ReturnType<typeof start>): Node => s.screens.view('work', viewport);

describe('the routes the engine navigates to', () => {
  it('each draws, never falling back to the project list', () => {
    const s = start({ projects: [project('p1', 'alpha', [worktree('w1')])] });
    s.screens.follow({ kind: 'project', id: 'p1' });
    expect(words(view(s))).toContain('alpha');
    expect(labelled(view(s), 'New Worktree')).toBeDefined();
    s.screens.follow({ kind: 'overview' });
    expect(words(view(s))).toContain('Ready to Merge');
    s.screens.follow({ kind: 'search' });
    expect(words(view(s))).toContain('Find anything anyone said');
    s.screens.follow({ kind: 'usage' });
    expect(words(view(s))).toContain('Plan limits');
    s.screens.follow({ kind: 'claude_code' });
    expect(words(view(s))).toContain('No sessions right now');
    s.screens.follow({ kind: 'assistant' });
    expect(words(view(s))).toContain('isn’t tied to any project');
  });
});

describe('every page of the Work screen', () => {
  const full = project('p1', 'alpha', [worktree('w1', { status: { changed: 1, ahead: 2 } }), worktree('old', { archived: true, archive: { freedBytes: 1, keptBytes: 1, remake: [], at: 2 } }), worktree('other', { external: true, path: '/r/.claude/worktrees/other', status: { changed: 0, ahead: 0 } }), worktree('mine', { external: true, path: '/x/mine' })], { sync: sync(), scripts: { setup: { command: 'npm i', source: 'yours' } } });
  const pages: ReadonlyArray<readonly [string, Record<string, string>?]> = [
    ['projects'],
    ['project', { id: 'p1' }],
    ['project-more', { id: 'p1' }],
    ['project-agent', { id: 'p1' }],
    ['project-group', { id: 'p1' }],
    ['add'],
    ['browse', { dir: '/r' }],
    ['new'],
    ['hidden'],
    ['arrange'],
    ['worktrees'],
    ['worktree', { id: 'w1' }],
    ['worktree', { id: 'old' }],
    ['worktree', { id: 'mine' }],
    ['clean'],
    ['clean', { project: 'p1' }],
    ['import', { project: 'p1' }],
    ['confirm', { act: 'archive', ids: 'w1' }],
    ['confirm', { act: 'free', ids: 'w1' }],
    ['confirm', { act: 'delete', ids: 'w1' }],
    ['confirm', { act: 'delete', ids: 'old' }],
    ['confirm', { act: 'remove-other', id: 'mine' }],
    ['confirm', { act: 'clean-agents', project: 'p1' }],
    ['confirm', { act: 'clean-others', project: 'p1', ids: 'mine' }],
    ['confirm', { act: 'remove-project', project: 'p1' }],
    ['confirm', { act: 'delete-chat', chat: 'main' }],
    ['overview'],
    ['search'],
    ['usage'],
    ['activity'],
    ['inbox'],
    ['templates'],
    ['assistant'],
  ];

  it.each(pages.map(([name, params]) => ({ name, params })))('$name $params draws, keeps each hotkey to one key, and leaves the top row its own', async ({ name, params }) => {
    const s = start({ projects: [full], hiddenProjects: ['/r/gone'], projectGroups: [{ name: 'Group', projects: [] }] });
    go(s, name, params);
    view(s);
    await s.settle();
    const tree = view(s);
    expect(words(tree)).not.toContain('This screen failed');
    const keys = hotkeys(tree);
    expect(new Set(keys).size).toBe(keys.length);
    const reserved = keys.filter((k) => 'wktolgb'.includes(k));
    expect(new Set(reserved)).toEqual(new Set(buttons(tree).includes('back') ? ['w', 'k', 't', 'o', 'l', 'g', 'b'] : ['w', 'k', 't', 'o', 'l', 'g']));
    expect(reserved.length).toBe(buttons(tree).includes('back') ? 7 : 6);
  });

  it('holds at most one main action on a page', async () => {
    for (const [name, params] of pages) {
      const s = start({ projects: [full] });
      go(s, name, params);
      view(s);
      await s.settle();
      const primary = flat(view(s)).filter((n) => n.k === 'button' && n.primary).map((n) => (n.k === 'button' ? n.key : ''));
      expect({ name, primary: primary.length > 1 ? primary : [] }).toEqual({ name, primary: [] });
    }
  });
});

describe('the project list', () => {
  const many = Array.from({ length: 100 }, (_, i) => project(`p${i}`, `quiet-${String(i).padStart(3, '0')}`));

  it('holds a window of a hundred projects, with More for the rest', async () => {
    const s = start({ projects: many });
    const first = view(s);
    expect(flat(first).filter((n) => n.k === 'button' && n.key.startsWith('project:')).length).toBeLessThanOrEqual(50);
    expect(words(first)).toContain('quiet-000');
    expect(words(first)).not.toContain('quiet-099');
    await press(s, 'projects:more');
    const next = view(s);
    expect(flat(next).filter((n) => n.k === 'button' && n.key.startsWith('project:')).length).toBeLessThanOrEqual(50);
    expect(words(next)).toContain('quiet-090');
    expect(words(next)).not.toContain('quiet-000');
    await press(s, 'projects:earlier');
    expect(words(view(s))).toContain('quiet-000');
  });

  it('counts a project’s worktrees in the same window', () => {
    const busy = project('p1', 'alpha', Array.from({ length: 300 }, (_, i) => worktree(`w${i}`)));
    const s = start({ projects: [busy] });
    expect(flat(view(s)).filter((n) => n.k === 'button' && n.key.startsWith('ws:')).length).toBeLessThanOrEqual(50);
  });

  it('finds one among many, by project or worktree', async () => {
    const s = start({ projects: [...many, project('px', 'needle', [worktree('w1', { name: 'thread' })])] });
    await press(s, 'projects:find');
    await press(s, 'projects:box', 'quiet-042');
    expect(words(view(s))).toContain('quiet-042');
    expect(words(view(s))).not.toContain('quiet-041');
    await press(s, 'projects:clear');
    await press(s, 'projects:find');
    await press(s, 'projects:box', 'thread');
    expect(words(view(s))).toContain('needle');
    expect(words(view(s))).not.toContain('quiet-000');
  });

  it('folds a group, and keeps your arrangement among the quiet ones', async () => {
    const s = start({ projects: [project('a', 'alpha'), project('b', 'beta'), project('c', 'gamma')], projectGroups: [{ name: 'Tools', projects: ['/r/gamma'] }], projectOrder: ['group:Tools', '/r/beta', '/r/alpha'] });
    const tree = words(view(s));
    expect(tree.indexOf('Tools')).toBeLessThan(tree.indexOf('gamma'));
    expect(tree.indexOf('beta')).toBeLessThan(tree.indexOf('alpha'));
    await press(s, 'group:Tools');
    expect(words(view(s))).not.toContain('gamma');
    await press(s, 'group:Tools');
    expect(words(view(s))).toContain('gamma');
  });

  it('starts a chat of your own: with words, or empty', async () => {
    const s = start({ projects: [{ ...project('chats', 'Chats'), root: '' }] });
    await press(s, 'chat:start');
    await press(s, 'chat:box', 'What is this?');
    await press(s, 'chat:start');
    await press(s, 'chat:box', '');
    expect(said(s.calls, 'workspaces.startChat')).toEqual([['chats', 'What is this?']]);
    expect(said(s.calls, 'workspaces.newChat')).toEqual([['chats', 'New chat']]);
  });
});

describe('adding projects', () => {
  it('says what’s wrong with a path before adding it, and adds a folder of projects its own way', async () => {
    const s = start();
    s.answers.set('local.statFiles', ([paths]) => (paths as string[]).map((path) => ({ path, kind: path === '/r/app' || path === '/r/many' ? 'folder' : path === '/r/file' ? 'file' : 'missing' })));
    go(s, 'add');
    view(s);
    await press(s, 'add:path', '/r/file');
    expect(words(view(s))).toContain('is a file');
    await press(s, 'add:path', '/r/nothing');
    expect(words(view(s))).toContain('no folder at');
    expect(said(s.calls, 'projects.add')).toEqual([]);
    await press(s, 'add:path', '/r/app');
    expect(said(s.calls, 'projects.add')).toEqual([['/r/app']]);
    await press(s, 'as:folder');
    await press(s, 'add:path', '/r/many');
    expect(said(s.calls, 'projects.addFolder')).toEqual([['/r/many']]);
  });

  it('offers what it found on this computer, and what you hid', async () => {
    const s = start({ hiddenProjects: ['/r/hid'] });
    s.answers.set('projects.suggest', () => [{ path: '/r/found', name: 'found', changed: 1 }]);
    go(s, 'add');
    view(s);
    await s.settle();
    const tree = view(s);
    expect(words(tree)).toContain('found');
    expect(words(tree)).toContain('hidden');
    await press(s, 'found:/r/found');
    expect(said(s.calls, 'workspaces.addProject')).toEqual([['/r/found']]);
    await press(s, 'show:/r/hid');
    expect(said(s.calls, 'workspaces.showProject')).toEqual([['/r/hid']]);
  });

  it('looks through the folders on this computer', async () => {
    const s = start({ home: '/Users/me' });
    s.answers.set('local.listDirs', ([dir]) => (dir === '/Users/me' ? [{ name: 'code', dir: true, size: 0 }] : [{ name: 'app', dir: true, size: 1 }]));
    go(s, 'browse', { dir: '/Users/me' });
    view(s);
    await s.settle();
    await press(s, 'dir:code');
    view(s);
    await s.settle();
    expect(words(view(s))).toContain('a git project');
    await press(s, 'browse:watch');
    expect(said(s.calls, 'workspaces.addFolder')).toEqual([['/Users/me/code']]);
    expect(words(view(s))).toContain('No projects yet');
  });

  it('creates a new one and goes there; a failure says so and stays', async () => {
    const s = start({ projects: [project('n1', 'fresh')] });
    s.answers.set('projects.newHome', () => '/Users/me/code');
    s.answers.set('projects.create', ([name]) => {
      if (name === 'bad') throw new Error('It exists');
      return { id: 'n1', path: '/r/fresh' };
    });
    go(s, 'new');
    view(s);
    await s.settle();
    expect(words(view(s))).toContain('/Users/me/code');
    await press(s, 'new:name', 'bad');
    expect(words(view(s))).toContain('It exists');
    await press(s, 'new:name', 'fresh');
    expect(said(s.calls, 'projects.create')).toContainEqual(['fresh']);
    expect(labelled(view(s), 'New Worktree')).toBeDefined();
  });
});

describe('groups', () => {
  const projects = [project('a', 'alpha'), project('b', 'beta'), project('c', 'gamma')];

  it('moves a project with Move buttons, as dragging does', async () => {
    const s = start({ projects });
    go(s, 'arrange');
    view(s);
    await press(s, 'arrange:p:b:up');
    expect(said(s.calls, 'workspaces.arrange')).toEqual([[{ project: 'b' }, { into: null, before: { project: 'a' } }]]);
    await press(s, 'arrange:p:b:down');
    expect(said(s.calls, 'workspaces.arrange').at(-1)).toEqual([{ project: 'b' }, { into: null, before: null }]);
    await press(s, 'arrange:p:a:down');
    expect(said(s.calls, 'workspaces.arrange').at(-1)).toEqual([{ project: 'a' }, { into: null, before: { project: 'c' } }]);
    expect(buttons(view(s))).not.toContain('arrange:p:a:up');
    expect(buttons(view(s))).not.toContain('arrange:p:c:down');
  });

  it('moves a group among the rest, and a project within its group', async () => {
    const s = start({ projects, projectGroups: [{ name: 'G', projects: ['/r/beta', '/r/gamma'] }], projectOrder: ['/r/alpha', 'group:G'] });
    go(s, 'arrange');
    await press(s, 'arrange:g:G:up');
    expect(said(s.calls, 'workspaces.arrange').at(-1)).toEqual([{ group: 'G' }, { into: null, before: { project: 'a' } }]);
    await press(s, 'arrange:p:b:down');
    expect(said(s.calls, 'workspaces.arrange').at(-1)).toEqual([{ project: 'b' }, { into: 'G', before: null }]);
  });

  it('makes, renames and ungroups, asking first for the last', async () => {
    const s = start({ projects, projectGroups: [{ name: 'G', projects: ['/r/beta'] }] });
    go(s, 'arrange');
    await press(s, 'arrange:add');
    await press(s, 'arrange:new', 'Fresh');
    expect(said(s.calls, 'workspaces.newGroup')).toEqual([['Fresh']]);
    await press(s, 'arrange:g:G:rename');
    await press(s, 'arrange:g:G:name', 'H');
    expect(said(s.calls, 'workspaces.renameGroup')).toEqual([['G', 'H']]);
    await press(s, 'arrange:g:G:ungroup');
    expect(said(s.calls, 'workspaces.ungroup')).toEqual([]);
    expect(words(view(s))).toContain('Press Again to Ungroup');
    await press(s, 'arrange:g:G:ungroup');
    expect(said(s.calls, 'workspaces.ungroup')).toEqual([['G']]);
  });

  it('moves a project into a group, a new one, or out', async () => {
    const s = start({ projects, projectGroups: [{ name: 'G', projects: ['/r/beta'] }, { name: 'H', projects: [] }] });
    go(s, 'project-group', { id: 'b' });
    await press(s, 'to:H');
    expect(said(s.calls, 'workspaces.setGroup')).toEqual([['b', 'H']]);
    go(s, 'project-group', { id: 'b' });
    await press(s, 'group:out');
    expect(said(s.calls, 'workspaces.setGroup').at(-1)).toEqual(['b']);
    go(s, 'project-group', { id: 'a' });
    await press(s, 'group:add');
    await press(s, 'group:new', 'New');
    expect(said(s.calls, 'workspaces.newGroup')).toEqual([['New', { project: 'a' }]]);
  });

  it('hides, shows again, and deletes after asking', async () => {
    const s = start({ projects, hiddenProjects: ['/r/hid'] });
    go(s, 'project-more', { id: 'a' });
    await press(s, 'more:hide');
    expect(said(s.calls, 'workspaces.hideProject')).toEqual([['a']]);
    await press(s, 'hidden');
    await press(s, 'show:/r/hid');
    expect(said(s.calls, 'workspaces.showProject')).toEqual([['/r/hid']]);
    go(s, 'project-more', { id: 'b' });
    await press(s, 'more:delete');
    expect(said(s.calls, 'workspaces.removeProject')).toEqual([]);
    expect(words(view(s))).toContain('isn’t touched');
    await press(s, 'confirm');
    expect(said(s.calls, 'workspaces.removeProject')).toEqual([['b']]);
    expect(words(view(s))).toContain('Add Project');
  });
});

describe('a project’s home', () => {
  const home = (extra: Record<string, unknown> = {}, workspaces: unknown[] = []): ReturnType<typeof start> => {
    const s = start({ projects: [project('p1', 'alpha', workspaces, extra)] });
    s.answers.set('workspaces.branches', () => ({ base: 'origin/main', branches: ['origin/main', 'origin/dev', 'old-feature'] }));
    go(s, 'project', { id: 'p1' });
    view(s);
    return s;
  };

  it('starts a worktree from a base branch with a name, and opens it', async () => {
    const s = home();
    await s.settle();
    const select = flat(view(s)).find((n) => n.k === 'select' && n.key === 'home:p1:base');
    expect(select && select.k === 'select' ? select.options.map((o) => o.value) : []).toEqual(['origin/main', 'origin/dev', 'old-feature']);
    await press(s, 'home:p1:base', 'origin/dev');
    await press(s, 'home:name');
    await press(s, 'home:p1:name-box', 'my-task');
    s.answers.set('workspaces.startWorktree', () => 'new-ws');
    await press(s, 'home:p1:box', ' Add a health check ');
    expect(said(s.calls, 'workspaces.startWorktree')).toEqual([['p1', 'Add a health check', { base: 'origin/dev', name: 'my-task' }]]);
    expect(s.calls).toContainEqual(['workspaces.load', ['new-ws']]);
  });

  it('sends only what you changed: the default branch stays unsaid', async () => {
    const s = home();
    await s.settle();
    await press(s, 'home:p1:base', 'origin/dev');
    await press(s, 'home:p1:base', 'origin/main');
    await press(s, 'home:p1:box', 'A task');
    expect(said(s.calls, 'workspaces.startWorktree')).toEqual([['p1', 'A task', {}]]);
  });

  it('doesn’t push a second route when the engine has already gone there', async () => {
    const s = home();
    s.answers.set('workspaces.startWorktree', () => {
      s.screens.follow({ kind: 'workspace', id: 'made', tab: 'chat' });
      return 'made';
    });
    await press(s, 'home:p1:box', 'A task');
    expect(s.screens.nav.routeOf('work').params?.id).toBe('made');
    s.screens.nav.back('work');
    expect(s.screens.nav.routeOf('work').name).toBe('project');
  });

  it('makes an empty worktree from a name alone, and does nothing with neither', async () => {
    const s = home();
    await press(s, 'home:p1:box', '  ');
    expect(said(s.calls, 'workspaces.startWorktree')).toEqual([]);
    expect(said(s.calls, 'workspaces.newWorktree')).toEqual([]);
    await press(s, 'home:name');
    await press(s, 'home:p1:name-box', 'empty-one');
    await press(s, 'home:p1:box', '');
    expect(said(s.calls, 'workspaces.newWorktree')).toEqual([['p1', 'empty-one', {}]]);
  });

  it('asks in a chat that only answers', async () => {
    const s = home();
    await press(s, 'kind:chat');
    expect(flat(view(s)).some((n) => n.k === 'select')).toBe(false);
    await press(s, 'home:p1:box', 'Where is the login?');
    expect(said(s.calls, 'workspaces.startChat')).toEqual([['p1', 'Where is the login?']]);
  });

  it('starts from a template: it fills the box, and one that plans says so', async () => {
    const s = start({ projects: [project('p1', 'alpha')], templates: [{ id: 't1', name: 'Build a feature', prompt: 'Build this: ', plan: true, builtIn: true }] });
    go(s, 'project', { id: 'p1' });
    await press(s, 'home:template');
    await press(s, 'template:t1');
    const box = flat(view(s)).find((n) => n.k === 'input' && n.key === 'home:p1:box');
    expect(box && box.k === 'input' ? box.value : undefined).toBe('Build this: ');
    expect(words(view(s))).toContain('plans first');
    await press(s, 'home:p1:box', 'Build this: payments');
    expect(said(s.calls, 'workspaces.startWorktree')).toEqual([['p1', 'Build this: payments', { plan: true }]]);
  });

  it('starts the next worktree with another agent, once', async () => {
    const s = start({ projects: [project('p1', 'alpha')], runtimes: [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true, models: [] }] });
    go(s, 'project-agent', { id: 'p1' });
    await press(s, 'agent:next', 'codex:');
    s.screens.nav.back('work');
    go(s, 'project', { id: 'p1' });
    expect(words(view(s))).toContain('Starts with Codex');
    await press(s, 'home:p1:box', 'A task');
    expect(said(s.calls, 'workspaces.startWorktree')).toEqual([['p1', 'A task', { agent: { runtime: 'codex', label: 'Codex' } }]]);
    expect(words(view(s))).not.toContain('Starts with Codex');
  });

  it('keeps a project’s own agent in Settings', async () => {
    const s = start({ projects: [project('p1', 'alpha')], runtimes: [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true, models: [] }] });
    go(s, 'project-agent', { id: 'p1' });
    await press(s, 'agent:project', 'codex:');
    expect(said(s.calls, 'session.setPrefs')).toEqual([[{ projectAgents: { alpha: { runtime: 'codex', label: 'Codex' } } }]]);
  });

  it('says how main stands, fetches when it’s stale, and fetches on request', async () => {
    const s = home({ sync: sync() });
    expect(said(s.calls, 'git.fetchIfStale')).toEqual([['p1']]);
    const tree = view(s);
    expect(words(tree)).toContain('2 behind origin/main');
    expect(labelled(tree, 'Update main')).toBeDefined();
    await press(s, 'sync:fetch');
    expect(said(s.calls, 'git.fetch')).toEqual([['p1']]);
  });

  it('offers no Update when main is up to date, and says so', () => {
    const s = home({ sync: sync({ behind: 0 }) });
    expect(words(view(s))).toContain('Up to date with origin/main');
    expect(labelled(view(s), 'Update main')).toBeUndefined();
  });

  it('updates main, and what’s in the way asks: stash, or move to a worktree', async () => {
    const s = home({ sync: sync() });
    s.answers.set('git.updateMain', () => ({ kind: 'dirty', branch: 'main', upstream: 'origin/main', behind: 2, files: ['src/a.ts'] }));
    await press(s, 'sync:update');
    expect(said(s.calls, 'git.updateMain')).toEqual([['p1']]);
    const asking = view(s);
    expect(words(asking)).toContain('in the way');
    expect(words(asking)).toContain('src/a.ts');
    s.answers.set('git.stashAndUpdate', () => ({ kind: 'updated', branch: 'main', upstream: 'origin/main', commits: 2, restored: true }));
    await press(s, 'sync:stash');
    expect(said(s.calls, 'git.stashAndUpdate')).toEqual([['p1']]);
    expect(words(view(s))).not.toContain('in the way');

    await press(s, 'sync:update');
    s.answers.set('git.moveAndUpdate', () => ({ wsId: 'w9', outcome: { kind: 'updated', branch: 'main', upstream: 'origin/main', commits: 2 } }));
    await press(s, 'sync:move');
    expect(said(s.calls, 'git.moveAndUpdate')).toEqual([['p1']]);
  });

  it('hands what it can’t fast-forward to the agent, with git’s own words', async () => {
    const s = home({ sync: sync({ ahead: 1 }) });
    s.answers.set('git.updateMain', () => ({ kind: 'diverged', branch: 'main', upstream: 'origin/main', ahead: 1, behind: 2 }));
    await press(s, 'sync:update');
    expect(words(view(s))).toContain('have both moved on');
    await press(s, 'sync:agent');
    const [[id, situation]] = said(s.calls, 'git.askClaude') as [[string, string]];
    expect(id).toBe('p1');
    expect(situation).toContain('have both moved on');
  });

  it('says when putting your changes back conflicted, and that they’re safe', async () => {
    const s = home({ sync: sync() });
    s.answers.set('git.updateMain', () => ({ kind: 'dirty', branch: 'main', upstream: 'origin/main', behind: 2, files: [] }));
    await press(s, 'sync:update');
    s.answers.set('git.stashAndUpdate', () => ({ kind: 'updated', branch: 'main', upstream: 'origin/main', commits: 2, restored: false, conflicts: ['a.ts'], stash: { sha: 'abc', message: 'teamod: x' } }));
    await press(s, 'sync:stash');
    expect(words(view(s))).toContain('safe in the stash');
    expect(words(view(s))).toContain('a.ts');
  });

  it('puts the main folder back on its branch: at once when clean, asking when not', async () => {
    const clean = home({ sync: sync({ onDefault: false, current: 'feature', behind: 0 }) });
    expect(words(view(clean))).toContain('The main folder is on feature');
    clean.answers.set('git.switchToDefault', () => ({ kind: 'switched' }));
    await press(clean, 'sync:switch');
    expect(said(clean.calls, 'git.switchToDefault')).toEqual([['p1', 'clean']]);

    const dirty = home({ sync: sync({ onDefault: false, current: 'feature', behind: 0, dirty: 2 }) });
    await press(dirty, 'sync:switch');
    expect(said(dirty.calls, 'git.switchToDefault')).toEqual([]);
    expect(words(view(dirty))).toContain('Switch the main folder to main?');
    await press(dirty, 'sync:switch-stash');
    expect(said(dirty.calls, 'git.switchToDefault')).toEqual([['p1', 'stash']]);
    await press(dirty, 'sync:switch');
    await press(dirty, 'sync:switch-move');
    expect(said(dirty.calls, 'git.switchToDefault').at(-1)).toEqual(['p1', 'move']);
  });

  it('lists a few open pull requests, opening a worktree’s own, with the rest on the Board', async () => {
    const pull = (number: number, branch: string, extra = {}): Record<string, unknown> => ({ number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, author: 'kay', branch, draft: false, checks: 'failing', createdAt: 1, updatedAt: 1, ...extra });
    const s = start({ projects: [project('p1', 'alpha', [worktree('w1', { branch: 'mine' })])] });
    s.answers.set('issues.pulls', () => ({ kind: 'github', repo: {}, total: 9, fetchedAt: 1, pulls: [pull(1, 'mine'), pull(2, 'theirs', { draft: true, checks: 'none' }), pull(3, 'b'), pull(4, 'c'), pull(5, 'd')] }));
    go(s, 'project', { id: 'p1' });
    view(s);
    await s.settle();
    const tree = view(s);
    expect(words(tree)).toContain('Pull requests (9)');
    expect(words(tree)).toContain('Checks fail');
    expect(words(tree)).toContain('Draft');
    expect(words(tree)).not.toContain('#5');
    expect(flat(tree).filter((n) => n.k === 'link').map((n) => (n.k === 'link' ? n.href : ''))).toContain('https://github.com/o/r/pull/2');
    await press(s, 'pull:1');
    expect(s.calls).toContainEqual(['workspaces.load', ['w1']]);
    s.screens.nav.back('work');
    await press(s, 'pulls:board');
    expect(s.screens.nav.routeOf('work')).toEqual({ screen: 'board', name: 'pulls', params: { project: 'p1' } });
  });

  it('says in words when it can’t read pull requests, and nothing when there are none', async () => {
    const failing = start({ projects: [project('p1', 'alpha')] });
    failing.answers.set('issues.pulls', () => {
      throw new Error('gh broke');
    });
    go(failing, 'project', { id: 'p1' });
    view(failing);
    await failing.settle();
    expect(words(view(failing))).toContain('gh broke');
    const none = start({ projects: [project('p1', 'alpha')] });
    none.answers.set('issues.pulls', () => ({ kind: 'none' }));
    go(none, 'project', { id: 'p1' });
    view(none);
    await none.settle();
    expect(words(view(none))).not.toContain('Pull requests');
  });

  it('shows its setup and run commands, and where they came from', () => {
    const s = home({ scripts: { setup: { command: 'npm install', source: 'teamod.json' }, run: { command: 'npm start', source: 'yours' } } });
    const tree = words(view(s));
    expect(tree).toContain('npm install');
    expect(tree).toContain('from teamod.json');
    expect(tree).toContain('npm start');
    expect(tree).toContain('set by you');
    expect(buttons(view(s)).some((k) => k.startsWith('script'))).toBe(false);
  });

  it('brings an archived one back at once, and deletes only after asking', async () => {
    const s = home({}, [worktree('w1', { archived: true, archive: { freedBytes: 1, keptBytes: 1, remake: [], at: 1 } })]);
    await press(s, 'arch:w1:restore');
    expect(said(s.calls, 'workspaces.restore')).toEqual([['w1']]);
    await press(s, 'arch:w1:delete');
    expect(said(s.calls, 'workspaces.remove')).toEqual([]);
    expect(words(view(s))).toContain('You can’t undo this');
    await press(s, 'confirm');
    expect(said(s.calls, 'workspaces.remove')).toEqual([['w1']]);
    expect(labelled(view(s), 'New Worktree')).toBeDefined();
  });

  it('calls an archived chat a chat when it asks', async () => {
    const s = home({}, [{ id: 'c1', projectId: 'p1', name: 'A question', path: '/r/alpha', kind: 'chat', createdAt: 1, external: false, archived: true }]);
    await press(s, 'arch:c1:delete');
    expect(words(view(s))).toContain('Delete 1 archived chat permanently?');
    expect(labelled(view(s), 'Delete 1 Chat')).toBeDefined();
  });

  it('leaves the page at once when it asks for something long', async () => {
    const s = start({ projects: [project('p1', 'alpha', [worktree('w1')])] });
    let finish: () => void = () => undefined;
    s.answers.set('workspaces.archive', () => new Promise<void>((resolve) => (finish = resolve)));
    go(s, 'worktrees');
    go(s, 'worktree', { id: 'w1' });
    await press(s, 'wt:archive');
    const pressed = press(s, 'confirm');
    await s.settle();
    expect(s.screens.nav.routeOf('work').name).toBe('worktrees');
    finish();
    expect(await pressed).toEqual({ ok: true });
  });

  it('says when it’s gone', () => {
    const s = start();
    go(s, 'project', { id: 'nope' });
    expect(words(view(s))).toContain('That project is gone');
    expect(labelled(view(s), '‹ Back')).toBeDefined();
  });
});

describe('the Worktrees page', () => {
  const rows = (): AppState['projects'] => [
    project('p1', 'alpha', [
      worktree('big', { status: { changed: 2, ahead: 0 } }),
      worktree('merged', { status: { changed: 0, ahead: 3 } }),
      worktree('agent', { external: true, path: '/r/.claude/worktrees/agent', status: { changed: 0, ahead: 0 } }),
      worktree('tool', { external: true, path: '/x/tool', status: { changed: 1, ahead: 0 } }),
      worktree('put', { archived: true, branch: 'b' }),
    ]),
  ];

  it('says who made each, whether it’s done, and the space it takes', async () => {
    const s = start({ projects: rows(), disk: { big: 5 * 1024 * 1024 }, prs: { merged: { state: 'MERGED', number: 7 } } as unknown as AppState['prs'] });
    go(s, 'worktrees');
    const tree = words(view(s));
    expect(said(s.calls, 'workbench.measureDisk')).toEqual([[]]);
    expect(tree).toContain('5 MB');
    expect(tree).toContain('2 uncommitted files');
    expect(tree).toContain('Merged (#7)');
    expect(tree).toContain('Sub-agent');
    expect(tree).toContain('Outside');
    expect(tree).not.toContain('put');
  });

  it('narrows to the done, the sub-agents, the outside and the archived', async () => {
    const s = start({ projects: rows() });
    go(s, 'worktrees');
    await press(s, 'filter:done');
    expect(words(view(s))).toContain('agent');
    expect(words(view(s))).not.toContain('big');
    await press(s, 'filter:outside');
    expect(words(view(s))).toContain('tool');
    await press(s, 'filter:archived');
    expect(words(view(s))).toContain('put');
    expect(words(view(s))).not.toContain('big');
  });

  it('asks before archiving, and says what’s kept', async () => {
    const s = start({ projects: rows() });
    go(s, 'worktree', { id: 'big' });
    await press(s, 'wt:archive');
    expect(said(s.calls, 'workspaces.archive')).toEqual([]);
    expect(words(view(s))).toContain('Everything of yours');
    await press(s, 'confirm');
    expect(said(s.calls, 'workspaces.archive')).toEqual([['big']]);
  });

  it('asks before deleting, says what’s lost, and Back leaves it alone', async () => {
    const s = start({ projects: rows() });
    go(s, 'worktrees');
    go(s, 'worktree', { id: 'big' });
    await press(s, 'wt:delete');
    expect(words(view(s))).toContain('2 uncommitted files are lost');
    await press(s, 'back');
    expect(said(s.calls, 'workspaces.remove')).toEqual([]);
    await press(s, 'wt:delete');
    await press(s, 'confirm');
    expect(said(s.calls, 'workspaces.remove')).toEqual([['big']]);
    s.set({ projects: [] });
    // Its own page is gone with it: back on the list, not on "gone".
    expect(s.screens.nav.routeOf('work').name).toBe('worktrees');
  });

  it('removes build files after asking', async () => {
    const s = start({ projects: rows() });
    s.answers.set('workspaces.archivePlan', () => ({ drop: [{ path: 'node_modules', what: 'dependencies', bytes: 3 * 1024 * 1024 }], dropBytes: 3 * 1024 * 1024, keep: [], keepCount: 0, remake: [] }));
    go(s, 'worktree', { id: 'big' });
    view(s);
    await s.settle();
    expect(words(view(s))).toContain('3 MB is build files');
    expect(words(view(s))).toContain('node_modules');
    await press(s, 'wt:free');
    expect(said(s.calls, 'workspaces.freeSpace')).toEqual([]);
    await press(s, 'confirm');
    expect(said(s.calls, 'workspaces.freeSpace')).toEqual([['big']]);
  });

  it('acts on what you ticked, asking once, and says what failed', async () => {
    const s = start({ projects: rows() });
    s.answers.set('workspaces.remove', ([id]) => {
      if (id === 'merged') throw new Error('merged would not go');
      return undefined;
    });
    go(s, 'worktrees');
    expect(labelled(view(s), 'Archive')).toBeUndefined();
    await press(s, 'wt:big:tick');
    await press(s, 'wt:merged:tick');
    expect(labelled(view(s), 'Archive')).toBeDefined();
    await press(s, 'batch:delete');
    expect(said(s.calls, 'workspaces.remove')).toEqual([]);
    expect(words(view(s))).toContain('Delete 2 worktrees permanently?');
    const done = await press(s, 'confirm');
    expect(said(s.calls, 'workspaces.remove')).toEqual([['big'], ['merged']]);
    expect(done).toEqual({ ok: true, toast: 'merged would not go' });
    expect(labelled(view(s), 'Delete')).toBeUndefined();
  });

  it('restores what you ticked under Archived with no question: it loses nothing', async () => {
    const s = start({ projects: rows() });
    go(s, 'worktrees');
    await press(s, 'filter:archived');
    await press(s, 'wt:put:tick');
    await press(s, 'batch:restore');
    expect(said(s.calls, 'workspaces.restore')).toEqual([['put']]);
  });

  it('windows a long list', async () => {
    const s = start({ projects: [project('p1', 'alpha', Array.from({ length: 120 }, (_, i) => worktree(`w${i}`)))] });
    go(s, 'worktrees');
    expect(flat(view(s)).filter((n) => n.k === 'button' && /^wt:w\d+$/.test(n.key)).length).toBeLessThanOrEqual(50);
    await press(s, 'worktrees:more');
    expect(flat(view(s)).filter((n) => n.k === 'button' && /^wt:w\d+$/.test(n.key)).length).toBeLessThanOrEqual(50);
  });

  it('tells a worktree from outside, and shows an earlier conversation', async () => {
    const s = start({ projects: rows() });
    s.answers.set('workspaces.worktreeInfo', () => ({ id: 'tool', missing: false, detached: false, changed: 1, ahead: 2, behind: 0, merged: false, upstreamGone: false, base: 'main', branch: 'b', origin: { source: 'other', label: 'Made outside', detail: 'By a script.' }, conversations: [{ sessionId: 'sess-1', title: 'Old talk', lastModified: 1 }], name: 'tool', path: '/x/tool', projectId: 'p1', projectName: 'alpha' }));
    go(s, 'worktree', { id: 'tool' });
    view(s);
    await s.settle();
    const tree = words(view(s));
    expect(tree).toContain('By a script.');
    expect(tree).toContain('Old talk');
    await press(s, 'convo:sess-1');
    expect(said(s.calls, 'workspaces.showConversation')).toEqual([['tool', 'sess-1']]);
    expect(s.calls).toContainEqual(['workspaces.load', ['tool']]);
  });

  it('removes a worktree from outside after asking, and forces only what it warned about', async () => {
    const s = start({ projects: rows() });
    go(s, 'worktree', { id: 'tool' });
    await press(s, 'wt:remove-other');
    expect(words(view(s))).toContain('1 uncommitted change');
    expect(labelled(view(s), 'Remove Anyway')).toBeDefined();
    expect(said(s.calls, 'workspaces.removeOther')).toEqual([]);
    await press(s, 'confirm');
    expect(said(s.calls, 'workspaces.removeOther')).toEqual([['tool', true]]);
  });

  it('cleans up sub-agents’ and other tools’ worktrees, only what you left ticked, after asking', async () => {
    const s = start({ projects: rows(), disk: { tool: 2 * 1024 * 1024 } });
    s.answers.set('workspaces.staleOthers', () => [{ id: 'tool', name: 'tool', path: '/x/tool', source: 'other', reason: 'merged', reasonText: 'Everything on it is already in main' }, { id: 'agent', name: 'agent', path: '/y', source: 'claude', reason: 'merged', reasonText: 'Merged' }]);
    s.answers.set('workspaces.otherOrigins', () => ({ tool: { source: 'other', label: 'Made by a script', detail: '' } }));
    s.answers.set('workspaces.otherActivity', () => ({ agent: 100, tool: 50 }));
    go(s, 'clean');
    expect(words(view(s))).toContain('alpha');
    await press(s, 'clean:p1');
    view(s);
    await s.settle();
    const tree = view(s);
    expect(words(tree)).toContain('Made by a script');
    expect(words(tree).indexOf('agent')).toBeLessThan(words(tree).lastIndexOf('tool'));

    await press(s, 'clean:agents');
    expect(said(s.calls, 'workspaces.cleanAgentWorktrees')).toEqual([]);
    await press(s, 'confirm');
    expect(said(s.calls, 'workspaces.cleanAgentWorktrees')).toEqual([['p1']]);

    await press(s, 'stale:agent');
    await press(s, 'clean:others');
    expect(said(s.calls, 'workspaces.cleanUpOthers')).toEqual([]);
    await press(s, 'confirm');
    expect(said(s.calls, 'workspaces.cleanUpOthers')).toEqual([['p1', ['tool']]]);
  });

  it('says when there’s nothing to clean', () => {
    const s = start({ projects: [project('p1', 'alpha')] });
    go(s, 'clean', { project: 'p1' });
    expect(words(view(s))).toContain('Nothing to clean up');
  });
});

describe('importing a conversation', () => {
  const conversations = [{ sessionId: 'aa-1', title: 'Fix the bug', lastModified: 1, cwd: '/r/alpha/sub', bytes: 1024 }, { sessionId: 'bb-2', title: 'Brought', lastModified: 2, cwd: '/r/alpha', bytes: 2048, wsId: 'ws-b' }];

  it('goes on with one in a new worktree, named as you say', async () => {
    const s = start({ projects: [project('p1', 'alpha')] });
    s.answers.set('workspaces.outsideConversations', () => ({ dir: '/r/alpha', conversations }));
    s.answers.set('workspaces.importOutside', () => 'imported');
    go(s, 'import', { project: 'p1' });
    view(s);
    await s.settle();
    const tree = words(view(s));
    expect(tree).toContain('Fix the bug');
    expect(tree).toContain('sub');
    expect(tree).toContain('Brought in already');
    await press(s, 'convo:aa-1');
    await press(s, 'import:name:aa-1', 'fix-it');
    expect(said(s.calls, 'workspaces.importOutside')).toEqual([['p1', '/r/alpha', 'aa-1', 'fix-it']]);
    expect(s.calls).toContainEqual(['workspaces.load', ['imported']]);
  });

  it('opens one already brought in, and looks in another folder', async () => {
    const s = start({ projects: [project('p1', 'alpha')] });
    s.answers.set('workspaces.outsideConversations', ([, dir]) => ({ dir: dir ?? '/r/alpha', conversations: dir ? [] : conversations }));
    go(s, 'import', { project: 'p1' });
    view(s);
    await s.settle();
    await press(s, 'convo:bb-2');
    await press(s, 'import:open');
    expect(s.calls).toContainEqual(['workspaces.load', ['ws-b']]);
    s.screens.nav.back('work');
    await press(s, 'import:another');
    await press(s, 'import:dir', '/elsewhere');
    view(s);
    await s.settle();
    expect(said(s.calls, 'workspaces.outsideConversations').at(-1)).toEqual(['p1', '/elsewhere']);
    expect(words(view(s))).toContain('No conversation ran in this folder');
  });

  it('says so when it can’t look', async () => {
    const s = start({ projects: [project('p1', 'alpha')] });
    s.answers.set('workspaces.outsideConversations', () => {
      throw new Error('That project isn’t on this Mac');
    });
    go(s, 'import', { project: 'p1' });
    view(s);
    await s.settle();
    expect(words(view(s))).toContain('That project isn’t on this Mac');
  });
});

describe('Overview', () => {
  const needing = worktree('stuck');
  const log = [{ id: 'r1', type: 'agent', channel: 'ws:stuck', subagents: [], requestId: 'q', owner: 'me', ownerName: 'me', requesterName: 'me', status: 'awaiting_approval', text: '', steps: [], ts: 5 }] as unknown as AppState['log'];

  it('shows what’s in progress everywhere, what needs you first', () => {
    const s = start({ projects: [project('p1', 'alpha', [worktree('calm', { status: { changed: 0, ahead: 0 } }), needing]), project('p2', 'beta', [worktree('other')])], log });
    go(s, 'overview');
    const tree = words(view(s));
    expect(tree.indexOf('stuck')).toBeLessThan(tree.indexOf('calm'));
    expect(tree).toContain('beta');
    expect(tree).toContain('Needs You 1');
  });

  it('narrows by segment and finds, and offers Restore and Delete on what’s archived', async () => {
    const s = start({ projects: [project('p1', 'alpha', [needing, worktree('gone', { archived: true, branch: 'b' })])], log });
    go(s, 'overview');
    await press(s, 'overview:filter:archived');
    expect(words(view(s))).toContain('gone');
    expect(words(view(s))).not.toContain('stuck');
    await press(s, 'ws:gone:restore');
    expect(said(s.calls, 'workspaces.restore')).toEqual([['gone']]);
    await press(s, 'ws:gone:delete');
    expect(said(s.calls, 'workspaces.remove')).toEqual([]);
    s.screens.nav.back('work');
    await press(s, 'overview:filter:all');
    await press(s, 'overview:find');
    await press(s, 'overview:box', 'stuck');
    expect(words(view(s))).not.toContain('gone');
  });

  it('leaves out the main folder and sub-agents’ worktrees', () => {
    const s = start({ projects: [project('p1', 'alpha', [worktree('main-one', { kind: 'main' }), worktree('agents', { external: true, path: '/r/.claude/worktrees/agents' })])] });
    go(s, 'overview');
    const tree = words(view(s));
    expect(tree).not.toContain('main-one');
    expect(tree).not.toContain('agents');
    expect(tree).toContain('No worktrees or chats yet');
  });
});

describe('Search', () => {
  it('searches, shows where each hit is, and opens one', async () => {
    const hits = [{ channel: 'ws:w1', place: 'alpha › w1', who: 'kay', text: 'the auth middleware rejects it', at: 4, ts: 1 }];
    const s = start({ search: { query: 'auth', hits, searched: 3, cursor: 0 } as unknown as AppState['search'] });
    go(s, 'search');
    const tree = words(view(s));
    expect(tree).toContain('1 in 3 conversations');
    expect(tree).toContain('alpha › w1');
    expect(tree).toContain('auth');
    await press(s, 'search:box', ' auth ');
    expect(said(s.calls, 'workbench.search')).toEqual([['auth']]);
    await press(s, 'hit:0');
    expect(said(s.calls, 'workbench.openHit')).toEqual([[0]]);
  });

  it('says when nothing matches, and holds a page of many', async () => {
    const none = start({ search: { query: 'zzz', hits: [], searched: 3, cursor: 0 } as unknown as AppState['search'] });
    go(none, 'search');
    expect(words(view(none))).toContain('Nothing says “zzz”');
    const hits = Array.from({ length: 200 }, (_, i) => ({ channel: 'ws:w1', place: `place-${i}`, who: '', text: 'hit', at: 0, ts: 1 }));
    const many = start({ search: { query: 'hit', hits, searched: 1, cursor: 0 } as unknown as AppState['search'] });
    go(many, 'search');
    expect(buttons(view(many)).filter((k) => k.startsWith('hit:')).length).toBe(30);
    await press(many, 'search:more');
    await press(many, 'hit:30');
    expect(said(many.calls, 'workbench.openHit')).toEqual([[30]]);
  });
});

describe('Usage', () => {
  const today = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const usage = (): Record<string, unknown> => ({ input: 1000, output: 500, cacheRead: 0, cacheWrite: 500, cost: 0.25, runs: 1, days: { [today()]: { tokens: 2000, cost: 0.25 } } });

  it('adds up tokens and cost per day, and the disk, measured on opening and on request', async () => {
    const s = start({ projects: [project('p1', 'alpha', [worktree('w1', { usage: usage() })])], disk: { w1: 1024 * 1024 * 3 } });
    go(s, 'usage');
    view(s);
    await s.settle();
    const tree = words(view(s));
    expect(tree).toContain('Today');
    expect(tree).toContain('2k');
    expect(tree).toContain('$0.25');
    expect(tree).toContain('3 MB');
    expect(said(s.calls, 'workbench.measureDisk').length).toBe(1);
    await press(s, 'usage:measure');
    view(s);
    expect(said(s.calls, 'workbench.measureDisk').length).toBe(2);
    await press(s, 'usage:p1');
    expect(labelled(view(s), 'New Worktree')).toBeDefined();
  });

  it('says what your plans have left, and makes another your default', async () => {
    const me = { peerId: 'me', name: 'me', usages: [{ agent: { runtime: 'claude', label: 'Claude' }, plan: 'Max', fiveHour: { pct: 92 }, week: { pct: 10 }, updatedAt: 1 }, { agent: { runtime: 'codex', label: 'Codex' }, updatedAt: 1 }] };
    const friend = { peerId: 'them', name: 'kay', usages: [{ agent: { runtime: 'claude', label: 'Claude' }, fiveHour: { pct: 40 }, updatedAt: 1 }] };
    const s = start({ self: me as never, selfId: 'me', peers: [me, friend] as never });
    go(s, 'usage');
    const tree = words(view(s));
    expect(tree).toContain('Max');
    expect(tree).toContain('92% used');
    expect(tree).toContain('kay');
    await press(s, 'default:codex');
    expect(said(s.calls, 'session.setPrefs')).toEqual([[{ defaultAgent: { runtime: 'codex', label: 'Codex' } }]]);
  });

  it('says so when it has nothing to measure', () => {
    const s = start();
    go(s, 'usage');
    expect(words(view(s))).toContain('Nothing to measure yet');
  });
});

describe('Activity', () => {
  const session = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, title: `Session ${id}`, cwd: '/r/alpha', status: 'working', lastAt: Date.now(), steps: 3, agents: [], ...extra });

  it('lists every session, by project, and only reads', async () => {
    const agent = { id: 'a1', description: 'Fix the panel', type: 'general-purpose', background: false, status: 'running', startedAt: 1, lastAt: 1, steps: 2, step: 'Reading a.ts' };
    const s = start({ projects: [project('p1', 'alpha', [worktree('w1')])], claudeCode: { sessions: [session('aaaaaaaa', { projectId: 'p1', workspaceId: 'w1', agents: [agent] }), session('bbbbbbbb', { cwd: '/x/elsewhere', status: 'idle' }), session('cccccccc', { own: true })], origins: [] } as never });
    go(s, 'activity');
    const tree = words(view(s));
    expect(tree).toContain('Session aaaaaaaa');
    expect(tree).toContain('elsewhere');
    expect(tree).toContain('1 agent running');
    expect(tree).toContain('Session cccccccc');
    expect(tree).toContain('a worktree’s own');
    expect(s.calls).toEqual([]);
    await press(s, 'session:aaaaaaaa');
    const page = view(s);
    expect(words(page)).toContain('Fix the panel');
    expect(words(page)).toContain('Reading a.ts');
    expect(s.calls).toEqual([]);
    await press(s, 'session:chat');
    expect(s.calls).toContainEqual(['workspaces.load', ['w1']]);
  });

  it('has no chat to open in a folder the engine doesn’t know, and says when one went quiet', async () => {
    const s = start({ claudeCode: { sessions: [session('bbbbbbbb', { cwd: '/x/elsewhere' })], origins: [] } as never });
    go(s, 'activity', { session: 'bbbbbbbb' });
    expect(labelled(view(s), 'Open Chat')).toBeUndefined();
    expect(words(view(s))).toContain('shows here live');
    s.set({ claudeCode: { sessions: [], origins: [] } as never });
    expect(words(view(s))).toContain('went quiet');
  });
});

describe('the Inbox', () => {
  const notice = (id: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, kind: 'done', title: `Notice ${id}`, body: `Body ${id}`, ts: Date.now(), read: false, ...extra });

  it('counts what’s unread in its place, and goes where a notice points, reading it', async () => {
    const s = start({ projects: [project('p1', 'alpha', [worktree('w1')])], inbox: [notice(1, { channel: 'ws:w1' }), notice(2, { read: true })] as never });
    expect(labelled(view(s), 'Inbox (1)')).toBeDefined();
    go(s, 'inbox');
    expect(words(view(s))).toContain('Body 1');
    await press(s, 'notice:1');
    expect(said(s.calls, 'inbox.read')).toEqual([[{ id: 1 }]]);
    expect(s.calls).toContainEqual(['workspaces.load', ['w1']]);
  });

  it('marks one read or unread, clears one or all after asking', async () => {
    const s = start({ inbox: [notice(1), notice(2, { read: true })] as never });
    go(s, 'inbox');
    await press(s, 'notice:1:read');
    expect(said(s.calls, 'inbox.read')).toEqual([[{ id: 1 }]]);
    await press(s, 'notice:2:read');
    expect(said(s.calls, 'inbox.unread')).toEqual([[2]]);
    await press(s, 'inbox:read-all');
    expect(said(s.calls, 'inbox.read').at(-1)).toEqual([]);
    await press(s, 'notice:1:clear');
    expect(said(s.calls, 'inbox.clear')).toEqual([]);
    await press(s, 'notice:1:clear');
    expect(said(s.calls, 'inbox.clear')).toEqual([[{ id: 1 }]]);
    await press(s, 'inbox:clear-all');
    expect(said(s.calls, 'inbox.clear').length).toBe(1);
    await press(s, 'inbox:clear-all');
    expect(said(s.calls, 'inbox.clear').at(-1)).toEqual([]);
  });

  it('narrows to the unread, and says when there’s nothing', async () => {
    const s = start({ inbox: [notice(1, { read: true })] as never });
    go(s, 'inbox');
    await press(s, 'inbox:filter:unread');
    expect(words(view(s))).toContain('Nothing like that here');
    const none = start();
    go(none, 'inbox');
    expect(words(none.screens.view('work', viewport))).toContain('Nothing here yet');
  });
});

describe('templates', () => {
  const templates = [{ id: 'fix', name: 'Fix a bug', prompt: 'There is a bug', builtIn: true }, { id: 'mine', name: 'Mine', prompt: 'Do my thing' }];

  it('saves one, plans first when asked', async () => {
    const s = start({ templates });
    go(s, 'templates');
    await press(s, 'templates:save');
    await press(s, 'templates:plan');
    await press(s, 'templates:box', 'Ship it: run the tests and ship');
    expect(said(s.calls, 'workbench.saveTemplate')).toEqual([['Ship it: run the tests and ship', true]]);
  });

  it('removes only your own, after asking', async () => {
    const s = start({ templates });
    go(s, 'templates');
    expect(buttons(view(s))).not.toContain('template:fix:remove');
    await press(s, 'template:mine:remove');
    expect(said(s.calls, 'workbench.removeTemplate')).toEqual([]);
    await press(s, 'template:mine:remove');
    expect(said(s.calls, 'workbench.removeTemplate')).toEqual([['mine']]);
  });
});

describe('Your Mac', () => {
  const assistant = { chats: [{ id: 'main', channel: 'mac:assistant', createdAt: 1 }, { id: 'two', channel: 'mac:assistant:two', createdAt: 2 }], active: 'two' };
  const said1 = { id: 'm1', type: 'chat', channel: 'mac:assistant:two', from: 'me', name: 'me', text: 'What runs on port 3000?', ts: 1, byAgent: false };
  const other = { ...said1, id: 'm2', channel: 'mac:assistant', text: 'From the other chat' };
  const run = { id: 'r1', type: 'agent', channel: 'mac:assistant:two', subagents: [], requestId: 'q1', owner: 'me', ownerName: 'me', requesterName: 'me', status: 'tool', text: '', steps: ['Read file.ts'], ts: 2 };

  it('reads the open chat from the log, and sends on its channel', async () => {
    const s = start({ assistant, log: [said1, other] as never });
    go(s, 'assistant');
    const tree = view(s);
    const messages = flat(tree).flatMap((n) => (n.k === 'md' ? [n.text] : []));
    expect(messages).toEqual(['What runs on port 3000?']);
    await press(s, 'assistant:box:mac:assistant:two', ' Thanks ');
    expect(said(s.calls, 'session.submit')).toEqual([['Thanks', { channel: 'mac:assistant:two' }]]);
  });

  it('opens another chat and starts a new one', async () => {
    const s = start({ assistant, log: [said1] as never });
    go(s, 'assistant');
    expect(words(view(s))).toContain('What runs on port 3000?');
    await press(s, 'chat:main');
    expect(said(s.calls, 'assistant.openChat')).toEqual([['main']]);
    await press(s, 'assistant:new');
    expect(said(s.calls, 'assistant.newChat')).toEqual([[]]);
  });

  it('deletes a chat only after asking, and offers no Delete on the only empty one', async () => {
    const s = start({ assistant, log: [said1] as never });
    go(s, 'assistant');
    await press(s, 'assistant:delete');
    expect(said(s.calls, 'assistant.deleteChat')).toEqual([]);
    expect(words(view(s))).toContain('Delete “What runs on port 3000?”?');
    await press(s, 'confirm');
    expect(said(s.calls, 'assistant.deleteChat')).toEqual([['two']]);
    const only = start({ assistant: { chats: [assistant.chats[0]!], active: 'main' } });
    go(only, 'assistant');
    expect(buttons(view(only))).not.toContain('assistant:delete');
  });

  it('stops a running answer, and holds only a page of a long chat', async () => {
    const long = Array.from({ length: 100 }, (_, i) => ({ ...said1, id: `m${i}`, text: `message ${i}` }));
    const s = start({ assistant, log: [...long, run] as never });
    go(s, 'assistant');
    expect(words(view(s))).not.toContain('message 5\n');
    expect(labelled(view(s), 'Stop')).toBeDefined();
    await press(s, 'assistant:stop');
    expect(said(s.calls, 'host.stopRun')).toEqual([['mac:assistant:two']]);
    await press(s, 'assistant:earlier');
    expect(words(view(s))).toContain('message 45');
    expect(words(view(s))).not.toContain('message 90');
    await press(s, 'assistant:later');
    expect(words(view(s))).toContain('message 90');
  });
});

describe('the inputs on the project list', () => {
  it('stay closed until asked for, so the box you type in isn’t taken', () => {
    const s = start({ projects: [project('p1', 'alpha')] });
    expect(inputs(view(s))).toEqual([]);
  });
});
