import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPABILITIES } from '../src/core/gateway/access.js';
import type { AppState } from '../src/core/store.js';
import { API, type Method } from '../src/ipc/api.js';
import { peerMd } from '../src/teamod/panes/team-common.js';
import { type Route, routeOfView } from '../src/teamod/screens.js';
import type { Node } from '../src/teamod/tree.js';
import { type Started, flat, labelled, start, viewport, words } from './teamod-helpers.js';

const ME = 'm'.repeat(32);
const BOB = 'b'.repeat(32);
const MIA = 'i'.repeat(32);
const KAY = 'k'.repeat(32);
const GROUP = 'f'.repeat(32);
const MAIN = 'e'.repeat(32);
const LEFT = 'd'.repeat(32);
const SHA = '1'.repeat(64);
const PIC = '2'.repeat(64);
const DM = `dm:${BOB}`;
const CHANNEL = `group:${GROUP}`;
const TASK = 't_abcdefghijkl';
const SENT = 't_sentsentsent';
const CONFIRM = 't_confirmconfi';
const ASKS = 't_questionquest';
const DONE = 't_donedonedone';
const SECRET = 't_secretsecret';
const RULE = 'r_abcdefgh';

const online = { state: 'online' };
const friend = (peerId: string, name: string, extra: Record<string, unknown> = {}) => ({ peerId, name, online: true, presence: online, addedAt: 1, unread: 0, ...extra });
const member = (peerId: string, name: string, extra: Record<string, unknown> = {}) => ({ peerId, name, online: true, presence: online, admin: false, self: false, ...extra });
const message = (id: string, conversation: string, text: string, extra: Record<string, unknown> = {}) => ({ id, conversation, from: BOB, name: 'bob', text, ts: 1000, mine: false, ...extra });
const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, direction: 'received', peerId: BOB, peerName: 'bob', kind: 'ask', ask: 'Run the tests', needs: ['shell'], by: 'agent', state: 'awaiting_approval', steps: [], createdAt: 1, updatedAt: 1, ...extra });

const worktree = { id: 'w1', projectId: 'p1', projectRoot: '/r/alpha', name: 'add-login', path: '/r/w1', branch: 'teamod/add-login', kind: 'worktree', createdAt: 1, external: false };
const invitation = { id: 'a'.repeat(16), kind: 'friend', code: 'K7QM-4XPA-R2TD', link: `teamod://add#${'x'.repeat(22)}`, codeLink: 'teamod://add?code=K7QM-4XPA-R2TD', expiresAt: Date.now() + 86_400_000, codeExpiresAt: Date.now() + 3_600_000, uses: 0 };
const groupInvite = { ...invitation, id: 'b'.repeat(16), kind: 'group', groupId: GROUP, link: `teamod://join#${'y'.repeat(22)}` };
const plan = { owner: BOB, ownerName: 'bob', id: 'plan-1', projectId: 'p1', title: 'Ship the login', rev: 2, status: 'draft', updatedAt: 1, reviews: [{ id: 'review-0001', by: MIA, name: 'mia', kind: 'comment', text: 'Looks fine', rev: 2, at: 1 }], body: { title: 'Ship the login', goal: 'Log in', milestones: [{ id: 'm1', title: 'First', goal: 'Start', criteria: ['It works'], tasks: [{ id: 't1', title: 'Write it', goal: 'The form' }] }] } };
const dialogue = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, topic: 'Which store?', mode: 'talk', participants: [{ agent: { runtime: 'claude', label: 'Claude' } }, { agent: { runtime: 'codex', label: 'Codex' } }], turnCap: 10, pauseAt: 10, used: 5, turns: [{ n: 1, by: 0, text: 'Postgres', tokens: 5, at: 1 }, { n: 1, by: 'person', name: 'bob', text: 'Why?', tokens: 0, at: 2 }], status, channel: 'room', createdAt: 1, updatedAt: 1, ...extra });

/** A state with something in every list, so every screen draws what it can. */
const rich = (): Partial<AppState> =>
  ({
    selfId: ME,
    self: { peerId: ME, name: 'me', shares: [], agent: true, host: true },
    isHost: true,
    home: '/h',
    room: 'me’s room',
    status: 'connected',
    invite: 'teamod://roomkey#secret',
    roomOpen: true,
    policy: 'ask',
    levels: { [BOB]: 'ask' },
    remembered: { [KAY]: { name: 'kay', trust: 'trusted' } },
    access: {},
    granted: { [BOB]: { level: 'trusted', reach: 'folder' } },
    trustPrompts: [MIA],
    follow: undefined,
    peers: [
      { peerId: ME, name: 'me', shares: [], agent: true, host: true },
      { peerId: BOB, name: 'bob', shares: [{ name: 'docs', writable: false }], agent: true, projects: ['alpha'] },
      { peerId: MIA, name: 'mia', shares: [], agent: false, guest: true },
      { peerId: 'n'.repeat(32), name: 'nia', shares: [], agent: true },
    ],
    guests: { [MIA]: { peerId: MIA, name: 'mia', projects: [], room: false, can: 'watch' } },
    knocks: [{ peerId: 'n'.repeat(32), linkId: 'link0001', ts: 1 }],
    links: [{ id: 'link0001', scope: 'room', label: 'everything', can: 'prompt', knock: true, singleUse: true, createdAt: 1, used: 0 }],
    offers: [{ owner: BOB, name: 'notes', writable: false }],
    myShares: [{ name: 'docs', root: '/h/docs', private: true, allowed: [BOB], writable: true }],
    friendFolders: [{ owner: BOB, ownerName: 'bob', name: 'pics', label: 'pics', writable: false, since: 1 }],
    shared: [
      { owner: BOB, id: 'w9', name: 'their-work', project: 'beta', branch: 'b', role: 'contribute', share: 'ws-w9', via: 'mesh', projectId: 'pb', earlier: true },
      { owner: BOB, id: 'w8', name: 'room-work', project: 'gamma', role: 'view', share: 'ws-w8' },
    ],
    sharedProjects: [{ owner: BOB, ownerName: 'bob', id: 'pb', name: 'beta', role: 'contribute', worktrees: [{ id: 'w9', name: 'their-work', branch: 'b' }], members: [{ peerId: MIA, name: 'mia', role: 'view' }], updatedAt: 1, copy: { state: 'failed', error: 'No room' } }],
    projectShares: { p1: { [BOB]: { role: 'contribute' } } },
    members: { w1: { [BOB]: 'view' } },
    roster: { w9: [{ peerId: MIA, role: 'view' }] },
    forks: { w9: { state: 'failed', error: 'Nope' } },
    delivery: {},
    projects: [{ id: 'p1', name: 'alpha', root: '/r/alpha', base: 'main', workspaces: [worktree] }],
    browser: { at: { owner: BOB, share: 'pics', path: '' }, loading: false, cursor: 0, rows: [{ label: '..', dir: true, target: 'up' }, { label: 'sub', dir: true, target: { owner: BOB, share: 'pics', path: 'sub' } }, { label: 'a.txt', dir: false, target: { owner: BOB, share: 'pics', path: 'a.txt' }, size: 10 }] },
    log: [
      { id: 'c1', type: 'chat', channel: 'ws:w9', from: BOB, name: 'bob', text: 'Hello', ts: 1, byAgent: false },
      { id: 's1', type: 'system', channel: 'ws:w9', text: 'Started', ts: 2, level: 'info', said: { from: BOB, name: 'bob', text: 'Earlier words', byAgent: false, ts: 1 } },
      { id: 'a1', type: 'agent', channel: 'ws:w9', subagents: [], requestId: 'q', owner: BOB, ownerName: 'bob', requesterName: 'me', status: 'done', text: 'Done it', steps: ['Read'], ts: 3 },
      { id: 'r1', type: 'chat', channel: 'room', from: BOB, name: 'bob', text: 'In the room', ts: 1, byAgent: false },
      { id: 'sh', type: 'shell', channel: 'room', ts: 2, owner: BOB, ownerName: 'bob', by: 'you', command: 'npm test', status: 'done', output: 'ok' },
    ],
    network: {
      enabled: true,
      self: { peerId: ME, name: 'me', presence: online, appearOffline: false, avatar: PIC },
      friends: [friend(BOB, 'bob', { unread: 2, avatar: PIC, teamod: { version: '1.2.0', can: [] }, last: message('last0001', DM, 'latest words') }), friend(KAY, 'kay', { online: false, via: 'relay' })],
      groups: [
        { id: GROUP, name: 'launch', admin: true, active: true, unread: 1, createdAt: 1, members: [member(ME, 'me', { self: true, admin: true }), member(BOB, 'bob'), member(MIA, 'mia', { admin: true })], requests: [{ peerId: KAY, name: 'kay', ts: 1 }] },
        { id: MAIN, name: 'Everyone', admin: true, active: true, unread: 0, createdAt: 1, members: [member(ME, 'me', { self: true, admin: true })], requests: [] },
        { id: LEFT, name: 'old', admin: false, active: false, unread: 0, createdAt: 1, members: [], requests: [] },
      ],
      invitations: [invitation, groupInvite],
      pendingJoins: [{ groupId: 'c'.repeat(32), name: 'waiting room', since: 1 }],
      offers: [{ peerId: 'o'.repeat(32), name: 'oli', dir: 'in', at: 1, expiresAt: Date.now() + 1000 }],
      main: MAIN,
      files: { [SHA]: { state: 'here', path: '/h/.teamod/files/a.png', size: 1000 } },
      live: { [DM]: [{ peerId: BOB, name: 'bob', for: 'x', since: Date.now() }] },
      messages: {
        [DM]: [
          message('dm000001', DM, 'From bob', { files: [{ sha: SHA, name: 'a.png', size: 1000, image: true }], ask: { to: [ME] } }),
          message('dm000002', DM, 'Mine', { from: ME, name: 'me', mine: true, status: 'expired', edited: 2 }),
          message('dm000003', DM, 'Answer', { claude: { for: 'dm000002', request: { ask: 'Send the wallpaper', needs: ['files'] } } }),
          message('dm000004', DM, '', { status: 'locked' }),
        ],
        [CHANNEL]: [message('gm000001', CHANNEL, 'In the channel')],
      },
    },
    gateway: {
      enabled: true,
      note: 'the API',
      capabilities: { ...DEFAULT_CAPABILITIES, folders: ['/h/shared'] },
      askFreely: [KAY],
      cards: { [BOB]: { note: 'Ask me about the API', trust: 'trusted', offers: ['shell'], projects: ['alpha'], claude: true, at: 1 } },
      rules: [{ id: RULE, peerId: BOB, peerName: 'bob', kind: 'task', needs: ['shell'], decision: 'allow', createdAt: 1 }],
      tasks: [
        task(TASK, { kind: 'run', command: 'npm test', chat: DM, summary: 'tests' }),
        task(SECRET, { kind: 'file', path: '/h/.env', secret: { kind: 'dotenv', label: 'your .env file .env' } }),
        task(SENT, { direction: 'sent', state: 'working', steps: ['Reading'], incoming: { received: 10, total: 20 } }),
        task(CONFIRM, { direction: 'sent', state: 'confirm', conversation: DM }),
        task(ASKS, { direction: 'sent', state: 'working', question: { qid: 'q1', askedAt: 1, questions: [{ question: 'Which store?', header: '', options: [{ label: 'Postgres', description: '' }, { label: 'SQLite', description: '' }], multiSelect: false }] } }),
        task(DONE, { direction: 'sent', state: 'done', result: { status: 'done', summary: 'All done', data: { a: 1 }, files: [{ name: 'shot.png', size: 10, path: '/h/shot.png', image: true }], log: [], problems: ['Off a bit'], valid: false, agent: { runtime: 'codex', label: 'Codex' } } }),
      ],
    },
    team: {
      enabled: true,
      offers: [{ peerId: BOB, name: 'bob', projectId: 'p1', repo: 'acme/api', state: 'invited', at: 1 }, { peerId: KAY, name: 'kay', projectId: 'p1', repo: 'acme/web', state: 'asked', at: 1 }],
      teams: { p1: { projectId: 'p1', repo: 'acme/api', mates: [{ peerId: BOB, name: 'bob', since: 1 }, { peerId: MIA, name: 'mia', since: 1, indirect: true }], invitable: [{ peerId: KAY, name: 'kay' }] } },
      working: { i1: [{ peerId: BOB, name: 'bob', running: true }] },
      waiting: {},
      assigned: [{ issueId: 'i2', key: 'ACME-2', title: 'Do it', projectId: 'p1', byId: BOB, by: 'bob', at: 1 }],
      plans: [plan],
      planShares: { 'plan-2': { planId: 'plan-2', peers: [BOB], reviews: [{ id: 'review-0002', by: BOB, name: 'bob', kind: 'suggest', ops: [{ op: 'update_task', id: 't1', patch: { title: 'New' } }], rev: 1, at: 1 }] } },
      knocks: [{ id: 'knock-001', peerId: BOB, name: 'bob', issueId: 'i1', key: 'ACME-1', title: 'Login', projectId: 'p1', workspaceId: 'w1', worktree: 'add-login', note: 'Let me in', at: 1 }],
      myKnocks: [{ id: 'knock-002', issueId: 'i3', peerId: BOB, name: 'bob', state: 'declined', at: 1 }],
    },
    plans: { enabled: true, style: '', plans: [{ id: 'plan-2', projectId: 'p1', home: 'ws:w1', status: 'draft', draft: { title: 'Mine', goal: '', milestones: [] }, draftRev: 1, autonomy: 'gates', maxParallel: 1, testsAt: 'milestone', paused: false }] },
    board: { issues: [{ id: 'i1', key: 'ACME-1', title: 'Login', projectId: 'p1', status: 'todo' }] },
    dialogues: {
      d1: dialogue('d1', 'proposed'),
      d2: dialogue('d2', 'paused'),
      d3: dialogue('d3', 'running'),
      d4: dialogue('d4', 'ended', { note: 'We agree' }),
    },
  }) as unknown as Partial<AppState>;

/** Every Team route, with what each needs to draw in full. */
const ROUTES: readonly Route[] = [
  { name: 'friends' },
  { name: 'add' },
  { name: 'status' },
  { name: 'friend', params: { id: BOB } },
  { name: 'friend-more', params: { id: BOB } },
  { name: 'network' },
  { name: 'chats' },
  { name: 'conversation', params: { id: DM } },
  { name: 'conversation', params: { id: CHANNEL } },
  { name: 'conversation', params: { id: `group:${LEFT}` } },
  { name: 'chat-ask', params: { id: CHANNEL } },
  { name: 'chat-more', params: { id: DM } },
  { name: 'chat-more', params: { id: CHANNEL } },
  { name: 'message', params: { id: DM, msg: 'dm000002' } },
  { name: 'message', params: { id: DM, msg: 'dm000001' } },
  { name: 'file', params: { id: DM, msg: 'dm000001', sha: SHA } },
  { name: 'channel', params: { id: GROUP } },
  { name: 'channel', params: { id: LEFT } },
  { name: 'member', params: { id: GROUP, peer: BOB } },
  { name: 'add-people', params: { id: GROUP } },
  { name: 'new-channel', params: { with: BOB } },
  { name: 'requests' },
  { name: 'request', params: { id: TASK } },
  { name: 'request', params: { id: SECRET } },
  { name: 'request', params: { id: SENT } },
  { name: 'request', params: { id: CONFIRM } },
  { name: 'request', params: { id: ASKS } },
  { name: 'request', params: { id: DONE } },
  { name: 'request-more', params: { id: TASK } },
  { name: 'ask', params: { to: BOB } },
  { name: 'ask' },
  { name: 'access' },
  { name: 'capability', params: { need: 'shell' } },
  { name: 'rule', params: { id: RULE } },
  { name: 'sharing' },
  { name: 'share-pick' },
  { name: 'share-project', params: { id: 'p1' } },
  { name: 'share-worktree', params: { id: 'w1' } },
  { name: 'handoff', params: { id: 'w1' } },
  { name: 'share-folder' },
  { name: 'shared-project', params: { owner: BOB, id: 'pb' } },
  { name: 'shared-worktree', params: { owner: BOB, id: 'w9' } },
  { name: 'shared-more', params: { owner: BOB, id: 'w9' } },
  { name: 'shared-scratch', params: { owner: BOB, id: 'w9' } },
  { name: 'shared-file', params: { owner: BOB, share: 'ws-w9', path: '.context/a.txt' } },
  { name: 'folder' },
  { name: 'room' },
  { name: 'room-more' },
  { name: 'room-chat' },
  { name: 'room-invite' },
  { name: 'guest', params: { id: MIA } },
  { name: 'room-person', params: { id: BOB } },
  { name: 'invite-person', params: { id: BOB } },
  { name: 'remote-worktree', params: { id: BOB } },
  { name: 'boards' },
  { name: 'team-project', params: { id: 'p1' } },
  { name: 'team-plan', params: { owner: BOB, id: 'plan-1' } },
  { name: 'team-plan', params: { owner: BOB, id: 'plan-1', task: 't1' } },
  { name: 'plan-reviews', params: { id: 'plan-2' } },
  { name: 'dialogues' },
  { name: 'dialogue', params: { id: 'd1' } },
  { name: 'dialogue', params: { id: 'd2' } },
  { name: 'dialogue', params: { id: 'd3' } },
  { name: 'dialogue', params: { id: 'd4' } },
  { name: 'dialogue-new' },
];

const at = (s: Started, route: Route): Node => {
  s.screens.nav.go('team', route);
  return s.screens.view('team', viewport);
};
const draw = (s: Started): Node => s.screens.view('team', viewport);
const press = (s: Started, key: string, value?: string) => s.screens.press('team', key, value, viewport);
const keysOf = (tree: Node): string[] => flat(tree).flatMap((n) => (n.k === 'button' || n.k === 'input' || n.k === 'select' ? [n.key] : []));
const inputs = (tree: Node, key: string): boolean => flat(tree).some((n) => n.k === 'input' && n.key === key);
const has = (tree: Node, key: string): boolean => keysOf(tree).includes(key);
const noCallsOf = (s: Started, method: string): boolean => !s.calls.some(([m]) => m === method);
const callsOf = (s: Started, method: string): ReadonlyArray<readonly unknown[]> => s.calls.filter(([m]) => m === method).map(([, args]) => args);

/** The arguments the client would send: left-out trailing ones stay left out. */
const sent = (args: readonly unknown[]): unknown[] => {
  const list = [...args];
  while (list.length && list[list.length - 1] === undefined) list.pop();
  return list;
};

describe('every Team route', () => {
  it.each(ROUTES.map((r) => [`${r.name} ${Object.values(r.params ?? {}).map((v) => v.slice(0, 8)).join(' ')}`, r] as const))('draws: %s', (_, route) => {
    const s = start(rich());
    const tree = at(s, route);
    expect(words(tree)).not.toContain('This screen failed');
    expect(labelled(tree, 'Team')).toBeDefined();
    const hotkeys = flat(tree).flatMap((n) => (n.k === 'button' && n.hotkey ? [n.hotkey] : []));
    expect(hotkeys.filter((key) => !/^[a-z0-9]$/.test(key))).toEqual([]);
    expect(new Set(hotkeys).size).toBe(hotkeys.length);
    const colors = flat(tree).flatMap((n) => (n.k === 'text' || n.k === 'button' ? (n.spans ?? []).flatMap((x) => (x.color ? [x.color] : [])) : []));
    expect(colors.filter((c) => !['success', 'error', 'warning', 'claude'].includes(c))).toEqual([]);
    const main = flat(tree).filter((n) => n.k === 'button' && n.primary);
    expect(main.length, 'one main action on a view').toBeLessThanOrEqual(1);
  });

  it('keeps its keys across redraws', () => {
    for (const route of ROUTES) {
      const s = start(rich());
      expect(keysOf(at(s, route))).toEqual(keysOf(draw(s)));
    }
  });

  it('asks the engine only for what a draw needs to read, never to change anything', async () => {
    const reads = new Set(['network.read', 'network.status', 'sharing.scratch', 'files.read']);
    for (const route of ROUTES) {
      const s = start(rich());
      at(s, route);
      await s.settle();
      draw(s);
      expect(s.calls.map(([m]) => m).filter((m) => !reads.has(m)), route.name).toEqual([]);
    }
  });

  it('says so when what a route names is gone', () => {
    for (const route of ROUTES.filter((r) => r.params)) {
      const s = start({ ...rich(), network: { enabled: true, friends: [], groups: [], invitations: [], pendingJoins: [], messages: {} } } as unknown as Partial<AppState>);
      const gone = { ...route, params: Object.fromEntries(Object.keys(route.params ?? {}).map((k) => [k, 'gone'])) };
      expect(words(at(s, gone))).not.toContain('This screen failed');
    }
  });

  it('draws with nothing at all, and with the network off', () => {
    for (const route of ROUTES) expect(words(at(start(), route))).not.toContain('This screen failed');
  });
});

/** Press everything: what reaches the engine must be what the API takes. */
describe('every press on every route', () => {
  const scratch = (s: Started): void => {
    s.answers.set('sharing.scratch', () => ({ root: '', dir: '', files: [{ path: '.context/a.txt', size: 3, mtime: 1 }] }));
    s.answers.set('files.read', () => ({ content: 'hello', truncated: false }));
    s.answers.set('network.status', () => ({ enabled: true, peerId: ME, address: 'addr' }));
  };
  const skip = (key: string): boolean => key.startsWith('screen:') || key.startsWith('place:') || key === 'back';
  const valueFor = (node: Node): string | undefined => (node.k === 'select' ? node.options[0]?.value : node.k === 'input' ? '~/some words' : undefined);
  const seen = new Set<string>();
  const check = (s: Started, label: string): void => {
    for (const [method, args] of s.calls) {
      seen.add(method);
      const schema = (API as Record<string, { args: { safeParse: (x: unknown) => { success: boolean; error?: unknown } } } | undefined>)[method];
      expect(schema, `${label}: ${method} is an API method`).toBeDefined();
      const parsed = schema?.args.safeParse(sent(args));
      expect(parsed?.success, `${label}: ${method}(${JSON.stringify(sent(args))})`).toBe(true);
    }
  };

  it.each(ROUTES.map((r) => [`${r.name} ${Object.values(r.params ?? {}).map((v) => v.slice(0, 8)).join(' ')}`, r] as const))('%s', async (_, route) => {
    const first = start(rich());
    scratch(first);
    at(first, route);
    await first.settle();
    const controls = flat(draw(first)).filter((n): n is Extract<Node, { key: string }> => (n.k === 'button' || n.k === 'input' || n.k === 'select') && !skip(n.key));
    for (const control of controls) {
      const s = start(rich());
      scratch(s);
      at(s, route);
      await s.settle();
      const pressed = await press(s, control.key, valueFor(control));
      await s.settle();
      expect(pressed.error === 'That is no longer there.', control.key).toBe(false);
      expect(pressed.error ?? '', control.key).not.toMatch(/Cannot read|is not a function|is not iterable|undefined/);
      check(s, control.key);
      // What the press opened or asks next (Always, a confirmation, a field): press that too.
      const after = flat(draw(s)).filter((n): n is Extract<Node, { key: string }> => (n.k === 'button' || n.k === 'input' || n.k === 'select') && !skip(n.key));
      for (const next of after.filter((n) => !controls.some((c) => c.key === n.key)).slice(0, 12)) {
        const then = await press(s, next.key, valueFor(next));
        expect(then.error ?? '', `${control.key} then ${next.key}`).not.toMatch(/Cannot read|is not a function|is not iterable|undefined/);
        await s.settle();
        check(s, `${control.key} then ${next.key}`);
      }
    }
  }, 60_000);

  it('between them reach nearly every method of the screen', () => {
    expect(seen.size).toBeGreaterThan(85);
  });
});

describe('the network', () => {
  const off = { network: { enabled: false, friends: [], groups: [], invitations: [], pendingJoins: [], messages: {} } } as unknown as Partial<AppState>;

  it('stays off until the person presses Turn On', async () => {
    for (const route of ROUTES) {
      const s = start(off);
      at(s, route);
      await s.settle();
      draw(s);
      expect(noCallsOf(s, 'network.setEnabled'), route.name).toBe(true);
    }
    const s = start(off);
    const tree = draw(s);
    expect(words(tree)).toContain('stays off until you turn it on');
    expect(labelled(tree, 'Turn On')).toBeDefined();
    await press(s, 'network:on');
    expect(s.calls).toEqual([['network.setEnabled', [true]]]);
  });

  it('has that one press and no other: the source turns it on in one place', () => {
    const source = readdirSync('src/teamod/panes').filter((f) => f.startsWith('team')).map((f) => readFileSync(`src/teamod/panes/${f}`, 'utf8')).join('\n');
    expect(source.match(/'network\.setEnabled', true/g)).toHaveLength(1);
    for (const route of ROUTES.filter((r) => !['friends', 'add', 'network'].includes(r.name))) {
      expect(labelled(at(start(off), route), 'Turn On'), route.name).toBeUndefined();
    }
  });

  it('turns off only after saying what that means', async () => {
    const s = start(rich());
    at(s, { name: 'network' });
    await press(s, 'network:off');
    expect(noCallsOf(s, 'network.setEnabled')).toBe(true);
    await press(s, 'network:off:yes');
    expect(callsOf(s, 'network.setEnabled')).toEqual([[false]]);
  });

  it('says your status, and changes it from a press', async () => {
    const s = start(rich());
    expect(words(draw(s))).toContain('me');
    at(s, { name: 'status' });
    await press(s, 'status:away');
    expect(callsOf(s, 'network.presence.set')).toEqual([[{ state: 'away' }]]);
    await press(s, 'status:note', 'at lunch');
    expect(callsOf(s, 'network.presence.set').at(-1)).toEqual([{ state: 'online', note: 'at lunch' }]);
  });
});

describe('adding a teammate', () => {
  const none = (): Partial<AppState> => {
    const state = rich();
    return { ...state, network: { ...(state.network as AppState['network']), invitations: [] } };
  };

  it('makes an invitation, and shows its link and code to copy', async () => {
    const s = start(none());
    at(s, { name: 'friends' });
    await press(s, 'add');
    await press(s, 'invite:create');
    expect(callsOf(s, 'network.friends.invite')).toEqual([[]]);

    const shown = start(rich());
    const tree = at(shown, { name: 'add' });
    expect(words(tree)).toContain(invitation.code);
    expect(words(tree)).toContain(invitation.link);
    expect(await press(shown, 'invite:copy-link')).toEqual({ ok: true, copy: invitation.link, toast: 'Copied the link' });
    expect(await press(shown, 'invite:copy-code')).toEqual({ ok: true, copy: invitation.code, toast: 'Copied the code' });
    await press(shown, 'invite:cancel');
    expect(callsOf(shown, 'network.friends.cancelInvite')).toEqual([[invitation.id]]);
  });

  it('takes a link or a code someone pasted, and says who it was', async () => {
    const s = start(rich());
    s.answers.set('network.friends.accept', () => ({ kind: 'friend', peerId: KAY, name: 'kay' }));
    at(s, { name: 'add' });
    await press(s, 'invite:accept', '  K7QM-4XPA-R2TD ');
    expect(callsOf(s, 'network.friends.accept')).toEqual([['K7QM-4XPA-R2TD']]);
    expect(words(draw(s))).toContain('You and kay are teammates now.');
    await press(s, 'accepted:open');
    expect(words(draw(s))).toContain('kay');
  });

  it('takes a channel’s link as a join, and says it waits for an admin', async () => {
    const s = start(rich());
    s.answers.set('network.groups.join', () => ({ kind: 'group', groupId: GROUP, name: 'launch', status: 'waiting' }));
    at(s, { name: 'add' });
    await press(s, 'invite:accept', `teamod://join#${'y'.repeat(22)}`);
    expect(s.calls.filter(([m]) => m === 'network.friends.accept')).toEqual([]);
    expect(words(draw(s))).toContain('An admin lets you in.');
  });

  it('says what went wrong with an invitation in words', async () => {
    const s = start(rich());
    s.answers.set('network.friends.accept', () => {
      throw new Error('Nobody is waiting on that code');
    });
    at(s, { name: 'add' });
    await press(s, 'invite:accept', 'K7QM-4XPA-R2TD');
    expect(words(draw(s))).toContain('expired or was already used');
  });

  it('accepts or turns down someone’s request to be teammates', async () => {
    const s = start(rich());
    await press(s, `offer:${'o'.repeat(32)}:yes`);
    await press(s, `offer:${'o'.repeat(32)}:no`);
    expect(callsOf(s, 'network.friends.answerOffer')).toEqual([['o'.repeat(32), true], ['o'.repeat(32), false]]);
  });
});

describe('a teammate’s card', () => {
  it('changes trust only from a press, and full trust only once it’s said what it means', async () => {
    const s = start(rich());
    const tree = at(s, { name: 'friend', params: { id: BOB } });
    expect(noCallsOf(s, 'people.setTrust')).toBe(true);
    expect(words(tree)).toContain('Trust');
    await press(s, `friend:${BOB}:trust:trusted`);
    expect(callsOf(s, 'people.setTrust')).toEqual([[BOB, 'trusted']]);
    await press(s, `friend:${BOB}:trust:full`);
    expect(callsOf(s, 'people.setTrust')).toHaveLength(1);
    expect(words(draw(s))).toContain('Anything on this computer');
    await press(s, `friend:${BOB}:trust:full-yes`);
    expect(callsOf(s, 'people.setTrust').at(-1)).toEqual([BOB, 'full']);
  });

  it('shows what their agent can do here and your rules for them', async () => {
    const s = start(rich());
    const tree = words(at(s, { name: 'friend', params: { id: BOB } }));
    expect(tree).toContain('Run commands: Ask me');
    expect(tree).toContain('Requests to your agent');
    await press(s, `rule:${RULE}`);
    await press(s, `rule:${RULE}:decline`);
    expect(callsOf(s, 'gateway.saveRule')[0]?.[0]).toMatchObject({ id: RULE, peerId: BOB, decision: 'decline' });
    await press(s, `rule:${RULE}:delete`);
    expect(noCallsOf(s, 'gateway.removeRule')).toBe(true);
    await press(s, `rule:${RULE}:delete:yes`);
    expect(callsOf(s, 'gateway.removeRule')).toEqual([[RULE]]);
  });

  it('removes a teammate behind More, after saying what goes', async () => {
    const s = start(rich());
    expect(has(at(s, { name: 'friend', params: { id: BOB } }), 'friend:remove')).toBe(false);
    await press(s, 'friend:more');
    await press(s, 'friend:remove');
    expect(noCallsOf(s, 'network.friends.remove')).toBe(true);
    expect(words(draw(s))).toContain('removed from this computer');
    await press(s, 'friend:remove:yes');
    expect(callsOf(s, 'network.friends.remove')).toEqual([[BOB]]);
  });

  it('sets capabilities by trust level, from a press', async () => {
    const s = start(rich());
    at(s, { name: 'access' });
    await press(s, 'capability:shell');
    await press(s, 'capability:shell:trusted:allow');
    expect(callsOf(s, 'gateway.setCapabilities')).toEqual([[{ levels: { shell: { ask: 'ask', trusted: 'allow', full: 'allow' } } }]]);
    expect(has(draw(s), 'capability:shell:ask:allow'), '"Ask me each time" has no Allow').toBe(false);
  });
});

describe('a request', () => {
  const answer = { scope: 'this', command: 'this', expiry: 'never' };

  it('is opened by the engine’s own idea of Requests', () => {
    expect(routeOfView({ kind: 'requests' })).toEqual({ screen: 'team', name: 'requests' });
    const s = start(rich());
    const tree = words(at(s, { name: 'requests' }));
    expect(tree).toContain('Waiting for you');
    expect(tree).toContain('$ npm test');
  });

  it('is allowed by a press', async () => {
    const s = start(rich());
    const tree = at(s, { name: 'request', params: { id: TASK } });
    expect(words(tree)).toContain('npm test');
    expect(noCallsOf(s, 'gateway.decide')).toBe(true);
    await press(s, `decide:${TASK}:yes`);
    expect(callsOf(s, 'gateway.decide')).toEqual([[TASK, { answer: 'yes', ...answer }]]);
  });

  it('is declined by a press, with or without a reason', async () => {
    const s = start(rich());
    at(s, { name: 'request', params: { id: TASK } });
    await press(s, `decide:${TASK}:no`);
    expect(callsOf(s, 'gateway.decide')).toEqual([[TASK, { answer: 'no', ...answer }]]);
    await press(s, `request:${TASK}:more`);
    await press(s, `decide:${TASK}:reason`, 'Not today');
    expect(callsOf(s, 'gateway.decide').at(-1)).toEqual([TASK, { answer: 'no', ...answer, reason: 'Not today' }]);
  });

  it('is allowed always only after saying the rule it writes', async () => {
    const s = start(rich());
    at(s, { name: 'request', params: { id: TASK } });
    await press(s, `decide:${TASK}:always`);
    expect(noCallsOf(s, 'gateway.decide')).toBe(true);
    expect(words(draw(s))).toContain('run without asking');
    await press(s, `always:${TASK}:week`);
    await press(s, `decide:${TASK}:always-yes`);
    expect(callsOf(s, 'gateway.decide')).toEqual([[TASK, { answer: 'always', scope: 'this', command: 'this', expiry: 'week' }]]);
  });

  it('never offers Always for a secret, and says it’s one', async () => {
    const s = start(rich());
    const tree = at(s, { name: 'request', params: { id: SECRET } });
    expect(has(tree, `decide:${SECRET}:always`)).toBe(false);
    expect(labelled(tree, 'Allow Once')).toBeDefined();
    expect(words(tree)).toContain('only you can allow it');
    await press(s, `request:${SECRET}:more`);
    expect(has(draw(s), `decide:${SECRET}:trust`), 'trust never covers a secret').toBe(false);
  });

  it('answers “Ask their agent?”: Ask, Always, Not Now, or reworded', async () => {
    const s = start(rich());
    at(s, { name: 'request', params: { id: CONFIRM } });
    await press(s, `confirm:${CONFIRM}:yes`);
    await press(s, `confirm:${CONFIRM}:always`);
    await press(s, `confirm:${CONFIRM}:no`);
    await press(s, `confirm:${CONFIRM}:edit`);
    await press(s, `confirm:${CONFIRM}:words`, 'Run only the unit tests');
    expect(callsOf(s, 'gateway.confirm')).toEqual([[CONFIRM, true], [CONFIRM, true, '', true], [CONFIRM, false], [CONFIRM, true, 'Run only the unit tests']]);
  });

  it('answers their agent’s question, or lets them decide', async () => {
    const s = start(rich());
    at(s, { name: 'request', params: { id: ASKS } });
    await press(s, `question:${ASKS}:q1:0:1`);
    await press(s, `question:${ASKS}:skip`);
    expect(callsOf(s, 'gateway.answer')).toEqual([[ASKS, ['SQLite']], [ASKS, 'skip']]);
  });

  it('cancels what’s going, and removes what’s over', async () => {
    const s = start(rich());
    at(s, { name: 'request', params: { id: SENT } });
    await press(s, `request:${SENT}:stop`);
    expect(callsOf(s, 'gateway.cancel')).toEqual([[SENT]]);
    at(s, { name: 'request', params: { id: DONE } });
    await press(s, `request:${DONE}:forget`);
    await press(s, `request:${DONE}:forget:yes`);
    expect(callsOf(s, 'gateway.forget')).toEqual([[DONE]]);
  });

  it('asks someone’s agent, and saves your note, from a field', async () => {
    const s = start(rich());
    s.answers.set('gateway.ask', () => ({ id: SENT }));
    at(s, { name: 'ask', params: { to: BOB } });
    await press(s, `ask:${BOB}:words`, 'Run the tests');
    expect(callsOf(s, 'gateway.ask')).toEqual([[BOB, 'Run the tests']]);
    expect(words(draw(s))).toContain('To bob’s agent');
    at(s, { name: 'access' });
    await press(s, 'access:note', 'design reviews');
    expect(callsOf(s, 'gateway.setNote')).toEqual([['design reviews']]);
  });

  it('shows a result’s words and data, its picture only when asked', async () => {
    const png = 'iVBORw0KGgo=';
    const s = start(rich());
    s.answers.set('gateway.image', () => `data:image/png;base64,${png}`);
    const tree = at(s, { name: 'request', params: { id: DONE } });
    expect(words(tree)).toContain('All done');
    expect(words(tree)).toContain('"a": 1');
    expect(noCallsOf(s, 'gateway.image')).toBe(true);
    await press(s, `task:${DONE}:picture:0`);
    draw(s);
    await s.settle();
    expect(flat(draw(s)).find((n) => n.k === 'image')).toMatchObject({ png });
  });
});

describe('a conversation', () => {
  it('is what the engine navigates to, for a direct message or a channel', () => {
    expect(routeOfView({ kind: 'conversation', id: DM })).toEqual({ screen: 'team', name: 'conversation', params: { id: DM } });
    const s = start(rich());
    expect(words(at(s, { name: 'conversation', params: { id: DM } }))).toContain('From bob');
    expect(words(at(s, { name: 'conversation', params: { id: CHANNEL } }))).toContain('In the channel');
  });

  it('sends what you wrote: plain words as words, files or an asked agent with them', async () => {
    const s = start(rich());
    at(s, { name: 'conversation', params: { id: DM } });
    await press(s, `chat:${DM}:box`, ' Hello there ');
    expect(callsOf(s, 'network.dm.send')).toEqual([[BOB, 'Hello there']]);

    at(s, { name: 'conversation', params: { id: CHANNEL } });
    await press(s, `chat:${CHANNEL}:box`, 'Hi all');
    expect(callsOf(s, 'network.groups.send')).toEqual([[GROUP, 'Hi all']]);

    const file = { sha: SHA, name: 'a.txt', size: 3 };
    s.answers.set('network.files.add', () => [file]);
    await press(s, `chat:${CHANNEL}:attach`);
    await press(s, `chat:${CHANNEL}:path`, '~/a.txt');
    expect(callsOf(s, 'network.files.add')).toEqual([[['/h/a.txt']]]);
    expect(words(draw(s))).toContain('Attached: a.txt');
    await press(s, `chat:${CHANNEL}:ask`);
    await press(s, 'ask:all');
    await press(s, `chat:${CHANNEL}:box`, 'Look at this');
    expect(callsOf(s, 'network.post')).toEqual([[CHANNEL, { text: 'Look at this', files: [file], ask: 'all' }]]);
    expect(words(draw(s))).not.toContain('Attached: a.txt');
  });

  it('sends nothing for empty words', async () => {
    const s = start(rich());
    at(s, { name: 'conversation', params: { id: DM } });
    await press(s, `chat:${DM}:box`, '   ');
    expect(s.calls.filter(([m]) => m.startsWith('network.dm') || m === 'network.post')).toEqual([]);
  });

  it('reads what’s shown, once per message', async () => {
    const s = start(rich());
    at(s, { name: 'conversation', params: { id: DM } });
    draw(s);
    await s.settle();
    draw(s);
    expect(callsOf(s, 'network.read')).toEqual([[DM]]);
  });

  it('has your own message edited, deleted or sent again; only yours, and only a direct one', async () => {
    const s = start(rich());
    const mine = at(s, { name: 'message', params: { id: DM, msg: 'dm000002' } });
    expect(has(mine, 'message:dm000002:edit')).toBe(true);
    await press(s, 'message:dm000002:edit');
    await press(s, 'message:dm000002:words', 'Changed');
    expect(callsOf(s, 'network.messages.edit')).toEqual([[DM, 'dm000002', 'Changed']]);
    await press(s, 'message:dm000002:again');
    expect(callsOf(s, 'network.dm.send')).toEqual([[BOB, 'Mine']]);
    await press(s, 'message:dm000002:delete-all');
    await press(s, 'message:dm000002:delete-all:yes');
    expect(callsOf(s, 'network.messages.delete')).toEqual([[DM, 'dm000002', { everyone: true }]]);

    const theirs = at(s, { name: 'message', params: { id: DM, msg: 'dm000001' } });
    expect(has(theirs, 'message:dm000001:edit')).toBe(false);
    expect(has(theirs, 'message:dm000001:delete-all')).toBe(false);
    const inChannel = at(s, { name: 'message', params: { id: CHANNEL, msg: 'gm000001' } });
    expect(has(inChannel, 'message:gm000001:delete')).toBe(false);
  });

  it('downloads a file, then opens, reveals and saves it from presses', async () => {
    const state = rich();
    const s = start({ ...state, network: { ...(state.network as AppState['network']), files: {} } });
    const tree = at(s, { name: 'file', params: { id: DM, msg: 'dm000001', sha: SHA } });
    expect(labelled(tree, 'Open')).toBeUndefined();
    await press(s, `file:${SHA}:download`);
    expect(callsOf(s, 'network.files.download')).toEqual([[SHA, DM]]);
    s.set({ network: { ...(state.network as AppState['network']), files: { [SHA]: { state: 'coming', received: 10, size: 1000 } } } });
    await press(s, `file:${SHA}:cancel`);
    expect(callsOf(s, 'network.files.cancel')).toEqual([[SHA]]);

    const here = start(rich());
    here.answers.set('network.files.saveTo', () => '/h/a.png');
    at(here, { name: 'file', params: { id: DM, msg: 'dm000001', sha: SHA } });
    expect(noCallsOf(here, 'network.files.open')).toBe(true);
    await press(here, `file:${SHA}:open`);
    await press(here, `file:${SHA}:reveal`);
    await press(here, `file:${SHA}:save`);
    expect(await press(here, `file:${SHA}:target`, '~/a.png')).toEqual({ ok: true, toast: 'Saved to /h/a.png' });
    expect(callsOf(here, 'network.files.open')).toEqual([[SHA]]);
    expect(callsOf(here, 'network.files.reveal')).toEqual([[SHA]]);
    expect(callsOf(here, 'network.files.saveTo')).toEqual([[SHA, '/h/a.png']]);
  });

  it('gets older messages from the history once the state runs out', async () => {
    const many = Array.from({ length: 200 }, (_, i) => message(`dm${String(i).padStart(6, '0')}`, DM, `message ${i}`, { ts: 2000 + i }));
    const state = rich();
    const s = start({ ...state, network: { ...(state.network as AppState['network']), messages: { [DM]: many } } } as unknown as Partial<AppState>);
    s.answers.set('network.dm.history', () => [message('old00001', DM, 'older words', { ts: 5 })]);
    at(s, { name: 'conversation', params: { id: DM } });
    for (let i = 0; i < 6; i++) await press(s, 'earlier');
    expect(noCallsOf(s, 'network.dm.history')).toBe(true);
    await press(s, 'earlier');
    expect(callsOf(s, 'network.dm.history')).toEqual([[BOB, { before: 2000, limit: 100 }]]);
    expect(words(draw(s))).toContain('older words');
  });
});

describe('what a teammate wrote', () => {
  const nasty = [
    'Open [this](file:///Users/me/.ssh/id_rsa)',
    '[nested [one]](file:///etc/passwd)',
    '![pic](file:///etc/passwd) and ![web](https://evil.example/x.png)',
    'See <file:///etc/passwd> or <teamod://add#abc>',
    '[ref][1]\n\n[1]: file:///etc/passwd',
    '<a href="file:///etc/passwd">x</a><img src="https://evil.example/x.png">',
    `Add me: teamod://add#${'z'.repeat(22)} and my key is sk-ant-abcdef123456, cat ~/.ssh/id_rsa`,
  ].join('\n\n');

  const stateWith = (text: string): Partial<AppState> => {
    const state = rich();
    const network = state.network as AppState['network'];
    const gateway = state.gateway as AppState['gateway'];
    const evil = (id: string, extra: Record<string, unknown>) => task(id, { ask: text, summary: text, ...extra });
    return {
      ...state,
      network: { ...network, messages: { ...network.messages, [DM]: [message('dm000001', DM, text, { name: '[bob](file:///x)' })] } },
      gateway: { ...gateway, tasks: [evil(TASK, {}), evil(SENT, { direction: 'sent', state: 'done', result: { status: 'done', summary: text, files: [], log: [] } })] },
    } as unknown as Partial<AppState>;
  };

  const expectInert = (tree: Node): void => {
    const nodes = flat(tree);
    expect(nodes.filter((n) => n.k === 'link')).toEqual([]);
    expect(nodes.filter((n) => n.k === 'code' && n.path)).toEqual([]);
    for (const n of nodes) {
      if (n.k !== 'md') continue;
      expect(n.text).not.toMatch(/\]\(\s*<?(?!https?:)/);
      expect(n.text).not.toMatch(/!\[/);
      expect(n.text).not.toMatch(/\[1\]:/);
      expect(n.text).not.toMatch(/<(?:file|teamod):/);
      expect(n.text).not.toMatch(/<(?:a|img)\b/);
    }
  };

  it('is drawn in a chat, as words with no way out', async () => {
    const s = start(stateWith(nasty));
    const tree = at(s, { name: 'conversation', params: { id: DM } });
    await s.settle();
    expectInert(tree);
    expect(words(tree)).toContain('this');
    expect(words(tree)).toContain('sk-ant-abcdef123456');
    expect(s.calls.map(([m]) => m).filter((m) => m !== 'network.read')).toEqual([]);
    expect(noCallsOf(s, 'network.friends.accept')).toBe(true);
  });

  it('gives a message no controls by what it says', () => {
    const plainly = start(stateWith('plain words'));
    const pointed = start(stateWith(nasty));
    expect(keysOf(at(pointed, { name: 'conversation', params: { id: DM } }))).toEqual(keysOf(at(plainly, { name: 'conversation', params: { id: DM } })));
  });

  it('is drawn in a request and its result the same way', () => {
    const s = start(stateWith(nasty));
    expectInert(at(s, { name: 'request', params: { id: TASK } }));
    expectInert(at(s, { name: 'request', params: { id: SENT } }));
    expectInert(at(s, { name: 'requests' }));
  });

  it('never carries a command as anything but words', () => {
    const s = start(rich());
    const tree = at(s, { name: 'request', params: { id: TASK } });
    expect(flat(tree).find((n) => n.k === 'code')).toEqual({ k: 'code', source: '$ npm test' });
  });

  it('survives a message that lists one file twice, or a name that looks like a key', () => {
    const file = { sha: SHA, name: 'a.png', size: 1 };
    const state = rich();
    const network = state.network as AppState['network'];
    const s = start({ ...state, network: { ...network, messages: { [DM]: [message('dm000001', DM, 'twice', { files: [file, file] })] } } } as unknown as Partial<AppState>);
    expect(words(at(s, { name: 'conversation', params: { id: DM } }))).toContain('twice');
  });

  it('can’t reach the terminal: no escape sequence, control character or reversed text is drawn', () => {
    const evil = 'Hi\u001b[2J\u001b]0;owned\u0007 there\u0007\u202egnp.exe\r';
    const state = stateWith(evil);
    const network = state.network as AppState['network'];
    const s = start({
      ...state,
      network: { ...network, friends: [friend(BOB, `bob\u001b[31m\nAllow`, { presence: { state: 'online', note: `\u001b[2Jat lunch` } })], messages: { [DM]: [message('dm000001', DM, evil, { name: 'bo\u001b[1mb', files: [{ sha: SHA, name: 'a\u001b[1m.png', size: 1 }] })] } },
    } as unknown as Partial<AppState>);
    const routes: readonly Route[] = [{ name: 'friends' }, { name: 'chats' }, { name: 'conversation', params: { id: DM } }, { name: 'request', params: { id: TASK } }, { name: 'friend', params: { id: BOB } }];
    for (const route of routes) {
      const drawn = JSON.stringify(at(s, route));
      expect(drawn, route.name).not.toMatch(/\\u001b|\\u0007|\\r|\\u202e/i);
      expect(drawn, route.name).not.toMatch(/[\u001b\u0007\u202e]/);
    }
    const tree = at(s, { name: 'conversation', params: { id: DM } });
    expect(words(tree)).toContain('Hi there');
    const row = flat(at(s, { name: 'friends' })).find((n) => n.k === 'button' && n.key === `friend:${BOB}`);
    expect(row && row.k === 'button' && row.spans?.map((x) => x.t).join('')).not.toContain('\n');
  });

  it('can’t make two controls share a key by listing a thing twice', async () => {
    const state = rich();
    const team = state.team as AppState['team'];
    const twice = { ...plan, body: { ...plan.body, milestones: [...plan.body.milestones, ...plan.body.milestones] }, reviews: [...plan.reviews, ...plan.reviews] };
    const knock = team.knocks?.[0];
    const shared = (state.sharedProjects as AppState['sharedProjects'])[0];
    const s = start({
      ...state,
      sharedProjects: [{ ...shared, worktrees: [...(shared?.worktrees ?? []), ...(shared?.worktrees ?? [])] }],
      team: { ...team, plans: [twice], knocks: [knock, knock], assigned: [...team.assigned, ...team.assigned], working: { i1: [{ peerId: BOB, name: 'bob' }, { peerId: BOB, name: 'bob' }] }, planShares: { 'plan-2': { ...team.planShares['plan-2'], reviews: [...(team.planShares['plan-2']?.reviews ?? []), ...(team.planShares['plan-2']?.reviews ?? [])] } } },
    } as unknown as Partial<AppState>);
    s.answers.set('sharing.scratch', () => ({ files: [{ path: 'a', size: 1, mtime: 1 }, { path: 'a', size: 1, mtime: 1 }] }));
    const routes: readonly Route[] = [{ name: 'boards' }, { name: 'team-plan', params: { owner: BOB, id: 'plan-1' } }, { name: 'plan-reviews', params: { id: 'plan-2' } }, { name: 'shared-project', params: { owner: BOB, id: 'pb' } }, { name: 'shared-scratch', params: { owner: BOB, id: 'w9' } }];
    for (const route of routes) {
      expect(words(at(s, route)), route.name).not.toContain('This screen failed');
      await s.settle();
      expect(words(draw(s)), route.name).not.toContain('This screen failed');
    }
  });

  it('keeps a web link, since that can only go to the web', () => {
    expect(peerMd('[docs](https://example.com/a)')).toBe('[docs](https://example.com/a)');
    expect(peerMd('[x](file:///etc/passwd)')).toBe('[x]');
    expect(peerMd('[x](  javascript:alert(1))')).not.toContain('javascript');
  });
});

describe('every list', () => {
  const MANY = 400;
  const peerId = (i: number): string => `p${String(i).padStart(31, '0')}`;
  const rows = (tree: Node, prefix: string, suffix = ''): number => keysOf(tree).filter((k) => k.startsWith(prefix) && k.endsWith(suffix) && !k.endsWith(':more') && !k.endsWith(':above')).length;
  const more = (tree: Node): string | undefined => keysOf(tree).find((k) => k.endsWith(':more') && !k.startsWith('requests:more') && k !== 'friend:more' && k !== 'room:more' && k !== 'shared:more' && !/^chat:.*:more$/.test(k));
  const windows = async (state: Partial<AppState>, route: Route, prefix: string, suffix = ''): Promise<void> => {
    const s = start({ ...rich(), ...state });
    const tree = at(s, route);
    expect(words(tree), route.name).not.toContain('This screen failed');
    const before = rows(tree, prefix, suffix);
    expect(before, `${route.name}: first window of ${prefix}`).toBeGreaterThan(0);
    expect(before, `${route.name}: first window of ${prefix}`).toBeLessThanOrEqual(100);
    const key = more(tree);
    expect(key, `${route.name}: a press for more of ${prefix}`).toBeDefined();
    for (let i = 0; i < 20; i++) {
      const next = more(draw(s));
      if (!next) break;
      await press(s, next);
      expect(rows(draw(s), prefix, suffix), `${route.name}: ${prefix} after More`).toBeLessThanOrEqual(100);
    }
  };
  const network = (patch: Record<string, unknown>): Partial<AppState> => ({ network: { ...(rich().network as AppState['network']), ...patch } }) as unknown as Partial<AppState>;
  const friends = Array.from({ length: MANY }, (_, i) => friend(peerId(i), `friend ${i}`));

  it('holds a window of teammates', () => windows(network({ friends }), { name: 'friends' }, 'friend:p'));
  it('holds a window of direct messages', () => windows(network({ friends }), { name: 'chats' }, 'chat:dm:'));
  it('holds a window of channels', () => windows(network({ groups: Array.from({ length: MANY }, (_, i) => ({ id: i.toString(16).padStart(32, '0'), name: `g ${i}`, admin: false, active: true, unread: 0, createdAt: 1, members: [], requests: [] })) }), { name: 'chats' }, 'chat:group:'));
  it('holds a window of members', () => windows(network({ groups: [{ id: GROUP, name: 'big', admin: true, active: true, unread: 0, createdAt: 1, members: friends.map((f) => member(f.peerId, f.name)), requests: [] }] }), { name: 'channel', params: { id: GROUP } }, 'channel:member:'));
  it('holds a window of join requests', () => windows(network({ groups: [{ id: GROUP, name: 'big', admin: true, active: true, unread: 0, createdAt: 1, members: [], requests: friends.map((f) => ({ peerId: f.peerId, name: f.name, ts: 1 })) }] }), { name: 'channel', params: { id: GROUP } }, 'channel:approve:'));
  it('holds a window of people to add', () => windows(network({ friends }), { name: 'add-people', params: { id: GROUP } }, 'add-people:p'));
  it('holds a window of teammates for a new channel', () => windows(network({ friends }), { name: 'new-channel' }, 'new-channel:p'));
  it('holds a window of requests', () => windows({ gateway: { ...(rich().gateway as AppState['gateway']), tasks: Array.from({ length: MANY }, (_, i) => task(`t_task${String(i).padStart(10, '0')}`, { state: 'working' })) } } as unknown as Partial<AppState>, { name: 'requests' }, 'task:'));
  it('holds a window of what waits for you', () => windows({ gateway: { ...(rich().gateway as AppState['gateway']), tasks: Array.from({ length: MANY }, (_, i) => task(`t_task${String(i).padStart(10, '0')}`)) } } as unknown as Partial<AppState>, { name: 'requests' }, 'waiting:'));
  it('holds a window of rules', () => windows({ gateway: { ...(rich().gateway as AppState['gateway']), rules: Array.from({ length: MANY }, (_, i) => ({ id: `r_rule${i}x`, peerId: BOB, peerName: 'bob', kind: 'task', needs: [], decision: 'allow', createdAt: 1 })) } } as unknown as Partial<AppState>, { name: 'access' }, 'rule:'));
  it('holds a window of a teammate’s rules', () => windows({ gateway: { ...(rich().gateway as AppState['gateway']), rules: Array.from({ length: MANY }, (_, i) => ({ id: `r_rule${i}x`, peerId: BOB, peerName: 'bob', kind: 'task', needs: [], decision: 'allow', createdAt: 1 })) } } as unknown as Partial<AppState>, { name: 'friend', params: { id: BOB } }, 'rule:'));
  it('holds a window of projects shared with you', () => windows({ sharedProjects: Array.from({ length: MANY }, (_, i) => ({ owner: BOB, ownerName: 'bob', id: `p${i}`, name: `p ${i}`, role: 'view', worktrees: [], members: [], updatedAt: 1 })) } as unknown as Partial<AppState>, { name: 'sharing' }, 'shared:'));
  it('holds a window of folders shared with you', () => windows({ friendFolders: Array.from({ length: MANY }, (_, i) => ({ owner: BOB, ownerName: 'bob', name: `f${i}`, label: `f ${i}`, writable: false, since: 1 })) } as unknown as Partial<AppState>, { name: 'sharing' }, 'shared-folder:'));
  it('holds a window of folders you share', () => windows({ myShares: Array.from({ length: MANY }, (_, i) => ({ name: `f${i}`, root: `/f/${i}` })) } as unknown as Partial<AppState>, { name: 'share-folder' }, 'share-folder:stop:'));
  it('holds a window of your projects to share', () => windows({ projects: Array.from({ length: MANY }, (_, i) => ({ id: `p${i}`, name: `p ${i}`, root: `/r/${i}`, base: 'main', workspaces: [] })) } as unknown as Partial<AppState>, { name: 'share-pick' }, 'share:pick:'));
  it('holds a window of who a project is shared with', () => windows(network({ friends }), { name: 'share-project', params: { id: 'p1' } }, 'share:p1:p', ':none'));
  it('holds a window of the room’s people', () => windows({ peers: Array.from({ length: MANY }, (_, i) => ({ peerId: peerId(i), name: `p ${i}`, shares: [], agent: false })) } as unknown as Partial<AppState>, { name: 'room' }, 'room:person:'));
  it('holds a window of guests', () => windows({ guests: Object.fromEntries(Array.from({ length: MANY }, (_, i) => [peerId(i), { peerId: peerId(i), name: `g ${i}`, projects: [], room: false, can: 'watch' }])) } as unknown as Partial<AppState>, { name: 'room' }, 'room:guest:'));
  it('holds a window of people at the door', () => windows({ knocks: Array.from({ length: MANY }, (_, i) => ({ peerId: peerId(i), linkId: 'x', ts: 1 })) } as unknown as Partial<AppState>, { name: 'room' }, 'room:let-in:'));
  it('holds a window of links', () => windows({ links: Array.from({ length: MANY }, (_, i) => ({ id: `link${i}`, scope: 'room', label: 'x', can: 'watch', knock: false, singleUse: false, createdAt: 1, used: 0 })) } as unknown as Partial<AppState>, { name: 'room-invite' }, 'invite:copy:'));
  it('holds a window of team offers', () => windows({ team: { ...(rich().team as AppState['team']), offers: Array.from({ length: MANY }, (_, i) => ({ peerId: peerId(i), name: 'n', projectId: 'p', repo: 'r', state: 'found', at: 1 })) } } as unknown as Partial<AppState>, { name: 'boards' }, 'offer:', ':no'));
  it('holds a window of knocks', () => windows({ team: { ...(rich().team as AppState['team']), knocks: Array.from({ length: MANY }, (_, i) => ({ id: `knock-${String(i).padStart(4, '0')}`, peerId: BOB, name: 'n', issueId: 'i', key: 'K', title: 't', projectId: 'p', workspaceId: 'w', worktree: 'w', at: 1 })) } } as unknown as Partial<AppState>, { name: 'boards' }, 'knock:knock-', ':decline'));
  it('holds a window of teammates on a team', () => windows({ team: { ...(rich().team as AppState['team']), teams: { p1: { projectId: 'p1', repo: 'r', mates: friends.map((f) => ({ peerId: f.peerId, name: f.name, since: 1 })) } } } } as unknown as Partial<AppState>, { name: 'team-project', params: { id: 'p1' } }, 'team:befriend:'));
  it('holds a window of dialogues', () => windows({ dialogues: Object.fromEntries(Array.from({ length: MANY }, (_, i) => [`d${i}`, dialogue(`d${i}`, 'ended')])) } as unknown as Partial<AppState>, { name: 'dialogues' }, 'dialogue:'));
  it('holds a window of the agents who could talk', () => windows(network({ friends }), { name: 'dialogue-new' }, 'dialogue-new:peer:'));
  it('holds a window of a scratch folder', async () => {
    const s = start(rich());
    s.answers.set('sharing.scratch', () => ({ files: Array.from({ length: 300 }, (_, i) => ({ path: `f${i}`, size: 1, mtime: 1 })) }));
    at(s, { name: 'shared-scratch', params: { owner: BOB, id: 'w9' } });
    await s.settle();
    const tree = draw(s);
    expect(rows(tree, 'scratch:f')).toBe(30);
    await press(s, 'scratch:w9:more');
    expect(rows(draw(s), 'scratch:f')).toBe(60);
  });

  it('holds a window of messages, Earlier for the rest, and never more than a hundred', async () => {
    const many = Array.from({ length: 200 }, (_, i) => message(`dm${String(i).padStart(6, '0')}`, DM, `message ${i}`, { ts: 2000 + i }));
    const s = start({ ...rich(), ...network({ messages: { [DM]: many } }) });
    let tree = at(s, { name: 'conversation', params: { id: DM } });
    expect(flat(tree).filter((n) => n.k === 'md')).toHaveLength(30);
    expect(words(tree)).toContain('message 199');
    expect(words(tree)).not.toContain('message 100\n');
    for (let i = 0; i < 6; i++) {
      await press(s, 'earlier');
      tree = draw(s);
      expect(flat(tree).filter((n) => n.k === 'md').length).toBeLessThanOrEqual(100);
    }
    expect(words(tree)).toContain('message 0');
    expect(labelled(tree, `Later (100)`)).toBeDefined();
  });

  it('holds a window of a shared worktree’s conversation', async () => {
    const log = Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, type: 'chat', channel: 'ws:w9', from: BOB, name: 'bob', text: `line ${i}`, ts: i, byAgent: false }));
    const s = start({ ...rich(), log } as unknown as Partial<AppState>);
    const tree = at(s, { name: 'shared-worktree', params: { owner: BOB, id: 'w9' } });
    expect(flat(tree).filter((n) => n.k === 'md')).toHaveLength(30);
    expect(words(tree)).toContain('line 299');
  });
});

describe('sharing and rooms', () => {
  it('shares a project from a press, changed in place, and stops the same way', async () => {
    const s = start(rich());
    at(s, { name: 'share-project', params: { id: 'p1' } });
    await press(s, `share:p1:${KAY}:view`);
    await press(s, `share:p1:${BOB}:none`);
    expect(callsOf(s, 'sharing.shareWithFriend')).toEqual([[{ peerId: KAY, projectId: 'p1', role: 'view' }]]);
    expect(callsOf(s, 'sharing.unshareFriend')).toEqual([[{ peerId: BOB, projectId: 'p1' }]]);
  });

  it('shares one worktree over the room or the network, as each person is reached', async () => {
    const s = start(rich());
    at(s, { name: 'share-worktree', params: { id: 'w1' } });
    await press(s, `share-ws:w1:${BOB}:none`);
    expect(callsOf(s, 'sharing.remove')).toEqual([['w1', BOB]]);
    await press(s, `share-ws:w1:${KAY}:contribute`);
    expect(callsOf(s, 'sharing.shareWithFriend')).toEqual([[{ peerId: KAY, workspaceId: 'w1', projectId: 'p1', role: 'contribute' }]]);
    await press(s, `share-ws:w1:${MIA}:view`);
    expect(callsOf(s, 'sharing.invite')).toEqual([['w1', MIA, 'view']]);
  });

  it('says a teammate’s project is theirs, and leaves it after asking', async () => {
    const s = start(rich());
    expect(words(at(s, { name: 'shared-project', params: { owner: BOB, id: 'pb' } }))).toContain('bob’s');
    await press(s, 'shared:copy');
    expect(callsOf(s, 'sharing.copyProject')).toEqual([[BOB, 'pb']]);
    await press(s, 'shared:leave');
    await press(s, 'shared:leave:yes');
    expect(callsOf(s, 'sharing.leaveProject')).toEqual([[BOB, 'pb']]);
  });

  it('works in a teammate’s worktree: their agent by default, a press for yours', async () => {
    const state = rich();
    const s = start(state);
    const tree = at(s, { name: 'shared-worktree', params: { owner: BOB, id: 'w9' } });
    expect(words(tree)).toContain('Hello');
    await press(s, 'shared:earlier');
    expect(callsOf(s, 'sharing.earlier')).toEqual([[BOB, 'w9']]);
    await press(s, 'shared:w9:box', 'Do it');
    expect(callsOf(s, 'session.submit')).toEqual([['Do it', { channel: 'ws:w9' }]]);

    const projects = (state.sharedProjects as AppState['sharedProjects']).map((p) => ({ ...p, copy: { state: 'ready' as const, projectId: 'p1', path: '/r/alpha' } }));
    const mine = start({ ...state, sharedProjects: projects });
    at(mine, { name: 'shared-worktree', params: { owner: BOB, id: 'w9' } });
    await press(mine, 'shared:runs-on');
    await press(mine, 'shared:w9:box', 'Mine');
    expect(callsOf(mine, 'sharing.runHere')).toEqual([[BOB, 'w9', 'Mine']]);
  });

  it('forks and leaves a teammate’s worktree from More', async () => {
    const s = start(rich());
    at(s, { name: 'shared-more', params: { owner: BOB, id: 'w9' } });
    await press(s, 'shared:fork-name', 'my-copy');
    expect(callsOf(s, 'sharing.fork')).toEqual([[BOB, 'w9', 'my-copy']]);
    await press(s, 'shared:leave-worktree');
    await press(s, 'shared:leave-worktree:yes');
    expect(callsOf(s, 'sharing.leave')).toEqual([[BOB, 'w9']]);
  });

  it('shares a folder with who you picked, and stops', async () => {
    const s = start(rich());
    at(s, { name: 'share-folder' });
    expect((await press(s, 'share-folder:path', '~/notes')).error).toContain('Pick who');
    await press(s, `share-folder:person:${BOB}`);
    await press(s, 'share-folder:path', '~/notes');
    expect(sent(callsOf(s, 'session.shareFolder')[0] ?? [])).toEqual(['/h/notes', false, [BOB]]);
    await press(s, 'share-folder:stop:docs');
    expect(callsOf(s, 'session.unshareFolder')).toEqual([['docs']]);
  });

  it('browses a folder shared with you, one level at a time', async () => {
    const s = start(rich());
    at(s, { name: 'sharing' });
    await press(s, `shared-folder:${BOB}:pics`);
    expect(callsOf(s, 'files.browseTo')).toEqual([[{ owner: BOB, share: 'pics', path: '' }]]);
    expect(words(draw(s))).toContain('a.txt');
    await press(s, 'folder:row:up');
    expect(callsOf(s, 'files.up')).toEqual([[]]);
    await press(s, `folder:row:${BOB}:pics:sub`);
    expect(callsOf(s, 'files.browseTo').at(-1)).toEqual([{ owner: BOB, share: 'pics', path: 'sub' }]);
    s.answers.set('files.read', () => ({ content: 'file words', truncated: false }));
    await press(s, `folder:row:${BOB}:pics:a.txt`);
    draw(s);
    await s.settle();
    expect(words(draw(s))).toContain('file words');
  });

  it('lets people in from a press, and only then', async () => {
    const s = start(rich());
    const door = 'n'.repeat(32);
    at(s, { name: 'room' });
    expect(noCallsOf(s, 'invites.letIn')).toBe(true);
    await press(s, `room:let-in:${door}`);
    await press(s, `room:turn-away:${door}`);
    expect(callsOf(s, 'invites.letIn')).toEqual([[door]]);
    expect(callsOf(s, 'invites.decline')).toEqual([[door]]);
    await press(s, `room:trust:${MIA}:trusted`);
    expect(callsOf(s, 'people.setTrust')).toEqual([[MIA, 'trusted']]);
    await press(s, `room:trust-later:${MIA}`);
    expect(callsOf(s, 'people.dismissPrompt')).toEqual([[MIA]]);
  });

  it('makes, copies and revokes a link', async () => {
    const s = start(rich());
    at(s, { name: 'room-invite' });
    await press(s, 'invite:scope:p1');
    await press(s, 'invite:can:watch');
    await press(s, 'invite:expires');
    await press(s, 'invite:copy');
    expect(callsOf(s, 'invites.create')).toEqual([[{ scope: 'p1', can: 'watch', knock: true, singleUse: true, expiresInMs: 0 }]]);
    await press(s, 'invite:copy:link0001');
    await press(s, 'invite:revoke:link0001');
    expect(callsOf(s, 'invites.copyLink')).toEqual([['link0001']]);
    expect(callsOf(s, 'invites.revoke')).toEqual([['link0001']]);
  });

  it('changes what a guest can do, and removes them', async () => {
    const s = start(rich());
    at(s, { name: 'guest', params: { id: MIA } });
    await press(s, 'guest:can:edit');
    await press(s, 'guest:add:p1');
    await press(s, 'guest:everything');
    expect(callsOf(s, 'invites.change')).toEqual([[MIA, { can: 'edit' }], [MIA, { addProject: 'p1' }], [MIA, { room: true }]]);
    await press(s, 'guest:remove');
    await press(s, 'guest:remove:yes');
    expect(callsOf(s, 'invites.remove')).toEqual([[MIA]]);
  });

  it('does what you do with someone in the room', async () => {
    const s = start(rich());
    at(s, { name: 'room-person', params: { id: BOB } });
    await press(s, 'person:follow');
    expect(callsOf(s, 'session.follow')).toEqual([['bob']]);
    await press(s, 'person:run');
    await press(s, 'person:command', 'npm test');
    expect(callsOf(s, 'session.runOnPeerByHand')).toEqual([['bob', 'npm test', 'room']]);

    const r = start(rich());
    at(r, { name: 'remote-worktree', params: { id: BOB } });
    await press(r, 'remote:plan');
    await press(r, 'remote:task', 'Add a check');
    expect(callsOf(r, 'remote.requestWorktree')).toEqual([[BOB, 'alpha', 'Add a check', true]]);

    const k = start(rich());
    at(k, { name: 'room-person', params: { id: BOB } });
    await press(k, 'person:remove');
    await press(k, 'person:remove:yes');
    expect(callsOf(k, 'session.removePerson')).toEqual([[BOB]]);
  });

  it('holds the room’s switches behind More', async () => {
    const s = start(rich());
    at(s, { name: 'room-more' });
    await press(s, 'room:closed');
    expect(callsOf(s, 'session.setRoomOpen')).toEqual([[false]]);
    await press(s, 'room:copy-link');
    expect(callsOf(s, 'session.copyInvite')).toEqual([[]]);
    await press(s, 'room:new-link');
    await press(s, 'room:new-link:yes');
    expect(callsOf(s, 'session.newInviteLink')).toEqual([[]]);
    await press(s, 'room:clear-all');
    await press(s, 'room:clear-all:yes');
    expect(callsOf(s, 'session.clearChat')).toEqual([['room', { everyone: true }]]);
  });

  it('says when the room can’t be reached, and retries from a press', async () => {
    const s = start({ ...rich(), connection: { state: 'reconnecting', attempt: 2, reason: 'No route' } } as unknown as Partial<AppState>);
    const tree = at(s, { name: 'room' });
    expect(words(tree)).toContain('No route');
    await press(s, 'room:retry');
    expect(callsOf(s, 'session.retryConnection')).toEqual([[]]);
  });

  it('hands a worktree off after saying who takes over', async () => {
    const s = start(rich());
    at(s, { name: 'handoff', params: { id: 'w1' } });
    await press(s, `handoff:w1:${BOB}`);
    expect(noCallsOf(s, 'remote.handoff')).toBe(true);
    await press(s, `handoff:w1:${BOB}:yes`);
    expect(callsOf(s, 'remote.handoff')).toEqual([['w1', BOB]]);
  });
});

describe('team boards', () => {
  it('answers an offer to team up, and takes one back', async () => {
    const s = start(rich());
    at(s, { name: 'boards' });
    await press(s, `offer:${BOB}:p1:yes`);
    await press(s, `offer:${KAY}:p1:no`);
    expect(callsOf(s, 'team.answer')).toEqual([[BOB, 'p1', true], [KAY, 'p1', false]]);
    expect(has(draw(s), `offer:${KAY}:p1:yes`), 'nothing to say yes to: they’re the ones asked').toBe(false);
  });

  it('answers a knock on your worktree, and knocks on theirs', async () => {
    const s = start(rich());
    at(s, { name: 'boards' });
    await press(s, 'knock:knock-001:contribute');
    await press(s, 'knock:knock-001:view');
    await press(s, 'knock:knock-001:decline');
    expect(callsOf(s, 'team.answerKnock')).toEqual([['knock-001', 'contribute'], ['knock-001', 'view'], ['knock-001', 'decline']]);
    await press(s, `knock:i1:${BOB}`);
    expect(callsOf(s, 'team.knock')).toEqual([['i1', BOB]]);
    await press(s, 'knock:mine:knock-002:clear');
    expect(callsOf(s, 'team.cancelKnock')).toEqual([['knock-002']]);
    await press(s, 'assigned:i2');
    expect(callsOf(s, 'team.ackAssignment')).toEqual([['i2']]);
  });

  it('adds someone on the team as a teammate, invites, and leaves', async () => {
    const s = start(rich());
    at(s, { name: 'team-project', params: { id: 'p1' } });
    await press(s, `team:befriend:${MIA}`);
    expect(callsOf(s, 'team.befriend')).toEqual([['p1', MIA]]);
    await press(s, `team:invite:${KAY}`);
    expect(callsOf(s, 'team.answer')).toEqual([[KAY, 'p1', true]]);
    await press(s, 'team:p1:leave');
    await press(s, 'team:p1:leave:yes');
    expect(callsOf(s, 'team.leave')).toEqual([['p1']]);
  });

  it('reviews a plan a teammate shared: approve, comment, suggest a change', async () => {
    const s = start(rich());
    at(s, { name: 'team-plan', params: { owner: BOB, id: 'plan-1' } });
    await press(s, 'team-plan:approve');
    await press(s, 'team-plan:comment', 'Nice');
    expect(callsOf(s, 'team.reviewPlan')).toEqual([[BOB, 'plan-1', { kind: 'approve' }], [BOB, 'plan-1', { kind: 'comment', text: 'Nice' }]]);
    await press(s, 'team-plan:task:t1');
    await press(s, `suggest:${BOB}:plan-1:t1:title`, 'Write it well');
    await press(s, `suggest:${BOB}:plan-1:t1:goal`, 'The form');
    expect(callsOf(s, 'team.reviewPlan').at(-1)).toEqual([BOB, 'plan-1', { kind: 'suggest', ops: [{ op: 'update_task', id: 't1', patch: { title: 'Write it well' } }] }]);
  });

  it('shares a plan of yours, and applies or sets aside what they suggest', async () => {
    const s = start(rich());
    at(s, { name: 'boards' });
    await press(s, 'plan:plan-2:share');
    expect(callsOf(s, 'team.sharePlan')).toEqual([['plan-2', false]]);
    at(s, { name: 'plan-reviews', params: { id: 'plan-2' } });
    await press(s, 'suggestion:review-0002:apply');
    await press(s, 'suggestion:review-0002:dismiss');
    expect(callsOf(s, 'team.applySuggestion')).toEqual([['plan-2', 'review-0002']]);
    expect(callsOf(s, 'team.dismissSuggestion')).toEqual([['plan-2', 'review-0002']]);
  });
});

describe('dialogues', () => {
  it('starts one only from who, how and a topic you gave, proposed for you to confirm', async () => {
    const s = start({ ...rich(), runtimes: [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true }], models: [] } as unknown as Partial<AppState>);
    s.answers.set('dialogues.start', () => dialogue('d1', 'proposed'));
    const tree = at(s, { name: 'dialogue-new' });
    expect(inputs(tree, 'dialogue-new:topic')).toBe(false);
    await press(s, 'dialogue-new:claude:');
    await press(s, 'dialogue-new:codex:');
    await press(s, 'dialogue-new:topic', 'Which store?');
    expect(callsOf(s, 'dialogues.start')).toEqual([[{ channel: 'room', agents: [{ runtime: 'claude', label: 'Claude' }, { runtime: 'codex', label: 'Codex' }], topic: 'Which store?', mode: 'talk' }]]);
    expect(words(draw(s))).toContain('Start when the caps look right');
  });

  it('asks a work dialogue for its worktree', async () => {
    const s = start({ ...rich(), runtimes: [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true }], models: [] } as unknown as Partial<AppState>);
    at(s, { name: 'dialogue-new' });
    await press(s, 'dialogue-new:claude:');
    await press(s, 'dialogue-new:codex:');
    await press(s, 'dialogue-new:mode:work');
    expect(words(draw(s))).toContain('pick it under Where');
    await press(s, 'dialogue-new:where:ws:w1');
    expect(inputs(draw(s), 'dialogue-new:topic')).toBe(true);
  });

  it('starts a proposal with the caps you set, continues and stops', async () => {
    const s = start(rich());
    at(s, { name: 'dialogue', params: { id: 'd1' } });
    await press(s, 'dialogue:d1:turn-cap', '6');
    await press(s, 'dialogue:d1:budget-cap', '20');
    await press(s, 'dialogue:start');
    expect(callsOf(s, 'dialogues.confirm')).toEqual([['d1', { turnCap: 6, budget: 20_000 }]]);
    await press(s, 'dialogue:cancel');
    expect(callsOf(s, 'dialogues.stop')).toEqual([['d1']]);
    at(s, { name: 'dialogue', params: { id: 'd2' } });
    await press(s, 'dialogue:continue');
    expect(callsOf(s, 'dialogues.continue')).toEqual([['d2']]);
    at(s, { name: 'dialogue', params: { id: 'd3' } });
    await press(s, 'dialogue:d3:say', 'Think about cost');
    expect(callsOf(s, 'dialogues.interject')).toEqual([['d3', 'Think about cost']]);
    expect(words(draw(s))).toContain('Postgres');
  });
});

describe('what the Team screen wires', () => {
  const source = readdirSync('src/teamod/panes').filter((f) => f.startsWith('team')).map((f) => readFileSync(`src/teamod/panes/${f}`, 'utf8')).join('\n');
  const coverage = readFileSync('src/teamod/coverage.ts', 'utf8');
  const teams = [...coverage.matchAll(/^ {2}'([\w.]+)': \{ on: 'team'/gm)].map((m) => m[1]!) as Method[];
  /** In the state already, the Mac doesn't call them either; or a pasted image's, the engine's own. */
  const leftOut = ['network.friends.list', 'network.groups.list', 'network.presence.get', 'gateway.list', 'session.serveFolder', 'network.files.addData'];

  it('names every method of the screen, but the few it has no use for', () => {
    expect(teams.length).toBeGreaterThan(100);
    expect(teams.filter((m) => !source.includes(`'${m}'`)).sort()).toEqual([...leftOut].sort());
  });
});
