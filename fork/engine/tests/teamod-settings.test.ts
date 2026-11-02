import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../src/core/store.js';
import type { AppState } from '../src/core/store.js';
import { encodeFailure } from '../src/shared/run-failure.js';
import type { Node } from '../src/teamod/tree.js';
import { type Method, parseArgs } from '../src/ipc/api.js';
import { flat, labelled, start as startScreens, viewport, words } from './teamod-helpers.js';

const project = (id: string, name: string, extra: Record<string, unknown> = {}): AppState['projects'][number] => ({ id, name, root: `/r/${name}`, base: 'origin/main', workspaces: [], ...extra }) as AppState['projects'][number];

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
const buttons = (tree: Node): string[] => flat(tree).flatMap((n) => (n.k === 'button' ? [n.key] : []));
const said = (calls: Array<[string, readonly unknown[]]>, method: string): Array<readonly unknown[]> => calls.filter(([m]) => m === method).map(([, args]) => args);

type Started = ReturnType<typeof start>;
const go = (s: Started, name: string, params?: Record<string, string>): void => s.screens.nav.go('settings', { name, ...(params ? { params } : {}) });
const press = (s: Started, key: string, value?: string): ReturnType<Started['screens']['press']> => s.screens.press('settings', key, value, viewport);
const view = (s: Started): Node => s.screens.view('settings', viewport);

const prefs = initialState('room').prefs;
const runtimes = [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true, models: [{ value: 'gpt-5', label: 'GPT-5', description: '' }] }, { id: 'local', label: 'Local model', available: false, why: 'No local model endpoint is set', state: 'no_endpoint' }] as AppState['runtimes'];

describe('every page of the Settings screen', () => {
  const pages: ReadonlyArray<readonly [string, Record<string, string>?]> = [['home'], ['agent'], ['sign-in'], ['notifications'], ['worktrees'], ['scripts'], ['env'], ['models'], ['endpoint'], ['tools'], ['engine'], ['stop']];

  it.each(pages.map(([name, params]) => ({ name, params })))('$name draws, with each hotkey on one press, and leaves the top row its own', async ({ name, params }) => {
    const s = start({ projects: [project('p1', 'alpha', { scripts: { setup: { command: 'npm i', source: 'yours' } } })], runtimes });
    go(s, name, params);
    view(s);
    await s.settle();
    const tree = view(s);
    expect(words(tree)).not.toContain('This screen failed');
    const keys = hotkeys(tree);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => 'wktolgb'.includes(k)).length).toBe(buttons(tree).includes('back') ? 7 : 6);
    expect(flat(tree).filter((n) => n.k === 'button' && n.primary).length).toBeLessThanOrEqual(1);
  });
});

describe('General', () => {
  it('renames you, and leaves it alone with no name', async () => {
    const s = start({ self: { peerId: 'me', name: 'elad' } as never });
    expect(words(view(s))).toContain('elad');
    await press(s, 'name');
    const box = flat(view(s)).find((n) => n.k === 'input' && n.key === 'name:box');
    expect(box && box.k === 'input' ? box.value : undefined).toBe('elad');
    await press(s, 'name:box', ' kay ');
    expect(said(s.calls, 'session.rename')).toEqual([['kay']]);
    await press(s, 'name');
    await press(s, 'name:box', '  ');
    expect(said(s.calls, 'session.rename')).toEqual([['kay']]);
  });

  it('changes a pref: approvals', async () => {
    const s = start();
    expect(words(view(s))).toContain('Off  Ask before running commands');
    await press(s, 'pref:selfApproval');
    expect(said(s.calls, 'session.setPrefs')).toEqual([[{ selfApproval: 'ask' }]]);
    s.set({ prefs: { ...prefs, selfApproval: 'ask' } });
    expect(words(view(s))).toContain('On   Ask before running commands');
    await press(s, 'pref:selfApproval');
    expect(said(s.calls, 'session.setPrefs').at(-1)).toEqual([{ selfApproval: 'never' }]);
  });

  it('says who friends reach and what they see, by pop-up, and only when it changes', async () => {
    const s = start();
    await press(s, 'pref:chatClaude', 'off');
    await press(s, 'pref:shareUsage', 'everyone');
    await press(s, 'pref:tunnel', 'p2p');
    await press(s, 'pref:friendWorktrees');
    await press(s, 'pref:tunnel', 'auto');
    expect(said(s.calls, 'session.setPrefs')).toEqual([[{ chatClaude: 'off' }], [{ shareUsage: 'everyone' }], [{ tunnel: 'p2p' }], [{ friendWorktrees: 'off' }]]);
  });
});

describe('Agent', () => {
  it('makes another runtime your agent, and Claude back through the model setting', async () => {
    const s = start({ runtimes });
    go(s, 'agent');
    view(s);
    await press(s, 'agent:mine', 'codex:gpt-5');
    expect(said(s.calls, 'session.setPrefs')).toEqual([[{ defaultAgent: { runtime: 'codex', label: 'Codex', model: 'gpt-5' } }]]);
    s.set({ prefs: { ...prefs, defaultAgent: { runtime: 'codex', label: 'Codex', model: 'gpt-5' } } });
    await press(s, 'agent:mine', 'claude:opus');
    expect(said(s.calls, 'session.setPrefs').at(-1)).toEqual([{ defaultAgent: null }]);
    expect(said(s.calls, 'workbench.setModel')).toEqual([[undefined, 'opus']]);
  });

  it('says why an agent can’t be picked, and doesn’t offer it', () => {
    const s = start({ runtimes });
    go(s, 'agent');
    const tree = view(s);
    expect(words(tree)).toContain('No local model endpoint is set');
    const select = flat(tree).find((n) => n.k === 'select' && n.key === 'agent:mine');
    expect(select && select.k === 'select' ? select.options.map((o) => o.value) : []).not.toContain('local:');
  });

  it('offers only the efforts your model takes, and Auto clears it', async () => {
    const s = start({ prefs: { ...prefs, model: 'haiku' }, models: [{ value: 'haiku', label: 'Haiku', description: '', efforts: ['low', 'medium'] }] });
    go(s, 'agent');
    const select = flat(view(s)).find((n) => n.k === 'select' && n.key === 'agent:effort');
    expect(select && select.k === 'select' ? select.options.map((o) => o.value) : []).toEqual(['', 'low', 'medium']);
    await press(s, 'agent:effort', 'low');
    expect(said(s.calls, 'session.setPrefs')).toEqual([[{ effort: 'low' }]]);
    s.set({ prefs: { ...prefs, model: 'haiku', effort: 'low' } });
    await press(s, 'agent:effort', '');
    expect(said(s.calls, 'session.setPrefs').at(-1)).toEqual([{ effort: null }]);
  });

  it('drives how it works in the chat', async () => {
    const s = start({ prefs: { ...prefs, autoCompact: true } });
    go(s, 'agent');
    await press(s, 'pref:subagents', 'compact');
    await press(s, 'pref:contextMeter');
    await press(s, 'pref:autoCompact');
    await press(s, 'pref:autoCompactAt', '90');
    await press(s, 'pref:parallelRuns', '3');
    await press(s, 'pref:chatLimit', '0');
    await press(s, 'pref:scratchFolder');
    expect(said(s.calls, 'session.setPrefs')).toEqual([[{ subagents: 'compact' }], [{ contextMeter: false }], [{ autoCompact: false }], [{ autoCompactAt: 90 }], [{ parallelRuns: 3 }], [{ chatLimit: 0 }], [{ scratchFolder: false }]]);
  });

  it('asks each agent on opening and on request, and signs in the one that needs it', async () => {
    const out = [{ id: 'claude', label: 'Claude', available: false, state: 'signed_out' }, { id: 'codex', label: 'Codex', available: false, state: 'missing' }] as AppState['runtimes'];
    const s = start({ runtimes: out });
    go(s, 'agent');
    view(s);
    await s.settle();
    expect(said(s.calls, 'workbench.checkAgents').length).toBe(1);
    const tree = view(s);
    expect(words(tree)).toContain('Not signed in');
    expect(words(tree)).toContain('npm i -g @openai/codex');
    await press(s, 'agents:claude:sign-in');
    expect(said(s.calls, 'workbench.agentSignIn')).toEqual([['claude']]);
    expect(await press(s, 'agents:codex:install')).toEqual({ ok: true, copy: 'npm i -g @openai/codex', toast: 'Copied: npm i -g @openai/codex' });
    view(s);
    await s.settle();
    await press(s, 'agents:check');
    view(s);
    expect(said(s.calls, 'workbench.checkAgents').length).toBeGreaterThan(1);
  });

  it('signs in and goes on only where a run stopped for it', async () => {
    const run = (status: string, text: string, ts: number): Record<string, unknown> => ({ id: `r${ts}`, type: 'agent', channel: 'ws:w1', subagents: [], requestId: `q${ts}`, owner: 'me', ownerName: 'me', requesterName: 'me', status, text, steps: [], ts });
    const failed = encodeFailure({ kind: 'signed_out', detail: 'Not logged in' });
    const s = start({ selfId: 'me', projects: [project('p1', 'alpha', { workspaces: [{ id: 'w1', name: 'my-work', kind: 'worktree' }] })], terminals: { 'shell:2': 'x' }, log: [run('error', failed, 1)] as never });
    go(s, 'agent');
    await press(s, 'agents:stuck');
    expect(words(view(s))).toContain('my-work');
    await press(s, 'sign-in:ws:w1:console');
    expect(said(s.calls, 'workbench.signInClaude')).toEqual([['shell:3', 'ws:w1', 'console']]);
    s.set({ log: [run('error', failed, 1), run('done', 'Fine now', 2)] as never });
    expect(words(view(s))).toContain('Nothing is waiting for a sign-in');
  });

  it('edits the PR instructions; resetting them asks first', async () => {
    const s = start({ prCustom: true });
    go(s, 'agent');
    expect(words(view(s))).toContain('Customized');
    await press(s, 'pr:edit');
    expect(said(s.calls, 'workbench.editPrPrompt')).toEqual([[]]);
    await press(s, 'pr:reset');
    expect(said(s.calls, 'workbench.resetPrPrompt')).toEqual([]);
    await press(s, 'pr:reset');
    expect(said(s.calls, 'workbench.resetPrPrompt')).toEqual([[]]);
    const built = start({ prCustom: false });
    go(built, 'agent');
    expect(buttons(view(built))).not.toContain('pr:reset');
  });
});

describe('Notifications', () => {
  it('changes one kind, keeping the rest and the Mac’s own sounds as they are', async () => {
    const s = start();
    go(s, 'notifications');
    await press(s, 'notify:pr');
    const [[change]] = said(s.calls, 'session.setPrefs') as [[{ notify: AppState['prefs']['notify'] }]];
    expect(change.notify).toEqual({ ...prefs.notify, pr: false });
    expect(words(view(s))).not.toContain('Sound');
  });

  it('sends a test, and pauses and resumes for a while', async () => {
    const s = start();
    go(s, 'notifications');
    await press(s, 'notify:test');
    expect(said(s.calls, 'session.testNotification')).toEqual([[]]);
    await press(s, 'notify:dnd', 'forever');
    const [[paused]] = said(s.calls, 'session.setPrefs') as [[{ notify: AppState['prefs']['notify'] }]];
    expect(paused.notify.dnd).toEqual({});
    s.set({ prefs: { ...prefs, notify: { ...prefs.notify, dnd: {} } } });
    expect(words(view(s))).toContain('until you turn it off');
    await press(s, 'notify:dnd-off');
    expect((said(s.calls, 'session.setPrefs').at(-1)?.[0] as { notify: AppState['prefs']['notify'] }).notify.dnd).toBeNull();
  });
});

describe('Worktrees', () => {
  it('sets the branch prefix, refusing what git wouldn’t take', async () => {
    const s = start();
    go(s, 'worktrees');
    expect(words(view(s))).toContain('teamod/fix-login');
    await press(s, 'pref:branchPrefix');
    expect((await press(s, 'pref:branchPrefix:box', 'bad prefix')).error).toContain('letters, digits');
    await press(s, 'pref:branchPrefix');
    await press(s, 'pref:branchPrefix:box', 'kay/');
    await press(s, 'pref:branchPrefix');
    await press(s, 'pref:branchPrefix:box', '');
    expect(said(s.calls, 'session.setPrefs')).toEqual([[{ branchPrefix: 'kay/' }], [{ branchPrefix: '' }]]);
  });

  it('switches setup in new worktrees, and picks the shell', async () => {
    const s = start({ shellChoices: [{ path: '/bin/zsh', name: 'zsh', isDefault: true }, { path: '/bin/fish', name: 'fish', isDefault: false }] });
    go(s, 'worktrees');
    await press(s, 'pref:autoSetup');
    await press(s, 'pref:shell', '/bin/fish');
    await press(s, 'pref:shellLogin');
    await press(s, 'pref:shellArgs');
    await press(s, 'pref:shellArgs:box', '--no-rcs -x');
    expect(said(s.calls, 'session.setPrefs')).toEqual([[{ autoSetup: false }], [{ shell: '/bin/fish' }], [{ shellLogin: false }], [{ shellArgs: ['--no-rcs', '-x'] }]]);
    s.set({ prefs: { ...prefs, shell: '/bin/fish' } });
    await press(s, 'pref:shell', '');
    expect(said(s.calls, 'session.setPrefs').at(-1)).toEqual([{ shell: '/bin/zsh' }]);
  });

  it('takes a shell by its path, which must be one', async () => {
    const s = start();
    go(s, 'worktrees');
    await press(s, 'pref:shell', '__other');
    await press(s, 'pref:shell-path');
    expect((await press(s, 'pref:shell-path:box', 'fish')).error).toContain('Start with /');
    await press(s, 'pref:shell-path');
    await press(s, 'pref:shell-path:box', '/opt/fish');
    expect(said(s.calls, 'session.setPrefs')).toEqual([[{ shell: '/opt/fish' }]]);
  });

  it('shares your commands with the team, and only yours are offered', async () => {
    const s = start({ projects: [project('p1', 'alpha', { scripts: { setup: { command: 'npm i', source: 'yours' } } }), project('p2', 'beta', { scripts: { run: { command: 'go run', source: 'teamod.json' } } }), project('p3', 'gamma')] });
    go(s, 'scripts');
    const tree = view(s);
    expect(words(tree)).toContain('npm i');
    expect(words(tree)).toContain('go run');
    expect(words(tree)).not.toContain('gamma');
    expect(buttons(tree)).not.toContain('share:p2');
    await press(s, 'share:p1');
    expect(said(s.calls, 'workbench.shareScripts')).toEqual([['p1']]);
  });

  it('holds a window of many projects', () => {
    const s = start({ projects: Array.from({ length: 100 }, (_, i) => project(`p${i}`, `p${i}`, { scripts: { setup: { command: 'npm i', source: 'yours' } } })) });
    go(s, 'scripts');
    expect(buttons(view(s)).filter((k) => k.startsWith('share:')).length).toBe(30);
  });
});

describe('Environment', () => {
  const SECRET = 's3cret-value-do-not-draw';
  const FILE_SECRET = 'file-secret-do-not-draw';
  const everywhere = (): Record<string, unknown> => ({ vars: [{ key: 'TOKEN', value: SECRET }, { key: 'OTHER', value: 'other-value' }], dotenv: false, dotenvKeys: [], claudeDotenv: false, overridden: { TOKEN: ['alpha'] } });
  const inProject = (): Record<string, unknown> => ({ vars: [{ key: 'OWN', value: 'own-value' }, { key: 'BOTH', value: 'mine' }], dotenv: true, dotenvKeys: ['FROM_FILE', 'BOTH'], dotenvVars: [{ key: 'FROM_FILE', value: FILE_SECRET }, { key: 'BOTH', value: 'theirs' }], dotenvFiles: ['.env'], claudeDotenv: false, newKeysBack: true });
  const asJson = (s: Started): string => JSON.stringify(view(s));

  const opened = async (answer: () => Record<string, unknown>, state: Partial<AppState> = {}): Promise<Started> => {
    const s = start(state);
    s.answers.set('env.get', answer);
    go(s, 'env');
    view(s);
    await s.settle();
    return s;
  };

  it('draws a variable’s name but never its value, until you press Show on that one', async () => {
    const s = await opened(everywhere);
    expect(words(view(s))).toContain('TOKEN');
    expect(asJson(s)).not.toContain(SECRET);
    expect(asJson(s)).not.toContain('other-value');
    await press(s, 'env:show:TOKEN');
    expect(asJson(s)).toContain(SECRET);
    expect(asJson(s)).not.toContain('other-value');
    await press(s, 'env:hide:TOKEN');
    expect(asJson(s)).not.toContain(SECRET);
  });

  it('keeps one value showing at a time, and not on another visit', async () => {
    const s = await opened(everywhere);
    await press(s, 'env:show:TOKEN');
    await press(s, 'env:show:OTHER');
    expect(asJson(s)).toContain('other-value');
    expect(asJson(s)).not.toContain(SECRET);
    await press(s, 'place:agent');
    await press(s, 'place:env');
    expect(asJson(s)).not.toContain('other-value');
  });

  it('hides a value on its own, and a Remove left armed disarms', async () => {
    const s = await opened(everywhere);
    vi.useFakeTimers();
    try {
      await press(s, 'env:show:TOKEN');
      expect(asJson(s)).toContain(SECRET);
      vi.advanceTimersByTime(60_001);
      expect(asJson(s)).not.toContain(SECRET);

      await press(s, 'env:remove:OTHER');
      expect(words(view(s))).toContain('Press Again to Remove');
      vi.advanceTimersByTime(15_001);
      expect(words(view(s))).not.toContain('Press Again to Remove');
      await press(s, 'env:remove:OTHER');
      expect(said(s.calls, 'env.set')).toEqual([]);
      expect(words(view(s))).toContain('Press Again to Remove');
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds no value in what it loaded', async () => {
    const s = await opened(everywhere);
    await press(s, 'env:change:TOKEN');
    const box = flat(view(s)).find((n) => n.k === 'input' && n.key === 'env:value:TOKEN');
    expect(box && box.k === 'input' ? box.value : 'none').toBeUndefined();
    expect(asJson(s)).not.toContain(SECRET);
  });

  it('changes a value, write-only, keeping the others; nothing typed changes nothing', async () => {
    const s = await opened(everywhere);
    await press(s, 'env:change:TOKEN');
    await press(s, 'env:value:TOKEN', '');
    expect(said(s.calls, 'env.set')).toEqual([]);
    await press(s, 'env:change:TOKEN');
    await press(s, 'env:value:TOKEN', 'typed-new-secret');
    expect(said(s.calls, 'env.set')).toEqual([[undefined, [{ key: 'TOKEN', value: 'typed-new-secret' }, { key: 'OTHER', value: 'other-value' }], undefined]]);
    expect(asJson(s)).not.toContain('typed-new-secret');
  });

  it('adds lines like a .env, saying what it skipped and why a name won’t do', async () => {
    const s = await opened(everywhere);
    await press(s, 'env:add');
    await press(s, 'env:new', 'export NEW_ONE="x"\nnot a line\n# a comment');
    expect(said(s.calls, 'env.set')).toEqual([[undefined, [{ key: 'TOKEN', value: SECRET }, { key: 'OTHER', value: 'other-value' }, { key: 'NEW_ONE', value: 'x' }], undefined]]);
    expect(words(view(s))).toContain('1 line skipped');
    expect(asJson(s)).not.toContain('not a line');
    await press(s, 'env:add');
    await press(s, 'env:new', 'nonsense');
    expect(words(view(s))).toContain('aren’t KEY=value');
    expect(said(s.calls, 'env.set').length).toBe(1);
  });

  it('removes a variable only after asking', async () => {
    const s = await opened(everywhere);
    await press(s, 'env:remove:OTHER');
    expect(said(s.calls, 'env.set')).toEqual([]);
    await press(s, 'env:remove:OTHER');
    expect(said(s.calls, 'env.set')).toEqual([[undefined, [{ key: 'TOKEN', value: SECRET }], undefined]]);
  });

  it('says where a name is overridden', async () => {
    const s = await opened(everywhere);
    expect(words(view(s))).toContain('Not used in alpha');
  });

  it('shows a project’s .env beside its own, hidden too; typing over one sets it here', async () => {
    const s = await opened(inProject, { projects: [project('p1', 'alpha')] });
    await press(s, 'env:scope', 'p1');
    view(s);
    await s.settle();
    const tree = words(view(s));
    expect(tree).toContain('FROM_FILE');
    expect(tree).toContain('from the .env');
    expect(tree).toContain('set here, over the .env');
    expect(asJson(s)).not.toContain(FILE_SECRET);
    expect(asJson(s)).not.toContain('own-value');
    await press(s, 'env:show:FROM_FILE');
    expect(asJson(s)).toContain(FILE_SECRET);
    expect(buttons(view(s))).not.toContain('env:remove:FROM_FILE');
    await press(s, 'env:change:FROM_FILE');
    await press(s, 'env:value:FROM_FILE', 'over');
    expect(said(s.calls, 'env.set')).toEqual([['p1', [{ key: 'OWN', value: 'own-value' }, { key: 'BOTH', value: 'mine' }, { key: 'FROM_FILE', value: 'over' }], true]]);
  });

  it('switches a project’s .env, keeps a copy, and its other switches', async () => {
    const s = await opened(inProject, { projects: [project('p1', 'alpha')] });
    s.answers.set('env.importDotenv', () => 1);
    await press(s, 'env:scope', 'p1');
    view(s);
    await s.settle();
    await press(s, 'env:dotenv');
    expect(said(s.calls, 'env.set')).toEqual([['p1', [{ key: 'OWN', value: 'own-value' }, { key: 'BOTH', value: 'mine' }], false]]);
    expect(await press(s, 'env:keep-copy')).toEqual({ ok: true, toast: 'Copied 1 variable' });
    expect(said(s.calls, 'env.importDotenv')).toEqual([['p1']]);
    view(s);
    await s.settle();
    await press(s, 'env:new-keys-back');
    expect(said(s.calls, 'env.newKeysBack')).toEqual([['p1', false]]);
    view(s);
    await s.settle();
    await press(s, 'env:claude-dotenv');
    expect(said(s.calls, 'env.claudeDotenv')).toEqual([['p1', true]]);
  });

  it('tests the database, and says so in words either way', async () => {
    const s = await opened(everywhere);
    s.answers.set('env.testDatabase', () => ({ ok: true, from: 'DATABASE_URL' }));
    await press(s, 'env:test-db');
    expect(said(s.calls, 'env.testDatabase')).toEqual([[]]);
    expect(words(view(s))).toContain('Connected, using DATABASE_URL');
    s.answers.set('env.testDatabase', () => ({ ok: false, message: 'No database set' }));
    await press(s, 'env:test-db');
    expect(words(view(s))).toContain('No database set');
  });

  it('says so when it can’t read them', async () => {
    const s = await opened(() => {
      throw new Error('env.json is broken');
    });
    expect(words(view(s))).toContain('env.json is broken');
  });
});

describe('Local models', () => {
  const endpoints = [{ id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434', hasKey: false, models: [], reachable: false, builtIn: true }, { id: 'work', label: 'Work proxy', baseUrl: 'https://proxy.example.com', hasKey: true, models: ['big'], found: ['big', 'small'], reachable: true }];

  const opened = async (): Promise<Started> => {
    const s = start();
    s.answers.set('env.endpoints', () => endpoints);
    s.answers.set('env.checkEndpoints', () => endpoints);
    go(s, 'models');
    view(s);
    await s.settle();
    return s;
  };

  it('lists them, whether each answers, and looks when it opens and on request', async () => {
    const s = await opened();
    expect(said(s.calls, 'env.checkEndpoints').length).toBe(1);
    const tree = words(view(s));
    expect(tree).toContain('Not running on this computer');
    expect(tree).toContain('1 model: big');
    expect(tree).toContain('key saved');
    await press(s, 'endpoint:check');
    expect(said(s.calls, 'env.checkEndpoints').length).toBe(2);
  });

  it('adds one a field at a time; the key is write-only', async () => {
    const s = await opened();
    await press(s, 'endpoint:add');
    await press(s, 'endpoint:label');
    await press(s, 'endpoint:label:box', 'Mine');
    await press(s, 'endpoint:url');
    await press(s, 'endpoint:url:box', 'http://mine');
    await press(s, 'endpoint:key');
    const box = flat(view(s)).find((n) => n.k === 'input' && n.key === 'endpoint:key:box');
    expect(box && box.k === 'input' ? box.value : 'none').toBeUndefined();
    await press(s, 'endpoint:key:box', 'typed-key-secret');
    expect(JSON.stringify(view(s))).not.toContain('typed-key-secret');
    await press(s, 'endpoint:models');
    await press(s, 'endpoint:models:box', 'a, b');
    await press(s, 'endpoint:save');
    expect(said(s.calls, 'env.saveEndpoint')).toEqual([[{ label: 'Mine', baseUrl: 'http://mine', key: 'typed-key-secret', models: ['a', 'b'] }]]);
    expect(words(view(s))).toContain('Add Endpoint');
  });

  it('keeps the saved key unless you replace or remove it', async () => {
    const s = await opened();
    await press(s, 'endpoint:work:edit');
    await press(s, 'endpoint:save');
    expect(said(s.calls, 'env.saveEndpoint')).toEqual([[{ id: 'work', label: 'Work proxy', baseUrl: 'https://proxy.example.com', models: ['big'] }]]);
    await press(s, 'endpoint:work:edit');
    expect(words(view(s))).toContain('Saved (type to replace)');
    await press(s, 'endpoint:clear-key');
    await press(s, 'endpoint:save');
    expect(said(s.calls, 'env.saveEndpoint').at(-1)).toEqual([{ id: 'work', label: 'Work proxy', baseUrl: 'https://proxy.example.com', key: '', models: ['big'] }]);
  });

  it('says what’s missing rather than sending it', async () => {
    const s = await opened();
    await press(s, 'endpoint:work:edit');
    await press(s, 'endpoint:label');
    await press(s, 'endpoint:label:box', '');
    await press(s, 'endpoint:save');
    expect(said(s.calls, 'env.saveEndpoint')).toEqual([]);
    expect(words(view(s))).toContain('It needs a name and an address');
  });

  it('removes one after asking, and never the built-in', async () => {
    const s = await opened();
    expect(buttons(view(s))).not.toContain('endpoint:ollama:remove');
    await press(s, 'endpoint:work:remove');
    expect(said(s.calls, 'env.removeEndpoint')).toEqual([]);
    await press(s, 'endpoint:work:remove');
    expect(said(s.calls, 'env.removeEndpoint')).toEqual([['work']]);
  });
});

describe('Skills and MCP', () => {
  const servers = [
    { name: 'plugin:figma:figma', label: 'figma', from: 'plugin', where: 'figma', status: 'needs-auth', canSignIn: true },
    { name: 'db', label: 'db', from: 'user', status: 'failed', error: 'no socket', canSignIn: false, tools: 3 },
    { name: 'off', label: 'off-one', from: 'user', status: 'disabled', canSignIn: false, canTurnOff: true },
    { name: 'claude.ai Gmail', label: 'Gmail', from: 'claude.ai', status: 'needs-auth', canSignIn: false },
  ];

  const opened = async (state: Partial<AppState> = {}): Promise<Started> => {
    const s = start(state);
    s.answers.set('claudeCode.mcpServers', () => servers);
    s.answers.set('claudeCode.skills', () => [{ name: 'review', description: 'Reviews a change', kind: 'skill', source: 'user' }]);
    go(s, 'tools');
    view(s);
    await s.settle();
    return s;
  };

  it('lists your servers and how each is, for your agent', async () => {
    const s = await opened();
    expect(said(s.calls, 'claudeCode.mcpServers')).toEqual([['claude']]);
    const tree = view(s);
    expect(words(tree)).toContain('Needs you to sign in');
    expect(words(tree)).toContain('no socket');
    expect(words(tree)).toContain('From the figma plugin');
    expect(flat(tree).some((n) => n.k === 'link' && n.href.includes('claude.ai'))).toBe(true);
  });

  it('signs in through your browser and waits, then looks again', async () => {
    const s = await opened();
    s.answers.set('claudeCode.mcpSignIn', () => ({ url: 'https://auth.example.com/go' }));
    let signedIn: (ok: boolean) => void = () => undefined;
    s.answers.set('claudeCode.mcpSignedIn', () => new Promise<boolean>((resolve) => (signedIn = resolve)));
    await press(s, 'mcp:plugin:figma:figma:sign-in');
    expect(said(s.calls, 'claudeCode.mcpSignIn')).toEqual([['plugin:figma:figma', 'claude']]);
    expect(said(s.calls, 'claudeCode.mcpSignedIn')).toEqual([['plugin:figma:figma', 'claude']]);
    const tree = view(s);
    expect(flat(tree).some((n) => n.k === 'link' && n.href === 'https://auth.example.com/go')).toBe(true);
    expect(words(tree)).toContain('Waiting for your browser');
    signedIn(true);
    await s.settle();
    await s.settle();
    expect(words(view(s))).toContain('Signed in to figma');
    await s.settle();
    expect(said(s.calls, 'claudeCode.mcpServers').length).toBe(2);
  });

  it('says why a sign-in can’t start', async () => {
    const s = await opened();
    s.answers.set('claudeCode.mcpSignIn', () => ({ error: 'Not a web server' }));
    expect((await press(s, 'mcp:plugin:figma:figma:sign-in')).error).toBe('Not a web server');
  });

  it('turns one on and off where its agent keeps it', async () => {
    const s = await opened();
    s.answers.set('claudeCode.mcpSetEnabled', () => ({ ok: true }));
    await press(s, 'mcp:off:on');
    expect(said(s.calls, 'claudeCode.mcpSetEnabled')).toEqual([['off', true, 'claude']]);
  });

  it('with both agents set up, a tab for each, yours first', async () => {
    const s = await opened({ runtimes });
    await press(s, 'mcp:tab:codex');
    view(s);
    expect(said(s.calls, 'claudeCode.mcpServers').at(-1)).toEqual(['codex']);
  });

  it('lists skills and commands, yours or a project’s', async () => {
    const s = await opened({ home: '/Users/me', projects: [project('p1', 'alpha')] });
    expect(said(s.calls, 'claudeCode.skills')).toEqual([['draft', '/Users/me']]);
    expect(words(view(s))).toContain('/review');
    expect(words(view(s))).toContain('Reviews a change');
    await press(s, 'skills:project', 'p1');
    view(s);
    expect(said(s.calls, 'claudeCode.skills').at(-1)).toEqual(['draft', '/r/alpha']);
  });
});

describe('Stop the Engine', () => {
  it('asks first, and Back leaves it running', async () => {
    const s = start();
    await press(s, 'place:engine');
    expect(labelled(view(s), 'Stop the Engine')).toBeDefined();
    await press(s, 'engine:stop');
    expect(said(s.calls, 'daemon.stop')).toEqual([]);
    expect(words(view(s))).toContain('Stop the Engine?');
    await press(s, 'back');
    expect(said(s.calls, 'daemon.stop')).toEqual([]);
    await press(s, 'engine:stop');
    await press(s, 'stop:confirm');
    expect(said(s.calls, 'daemon.stop')).toEqual([[]]);
  });
});
