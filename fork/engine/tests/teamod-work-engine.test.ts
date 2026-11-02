import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentBackend } from '../src/agent/types.js';
import { Session } from '../src/core/session.js';
import { ShareService } from '../src/core/shares.js';
import { Store, initialState } from '../src/core/store.js';
import type { Method } from '../src/ipc/api.js';
import { deriveKeys, generateSecret } from '../src/net/crypto.js';
import { type Hub, startHub } from '../src/net/hub.js';
import { PeerClient } from '../src/net/peer-client.js';
import { SCREENS } from '../src/teamod/panes/index.js';
import { type ScreenHost, Screens, type SiteId } from '../src/teamod/screens.js';
import type { Node } from '../src/teamod/tree.js';
import { TerminalManager } from '../src/terminal/index.js';
import { WorkspaceManager } from '../src/workspaces/manager.js';
import { WorkspaceStore } from '../src/workspaces/store.js';
import { attach, waitFor } from './helpers.js';
import { flat, viewport, words } from './teamod-helpers.js';

/**
 * The Work and Settings screens over a real engine, in this process: real git, real worktrees, what
 * each method really answers. The other tests stub the answers; this one is what keeps them honest.
 */

const keys = deriveKeys(generateSecret());
const home = process.env.TEAMOD_HOME;
let hub: Hub;
let base: string;
let terminals: TerminalManager;
const sessions: Session[] = [];

beforeEach(async () => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'teamod-work-')));
  process.env.TEAMOD_HOME = path.join(base, 'home-teamod');
  terminals = new TerminalManager();
  hub = await startHub({ keys });
});

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.stop();
  terminals.closeAll();
  await hub?.close();
  process.env.TEAMOD_HOME = home;
});

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=T', ...args], { cwd, stdio: 'pipe' }).toString();

/** A project behind its origin by one commit, with a second branch there. */
function repo(): string {
  const origin = path.join(base, 'origin.git');
  execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'pipe' });
  const dir = path.join(base, 'code', 'app');
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  writeFileSync(path.join(dir, 'README.md'), '# app\n');
  writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'init');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  const other = path.join(base, 'other');
  execFileSync('git', ['clone', origin, other], { stdio: 'pipe' });
  git(other, 'switch', '-c', 'dev');
  writeFileSync(path.join(other, 'dev.txt'), 'dev\n');
  git(other, 'add', '.');
  git(other, 'commit', '-m', 'on dev');
  git(other, 'push', 'origin', 'dev');
  git(other, 'switch', 'main');
  writeFileSync(path.join(other, 'new.txt'), 'new\n');
  git(other, 'add', '.');
  git(other, 'commit', '-m', 'new on main');
  git(other, 'push', 'origin', 'main');
  git(dir, 'fetch', 'origin');
  return dir;
}

async function solo(dir: string) {
  const store = new Store(initialState('test', 'ask'));
  const client = new PeerClient({ url: `ws://127.0.0.1:${hub.port}`, keys, profile: { name: 'kay', shares: [], agent: true }, reconnect: false });
  const wsStore = new WorkspaceStore(path.join(base, 'home'));
  wsStore.saveConfig({ roots: [], projects: [dir], hidden: [] });
  const workspaces = new WorkspaceManager(wsStore);
  await workspaces.refresh();
  const session = new Session({
    client,
    store,
    shares: new ShareService([]),
    agentCwd: base,
    workspaces,
    terminals,
    hasGh: async () => false,
    findPr: async () => undefined,
    open: () => undefined,
    desktopNotify: () => undefined,
    zoom: async () => ({ ok: true, message: '' }),
    copy: async () => undefined,
    saveSettings: () => undefined,
    createAgent: (): AgentBackend => ({ nameTask: async () => 'named-by-a-model', run: async () => 'Done.' }),
  });
  const screen = attach(session);
  session.start();
  sessions.push(session);
  await waitFor(() => store.getState().self && screen.store.getState().projects.some((p) => p.root), 8000);
  const calls: Array<[string, readonly unknown[]]> = [];
  const host: ScreenHost = {
    getState: () => screen.store.getState(),
    call: (method, args) => {
      calls.push([method, args]);
      return (screen.call as (m: Method, ...a: unknown[]) => Promise<unknown>).call(screen, method as Method, ...args);
    },
    markDirty: () => undefined,
    look: () => undefined,
  };
  const screens = new Screens(host, SCREENS);
  screen.onIntent((intent) => {
    if (intent.type === 'navigate') screens.follow(intent.view);
  });
  const view = (site: SiteId = 'work'): Node => screens.view(site, viewport);
  const press = async (key: string, value?: string, site: SiteId = 'work'): Promise<void> => {
    const out = await screens.press(site, key, value, viewport);
    if (!out.ok) throw new Error(`${key}: ${out.error}`);
  };
  /** Draw until the screen says this: a value it asked for lands in its own time. */
  const says = async (words_: string, site: SiteId = 'work'): Promise<void> => {
    await waitFor(() => words(view(site)).includes(words_), 8000).catch(() => {
      throw new Error(`The screen never said “${words_}”:\n${words(view(site))}`);
    });
  };
  const project = () => screen.store.getState().projects.find((p) => p.root)!;
  return { session, calls, screens, view, press, says, project, state: () => screen.store.getState() };
}

describe('the Work screen, on a real engine', () => {
  it('from a project to a worktree on a chosen branch and back to nothing, asking before it loses anything', { timeout: 60_000 }, async () => {
    const dir = repo();
    const kay = await solo(dir);
    const id = kay.project().id;

    await kay.says('app');
    await kay.press(`project:${id}`);

    // Main against origin, and updating it.
    await kay.says('1 behind origin/main');
    expect(flat(kay.view()).some((n) => n.k === 'button' && n.key === 'sync:update')).toBe(true);
    await kay.press('sync:update');
    await kay.says('Up to date with origin/main');
    expect(existsSync(path.join(dir, 'new.txt'))).toBe(true);

    // What a worktree can start from, and starting one there.
    await waitFor(() => flat(kay.view()).some((n) => n.k === 'select' && n.key === `home:${id}:base`), 8000);
    const select = flat(kay.view()).find((n) => n.k === 'select' && n.key === `home:${id}:base`);
    const dev = select?.k === 'select' ? select.options.map((o) => o.value).find((b) => b.includes('dev')) : undefined;
    expect(dev).toBeDefined();
    await kay.press(`home:${id}:base`, dev);
    await kay.press('home:name');
    await kay.press(`home:${id}:name-box`, 'on-dev');
    await kay.press(`home:${id}:box`, 'Add a health check');
    const ws = await waitFor(() => kay.project().workspaces.find((w) => w.name === 'on-dev' && !w.pending), 15_000);
    expect(existsSync(path.join(ws.path, 'dev.txt'))).toBe(true);
    expect(kay.screens.nav.routeOf('work')).toMatchObject({ screen: 'task', params: { id: ws.id } });

    // The Worktrees page: who made it, its space; archiving asks first.
    await kay.press('screen:work');
    await kay.press('place:worktrees');
    await kay.says('on-dev');
    await kay.says('teamod');
    await waitFor(() => kay.state().disk[ws.id] !== undefined, 15_000);
    await kay.press(`wt:${ws.id}`);
    await kay.press('wt:archive');
    expect(kay.calls.some(([m]) => m === 'workspaces.archive')).toBe(false);
    await kay.says('Everything of yours');
    await kay.press('confirm');
    await waitFor(() => kay.project().workspaces.find((w) => w.id === ws.id)?.archived, 15_000);
    await waitFor(() => !kay.state().archiving[ws.id] && !existsSync(ws.path), 15_000);

    // On its project's home: Delete asks first too, and then it's gone.
    await kay.press('screen:work');
    await kay.press(`project:${id}`);
    await kay.says('Archived (1)');
    await kay.press(`arch:${ws.id}:delete`);
    await kay.says('You can’t undo this');
    expect(kay.project().workspaces.some((w) => w.id === ws.id)).toBe(true);
    await kay.press('confirm');
    await waitFor(() => !kay.project().workspaces.some((w) => w.id === ws.id), 15_000);
    await kay.says('Nothing in progress here');
  });

  it('adds, groups, arranges and hides projects', { timeout: 40_000 }, async () => {
    const dir = repo();
    const second = path.join(base, 'code', 'two');
    mkdirSync(second, { recursive: true });
    git(second, 'init', '-b', 'main');
    const kay = await solo(dir);
    const id = kay.project().id;

    await kay.press('add');
    await kay.press('add:more');
    await kay.press('add:path', second);
    await waitFor(() => kay.state().projects.some((p) => p.root === second), 8000);
    const two = kay.state().projects.find((p) => p.root === second)!;

    await kay.press('place:projects');
    await kay.press('arrange');
    await kay.press('arrange:add');
    await kay.press('arrange:new', 'Team');
    await waitFor(() => kay.state().projectGroups.some((g) => g.name === 'Team'), 4000);
    const moved = kay.view();
    expect(words(moved)).toContain('Team');
    await kay.press(`arrange:p:${two.id}:group`);
    await kay.press('to:Team');
    await waitFor(() => kay.state().projectGroups.find((g) => g.name === 'Team')?.projects.includes(second), 4000);
    await kay.says('Group');

    const order = (): readonly string[] => kay.state().projectOrder;
    await waitFor(() => order().length > 0, 4000);
    const groupFirst = order()[0] === 'group:Team';
    await kay.press(groupFirst ? 'arrange:g:Team:down' : 'arrange:g:Team:up');
    await waitFor(() => (order()[0] === 'group:Team') !== groupFirst, 4000);

    await kay.press('arrange:g:Team:ungroup');
    expect(kay.state().projectGroups.some((g) => g.name === 'Team')).toBe(true);
    await kay.press('arrange:g:Team:ungroup');
    await waitFor(() => !kay.state().projectGroups.some((g) => g.name === 'Team'), 4000);

    kay.screens.nav.go('work', { name: 'project-more', params: { id } });
    await kay.press('more:hide');
    await waitFor(() => kay.state().hiddenProjects.includes(dir), 4000);
    await kay.press('hidden');
    await kay.press(`show:${dir}`);
    await waitFor(() => !kay.state().hiddenProjects.includes(dir), 4000);

    kay.screens.nav.go('work', { name: 'project-more', params: { id: two.id } });
    await kay.press('more:delete');
    await kay.press('confirm');
    await waitFor(() => !kay.state().projects.some((p) => p.root === second), 8000);
    expect(existsSync(second)).toBe(true);
    await kay.says('Add Project');
  });

  it('makes a new project, saves a template, searches, and reads the inbox', { timeout: 40_000 }, async () => {
    const dir = repo();
    const kay = await solo(dir);

    kay.screens.nav.go('work', { name: 'new' });
    kay.view();
    await kay.press('new:change');
    await kay.press('new:where', path.join(base, 'code'));
    await kay.press('new:name', 'brand-new');
    await waitFor(() => kay.state().projects.some((p) => p.name === 'brand-new'), 8000);
    await kay.says('New Worktree');

    kay.screens.nav.go('work', { name: 'templates' });
    await kay.says('Fix failing CI');
    await kay.press('templates:save');
    await kay.press('templates:box', 'Ship it: run the tests and ship');
    const mine = await waitFor(() => kay.state().templates.find((t) => t.name === 'Ship it'), 4000);
    await kay.press(`template:${mine.id}:remove`);
    await kay.press(`template:${mine.id}:remove`);
    await waitFor(() => !kay.state().templates.some((t) => t.id === mine.id), 4000);

    await kay.press('place:search');
    await kay.press('search:box', 'nothing-like-this');
    await kay.says('Nothing says “nothing-like-this”');

    await kay.press('place:usage');
    await kay.says('Plan limits');
    await kay.says('Worktrees take');

    await kay.press('place:activity');
    await kay.says('No sessions right now');

    await kay.press('place:overview');
    await kay.says('No worktrees or chats yet');

    await kay.press('screen:settings');
    await kay.press('place:notifications', undefined);
    await kay.press('notify:test');
    await waitFor(() => kay.state().inbox.length > 0, 4000);
    await kay.press('screen:work');
    await kay.press('place:inbox');
    const notice = kay.state().inbox[0]!;
    await kay.says(notice.title);
    await kay.press(`notice:${notice.id}:clear`);
    expect(kay.state().inbox.some((n) => n.id === notice.id)).toBe(true);
    await kay.press(`notice:${notice.id}:clear`);
    await waitFor(() => !kay.state().inbox.some((n) => n.id === notice.id), 4000);
  });

  it('cleans up a worktree made outside, after asking, keeping its branch', { timeout: 40_000 }, async () => {
    const dir = repo();
    git(dir, 'worktree', 'add', '-b', 'tools-branch', path.join(base, 'tool-wt'), 'origin/main');
    const kay = await solo(dir);
    const id = kay.project().id;
    const other = await waitFor(() => kay.project().workspaces.find((w) => w.path === path.join(base, 'tool-wt')), 8000);

    kay.screens.nav.go('work', { name: 'clean', params: { project: id } });
    await kay.says('These can go without losing anything');
    await kay.says('tool-wt');
    await kay.press(`other:${other.id}`);
    await kay.says('Made outside');
    await kay.press('back');
    await kay.press('clean:others');
    await kay.says('nothing of their own');
    expect(existsSync(other.path)).toBe(true);
    await kay.press('confirm');
    await waitFor(() => !existsSync(other.path), 8000);
    expect(git(dir, 'branch', '--list', 'tools-branch')).toContain('tools-branch');
  });
});

describe('the Settings screen, on a real engine', () => {
  it('keeps a variable’s value off the screen until you press Show, and saves through the engine', { timeout: 30_000 }, async () => {
    const dir = repo();
    const kay = await solo(dir);
    const secret = 'real-secret-value-123';
    await kay.press('place:env', undefined, 'settings');
    await kay.says('No variables yet', 'settings');
    await kay.press('env:add', undefined, 'settings');
    await kay.press('env:new', `API_TOKEN=${secret}`, 'settings');
    await waitFor(() => kay.state().envKeys.global.includes('API_TOKEN'), 4000);
    await kay.says('API_TOKEN', 'settings');
    expect(JSON.stringify(kay.view('settings'))).not.toContain(secret);
    await kay.press('env:show:API_TOKEN', undefined, 'settings');
    expect(JSON.stringify(kay.view('settings'))).toContain(secret);
    await kay.press('env:hide:API_TOKEN', undefined, 'settings');
    expect(JSON.stringify(kay.view('settings'))).not.toContain(secret);
    await kay.press('env:remove:API_TOKEN', undefined, 'settings');
    await kay.press('env:remove:API_TOKEN', undefined, 'settings');
    await waitFor(() => !kay.state().envKeys.global.includes('API_TOKEN'), 4000);

    // A project's .env shows beside its own, its values hidden too.
    writeFileSync(path.join(dir, '.env'), 'FROM_DOTENV=dotenv-secret\n');
    await kay.press('env:scope', kay.project().id, 'settings');
    await kay.says('FROM_DOTENV', 'settings');
    expect(JSON.stringify(kay.view('settings'))).not.toContain('dotenv-secret');
    await kay.press('env:show:FROM_DOTENV', undefined, 'settings');
    expect(JSON.stringify(kay.view('settings'))).toContain('dotenv-secret');
  });

  it('never draws an endpoint’s key, and changes a pref through the engine', { timeout: 30_000 }, async () => {
    const dir = repo();
    const kay = await solo(dir);
    await kay.press('place:models', undefined, 'settings');
    await kay.says('Add Endpoint', 'settings');
    await kay.press('endpoint:add', undefined, 'settings');
    await kay.press('endpoint:label', undefined, 'settings');
    await kay.press('endpoint:label:box', 'Proxy', 'settings');
    await kay.press('endpoint:url', undefined, 'settings');
    await kay.press('endpoint:url:box', 'http://127.0.0.1:9', 'settings');
    await kay.press('endpoint:key', undefined, 'settings');
    await kay.press('endpoint:key:box', 'sk-real-key', 'settings');
    expect(JSON.stringify(kay.view('settings'))).not.toContain('sk-real-key');
    await kay.press('endpoint:save', undefined, 'settings');
    await kay.says('key saved', 'settings');
    expect(JSON.stringify(kay.view('settings'))).not.toContain('sk-real-key');

    await kay.press('place:agent', undefined, 'settings');
    await kay.press('pref:contextMeter', undefined, 'settings');
    await waitFor(() => kay.state().prefs.contextMeter === false, 4000);
    await kay.press('agent:effort', 'high', 'settings');
    await waitFor(() => kay.state().prefs.effort === 'high', 4000);
    await kay.press('agent:effort', '', 'settings');
    await waitFor(() => kay.state().prefs.effort === undefined, 4000);
    await kay.press('place:worktrees', undefined, 'settings');
    await kay.press('pref:branchPrefix', undefined, 'settings');
    await kay.press('pref:branchPrefix:box', 'kay/', 'settings');
    await waitFor(() => kay.state().prefs.branchPrefix === 'kay/', 4000);
    await kay.press('place:general', undefined, 'settings');
    await kay.press('name', undefined, 'settings');
    await kay.press('name:box', 'kai', 'settings');
    await kay.says('kai', 'settings');
  });
});
