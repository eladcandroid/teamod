import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recipeById } from '../src/core/sentinel/recipes.js';
import { attachSentinel } from '../src/core/sentinel/registry.js';
import type { Dashboard, Tile } from '../src/core/sentinel/dashboard-model.js';
import { type Method, parseArgs } from '../src/ipc/api.js';
import { DASHBOARD_HANDLERS } from '../src/ipc/dashboard-handlers.js';
import { SENTINEL_HANDLERS } from '../src/ipc/sentinel-handlers.js';
import { NO_SENTINEL, type MetricSeries, type RunSummary, type Sentinel, type SentinelState, sentinelChatChannel } from '../src/core/sentinel/model.js';
import type { AppState } from '../src/core/store.js';
import { SURFACE } from '../src/teamod/coverage.js';
import { MOST_ROWS } from '../src/teamod/panes/sentinel-common.js';
import { sparkline } from '../src/teamod/panes/sentinel-model.js';
import type { Route } from '../src/teamod/screens.js';
import type { Node } from '../src/teamod/tree.js';
import { brief, setup } from './sentinel-fakes.js';
import { flat, labelled, start, viewport, words } from './teamod-helpers.js';

// ---------------------------------------------------------------- a real engine behind the screens

/** The screens over a real Sentinels: every call checked by the API's own schema, as the daemon checks it. */
function engine() {
  const core = setup();
  const session = { store: core.store, host: { stopRun: () => undefined, forgetContext: () => undefined } };
  attachSentinel(session, core.sentinels);
  const now = (): ReturnType<typeof core.store.getState> => core.store.getState();
  const app = start({ sentinel: now().sentinel, projects: now().projects, log: now().log } as unknown as Partial<AppState>);
  const handlers = { ...SENTINEL_HANDLERS, ...DASHBOARD_HANDLERS } as unknown as Record<string, (s: unknown, ...args: readonly unknown[]) => unknown>;
  for (const [method, handler] of Object.entries(handlers)) app.answers.set(method, (args) => handler(session, ...(parseArgs(method as Method, args) as readonly unknown[])));
  app.answers.set('session.submit', (args) => void parseArgs('session.submit', args));
  const sync = (): void => app.set({ sentinel: now().sentinel, log: now().log } as unknown as Partial<AppState>);
  const press = async (key: string, value?: string): Promise<{ ok: boolean; error?: string; toast?: string; copy?: string }> => {
    const out = await app.screens.press('sentinel', key, value, viewport);
    sync();
    await app.settle();
    return out;
  };
  const view = (): Node => {
    sync();
    return app.screens.view('sentinel', viewport);
  };
  const go = async (route: Route): Promise<void> => {
    app.screens.nav.go('sentinel', route);
    view();
    await app.settle();
  };
  return { ...core, ...app, press, view, go };
}

/** Press and fail on any error the press met (a call the schema refuses, say). */
async function must(e: ReturnType<typeof engine>, key: string, value?: string): Promise<void> {
  expect(await e.press(key, value)).toMatchObject({ ok: true });
}

const called = (calls: ReadonlyArray<[string, readonly unknown[]]>, method: string): Array<readonly unknown[]> => calls.filter(([m]) => m === method).map(([, args]) => args);

// ---------------------------------------------------------------- a state of the test's own

const daily = { kind: 'schedule', every: 'day', at: '07:00', missed: 'catch-up' } as const;
const item = (over: Partial<Sentinel> = {}): Sentinel => ({ id: 'sn1', name: 'Morning brief', icon: 'calendar', trigger: daily, steps: [{ id: 'st1', name: 'Read what changed', kind: 'claude', prompt: 'Brief me', where: 'project' }, { id: 'st2', name: 'Tell me', kind: 'notify', phone: true }], access: 'look', limits: { minutes: 30, pauseAfter: 3 }, notify: 'mac', paused: false, failures: 0, createdAt: 1, updatedAt: 2, ...over });
const run = (over: Partial<RunSummary> = {}): RunSummary => ({ id: 'run1', sentinelId: 'sn1', by: 'schedule', trigger: { kind: 'schedule', summary: 'Every day at 7:00' }, state: 'done', startedAt: Date.now() - 60_000, endedAt: Date.now() - 1000, headline: '3 commits landed', steps: [{ id: 'st1', state: 'done', startedAt: Date.now() - 60_000, endedAt: Date.now() - 2000 }, { id: 'st2', state: 'done' }], tasks: [], ...over });
const metric = (over: Partial<MetricSeries> = {}): MetricSeries => ({ sentinelId: 'sn1', name: 'subscribers', label: 'Subscribers', unit: 'count', better: 'up', kind: 'number', points: [{ at: 1000, value: 100, runId: 'r0' }, { at: 2000, value: 120, runId: 'run1' }], ...over });
const stateOf = (over: Partial<SentinelState> = {}): SentinelState => ({ ...NO_SENTINEL, enabled: true, ...over });
/** Every stubbed call a test made: the daemon would check each of these by the API's own schema, so the test does too. */
const made: Array<ReadonlyArray<[string, readonly unknown[]]>> = [];
const started = (over: Partial<SentinelState> = {}, more: Partial<AppState> = {}): ReturnType<typeof start> => {
  const app = start({ sentinel: stateOf(over), ...more });
  made.push(app.calls);
  return app;
};
afterEach(() => {
  for (const calls of made.splice(0)) for (const [method, args] of calls) expect(() => parseArgs(method as Method, args), `${method} ${JSON.stringify(args)}`).not.toThrow();
});

/** Go somewhere within the screen, and let what it fetched land. */
async function at(app: ReturnType<typeof start>, route: Route): Promise<Node> {
  app.screens.nav.go('sentinel', route);
  app.screens.view('sentinel', viewport);
  await app.settle();
  return app.screens.view('sentinel', viewport);
}

const buttons = (tree: Node): Array<Extract<Node, { k: 'button' }>> => flat(tree).filter((n): n is Extract<Node, { k: 'button' }> => n.k === 'button');
const hasKey = (tree: Node, key: string): boolean => flat(tree).some((n) => 'key' in n && n.key === key);

// ---------------------------------------------------------------- what the brief asks for

describe('New Sentinel', () => {
  it('makes one from a recipe, filled in, and opens it', async () => {
    const e = engine();
    await must(e, 'new');
    await must(e, 'way:recipe');
    e.view();
    await e.settle();
    expect(words(e.view())).toContain('Morning brief');
    await must(e, 'recipe:morning-brief');
    const [made] = e.store.getState().sentinel.items;
    expect(made).toMatchObject({ name: 'Morning brief', recipe: 'morning-brief', trigger: { kind: 'schedule', at: '07:00' } });
    expect(made!.steps.map((s) => s.kind)).toEqual(['claude', 'notify']);
    expect(words(e.view())).toContain('Every day at 7:00');
    // Back goes where you came from, not to the form that made it.
    await must(e, 'back');
    expect(hasKey(e.view(), 'new')).toBe(true);
  });

  it('makes both sentinels of a recipe that is two, the second after the first', async () => {
    const e = engine();
    await must(e, 'new');
    await must(e, 'way:recipe');
    e.view();
    await e.settle();
    await must(e, 'recipe:nightly-tests');
    const [first, second] = e.store.getState().sentinel.items;
    expect(first?.name).toBe('Nightly tests');
    expect(second?.trigger).toEqual({ kind: 'after', sentinelId: first!.id, on: 'failure' });
    expect(e.store.getState().sentinel.items.every((s) => s.paused)).toBe(true);
  });

  it('starts paused whichever way it is made, and only a press turns it on', async () => {
    const e = engine();
    await must(e, 'new');
    await must(e, 'way:build');
    await must(e, 'new:name', 'Night watch');
    const [made] = e.store.getState().sentinel.items;
    expect(made?.paused).toBe(true);
    expect(called(e.calls, 'sentinel.pause')).toEqual([]);
    // No draft it sends can ask otherwise.
    for (const [draft] of called(e.calls, 'sentinel.create')) expect(draft).not.toHaveProperty('paused');
    // Its page says so, and Turn On is the one main action.
    const tree = e.view();
    expect(words(tree)).toContain('This sentinel is paused');
    expect(buttons(tree).filter((b) => b.primary).map((b) => b.label)).toEqual(['Turn On']);
    await must(e, 'pause');
    expect(called(e.calls, 'sentinel.pause')).toEqual([[made!.id, false]]);
    expect(e.store.getState().sentinel.items[0]?.paused).toBe(false);
  });

  it('describes one in words: an empty paused sentinel, then the agent fills it in', async () => {
    const e = engine();
    e.answers.set('sentinel.ask', (args) => void parseArgs('sentinel.ask', args));
    await must(e, 'new');
    await must(e, 'new:words', 'Every weekday morning, read yesterday’s commits and brief me');
    const [made] = e.store.getState().sentinel.items;
    expect(made).toMatchObject({ name: 'Read yesterday’s commits and brief', paused: true, trigger: { kind: 'manual' }, steps: [] });
    expect(called(e.calls, 'sentinel.ask')).toEqual([[made!.id, 'Every weekday morning, read yesterday’s commits and brief me']]);
    expect(words(e.view())).toContain(made!.name);
  });

  it('puts it where you say', async () => {
    const e = engine();
    await must(e, 'new');
    await must(e, 'where', 'api');
    await must(e, 'way:build');
    await must(e, 'new:name', 'In the API');
    expect(e.store.getState().sentinel.items[0]?.projectId).toBe('api');
  });

  it('says so when the recipes do not load', async () => {
    const app = started();
    app.answers.set('sentinel.recipes', () => {
      throw new Error('The engine is away');
    });
    app.screens.nav.go('sentinel', { name: 'new', params: { way: 'recipe' } });
    expect(words(app.screens.view('sentinel', viewport))).toContain('Reading the recipes...');
    await app.settle();
    expect(words(app.screens.view('sentinel', viewport))).toContain('The engine is away');
  });
});

describe('a sentinel', () => {
  it('pauses and turns on', async () => {
    const e = engine();
    const made = e.sentinels.create(brief);
    e.sentinels.pause(made.id, false);
    await e.go({ name: 'page', params: { id: made.id } });
    expect(buttons(e.view()).filter((b) => b.primary).map((b) => b.label)).toEqual(['Run Now']);
    await must(e, 'pause');
    expect(called(e.calls, 'sentinel.pause')).toEqual([[made.id, true]]);
    expect(e.store.getState().sentinel.items[0]?.paused).toBe(true);
    expect(buttons(e.view()).filter((b) => b.primary).map((b) => b.label)).toEqual(['Turn On']);
    await must(e, 'pause');
    expect(e.store.getState().sentinel.items[0]?.paused).toBe(false);
  });

  it('runs, even while paused, without turning on; and stops', async () => {
    const e = engine();
    const made = e.sentinels.create(brief);
    await e.go({ name: 'page', params: { id: made.id } });
    const pressed = await e.press('run');
    expect(pressed).toMatchObject({ ok: true, toast: 'Morning brief is running' });
    expect(called(e.calls, 'sentinel.run')).toEqual([[made.id]]);
    expect(e.store.getState().sentinel.items[0]?.paused).toBe(true);
    const going = e.store.getState().sentinel.runs[0]!;
    expect(going.sentinelId).toBe(made.id);
    expect(labelled(e.view(), 'Stop')).toBeDefined();
    await must(e, 'stop');
    expect(called(e.calls, 'sentinel.stop')).toEqual([[going.id]]);
  });

  it('removes only after asking first', async () => {
    const e = engine();
    const made = e.sentinels.create(brief);
    await e.go({ name: 'page', params: { id: made.id } });
    await must(e, 'more');
    await must(e, 'delete');
    // Asked, not done.
    expect(called(e.calls, 'sentinel.remove')).toEqual([]);
    expect(e.store.getState().sentinel.items).toHaveLength(1);
    const asking = e.view();
    expect(words(asking)).toContain('Delete “Morning brief”?');
    expect(words(asking)).toContain('This can’t be undone');
    // Back keeps it.
    await must(e, 'back');
    expect(e.store.getState().sentinel.items).toHaveLength(1);
    await must(e, 'delete');
    const done = await e.press('ask:yes');
    expect(done).toMatchObject({ ok: true, toast: 'Deleted Morning brief' });
    expect(called(e.calls, 'sentinel.remove')).toEqual([[made.id]]);
    expect(e.store.getState().sentinel.items).toEqual([]);
    // Off its pages, to where you came from.
    expect(words(e.view())).not.toContain('That sentinel is gone');
  });

  it('duplicates, paused, and opens the copy', async () => {
    const e = engine();
    const made = e.sentinels.create(brief);
    e.sentinels.pause(made.id, false);
    await e.go({ name: 'page', params: { id: made.id } });
    await must(e, 'more');
    await must(e, 'duplicate');
    const copy = e.store.getState().sentinel.items[1]!;
    expect(copy).toMatchObject({ name: 'Morning brief copy', paused: true });
    expect(words(e.view())).toContain('Morning brief copy');
  });

  it('tests its sources and says what came back', async () => {
    const e = engine();
    const made = e.sentinels.create(brief);
    await e.go({ name: 'page', params: { id: made.id } });
    await must(e, 'more');
    await must(e, 'test');
    expect(called(e.calls, 'sentinel.test')).toEqual([[made.id]]);
    expect(words(e.view())).toContain('has no Keep the numbers step');
  });

  it('asks first before it may do more, and saves at once when it may do less', async () => {
    const e = engine();
    const made = e.sentinels.create({ ...brief, access: 'work' });
    await e.go({ name: 'more', params: { id: made.id } });
    await must(e, 'access', 'ship');
    expect(e.store.getState().sentinel.items[0]?.access).toBe('work');
    expect(words(e.view())).toContain('Give “Morning brief” Ship access?');
    await must(e, 'ask:yes');
    expect(e.store.getState().sentinel.items[0]?.access).toBe('ship');
    await must(e, 'access', 'look');
    expect(e.store.getState().sentinel.items[0]?.access).toBe('look');
  });

  it('does not offer less access than its steps need, and says why', async () => {
    const app = started({ items: [item({ access: 'ship', steps: [{ id: 'm', name: 'Merge', kind: 'merge', require: { checks: true, approval: true }, method: 'squash' }] })] });
    const tree = await at(app, { name: 'more', params: { id: 'sn1' } });
    const access = flat(tree).find((n) => n.k === 'select' && n.key === 'access');
    expect(access?.k === 'select' ? access.options.map((o) => o.value) : []).toEqual(['ship']);
    expect(words(tree)).toContain('Look and Work isn’t offered');
  });

  it('asks first before a merge goes without asking', async () => {
    const e = engine();
    const made = e.sentinels.create({ ...brief, access: 'ship', steps: [{ kind: 'pr' }, { kind: 'merge', require: { checks: true, approval: true }, method: 'squash' }] });
    const merge = made.steps[1]!;
    await e.go({ name: 'step', params: { id: made.id, step: merge.id } });
    await must(e, 'step:approval', 'no');
    const before = e.store.getState().sentinel.items[0]!.steps[1]!;
    expect(before.kind === 'merge' && before.require.approval).toBe(true);
    expect(words(e.view())).toContain('Merge without asking?');
    await must(e, 'ask:yes');
    const after = e.store.getState().sentinel.items[0]!.steps[1]!;
    expect(after.kind === 'merge' && after.require.approval).toBe(false);
    // Turning asking back on doesn't ask.
    await must(e, 'step:approval', 'yes');
    const again = e.store.getState().sentinel.items[0]!.steps[1]!;
    expect(again.kind === 'merge' && again.require.approval).toBe(true);
  });

  it('sets the run-at-once setting across all sentinels', async () => {
    const e = engine();
    e.sentinels.create(brief);
    await e.go({ name: 'list-more' });
    await must(e, 'run-at-once', '4');
    expect(called(e.calls, 'sentinel.setRunAtOnce')).toEqual([[4]]);
    expect(e.store.getState().sentinel.runAtOnce).toBe(4);
  });
});

describe('the list', () => {
  const items = [item({ id: 'a', name: 'Alpha', projectId: 'p1' }), item({ id: 'b', name: 'Beta', paused: true }), item({ id: 'c', name: 'Gamma', paused: true, pausedWhy: 'Paused after 3 failures in a row' })];
  const projects = [{ id: 'p1', name: 'alpha', root: '/r/alpha', base: 'main', workspaces: [] }] as unknown as AppState['projects'];

  it('finds, filters by project and state, and shows all again', async () => {
    const app = started({ items }, { projects });
    await at(app, { name: 'list-more' });
    await app.screens.press('sentinel', 'find', 'gam', viewport);
    await app.screens.press('sentinel', 'back', undefined, viewport);
    let tree = app.screens.view('sentinel', viewport);
    expect(hasKey(tree, 'sn:c')).toBe(true);
    expect(hasKey(tree, 'sn:a')).toBe(false);
    expect(words(tree)).toContain('Showing 1 of 3');
    await app.screens.press('sentinel', 'filters:clear', undefined, viewport);
    expect(hasKey(app.screens.view('sentinel', viewport), 'sn:a')).toBe(true);
    await at(app, { name: 'list-more' });
    await app.screens.press('sentinel', 'scope', 'p1', viewport);
    tree = await at(app, { name: 'list' });
    expect(hasKey(tree, 'sn:a')).toBe(true);
    expect(hasKey(tree, 'sn:b')).toBe(false);
    await at(app, { name: 'list-more' });
    await app.screens.press('sentinel', 'scope', '', viewport);
    await app.screens.press('sentinel', 'show', 'paused', viewport);
    tree = await at(app, { name: 'list' });
    expect(hasKey(tree, 'sn:a')).toBe(false);
    expect(hasKey(tree, 'sn:b')).toBe(true);
  });

  it('leads each row with how it’s doing and what it found', () => {
    const app = started({ items, runs: [run({ sentinelId: 'a' })], nextAt: { a: Date.now() + 60_000 }, troubles: {} }, { projects });
    const said = words(app.screens.view('sentinel', viewport));
    expect(said).toContain('Alpha  Every day at 7:00  next ');
    expect(said).toContain('Done  3 commits landed');
    expect(said).toContain('Hasn’t run yet');
    expect(said).toContain('Paused after 3 failures in a row');
    // Each with its one thing to do.
    expect(said).toContain('“Beta” is ready: look it over');
    expect(labelled(app.screens.view('sentinel', viewport), 'Resume')).toBeDefined();
  });

  it('turns a draft on from what waits, with a press', async () => {
    const app = started({ items }, { projects });
    await app.screens.press('sentinel', 'need:s:b:on', undefined, viewport);
    expect(called(app.calls, 'sentinel.pause')).toEqual([['b', false]]);
  });

  it('says what can’t watch', () => {
    const app = started({ items: [item()], troubles: { sn1: 'Sign in to GitHub first' } });
    const tree = app.screens.view('sentinel', viewport);
    expect(words(tree)).toContain('Can’t watch: Sign in to GitHub first');
    expect(words(tree)).toContain('Morning brief can’t watch');
  });

  it('offers the ways in when nothing is set up, and says what it’ll do', async () => {
    const app = started();
    const tree = app.screens.view('sentinel', viewport);
    expect(words(tree)).toContain('nothing runs until you turn it on');
    await app.screens.press('sentinel', 'first:words', ' Watch my site ', viewport);
    expect(called(app.calls, 'session.submit')).toEqual([['Watch my site', { channel: 'sentinel-chat:main' }]]);
    expect(hasKey(app.screens.view('sentinel', viewport), 'chat:main:box')).toBe(true);
  });
});

describe('the form', () => {
  it('sets every kind of trigger the engine takes, one field to a row', async () => {
    const e = engine();
    const other = e.sentinels.create({ name: 'Other' });
    const made = e.sentinels.create(brief);
    const trigger = () => e.store.getState().sentinel.items.find((s) => s.id === made.id)!.trigger;
    await e.go({ name: 'when', params: { id: made.id } });

    await must(e, 'when:every', 'week');
    expect(trigger()).toMatchObject({ every: 'week', days: [1] });
    await must(e, 'when:day:3');
    expect(trigger()).toMatchObject({ days: [1, 3] });
    await must(e, 'when:at', '09:30');
    expect(trigger()).toMatchObject({ at: '09:30' });
    expect((await e.press('when:at', 'nine'))).toMatchObject({ ok: false, error: 'A time like 07:00' });
    await must(e, 'when:every', 'month');
    await must(e, 'when:day', '12');
    expect(trigger()).toMatchObject({ every: 'month', day: 12 });
    await must(e, 'when:every', 'hours');
    await must(e, 'when:hours', '6');
    expect(trigger()).toMatchObject({ every: 'hours', hours: 6 });
    await must(e, 'when:missed', 'skip');
    expect(trigger()).toMatchObject({ missed: 'skip' });

    await must(e, 'when:kind', 'manual');
    expect(trigger()).toEqual({ kind: 'manual' });
    await must(e, 'when:kind', 'after');
    await must(e, 'when:after', other.id);
    await must(e, 'when:on', 'always');
    expect(trigger()).toEqual({ kind: 'after', sentinelId: other.id, on: 'always' });
    await must(e, 'when:kind', 'teamod');
    await must(e, 'when:what', 'pr-merged');
    await must(e, 'when:project', 'api');
    expect(trigger()).toEqual({ kind: 'teamod', what: 'pr-merged', projectId: 'api' });
    await must(e, 'when:project', '');
    expect(trigger()).toEqual({ kind: 'teamod', what: 'pr-merged' });
    await must(e, 'when:kind', 'github');
    await must(e, 'when:what', 'issue-labelled');
    await must(e, 'when:label', 'bug');
    await must(e, 'when:minutes', '15');
    expect(trigger()).toEqual({ kind: 'github', what: 'issue-labelled', minutes: 15, label: 'bug' });
    await must(e, 'when:kind', 'stripe');
    await must(e, 'when:what', 'refund');
    expect(trigger()).toEqual({ kind: 'stripe', what: 'refund' });
    await must(e, 'when:kind', 'uptime');
    await must(e, 'when:url', 'https://example.org/health');
    await must(e, 'when:minutes', '1');
    await must(e, 'when:expect', '204');
    expect(trigger()).toEqual({ kind: 'uptime', url: 'https://example.org/health', minutes: 1, expect: 204 });
    expect(await e.press('when:url', 'nowhere')).toMatchObject({ ok: false, error: 'A whole address, like https://example.com/health' });
    await must(e, 'when:kind', 'sentry');
    await must(e, 'when:what', 'spike');
    await must(e, 'when:org', 'acme');
    await must(e, 'when:sentry-project', 'web');
    expect(trigger()).toEqual({ kind: 'sentry', org: 'acme', project: 'web', what: 'spike' });
    await must(e, 'when:kind', 'webhook');
    await must(e, 'when:signature', 'github');
    expect(trigger()).toEqual({ kind: 'webhook', signature: 'github' });
    await must(e, 'when:kind', 'schedule');
    expect(trigger()).toMatchObject({ kind: 'schedule', every: 'day' });
  });

  it('adds every kind of step its access allows, and each one’s fields save', async () => {
    const e = engine();
    const made = e.sentinels.create({ name: 'All of it', access: 'ship', steps: [] });
    const steps = () => e.store.getState().sentinel.items[0]!.steps;
    const step = () => steps().at(-1)!;
    const add = async (kind: string): Promise<void> => {
      await e.go({ name: 'add-step', params: { id: made.id } });
      await must(e, `add:${kind}`);
      expect(step().kind).toBe(kind);
      // It lands on the new step's own page.
      expect(hasKey(e.view(), 'step:name')).toBe(true);
    };
    await add('claude');
    await must(e, 'step:prompt', 'Do the thing');
    await must(e, 'step:where', 'worktree');
    await must(e, 'step:preset', 'review');
    expect(step()).toMatchObject({ where: 'worktree', prompt: expect.stringContaining('Review what changed') });
    await must(e, 'step:agent', 'codex:gpt');
    expect(step()).toMatchObject({ runtime: 'codex', model: 'gpt' });
    await must(e, 'step:agent', 'claude:');
    expect(step()).toMatchObject({ runtime: 'claude' });
    expect(step()).not.toHaveProperty('model');
    await must(e, 'step:agent', '');
    expect(step()).not.toHaveProperty('runtime');
    await add('script');
    await must(e, 'step:command', 'npm test');
    await must(e, 'step:cwd', 'home');
    await must(e, 'step:timeout', '300');
    expect(step()).toMatchObject({ command: 'npm test', cwd: 'home', timeoutSec: 300 });
    await must(e, 'step:mode', 'script');
    await must(e, 'step:language', 'bash');
    await must(e, 'step:code', 'echo 1');
    expect(step()).toMatchObject({ code: 'echo 1', language: 'bash' });
    await must(e, 'step:mode', 'command');
    expect(step()).not.toHaveProperty('code');
    await add('notify');
    await must(e, 'step:title', 'Hello');
    await must(e, 'step:body', 'World');
    await must(e, 'step:phone', 'yes');
    expect(step()).toMatchObject({ title: 'Hello', body: 'World', phone: true });
    await add('http');
    await must(e, 'step:url', 'https://api.example.com/x');
    await must(e, 'step:method', 'POST');
    await must(e, 'step:header-new', 'Authorization: Bearer $KEY');
    await must(e, 'step:header:Authorization', 'Bearer $OTHER');
    await must(e, 'step:http-body', '{"a":1}');
    expect(step()).toMatchObject({ url: 'https://api.example.com/x', method: 'POST', headers: { Authorization: 'Bearer $OTHER' }, body: '{"a":1}' });
    await must(e, 'step:header-remove:Authorization');
    expect(step()).toMatchObject({ headers: {} });
    await must(e, 'step:service', 'slack');
    expect(step()).toMatchObject({ preset: 'slack', url: '$SLACK_WEBHOOK_URL' });
    await add('pr');
    await must(e, 'step:draft', 'yes');
    expect(step()).toMatchObject({ draft: true });
    await add('merge');
    await must(e, 'step:merge-as', 'merge');
    expect(step()).toMatchObject({ method: 'merge' });
    await add('message');
    await must(e, 'step:text', 'Hello there');
    expect(step()).toMatchObject({ text: 'Hello there' });
    await add('friend');
    await must(e, 'step:ask', 'Is staging up?');
    await must(e, 'step:their-project', 'infra');
    expect(step()).toMatchObject({ prompt: 'Is staging up?', project: 'infra' });
    await add('trigger');
    await add('measure');
    await must(e, 'step:from', 'source');
    await must(e, 'step:source', 'sqlite');
    await must(e, 'step:source-file', 'stats.db');
    await must(e, 'step:source-main', 'select 1 as n');
    expect(step()).toMatchObject({ from: 'source', source: { kind: 'sqlite', path: 'stats.db', query: 'select 1 as n' } });
    await must(e, 'spec:add');
    await must(e, 'spec:label', 'Sign ups');
    await must(e, 'spec:pick', 'rows[0].n');
    await must(e, 'spec:unit', 'percent');
    await must(e, 'spec:better', 'down');
    expect(step()).toMatchObject({ metrics: [{ name: 'sign-ups', label: 'Sign ups', pick: 'rows[0].n', unit: 'percent', better: 'down' }] });
    await must(e, 'spec:remove');
    expect(step()).toMatchObject({ metrics: [] });
    expect(steps()).toHaveLength(10);
  });

  it('says which steps its access refuses, and does not offer them', async () => {
    const app = started({ items: [item({ access: 'look' })] });
    const tree = await at(app, { name: 'add-step', params: { id: 'sn1' } });
    expect(hasKey(tree, 'add:merge')).toBe(false);
    expect(hasKey(tree, 'add:pr')).toBe(false);
    expect(hasKey(tree, 'add:script')).toBe(true);
    expect(words(tree)).toContain('Needs Ship access');
    expect(words(tree)).toContain('Needs Work access');
  });

  it('moves, copies and removes a step, the last only after asking', async () => {
    const e = engine();
    const made = e.sentinels.create(brief);
    const names = () => e.store.getState().sentinel.items[0]!.steps.map((s) => s.name);
    const second = made.steps[1]!;
    await e.go({ name: 'step-more', params: { id: made.id, step: second.id } });
    await must(e, 'step:up');
    expect(names()).toEqual(['Tell me', 'Read what changed']);
    await must(e, 'step:duplicate');
    expect(names()).toEqual(['Tell me', 'Tell me copy', 'Read what changed']);
    await e.go({ name: 'step-more', params: { id: made.id, step: second.id } });
    await must(e, 'step:remove');
    expect(names()).toHaveLength(3);
    await must(e, 'ask:yes');
    expect(names()).toEqual(['Tell me copy', 'Read what changed']);
    expect(words(e.view())).not.toContain('That step is gone');
  });
});

describe('a webhook’s secret', () => {
  const secretUrl = 'https://tunnel.example/hook/sn1/SECRETINURL';
  const hook = (): ReturnType<typeof started> => {
    const app = started({ items: [item({ trigger: { kind: 'webhook', signature: 'github' } })] });
    app.answers.set('sentinel.webhookUrl', () => ({ url: secretUrl, signingSecret: 'SIGNINGSECRET' }));
    app.answers.set('sentinel.rotateSecret', () => ({ url: `${secretUrl}2` }));
    return app;
  };

  it('is never in the list, on its page or on its form, and nothing fetches it there', async () => {
    const app = hook();
    for (const route of [{ name: 'list' }, { name: 'list-more' }, { name: 'page', params: { id: 'sn1' } }, { name: 'more', params: { id: 'sn1' } }, { name: 'when', params: { id: 'sn1' } }]) {
      const tree = await at(app, route);
      expect(JSON.stringify(tree)).not.toContain('SECRET');
    }
    expect(called(app.calls, 'sentinel.webhookUrl')).toEqual([]);
  });

  it('shows only after the press, on its own page; the signing secret only ever goes to the clipboard', async () => {
    const app = hook();
    await at(app, { name: 'when', params: { id: 'sn1' } });
    expect((await app.screens.press('sentinel', 'when:show-url', undefined, viewport)).ok).toBe(true);
    app.screens.view('sentinel', viewport);
    await app.settle();
    const shown = app.screens.view('sentinel', viewport);
    expect(called(app.calls, 'sentinel.webhookUrl')).toEqual([['sn1']]);
    expect(words(shown)).toContain(secretUrl);
    expect(JSON.stringify(shown)).not.toContain('SIGNINGSECRET');
    expect(await app.screens.press('sentinel', 'webhook:copy', undefined, viewport)).toMatchObject({ copy: secretUrl });
    expect(await app.screens.press('sentinel', 'webhook:secret', undefined, viewport)).toMatchObject({ copy: 'SIGNINGSECRET' });
    // Back hides it.
    await app.screens.press('sentinel', 'back', undefined, viewport);
    expect(JSON.stringify(app.screens.view('sentinel', viewport))).not.toContain('SECRET');
  });

  it('rotates only after asking, and reads the new one', async () => {
    const app = hook();
    await at(app, { name: 'webhook', params: { id: 'sn1' } });
    await at(app, { name: 'when', params: { id: 'sn1' } });
    await app.screens.press('sentinel', 'when:rotate', undefined, viewport);
    expect(called(app.calls, 'sentinel.rotateSecret')).toEqual([]);
    expect(words(app.screens.view('sentinel', viewport))).toContain('the old ones stop working at once');
    expect(await app.screens.press('sentinel', 'ask:yes', undefined, viewport)).toMatchObject({ ok: true, toast: expect.stringContaining('new secret') });
    expect(called(app.calls, 'sentinel.rotateSecret')).toEqual([['sn1']]);
    const reads = called(app.calls, 'sentinel.webhookUrl').length;
    await app.screens.press('sentinel', 'when:show-url', undefined, viewport);
    app.screens.view('sentinel', viewport);
    expect(called(app.calls, 'sentinel.webhookUrl').length).toBe(reads + 1);
  });
});

describe('a run', () => {
  const detail = { run: { ...run(), trigger: { kind: 'schedule', summary: 'Every day at 7:00' }, steps: [{ id: 'st1', state: 'done', output: 'The whole output', startedAt: 1, endedAt: 2100 }, { id: 'st2', state: 'failed', why: 'No phone paired' }] }, sentinel: { id: 'sn1', name: 'Morning brief' }, report: '# 3 commits landed\n\n- CI is green' };

  it('shows its report as Markdown, and its steps’ outputs a press away', async () => {
    const app = started({ items: [item()], runs: [run()] });
    app.answers.set('sentinel.runGet', () => detail);
    const tree = await at(app, { name: 'run', params: { run: 'run1', id: 'sn1' } });
    expect(called(app.calls, 'sentinel.runGet')).toEqual([['run1']]);
    expect(flat(tree).some((n) => n.k === 'md' && n.text.includes('CI is green'))).toBe(true);
    expect(words(tree)).toContain('3 commits landed');
    expect(words(tree)).toContain('Read what changed');
    expect(words(tree)).toContain('No phone paired');
    expect(words(tree)).not.toContain('The whole output');
    await app.screens.press('sentinel', 'run:output:st1', undefined, viewport);
    expect(flat(app.screens.view('sentinel', viewport)).some((n) => n.k === 'code' && n.source === 'The whole output')).toBe(true);
  });

  it('keeps what a report can point at to the web', async () => {
    const app = started({ items: [item()], runs: [run()] });
    app.answers.set('sentinel.runGet', () => ({ ...detail, report: 'See [the secrets](file:///etc/passwd) and [the site](https://example.com)' }));
    const tree = await at(app, { name: 'run', params: { run: 'run1', id: 'sn1' } });
    const report = flat(tree).find((n) => n.k === 'md');
    expect(report?.k === 'md' && report.text).toContain('[the site](https://example.com)');
    expect(report?.k === 'md' && report.text).not.toContain('file:');
  });

  it('says so while it reads, and when it can’t', async () => {
    const app = started({ items: [item()] });
    app.answers.set('sentinel.runGet', () => {
      throw new Error('That run is gone');
    });
    app.screens.nav.go('sentinel', { name: 'run', params: { run: 'nope' } });
    expect(words(app.screens.view('sentinel', viewport))).toContain('Reading the run...');
    await app.settle();
    expect(words(app.screens.view('sentinel', viewport))).toContain('That run is gone');
  });

  it('reads again as a live run moves, and once more when it ends', async () => {
    const live = run({ state: 'running', endedAt: undefined });
    const app = started({ items: [item()], runs: [live] });
    app.answers.set('sentinel.runGet', () => detail);
    await at(app, { name: 'run', params: { run: 'run1', id: 'sn1' } });
    const reads = called(app.calls, 'sentinel.runGet').length;
    app.set({ sentinel: stateOf({ items: [item()], runs: [run()] }) });
    app.screens.view('sentinel', viewport);
    expect(called(app.calls, 'sentinel.runGet').length).toBe(reads + 1);
  });

  it('decides a merge that waits', async () => {
    const waiting = run({ state: 'needs-you', pr: { number: 52, url: 'https://github.com/a/b/pull/52' }, endedAt: undefined });
    const app = started({ items: [item()], runs: [waiting] });
    app.answers.set('sentinel.runGet', () => ({ ...detail, run: { ...detail.run, state: 'needs-you' } }));
    const tree = await at(app, { name: 'run', params: { run: 'run1', id: 'sn1' } });
    expect(words(tree)).toContain('Pull request #52 waits for you.');
    expect(buttons(tree).filter((b) => b.primary).map((b) => b.label)).toEqual(['Merge']);
    expect(flat(tree).some((n) => n.k === 'link' && n.href === 'https://github.com/a/b/pull/52')).toBe(true);
    expect(await app.screens.press('sentinel', 'run:merge', undefined, viewport)).toMatchObject({ ok: true, toast: 'Merged #52' });
    expect(await app.screens.press('sentinel', 'run:skip', undefined, viewport)).toMatchObject({ ok: true, toast: '#52 stays open' });
    expect(called(app.calls, 'sentinel.decide')).toEqual([['run1', 'merge'], ['run1', 'skip']]);
  });

  it('decides from the list too', async () => {
    const app = started({ items: [item()], runs: [run({ state: 'needs-you', pr: { number: 52, url: 'https://github.com/a/b/pull/52' } })] });
    expect(words(app.screens.view('sentinel', viewport))).toContain('Morning brief wants to merge #52');
    await app.screens.press('sentinel', 'need:run:run1:merge', undefined, viewport);
    expect(called(app.calls, 'sentinel.decide')).toEqual([['run1', 'merge']]);
  });

  it('deletes a chat or the run only after asking, and not while it runs', async () => {
    const app = started({ items: [item()], runs: [run({ channel: 'ws:c1', steps: [{ id: 'st1', state: 'done', channel: 'ws:c1' }] })] });
    await at(app, { name: 'run-more', params: { run: 'run1', id: 'sn1' } });
    await app.screens.press('sentinel', 'more:delete-chat', undefined, viewport);
    expect(called(app.calls, 'sentinel.runDelete')).toEqual([]);
    await app.screens.press('sentinel', 'ask:yes', undefined, viewport);
    expect(called(app.calls, 'sentinel.runDelete')).toEqual([['run1', 'chat']]);
    await app.screens.press('sentinel', 'more:delete-run', undefined, viewport);
    expect(called(app.calls, 'sentinel.runDelete')).toHaveLength(1);
    await app.screens.press('sentinel', 'ask:yes', undefined, viewport);
    expect(called(app.calls, 'sentinel.runDelete')).toEqual([['run1', 'chat'], ['run1', 'run']]);
    const live = started({ items: [item()], runs: [run({ state: 'running' })] });
    const tree = await at(live, { name: 'run-more', params: { run: 'run1', id: 'sn1' } });
    expect(hasKey(tree, 'more:delete-run')).toBe(false);
  });

  it('lists every run the index keeps, not only the state’s', async () => {
    const app = started({ items: [item()], runs: [run()] });
    app.answers.set('sentinel.runs', () => Array.from({ length: 150 }, (_, i) => run({ id: `r${i}`, headline: `Old run ${i}` })));
    const tree = await at(app, { name: 'runs', params: { id: 'sn1' } });
    expect(called(app.calls, 'sentinel.runs')).toEqual([['sn1']]);
    expect(words(tree)).toContain('Old run 0');
    expect(words(tree)).not.toContain('Old run 100');
  });
});

describe('a real run, through the engine', () => {
  it('reads its report, its outputs, and the numbers and rows it kept', async () => {
    const e = engine();
    const sn = e.sentinels.create(brief);
    const done = e.sentinels.addHistory(sn.id, { by: 'schedule', trigger: { kind: 'schedule', summary: 'On its schedule' }, state: 'done', startedAt: Date.now() - 5000, endedAt: Date.now(), headline: 'Kept it', steps: sn.steps.map((st) => ({ id: st.id, state: 'done' as const })), tasks: [] }, { outputs: ['What the agent found'], report: '# Today\n\nAll good.' });
    e.sentinels.demoKeep(sn.id, done.id, [{ name: 'issues', label: 'Open issues', better: 'down', value: 9 }, { name: 'jobs', label: 'Jobs', better: 'none', columns: ['job'], rows: [{ job: 'deploy' }] }]);
    await e.go({ name: 'page', params: { id: sn.id } });
    expect(words(e.view())).toContain('Open issues  9');
    await must(e, `run:${done.id}`);
    e.view();
    await e.settle();
    const page = e.view();
    expect(flat(page).some((n) => n.k === 'md' && n.text.includes('All good.'))).toBe(true);
    expect(words(page)).toContain('Kept it');
    expect(words(page)).toContain('Open issues  9');
    expect(words(page)).toContain('Jobs  1 rows');
    await must(e, `run:output:${sn.steps[0]!.id}`);
    expect(flat(e.view()).some((n) => n.k === 'code' && n.source === 'What the agent found')).toBe(true);
    await must(e, 'run:kept:jobs');
    expect(words(e.view())).toContain('deploy');
    await must(e, 'rows:0');
    expect(words(e.view())).toContain('job  deploy');
    await must(e, 'back');
    await must(e, 'back');
    await must(e, 'run:kept:issues');
    e.view();
    await e.settle();
    expect(called(e.calls, 'sentinel.metricRead')).toEqual([[sn.id, 'issues']]);
    expect(words(e.view())).toContain('1 run, since');
  });

  it('keeps a webhook’s secret out of the state, and shows why there is no URL yet', async () => {
    const e = engine();
    const sn = e.sentinels.create({ name: 'Hook', trigger: { kind: 'webhook', signature: 'github' } });
    await e.go({ name: 'when', params: { id: sn.id } });
    await must(e, 'when:show-url');
    e.view();
    await e.settle();
    expect(called(e.calls, 'sentinel.webhookUrl')).toEqual([[sn.id]]);
    expect(words(e.view())).toContain('Webhooks need the teamod app');
  });

  it('runs a test of a source, keeps what it finds, and names the run', async () => {
    const e = engine();
    const sn = e.sentinels.create({ name: 'Numbers', steps: [{ kind: 'measure', from: 'source', source: { kind: 'command', command: 'echo 1', format: 'auto' }, metrics: [] }] });
    await e.go({ name: 'more', params: { id: sn.id } });
    const out = await e.press('test');
    expect(called(e.calls, 'sentinel.test')).toEqual([[sn.id]]);
    // Whatever it says of the source, it says it in words on the page.
    expect(out.ok).toBe(true);
    expect(flat(e.view()).some((n) => n.k === 'md')).toBe(true);
  });
});

describe('what a sentinel keeps', () => {
  const rowsMetric = metric({
    name: 'jobs',
    label: 'Jobs',
    kind: 'rows',
    points: [{ at: 2000, value: 2, runId: 'run1' }],
    rows: [{ name: 'Nightly', doc: 'report.html', object: 'bucket/a/b.pdf', retry: 'job-1' }, { name: 'Weekly', doc: 'other.html', object: 'bucket/c.pdf', retry: 'job-2' }],
    columns: ['name', 'doc', 'object', 'retry'],
    columnTypes: [{ key: 'doc', type: 'html' }, { key: 'object', type: 'storage' }, { key: 'retry', type: 'action', button: 'Retry', sentinel: 'sn1' }],
    rowsAt: 2000,
    rowsRunId: 'run1',
  });

  it('lists its data rows and files, and opens them', async () => {
    const app = started({ items: [item()], runs: [run()], metrics: { sn1: { jobs: rowsMetric } } });
    app.answers.set('sentinel.dataList', () => ({ metrics: [{ name: 'jobs', label: 'Jobs', kind: 'rows', unit: 'count', lines: 3, rows: 6, first: 1000, last: 2000 }], runs: [{ runId: 'run1', at: 2000, headline: 'Kept', state: 'done', files: [{ name: 'report.md', label: 'Report', kind: 'report', size: 2048 }] }], keepsDays: 14 }));
    app.answers.set('sentinel.runFile', () => ({ name: 'Report.md', mime: 'text/markdown', size: 2048, text: '# The report', runId: 'run1' }));
    const data = await at(app, { name: 'data', params: { id: 'sn1' } });
    expect(words(data)).toContain('6 rows over 3 runs');
    expect(words(data)).toContain('Files are kept 14 days');
    await app.screens.press('sentinel', 'data:run:run1', undefined, viewport);
    await app.screens.press('sentinel', 'file:report.md', undefined, viewport);
    app.screens.view('sentinel', viewport);
    await app.settle();
    const doc = app.screens.view('sentinel', viewport);
    expect(called(app.calls, 'sentinel.runFile')).toEqual([['run1', 'report.md']]);
    expect(flat(doc).some((n) => n.k === 'md' && n.text === '# The report')).toBe(true);
    await app.screens.press('sentinel', 'doc:open', undefined, viewport);
    await app.screens.press('sentinel', 'doc:reveal', undefined, viewport);
    expect(called(app.calls, 'sentinel.runFileOpen')).toEqual([['run1', 'report.md', 'open'], ['run1', 'report.md', 'reveal']]);
  });

  it('opens a row, with its documents and its action', async () => {
    const app = started({ items: [item()], runs: [run()], metrics: { sn1: { jobs: rowsMetric } } });
    app.answers.set('sentinel.document', () => ({ name: 'report.html', mime: 'text/html', size: 20, text: '<script>alert(1)</script>', runId: 'run1' }));
    app.answers.set('sentinel.storageDocument', () => ({ name: 'b.pdf', mime: 'application/pdf', size: 900, base64: 'AA', runId: 'run1', bucket: 'bucket', path: 'a/b.pdf' }));
    app.answers.set('sentinel.signStorage', () => ({ url: 'https://storage.example/signed?token=abc', expiresIn: 60 }));
    const rows = await at(app, { name: 'rows', params: { id: 'sn1', name: 'jobs' } });
    expect(words(rows)).toContain('Nightly');
    await app.screens.press('sentinel', 'rows:0', undefined, viewport);
    expect(words(app.screens.view('sentinel', viewport))).toContain('report.html');
    expect(await app.screens.press('sentinel', 'cell:retry', undefined, viewport)).toMatchObject({ ok: true, toast: 'Retry: running' });
    expect(called(app.calls, 'sentinel.runRow')).toEqual([['sn1', 'jobs', 'retry', rowsMetric.rows![0]]]);
    // A web page shows as its source: nothing in it runs.
    await app.screens.press('sentinel', 'cell:doc', undefined, viewport);
    app.screens.view('sentinel', viewport);
    await app.settle();
    const page = app.screens.view('sentinel', viewport);
    expect(called(app.calls, 'sentinel.document')).toEqual([['sn1', 'jobs', 'doc', 'report.html']]);
    expect(flat(page).some((n) => n.k === 'code' && n.language === 'html')).toBe(true);
    await app.screens.press('sentinel', 'doc:open', undefined, viewport);
    expect(called(app.calls, 'sentinel.documentOpen')).toEqual([['sn1', 'jobs', 'doc', 'report.html', 'open']]);
    await app.screens.press('sentinel', 'back', undefined, viewport);
    // A storage object is fetched when opened, and its link is signed only on a press.
    await app.screens.press('sentinel', 'cell:object', undefined, viewport);
    app.screens.view('sentinel', viewport);
    await app.settle();
    const stored = app.screens.view('sentinel', viewport);
    expect(called(app.calls, 'sentinel.storageDocument')).toEqual([['sn1', 'jobs', 'object', 'bucket/a/b.pdf']]);
    expect(words(stored)).toContain('In Storage: bucket/a/b.pdf');
    expect(called(app.calls, 'sentinel.signStorage')).toEqual([]);
    await app.screens.press('sentinel', 'doc:sign', undefined, viewport);
    expect(called(app.calls, 'sentinel.signStorage')).toEqual([['sn1', 'jobs', 'object', 'bucket/a/b.pdf']]);
    expect(flat(app.screens.view('sentinel', viewport)).some((n) => n.k === 'link' && n.href.startsWith('https://storage.example/'))).toBe(true);
    await app.screens.press('sentinel', 'doc:open', undefined, viewport);
    expect(called(app.calls, 'sentinel.storageOpen')).toEqual([['sn1', 'jobs', 'object', 'bucket/a/b.pdf', 'open']]);
  });

  it('reads a past run’s rows from its file, without its documents or actions', async () => {
    const app = started({ items: [item()], runs: [run()], metrics: { sn1: { jobs: rowsMetric } } });
    app.answers.set('sentinel.metricRead', () => ({ metric: rowsMetric, lines: [{ at: 1000, runId: 'old', rows: [{ name: 'Older', doc: 'gone.html', retry: null }], columns: ['name', 'doc', 'retry'] }] }));
    await at(app, { name: 'rows', params: { id: 'sn1', name: 'jobs', run: 'old' } });
    await app.settle();
    expect(words(app.screens.view('sentinel', viewport))).toContain('Older');
    await app.screens.press('sentinel', 'rows:0', undefined, viewport);
    const row = app.screens.view('sentinel', viewport);
    expect(hasKey(row, 'cell:doc')).toBe(false);
    expect(hasKey(row, 'cell:retry')).toBe(false);
  });

  it('reads a metric’s whole history, and takes it out', async () => {
    const app = started({ items: [item()], runs: [run()], metrics: { sn1: { subscribers: metric() } } });
    app.answers.set('sentinel.metricRead', () => ({ metric: metric(), lines: [{ at: 1000, runId: 'r0', value: 100 }, { at: 2000, runId: 'run1', value: 120 }] }));
    const page = await at(app, { name: 'page', params: { id: 'sn1' } });
    expect(words(page)).toContain('Subscribers  120  +20 (+20%)');
    await app.screens.press('sentinel', 'metric:subscribers', undefined, viewport);
    app.screens.view('sentinel', viewport);
    await app.settle();
    const tree = app.screens.view('sentinel', viewport);
    expect(called(app.calls, 'sentinel.metricRead')).toEqual([['sn1', 'subscribers']]);
    expect(words(tree)).toContain('2 runs');
    expect(words(tree)).toContain('120');
    await app.screens.press('sentinel', 'metric:csv', undefined, viewport);
    await app.screens.press('sentinel', 'metric:json', undefined, viewport);
    await app.screens.press('sentinel', 'metric:reveal', undefined, viewport);
    expect(called(app.calls, 'sentinel.dataExport')).toEqual([['sn1', { metric: 'subscribers', format: 'csv' }], ['sn1', { metric: 'subscribers', format: 'json' }]]);
    expect(called(app.calls, 'sentinel.dataReveal')).toEqual([['sn1']]);
  });

  it('shows on a run what that run kept', async () => {
    const app = started({ items: [item()], runs: [run()], metrics: { sn1: { subscribers: metric(), jobs: rowsMetric } } });
    app.answers.set('sentinel.runGet', () => ({ run: { ...run(), steps: [] }, report: 'Done' }));
    const tree = await at(app, { name: 'run', params: { run: 'run1', id: 'sn1' } });
    expect(words(tree)).toContain('Subscribers  120');
    expect(words(tree)).toContain('Jobs  2 rows');
  });
});

describe('the Sentinel chat', () => {
  const chats = { chats: [{ id: 'main', channel: sentinelChatChannel('main'), createdAt: 1 }, { id: 'abc', channel: sentinelChatChannel('abc'), createdAt: 2 }], active: 'main' };
  const said = { id: 'm1', type: 'chat', channel: sentinelChatChannel('main'), from: 'me', name: 'elad', text: 'What did they find?', ts: 1, byAgent: false };
  const answer = { id: 'r1', type: 'agent', channel: sentinelChatChannel('main'), subagents: [], requestId: 'q1', owner: 'me', ownerName: 'elad', requesterName: 'elad', status: 'done', text: 'I made `sentinel:sn1` for you', steps: [], ts: 2 };

  it('opens on the chat that is open, reads the log by channel, and sends by channel', async () => {
    const app = started({ chats, items: [item()] }, { log: [said, answer] as unknown as AppState['log'] });
    const tree = await at(app, { name: 'chat' });
    expect(words(tree)).toContain('What did they find?');
    expect(words(tree)).toContain('I made `sentinel:sn1` for you');
    await app.screens.press('sentinel', 'chat:main:box', ' And then? ', viewport);
    expect(called(app.calls, 'session.submit')).toEqual([['And then?', { channel: 'sentinel-chat:main' }]]);
    // A sentinel it names opens from here.
    await app.screens.press('sentinel', 'named:r1:sn1', undefined, viewport);
    expect(hasKey(app.screens.view('sentinel', viewport), 'run')).toBe(true);
  });

  it('lists the chats, opens one, makes one', async () => {
    const app = started({ chats }, { log: [said] as unknown as AppState['log'] });
    app.answers.set('sentinel.chatNew', () => ({ id: 'xyz', channel: sentinelChatChannel('xyz') }));
    await at(app, { name: 'chat' });
    await app.screens.press('sentinel', 'chats', undefined, viewport);
    const list = app.screens.view('sentinel', viewport);
    expect(words(list)).toContain('What did they find?');
    expect(words(list)).toContain('New chat');
    await app.screens.press('sentinel', 'open-chat:abc', undefined, viewport);
    expect(called(app.calls, 'sentinel.chatOpen')).toEqual([['abc']]);
    expect(hasKey(app.screens.view('sentinel', viewport), 'chat:abc:box')).toBe(true);
    await app.screens.press('sentinel', 'back', undefined, viewport);
    await app.screens.press('sentinel', 'chat:new', undefined, viewport);
    expect(called(app.calls, 'sentinel.chatNew')).toEqual([[]]);
  });

  it('clears and deletes only after asking', async () => {
    const app = started({ chats }, { log: [said] as unknown as AppState['log'] });
    await at(app, { name: 'chat-more', params: { chat: 'main' } });
    await app.screens.press('sentinel', 'chat:clear', undefined, viewport);
    expect(called(app.calls, 'sentinel.chatClear')).toEqual([]);
    await app.screens.press('sentinel', 'ask:yes', undefined, viewport);
    expect(called(app.calls, 'sentinel.chatClear')).toEqual([['main']]);
    await app.screens.press('sentinel', 'chat:delete', undefined, viewport);
    expect(called(app.calls, 'sentinel.chatDelete')).toEqual([]);
    expect(words(app.screens.view('sentinel', viewport))).toContain('go for good');
    await app.screens.press('sentinel', 'ask:yes', undefined, viewport);
    expect(called(app.calls, 'sentinel.chatDelete')).toEqual([['main']]);
  });

  it('starts empty with first asks, and has one to write in even before the engine says', async () => {
    const app = started();
    const tree = await at(app, { name: 'chat' });
    expect(words(tree)).toContain('Suggest Some for Me');
    await app.screens.press('sentinel', 'first:found', undefined, viewport);
    expect(called(app.calls, 'session.submit')[0]).toEqual([expect.stringContaining('What did my sentinels find'), { channel: 'sentinel-chat:main' }]);
  });

  it('shows what the conversation waits on you for, in place', async () => {
    const approval = { id: 'a1', kind: 'tool', title: 'Delete the uptime sentinel', detail: 'sentinel_remove', channel: sentinelChatChannel('main'), askedAt: 5 };
    const app = started({ chats }, { approvals: [approval] as unknown as AppState['approvals'] });
    const tree = await at(app, { name: 'chat' });
    expect(words(tree)).toContain('Delete the uptime sentinel');
    const approve = buttons(tree).find((b) => b.label === 'Approve');
    expect(approve).toBeDefined();
    await app.screens.press('sentinel', approve!.key, undefined, viewport);
    expect(called(app.calls, 'host.answerApproval')).toEqual([['yes', 'a1']]);
  });
});

describe('the dashboards', () => {
  const tiles = (): Tile[] => [
    { id: 't1', kind: 'number', width: 1, metric: { sentinelId: 'sn1', metric: 'subscribers' } },
    { id: 't2', kind: 'number', width: 1, metric: { sentinelId: 'sn1', metric: 'revenue' } },
    { id: 't3', kind: 'text', width: 2, sentinelId: 'sn1' },
    { id: 't4', kind: 'divider', width: 6, title: 'Money' },
  ];
  const board = (): Dashboard => ({ id: 'db1', name: 'Overview', compare: 'previous', tiles: tiles(), createdAt: 1, updatedAt: 2 });
  const metrics = { sn1: { subscribers: metric(), revenue: metric({ name: 'revenue', label: 'Revenue', unit: 'currency:USD', points: [{ at: 1000, value: 3000, runId: 'r0' }, { at: 2000, value: 2500, runId: 'run1' }] }) } };

  it('lists them, makes one, and opens a board with its tiles’ numbers as text and a sparkline', async () => {
    const app = started({ items: [item()], runs: [run()], metrics, dashboards: [board()] });
    app.answers.set('dashboard.create', () => ({ id: 'db2', name: 'Ops' }));
    const list = await at(app, { name: 'dashboards' });
    expect(words(list)).toContain('Overview');
    expect(words(list)).toContain('4 tiles');
    await app.screens.press('sentinel', 'board:new', undefined, viewport);
    await app.screens.press('sentinel', 'board:new-name', ' Ops ', viewport);
    expect(called(app.calls, 'dashboard.create')).toEqual([['Ops']]);
    await app.screens.press('sentinel', 'back', undefined, viewport);
    await app.screens.press('sentinel', 'board:db1', undefined, viewport);
    const tree = app.screens.view('sentinel', viewport);
    const said = words(tree);
    expect(said).toContain('Subscribers');
    expect(said).toContain('120  +20 (+20%)  vs the run before');
    expect(said).toContain('$2,500  −$500 (−16.7%)');
    expect(said).toContain(sparkline([100, 120], 48));
    expect(said).toContain('3 commits landed');
    expect(said).toContain('Money');
  });

  it('colours a change by which way is good, with theme keys only', async () => {
    const app = started({ items: [item()], runs: [run()], metrics, dashboards: [board()] });
    const tree = await at(app, { name: 'board', params: { board: 'db1' } });
    const spans = flat(tree).flatMap((n) => (n.k === 'text' ? n.spans : []));
    expect(spans.find((s) => s.t.includes('+20 (+20%)'))?.color).toBe('success');
    expect(spans.find((s) => s.t.includes('−$500'))?.color).toBe('error');
  });

  it('moves a tile with Move buttons, in place of a drag', async () => {
    const e = engine();
    const made = e.sentinels.create({ ...brief, steps: [] });
    const d = e.sentinels.dashboards.create('Overview');
    const a = e.sentinels.dashboards.addTile(d.id, { kind: 'text', sentinelId: made.id, width: 1, title: 'A' }).tile;
    const b = e.sentinels.dashboards.addTile(d.id, { kind: 'text', sentinelId: made.id, width: 1, title: 'B' }).tile;
    e.store.dispatch({ type: 'sentinel_dashboards', dashboards: e.sentinels.dashboards.list() });
    await e.go({ name: 'tile', params: { board: d.id, tile: a.id } });
    const first = e.view();
    expect(words(first)).toContain('Row 1, column 1 of 6');
    // Nowhere to go up or left from the first spot.
    expect(hasKey(first, 'tile:up')).toBe(false);
    expect(hasKey(first, 'tile:left')).toBe(false);
    await must(e, 'tile:right');
    expect(called(e.calls, 'dashboard.moveTile')).toEqual([[d.id, a.id, { col: 1, row: 0 }]]);
    e.store.dispatch({ type: 'sentinel_dashboards', dashboards: e.sentinels.dashboards.list() });
    const moved = e.sentinels.dashboards.get(d.id)!.tiles;
    expect(moved.find((t) => t.id === a.id)).toMatchObject({ col: 1, row: 0 });
    // Its neighbour swapped with it, and stays on the board.
    expect(moved.find((t) => t.id === b.id)).toMatchObject({ col: 0, row: 0 });
    expect(words(e.view())).toContain('Row 1, column 2 of 6');
    await must(e, 'tile:down');
    e.store.dispatch({ type: 'sentinel_dashboards', dashboards: e.sentinels.dashboards.list() });
    expect(e.sentinels.dashboards.get(d.id)!.tiles.find((t) => t.id === a.id)).toMatchObject({ col: 1, row: 1 });
    await must(e, 'tile:up');
    await must(e, 'tile:left');
    expect(called(e.calls, 'dashboard.moveTile').slice(1)).toEqual([[d.id, a.id, { col: 1, row: 1 }], [d.id, a.id, { col: 1, row: 0 }], [d.id, a.id, { col: 0, row: 0 }]]);
  });

  it('stops a tile a row past the board’s last, as a drag does', async () => {
    const lone: Dashboard = { id: 'db1', name: 'B', compare: 'previous', tiles: [{ id: 'a', kind: 'text', width: 1, sentinelId: 'sn1', col: 0, row: 1 }, { id: 'b', kind: 'text', width: 1, sentinelId: 'sn1', col: 0, row: 0 }], createdAt: 1, updatedAt: 1 };
    const app = started({ items: [item()], dashboards: [lone] });
    const tree = await at(app, { name: 'tile', params: { board: 'db1', tile: 'a' } });
    expect(words(tree)).toContain('Row 2, column 1 of 6');
    expect(hasKey(tree, 'tile:down')).toBe(true);
    const below = { ...lone, tiles: [{ ...lone.tiles[0]!, row: 2 }, lone.tiles[1]!] };
    app.set({ sentinel: stateOf({ items: [item()], dashboards: [below] }) });
    expect(hasKey(app.screens.view('sentinel', viewport), 'tile:down')).toBe(false);
  });

  it('adds by description, and through a pick', async () => {
    const e = engine();
    const made = e.sentinels.create({ ...brief });
    const d = e.sentinels.dashboards.create('Overview');
    e.store.dispatch({ type: 'sentinel_dashboards', dashboards: e.sentinels.dashboards.list() });
    e.answers.set('dashboard.ask', (args) => void parseArgs('dashboard.ask', args));
    await e.go({ name: 'board', params: { board: d.id } });
    await must(e, 'board:add');
    await must(e, 'add:words', 'revenue per day');
    expect(called(e.calls, 'dashboard.ask')).toEqual([[d.id, 'revenue per day']]);
    expect(hasKey(e.view(), 'board:add')).toBe(true);
    // Somewhere new.
    await must(e, 'board:add');
    await must(e, 'new:stripe');
    await must(e, 'idea:0');
    expect(called(e.calls, 'dashboard.ask')[1]).toEqual([d.id, 'Add a tile from Stripe: Revenue per day. If no sentinel fetches it yet, set one up (a draft) that does.']);
    // What a sentinel said last, then a step's output, then a heading.
    await must(e, 'board:add');
    await must(e, `pick:report:${made.id}`);
    await must(e, 'add:size', 'wide');
    await must(e, 'add:yes');
    await must(e, 'board:add');
    await must(e, `pick:step:${made.id}:${made.steps[0]!.id}`);
    await must(e, 'add:title', 'The brief');
    await must(e, 'board:add');
    await must(e, 'heading');
    await must(e, 'add:title', 'Money');
    const added = e.sentinels.dashboards.get(d.id)!.tiles;
    expect(added).toMatchObject([
      { kind: 'text', sentinelId: made.id, text: 'report', width: 2 },
      { kind: 'output', step: { sentinelId: made.id, stepId: made.steps[0]!.id }, title: 'The brief', height: 2 },
      { kind: 'divider', title: 'Money' },
    ]);
  });

  it('picks how a kept number shows', async () => {
    const app = started({ items: [item()], metrics, dashboards: [board()] });
    await at(app, { name: 'add-pick', params: { board: 'db1', kind: 'metric', sentinel: 'sn1', metric: 'subscribers' } });
    await app.screens.press('sentinel', 'add:look', 'bars', viewport);
    await app.screens.press('sentinel', 'add:size', 'full', viewport);
    await app.screens.press('sentinel', 'add:yes', undefined, viewport);
    expect(called(app.calls, 'dashboard.addTile')).toEqual([['db1', { kind: 'series', metrics: [{ sentinelId: 'sn1', metric: 'subscribers' }], chart: 'bar', width: 6 }]]);
  });

  it('updates a tile from its own page, and refreshes a board', async () => {
    const app = started({ items: [item()], runs: [run()], metrics, dashboards: [board()] });
    await at(app, { name: 'tile-more', params: { board: 'db1', tile: 't1' } });
    await app.screens.press('sentinel', 'tile:title', 'Subs', viewport);
    await app.screens.press('sentinel', 'tile:width', '3', viewport);
    await app.screens.press('sentinel', 'tile:height', '2', viewport);
    await app.screens.press('sentinel', 'tile:compare', 'week', viewport);
    expect(called(app.calls, 'dashboard.updateTile')).toEqual([['db1', 't1', { title: 'Subs' }], ['db1', 't1', { width: 3 }], ['db1', 't1', { height: 2 }], ['db1', 't1', { compare: 'week' }]]);
    await at(app, { name: 'board', params: { board: 'db1' } });
    await app.screens.press('sentinel', 'board:refresh', undefined, viewport);
    expect(called(app.calls, 'dashboard.refresh')).toEqual([['db1']]);
    app.set({ sentinel: stateOf({ items: [item()], metrics, dashboards: [board()], refreshing: { db1: { done: 1, total: 3 } } }) });
    expect(words(app.screens.view('sentinel', viewport))).toContain('Fetching... 2 of 3');
  });

  it('removes a tile and a board only after asking', async () => {
    const app = started({ items: [item()], runs: [run()], metrics, dashboards: [board()] });
    await at(app, { name: 'tile-more', params: { board: 'db1', tile: 't1' } });
    await app.screens.press('sentinel', 'tile:remove', undefined, viewport);
    expect(called(app.calls, 'dashboard.removeTile')).toEqual([]);
    await app.screens.press('sentinel', 'ask:yes', undefined, viewport);
    expect(called(app.calls, 'dashboard.removeTile')).toEqual([['db1', 't1']]);
    await at(app, { name: 'board-more', params: { board: 'db1' } });
    await app.screens.press('sentinel', 'board:delete', undefined, viewport);
    expect(called(app.calls, 'dashboard.remove')).toEqual([]);
    await app.screens.press('sentinel', 'ask:yes', undefined, viewport);
    expect(called(app.calls, 'dashboard.remove')).toEqual([['db1']]);
  });

  it('renames, sets what every tile compares with, and copies as Markdown', async () => {
    const app = started({ items: [item()], runs: [run()], metrics, dashboards: [board()] });
    await at(app, { name: 'board-more', params: { board: 'db1' } });
    await app.screens.press('sentinel', 'board:name', 'Numbers', viewport);
    await app.screens.press('sentinel', 'board:compare', 'month', viewport);
    expect(called(app.calls, 'dashboard.update')).toEqual([['db1', { name: 'Numbers' }], ['db1', { compare: 'month' }]]);
    const copied = await app.screens.press('sentinel', 'board:copy', undefined, viewport);
    expect(copied.copy).toContain('| Subscribers | 120 |');
  });

  it('says quietly what a tile can’t draw', async () => {
    const paused = item({ id: 'sn2', paused: true });
    const drawn = async (metricRef: { sentinelId: string; metric: string }): Promise<string> => {
      const tile: Tile = { id: 'x', kind: 'number', width: 1, metric: metricRef, title: 'A number' };
      const app = started({ items: [item(), paused], runs: [run(), run({ id: 'r2', sentinelId: 'sn2' })], dashboards: [{ id: 'db', name: 'B', compare: 'previous', tiles: [tile], createdAt: 1, updatedAt: 1 }] });
      return words(await at(app, { name: 'board', params: { board: 'db' } }));
    };
    expect(await drawn({ sentinelId: 'gone', metric: 'x' })).toContain('gone');
    expect(await drawn({ sentinelId: 'sn1', metric: 'nope' })).toContain('waiting for its first run');
    expect(await drawn({ sentinelId: 'sn2', metric: 'x' })).toContain('paused');
  });

  it('offers a draft your agent made, one press from on', async () => {
    const draft = item({ id: 'sn9', name: 'Open pull requests', paused: true });
    const ask = { channel: 'ws:c1', startedAt: 1, state: 'done' as const, text: 'open prs', answer: 'Added `sentinel:sn9`', made: ['sn9'] };
    const app = started({ items: [draft], dashboards: [board()], dashboardAsks: { db1: ask } });
    const tree = await at(app, { name: 'board', params: { board: 'db1' } });
    expect(words(tree)).toContain('Added “Open pull requests”');
    expect(words(tree)).toContain('It’s a draft: nothing runs until you turn it on');
    await app.screens.press('sentinel', 'draft:sn9:on', undefined, viewport);
    expect(called(app.calls, 'sentinel.pause')).toEqual([['sn9', false]]);
  });

  it('draws its sparkline from a tile’s points', () => {
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8])).toBe('▁▂▃▄▅▆▇█');
    expect(sparkline([5, 5, 5])).toBe('▄▄▄');
    expect(sparkline([1])).toBe('');
  });
});

// ---------------------------------------------------------------- the rules every screen keeps

describe('a long list', () => {
  const many = Array.from({ length: 200 }, (_, i) => item({ id: `sn${i}`, name: `Sentinel ${String(i).padStart(3, '0')}` }));

  const rowsOf = (tree: Node): number => buttons(tree).filter((b) => b.key.startsWith('sn:')).length;

  it('windows the sentinels, and More moves along without ever holding more than a draw should', async () => {
    const app = started({ items: many });
    let tree = app.screens.view('sentinel', viewport);
    expect(rowsOf(tree)).toBeLessThanOrEqual(MOST_ROWS);
    expect(words(tree)).not.toContain('Sentinel 150');
    for (let i = 0; i < 6; i++) {
      await app.screens.press('sentinel', 'list:more', undefined, viewport);
      tree = app.screens.view('sentinel', viewport);
      expect(rowsOf(tree)).toBeLessThanOrEqual(MOST_ROWS);
    }
    expect(words(tree)).toContain('Sentinel 199');
    expect(labelled(tree, 'Earlier (100)')).toBeDefined();
    await app.screens.press('sentinel', 'list:earlier', undefined, viewport);
    expect(words(app.screens.view('sentinel', viewport))).toContain('Sentinel 090');
  });

  it('windows a conversation from its newest end', async () => {
    const said = Array.from({ length: 300 }, (_, i) => ({ id: `m${i}`, type: 'chat', channel: sentinelChatChannel('main'), from: 'me', name: 'elad', text: `message ${i}.`, ts: i, byAgent: false }));
    const app = started({}, { log: said as unknown as AppState['log'] });
    const tree = await at(app, { name: 'chat' });
    expect(words(tree)).toContain('message 299.');
    expect(words(tree)).not.toContain('message 200.');
    const key = `chat:${sentinelChatChannel('main')}:earlier`;
    for (let i = 0; i < 12; i++) await app.screens.press('sentinel', key, undefined, viewport);
    const back = app.screens.view('sentinel', viewport);
    expect(flat(back).filter((n) => n.k === 'md').length).toBeLessThanOrEqual(MOST_ROWS);
    expect(words(back)).toContain('message 0.');
  });

  it('windows a board’s tiles and what can be added to it', async () => {
    const tiles: Tile[] = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, kind: 'text', width: 1, sentinelId: 'sn0' }));
    const app = started({ items: many, dashboards: [{ id: 'db1', name: 'B', compare: 'previous', tiles, createdAt: 1, updatedAt: 1 }] });
    const board = await at(app, { name: 'board', params: { board: 'db1' } });
    expect(buttons(board).filter((b) => b.key.startsWith('tile:')).length).toBeLessThanOrEqual(40);
    const add = await at(app, { name: 'add', params: { board: 'db1' } });
    expect(buttons(add).filter((b) => b.key.startsWith('pick:')).length).toBeLessThanOrEqual(MOST_ROWS);
    expect(buttons(add).some((b) => /^More \(\d+\)$/.test(b.label))).toBe(true);
  });
});

/** A sentinel of each kind of trigger and step, with a run in each state and a number of each kind. */
function richState(): { sentinel: SentinelState; more: Partial<AppState> } {
  const kinds: Sentinel['steps'] = [
    { id: 's1', name: 'Ask', kind: 'claude', prompt: 'p', where: 'worktree' },
    { id: 's2', name: 'Script', kind: 'script', command: 'c', cwd: 'project', timeoutSec: 120 },
    { id: 's3', name: 'Own script', kind: 'script', command: '', code: 'echo', language: 'bash', cwd: 'project', timeoutSec: 777 },
    { id: 's4', name: 'Notify', kind: 'notify', phone: false },
    { id: 's5', name: 'Http', kind: 'http', method: 'POST', url: 'https://x.example', headers: { A: 'b', C: 'd' }, body: '{}', timeoutSec: 30, preset: 'groqbot' },
    { id: 's6', name: 'Pr', kind: 'pr' },
    { id: 's7', name: 'Merge', kind: 'merge', require: { checks: true, approval: true }, method: 'squash' },
    { id: 's8', name: 'Message', kind: 'message', to: 'dm:p1', text: 't' },
    { id: 's9', name: 'Friend', kind: 'friend', peerId: 'p1', prompt: 'q' },
    { id: 's10', name: 'Trigger', kind: 'trigger', sentinelId: 'sn2' },
    { id: 's11', name: 'Keep', kind: 'measure', from: 'source', source: { kind: 'postgres', env: 'DB', query: 'select 1' }, metrics: [{ name: 'a', label: 'A', unit: 'count' }, { name: 'b', kind: 'rows' }] },
    { id: 's12', name: 'Keep http', kind: 'measure', from: 'source', source: { kind: 'http', url: 'https://x.example', method: 'GET', format: 'auto' }, metrics: [] },
    { id: 's13', name: 'Keep agent', kind: 'measure', from: 'claude', metrics: [{ name: 'c' }] },
  ];
  const triggers: Array<Sentinel['trigger']> = [
    daily,
    { kind: 'schedule', every: 'week', at: '09:00', days: [1, 3], missed: 'skip' },
    { kind: 'schedule', every: 'month', at: '09:00', day: 3, missed: 'skip' },
    { kind: 'schedule', every: 'hours', at: '00:00', hours: 3, missed: 'catch-up' },
    { kind: 'manual' },
    { kind: 'after', sentinelId: 'sn0', on: 'failure' },
    { kind: 'teamod', what: 'task-done', projectId: 'p1' },
    { kind: 'github', what: 'issue-labelled', label: 'bug', minutes: 7 },
    { kind: 'stripe', what: 'refund' },
    { kind: 'uptime', url: 'https://x.example', minutes: 5, expect: 418 },
    { kind: 'sentry', org: 'o', project: 'p', what: 'spike' },
    { kind: 'webhook', signature: 'github' },
  ];
  const items = triggers.map((trigger, i) => item({ id: `sn${i}`, name: `Sentinel ${i}`, trigger, steps: kinds, access: 'ship', paused: i % 3 === 0, ...(i === 3 ? { pausedWhy: 'Paused after 3 failures in a row' } : i === 6 ? { pausedWhy: 'claude-changed' } : {}), ...(i % 2 ? { projectId: 'p1' } : {}) }));
  const states = ['queued', 'running', 'needs-you', 'done', 'skipped', 'failed', 'stopped'] as const;
  const runs = states.map((state, i) => run({ id: `run${i}`, sentinelId: `sn${i}`, state, channel: i % 2 ? `ws:w${i}` : `mac:assistant:m${i}`, worktreeId: 'w1', pr: { number: i, url: 'https://github.com/a/b/pull/1' }, tasks: ['BOB-1', 'BOB-2'], steps: [{ id: 's1', state: i === 1 ? 'running' : 'done', channel: 'ws:w1' }, { id: 's2', state: 'failed', why: 'no' }, { id: 's3', state: 'waiting' }, { id: 's4', state: 'skipped' }], ...(i === 6 ? { why: 'Why it stopped' } : {}) }));
  const numbers = {
    n1: metric({ sentinelId: 'sn1', name: 'n1' }),
    r1: metric({ sentinelId: 'sn1', name: 'r1', kind: 'rows', rows: [{ a: 1, b: 'doc.pdf', c: 'bucket/p', d: null, e: 'https://x.example', p: 40, s: '1,2,3', dl: -3, pe: 'a@b.c', ra: 4 }], columns: ['a', 'b', 'c', 'd', 'e', 'p', 's', 'dl', 'pe', 'ra'], columnTypes: [{ key: 'b', type: 'file' }, { key: 'c', type: 'storage' }, { key: 'd', type: 'action', sentinel: 'sn0' }, { key: 'e', type: 'url' }, { key: 'p', type: 'progress' }, { key: 's', type: 'sparkline' }, { key: 'dl', type: 'delta' }, { key: 'pe', type: 'person' }, { key: 'ra', type: 'rating' }], rowsRunId: 'run1', rowsAt: 2 }),
    s1: metric({ sentinelId: 'sn1', name: 's1', kind: 'series', series: [{ x: 'Mon', y: 1 }, { x: 'Tue', y: 2 }] }),
    o1: metric({ sentinelId: 'sn1', name: 'o1', kind: 'output', output: { text: '# Hi', format: 'markdown' } }),
  };
  const ref = (name: string) => ({ sentinelId: 'sn1', metric: name });
  const tiles: Tile[] = [
    { id: 't1', kind: 'number', width: 1, metric: ref('n1') },
    { id: 't2', kind: 'series', width: 3, metrics: [ref('n1'), ref('n1')], chart: 'line' },
    { id: 't3', kind: 'series', width: 3, metric: ref('s1'), chart: 'bar' },
    { id: 't4', kind: 'table', width: 3, metric: ref('r1'), columns: [{ key: 'a', label: 'First' }] },
    { id: 't5', kind: 'output', width: 3, metric: ref('o1') },
    { id: 't6', kind: 'output', width: 3, step: { sentinelId: 'sn1', stepId: 's1' }, show: 'markdown' },
    { id: 't7', kind: 'output', width: 3, step: { sentinelId: 'sn1', stepId: 's2' } },
    { id: 't8', kind: 'output', width: 3, step: { sentinelId: 'sn1', stepId: 's5' }, show: 'table' },
    { id: 't9', kind: 'text', width: 2, sentinelId: 'sn1', text: 'report' },
    { id: 't10', kind: 'text', width: 2, sentinelId: 'sn0' },
    { id: 't11', kind: 'divider', width: 6, title: 'Money' },
    { id: 't12', kind: 'number', width: 1, metric: { sentinelId: 'gone', metric: 'x' } },
  ];
  const sentinel = stateOf({
    items,
    runs,
    live: { run1: { stepId: 's1', state: 'running' } },
    nextAt: { sn1: Date.now() + 3_600_000 },
    asks: { sn1: { channel: 'ws:w1', startedAt: 1, state: 'writing', text: 'x' } },
    troubles: { sn2: 'Sign in to GitHub first' },
    metrics: { sn1: numbers },
    dashboards: [{ id: 'db1', name: 'Overview', compare: 'previous', tiles, createdAt: 1, updatedAt: 1 }, { id: 'db2', name: 'Empty', compare: 'week', tiles: [], createdAt: 1, updatedAt: 1 }],
    refreshing: { db2: { done: 1, total: 3 } },
    dashboardAsks: { db1: { channel: 'ws:w1', startedAt: 1, state: 'done', text: 'x', made: ['sn0'] } },
    outputs: { sn1: { s1: { runId: 'run1', at: 1, format: 'markdown', text: '# Hello' }, s2: { runId: 'run1', at: 1, format: 'text', text: 'plain', cut: true }, s5: { runId: 'run1', at: 1, format: 'json', text: '[{"a":1},{"a":2}]' } } },
    chats: { chats: [{ id: 'main', channel: sentinelChatChannel('main'), createdAt: 1 }, { id: 'abc', channel: sentinelChatChannel('abc'), createdAt: 2 }], active: 'main' },
  });
  const log = [
    { id: 'l1', type: 'chat', channel: sentinelChatChannel('main'), from: 'me', name: 'elad', text: 'Hi', ts: 1, byAgent: false },
    { id: 'l2', type: 'agent', channel: sentinelChatChannel('main'), subagents: [], requestId: 'q1', owner: 'me', ownerName: 'elad', requesterName: 'elad', agent: { runtime: 'codex', label: 'Codex' }, status: 'tool', text: 'See sentinel:sn1 and sentinel:sn2', steps: ['Read'], ts: 2 },
    { id: 'l3', type: 'agent', channel: sentinelChatChannel('main'), subagents: [], requestId: 'q2', owner: 'me', ownerName: 'elad', requesterName: 'elad', prompt: 'Next', status: 'queued', text: '', steps: [], ts: 3 },
    { id: 'l4', type: 'system', channel: sentinelChatChannel('main'), text: 'A line', ts: 4, level: 'info' },
    { id: 'l5', type: 'shell', channel: sentinelChatChannel('main'), ts: 5, owner: 'me', ownerName: 'elad', by: 'you', command: 'ls', status: 'done', output: '' },
  ];
  const projects = [{ id: 'p1', name: 'alpha', root: '/r/alpha', base: 'main', workspaces: [] }];
  const network = { enabled: true, friends: [{ peerId: 'p1', name: 'Bob' }], groups: [{ id: 'g1', name: 'Team', active: true }], invitations: [], pendingJoins: [], messages: {} };
  const board = { enabled: true, issues: [{ id: 'i1', key: 'BOB-1', title: 'A task' }] };
  return { sentinel, more: { log, projects, network, selfId: 'me', board, runtimes: [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: false, why: 'Not set up' }], models: [{ value: 'opus', label: 'Opus' }] } as unknown as Partial<AppState> };
}

const ROUTES: readonly Route[] = [
  { name: 'list' },
  { name: 'list-more' },
  { name: 'new' },
  { name: 'new', params: { way: 'recipe' } },
  { name: 'new', params: { way: 'build' } },
  ...Array.from({ length: 12 }, (_, i) => [
    { name: 'page', params: { id: `sn${i}` } },
    { name: 'more', params: { id: `sn${i}` } },
    { name: 'when', params: { id: `sn${i}` } },
  ]).flat(),
  { name: 'webhook', params: { id: 'sn11' } },
  { name: 'webhook', params: { id: 'sn0' } },
  { name: 'runs', params: { id: 'sn1' } },
  { name: 'add-step', params: { id: 'sn1' } },
  ...Array.from({ length: 13 }, (_, i) => [
    { name: 'step', params: { id: 'sn1', step: `s${i + 1}` } },
    { name: 'step-more', params: { id: 'sn1', step: `s${i + 1}` } },
  ]).flat(),
  { name: 'step', params: { id: 'sn1', step: 'gone' } },
  { name: 'spec', params: { id: 'sn1', step: 's11', at: '0' } },
  { name: 'spec', params: { id: 'sn1', step: 's11', at: '1' } },
  { name: 'spec', params: { id: 'sn1', step: 's13', at: '0' } },
  { name: 'spec', params: { id: 'sn1', step: 's11', at: '9' } },
  { name: 'data', params: { id: 'sn1' } },
  { name: 'files', params: { id: 'sn1', run: 'run1' } },
  { name: 'metric', params: { id: 'sn1', name: 'n1' } },
  { name: 'metric', params: { id: 'sn1', name: 's1' } },
  { name: 'metric', params: { id: 'sn1', name: 'o1' } },
  { name: 'rows', params: { id: 'sn1', name: 'r1' } },
  { name: 'rows', params: { id: 'sn1', name: 'r1', run: 'old' } },
  { name: 'row', params: { id: 'sn1', name: 'r1', at: '0' } },
  { name: 'row', params: { id: 'sn1', name: 'r1', at: '9' } },
  ...Array.from({ length: 7 }, (_, i) => [
    { name: 'run', params: { run: `run${i}`, id: `sn${i}` } },
    { name: 'run-more', params: { run: `run${i}`, id: `sn${i}` } },
  ]).flat(),
  { name: 'run', params: { run: 'gone' } },
  { name: 'session', params: { channel: 'mac:assistant:m0' } },
  { name: 'session', params: { channel: 'ws:w1' } },
  { name: 'document', params: { source: 'kept', id: 'sn1', metric: 'r1', column: 'b', name: 'doc.pdf' } },
  { name: 'document', params: { source: 'storage', id: 'sn1', metric: 'r1', column: 'c', name: 'bucket/p' } },
  { name: 'document', params: { source: 'run', id: 'sn1', metric: 'run1', column: '', name: 'report.md' } },
  { name: 'chat' },
  { name: 'chat', params: { chat: 'abc' } },
  { name: 'chat', params: { chat: 'gone' } },
  { name: 'chats' },
  { name: 'chat-more', params: { chat: 'main' } },
  { name: 'dashboards' },
  { name: 'board', params: { board: 'db1' } },
  { name: 'board', params: { board: 'db2' } },
  { name: 'board', params: { board: 'gone' } },
  { name: 'board-more', params: { board: 'db1' } },
  ...Array.from({ length: 12 }, (_, i) => [
    { name: 'tile', params: { board: 'db1', tile: `t${i + 1}` } },
    { name: 'tile-more', params: { board: 'db1', tile: `t${i + 1}` } },
  ]).flat(),
  { name: 'tile', params: { board: 'db1', tile: 'gone' } },
  { name: 'add', params: { board: 'db1' } },
  { name: 'add-new', params: { board: 'db1', source: 'stripe' } },
  { name: 'add-new', params: { board: 'db1', source: 'nope' } },
  { name: 'add-pick', params: { board: 'db1', kind: 'metric', sentinel: 'sn1', metric: 'n1' } },
  { name: 'add-pick', params: { board: 'db1', kind: 'metric', sentinel: 'sn1', metric: 'r1' } },
  { name: 'add-pick', params: { board: 'db1', kind: 'metric', sentinel: 'sn1', metric: 's1' } },
  { name: 'add-pick', params: { board: 'db1', kind: 'metric', sentinel: 'sn1', metric: 'o1' } },
  { name: 'add-pick', params: { board: 'db1', kind: 'step', sentinel: 'sn1', step: 's1' } },
  { name: 'add-pick', params: { board: 'db1', kind: 'report', sentinel: 'sn1' } },
  { name: 'add-pick', params: { board: 'db1', kind: 'heading' } },
  ...(['remove', 'rotate'] as const).map((what) => ({ name: 'ask', params: { what, id: 'sn11' } })),
  { name: 'ask', params: { what: 'access', id: 'sn0', access: 'ship' } },
  { name: 'ask', params: { what: 'merge-alone', id: 'sn0', step: 's7' } },
  { name: 'ask', params: { what: 'remove-step', id: 'sn0', step: 's7' } },
  { name: 'ask', params: { what: 'run-chat', run: 'run3' } },
  { name: 'ask', params: { what: 'run', run: 'run3' } },
  { name: 'ask', params: { what: 'board', board: 'db1' } },
  { name: 'ask', params: { what: 'tile', board: 'db1', tile: 't1' } },
  { name: 'ask', params: { what: 'chat', chat: 'main' } },
  { name: 'ask', params: { what: 'chat-clear', chat: 'main' } },
  { name: 'ask', params: { what: 'nonsense' } },
];

const TOP_ROW = ['w', 'k', 't', 'o', 'l', 'g'];
const PLACE_KEYS = ['s', 'd', 'c'];
const THEME = new Set(['success', 'error', 'warning', 'claude']);

describe('every page of Sentinel', () => {
  /** Each route, on each surface, with what it fetches landed. */
  async function everyDraw(check: (tree: Node, route: Route, surface: string) => void): Promise<void> {
    const { sentinel, more } = richState();
    for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
      for (const route of ROUTES) {
        const app = started({}, more);
        app.set({ sentinel });
        app.answers.set('sentinel.recipes', () => [recipeById('morning-brief'), recipeById('nightly-tests'), recipeById('stripe-revenue')]);
        app.answers.set('sentinel.runGet', ([id]) => ({ run: { ...run({ id: id as string }), steps: [{ id: 's1', state: 'done', output: 'out', channel: 'ws:w1' }] }, report: '# R' }));
        app.answers.set('sentinel.runs', () => sentinel.runs);
        app.answers.set('sentinel.dataList', () => ({ metrics: [{ name: 'n1', label: 'N', kind: 'number', unit: 'count', lines: 2, first: 1, last: 2 }, { name: 'r1', label: 'R', kind: 'rows', unit: 'count', lines: 1, rows: 2 }], runs: [{ runId: 'run1', at: 1, headline: 'H', state: 'done', files: [{ name: 'report.md', label: 'Report', kind: 'report', size: 2 }, { name: 'step-1.txt', label: 'Step', kind: 'step', size: 2 }] }], keepsDays: 14 }));
        app.answers.set('sentinel.metricRead', ([, name]) => ({ metric: sentinel.metrics!.sn1![name as string], lines: [{ at: 1, runId: 'r0', value: 1 }, { at: 2, runId: 'r1', rows: [{ a: 1 }], columns: ['a'] }, { at: 3, runId: 'r2', series: [{ x: 'a', y: 1 }, { x: 'b', y: 2 }] }, { at: 4, runId: 'r3', output: { text: 'x', format: 'text' } }, { at: 5, runId: 'old', rows: [{ a: 1 }], columns: ['a'] }] }));
        app.answers.set('sentinel.webhookUrl', () => ({ url: 'https://x.example/hook/a/b', why: 'It’s paused', signingSecret: 'c' }));
        app.answers.set('sentinel.document', () => ({ name: 'doc.pdf', mime: 'application/pdf', size: 2, base64: 'AA', runId: 'run1' }));
        app.answers.set('sentinel.storageDocument', () => ({ name: 'p', mime: 'image/png', size: 2, base64: 'AA', runId: 'run1', bucket: 'bucket', path: 'p', at: 1 }));
        app.answers.set('sentinel.runFile', () => ({ name: 'R.md', mime: 'application/json', size: 2, text: '{}', cut: true, runId: 'run1', tooBig: false }));
        const viewportHere = { ...viewport, surface };
        app.screens.nav.go('sentinel', route);
        app.screens.view('sentinel', viewportHere);
        await app.settle();
        check(app.screens.view('sentinel', viewportHere), route, surface);
      }
    }
  }

  it('draws without failing, with the top of every screen', async () => {
    await everyDraw((tree, route) => {
      const said = words(tree);
      expect(said, JSON.stringify(route)).not.toContain('This screen failed');
      for (const key of ['screen:work', 'screen:sentinel', 'place:sentinels', 'place:dashboards', 'place:chat']) expect(hasKey(tree, key), `${key} on ${JSON.stringify(route)}`).toBe(true);
    });
  });

  it('keeps each hotkey to one thing, and off the reserved ones', async () => {
    await everyDraw((tree, route) => {
      const all = buttons(tree).flatMap((b) => (b.hotkey ? [{ key: b.key, hotkey: b.hotkey }] : []));
      const seen = all.map((x) => x.hotkey);
      expect(new Set(seen).size, `${JSON.stringify(route)}: ${seen.join(' ')}`).toBe(seen.length);
      for (const { key, hotkey } of all) {
        if (key.startsWith('screen:') || key.startsWith('place:') || key === 'back') continue;
        expect([...TOP_ROW, ...PLACE_KEYS, 'b'], `${key} on ${JSON.stringify(route)}`).not.toContain(hotkey);
        expect(hotkey).toMatch(/^[a-z0-9]$/);
      }
    });
  });

  it('has one main action at most', async () => {
    await everyDraw((tree, route) => {
      expect(buttons(tree).filter((b) => b.primary).length, JSON.stringify(route)).toBeLessThanOrEqual(1);
    });
  });

  it('colours only with the theme, says agent, and has no emoji', async () => {
    await everyDraw((tree, route) => {
      for (const n of flat(tree)) {
        const spans = n.k === 'text' ? n.spans : n.k === 'button' ? (n.spans ?? []) : [];
        for (const s of spans) if (s.color) expect(THEME.has(s.color), `${s.color} on ${JSON.stringify(route)}`).toBe(true);
      }
      const said = words(tree);
      expect(said, JSON.stringify(route)).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(said, JSON.stringify(route)).not.toMatch(/\bClaude\b/);
    });
  });

  it('never lets a select be empty or say the same value twice', async () => {
    await everyDraw((tree, route) => {
      for (const n of flat(tree)) {
        if (n.k !== 'select') continue;
        expect(n.options.length, `${n.key} on ${JSON.stringify(route)}`).toBeGreaterThan(0);
        expect(new Set(n.options.map((o) => o.value)).size, `${n.key} on ${JSON.stringify(route)}`).toBe(n.options.length);
        expect(n.options.some((o) => o.value === n.value), `${n.key} shows a value it doesn't list on ${JSON.stringify(route)}`).toBe(true);
      }
    });
  });

  it('draws fewer than the rows a draw may hold', async () => {
    await everyDraw((tree, route) => {
      expect(buttons(tree).length, JSON.stringify(route)).toBeLessThan(MOST_ROWS + 40);
    });
  });
});

describe('the methods', () => {
  const sources = readdirSync(path.join(__dirname, '../src/teamod/panes'))
    .filter((f) => /^sentinel(-.*)?\.ts$/.test(f))
    .map((f) => readFileSync(path.join(__dirname, '../src/teamod/panes', f), 'utf8'))
    .join('\n');

  it('wires every one this screen is down for', () => {
    const mine = Object.entries(SURFACE).flatMap(([method, surface]) => ('on' in surface && surface.on === 'sentinel' ? [method] : []));
    expect(mine.length).toBeGreaterThan(40);
    expect(mine.filter((method) => !sources.includes(`'${method}'`))).toEqual([]);
  });

  it('calls nothing the bridge would refuse', () => {
    const quoted = [...new Set([...sources.matchAll(/ctx\.call\(\s*'([a-zA-Z]+\.[a-zA-Z]+)'/g)].map((m) => m[1]!))];
    expect(quoted.length).toBeGreaterThan(40);
    expect(quoted.filter((m) => { const s = SURFACE[m as Method]; return !s || 'dropped' in s; })).toEqual([]);
  });
});

describe('when Sentinel isn’t on', () => {
  it('says so and draws no more', () => {
    const app = start();
    expect(words(app.screens.view('sentinel', viewport))).toContain('Sentinel isn’t on');
  });
});
