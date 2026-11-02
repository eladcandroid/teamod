import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// env.ts sets the home as it loads: keep it on the test's own, never the real ~/.teamod.
vi.hoisted(() => {
  process.env.TEAMOD_HOME = process.env.TEAMOD_HOME;
});

import { DaemonServer } from '../src/daemon/server.js';
import { Store, initialState } from '../src/core/store.js';
import { Bridge, type BridgeLine, connectAsMod } from '../src/teamod/bridge.js';
import { daemonEnv } from '../src/teamod/launch.js';
import { teamodHome } from '../src/teamod/env.js';
import { waitFor } from './helpers.js';

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

const ask = (socket: string, target: string, opts: { key?: string; method?: string; body?: string } = {}): Promise<{ status: number; body: unknown }> =>
  new Promise((resolve, reject) => {
    const req = request({ socketPath: socket, path: target, method: opts.method ?? 'GET', headers: opts.key ? { authorization: `Bearer ${opts.key}` } : {} }, (res) => {
      let text = '';
      res.on('data', (part: Buffer) => (text += part.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as unknown }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });

const project = { id: 'p1', name: 'alpha', root: '/tmp/alpha', base: 'main', workspaces: [] };

async function start(): Promise<{ store: Store; bridge: Bridge; lines: BridgeLine[]; daemon: DaemonServer; port: number; token: string }> {
  const store = new Store(initialState('room'));
  const token = 'a'.repeat(32);
  const session = { store, intents: { subscribe: () => () => undefined }, attend: () => undefined, detach: () => undefined };
  const daemon = new DaemonServer({ session: session as never, token, version: '1.0.0' });
  const port = await daemon.listen();
  cleanup.push(() => daemon.close());
  // Socket paths are short on macOS: /tmp, not the test home.
  const runDir = mkdtempSync(path.join('/tmp', 'tm-'));
  cleanup.push(() => rmSync(runDir, { recursive: true, force: true }));
  const lines: BridgeLine[] = [];
  const bridge = new Bridge({ runDir, connect: () => connectAsMod(port, token, '1.0.0'), out: (line) => lines.push(line) });
  await bridge.start();
  cleanup.push(() => bridge.stop());
  return { store, bridge, lines, daemon, port, token };
}

describe('the bridge', () => {
  it('says how to reach it, on a socket only the person can open', async () => {
    const { bridge, lines } = await start();
    expect(lines[0]).toEqual({ t: 'ready', socket: bridge.socketPath, key: bridge.key });
    expect(statSync(bridge.socketPath).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(bridge.socketPath)).mode & 0o777).toBe(0o700);
  });

  it('refuses a request without the key', async () => {
    const { bridge } = await start();
    expect((await ask(bridge.socketPath, '/view/work')).status).toBe(401);
    expect((await ask(bridge.socketPath, '/view/work', { key: 'x'.repeat(64) })).status).toBe(401);
  });

  it('serves a view, and says when a shown view changed', async () => {
    const { store, bridge, lines } = await start();
    const key = bridge.key;
    const before = JSON.stringify((await ask(bridge.socketPath, '/view/work?surface=terminal&columns=60&rows=30', { key })).body);
    expect(before).toContain('No projects yet');

    store.dispatch({ type: 'projects', projects: [project] });
    await waitFor(() => lines.some((l) => l.t === 'dirty' && l.routes.includes('work')));
    expect(JSON.stringify((await ask(bridge.socketPath, '/view/work?surface=terminal&columns=60&rows=30', { key })).body)).toContain('alpha');
  });

  it('stops telling once a pane closed', async () => {
    const { store, bridge, lines } = await start();
    const key = bridge.key;
    await ask(bridge.socketPath, '/view/work', { key });
    await ask(bridge.socketPath, '/view/work', { key, method: 'DELETE' });
    store.dispatch({ type: 'projects', projects: [project] });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(lines.filter((l) => l.t === 'dirty')).toEqual([]);
  });

  it('runs a press by key and refuses one that is gone', async () => {
    const { bridge } = await start();
    const key = bridge.key;
    await ask(bridge.socketPath, '/view/work', { key });
    const press = (k: string): Promise<{ status: number; body: unknown }> => ask(bridge.socketPath, '/press', { key, method: 'POST', body: JSON.stringify({ site: 'work', key: k }) });
    expect((await press('add')).body).toMatchObject({ ok: true });
    expect(JSON.stringify((await ask(bridge.socketPath, '/view/work', { key })).body)).toContain('add-path');
    expect((await press('gone')).body).toEqual({ ok: false, error: 'That is no longer there.' });
  });

  it('opens a pane by its name, and an empty command opens Work', async () => {
    const { bridge } = await start();
    const command = (text: string): Promise<{ status: number; body: unknown }> => ask(bridge.socketPath, '/command', { key: bridge.key, method: 'POST', body: JSON.stringify({ text }) });
    expect((await command('')).body).toEqual({ open: 'work', title: 'Work' });
    expect((await command('team')).body).toEqual({ open: 'team', title: 'Team' });
  });

  it('stays quiet about a change no shown view draws', async () => {
    const { store, bridge, lines } = await start();
    await ask(bridge.socketPath, '/view/work', { key: bridge.key });
    await new Promise((resolve) => setTimeout(resolve, 250));
    lines.length = 0;
    store.dispatch({ type: 'system', text: 'hello', id: 'm1', ts: 1 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(lines.filter((l) => l.t === 'dirty')).toEqual([]);
  });

  it('answers a failed call as a result, not a crash', async () => {
    const { bridge } = await start();
    const { status, body } = await ask(bridge.socketPath, '/call', { key: bridge.key, method: 'POST', body: JSON.stringify({ method: 'no.such', args: [] }) });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: false });
  });

  it('refuses a method teamod dropped', async () => {
    const { bridge } = await start();
    const { body } = await ask(bridge.socketPath, '/call', { key: bridge.key, method: 'POST', body: JSON.stringify({ method: 'companion.pair.start', args: [] }) });
    expect(body).toEqual({ ok: false, error: "teamod doesn't offer companion.pair.start" });
  });

  it('removes a socket left by a bridge that died', async () => {
    const { bridge } = await start();
    const { writeFileSync, existsSync } = await import('node:fs');
    const stale = path.join(path.dirname(bridge.socketPath), '999999.sock');
    writeFileSync(stale, '');
    const again = new Bridge({ runDir: path.dirname(bridge.socketPath), connect: () => Promise.reject(new Error('no daemon')), out: () => undefined });
    await again.start().catch(() => undefined);
    expect(existsSync(stale)).toBe(false);
  });
});

describe('the daemon environment', () => {
  it('leaves out Claude Code and teamod variables, and marks lanes', () => {
    const env = daemonEnv({ HOME: '/h', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', TEAMOD_TOOLS_TOKEN: 'secret', TEAMOD_HOME: '/old', OTHER: 'kept' }, '/h/.teamod', '/bin');
    expect(env).toEqual({ HOME: '/h', OTHER: 'kept', TEAMOD_HOME: '/h/.teamod', TEAMOD_HOME: '/h/.teamod', TEAMOD_DAEMON: '1', PATH: '/bin' });
  });
});

describe('the home folder', () => {
  it('is ~/.teamod unless TEAMOD_HOME says otherwise, whatever TEAMOD_HOME holds', () => {
    expect(teamodHome({ TEAMOD_HOME: '/real/.teamod' })).toBe(path.join(os.homedir(), '.teamod'));
    expect(teamodHome({ TEAMOD_HOME: '/elsewhere' })).toBe('/elsewhere');
  });
});
