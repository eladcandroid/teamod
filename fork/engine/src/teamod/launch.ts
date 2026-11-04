import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { daemonLogPath, openDaemonLog, releaseLock, runningDaemon, takeLock } from '../daemon/files.js';
import type { DaemonInfo } from '../ipc/protocol.js';
import { writeBrief } from './brief.js';
import { teamodHome } from './env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const START_TIMEOUT_MS = 60_000;
const POLL_MS = 200;
const PATH_MARK = '__TEAMOD_PATH__';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The PATH of a login shell: a daemon outlives the session, and agents need what the person installed. */
export function loginPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (process.platform === 'win32') return env.PATH;
  const shell = env.SHELL || '/bin/zsh';
  const ran = spawnSync(shell, ['-ilc', `printf '${PATH_MARK}%s${PATH_MARK}' "$PATH"`], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  const found = ran.stdout?.split(PATH_MARK)[1];
  return found || env.PATH;
}

/**
 * What the daemon starts with. Claude Code's own variables stay out, so a lane isn't taken for a
 * nested session, and teamod's own stay out, so a session can't lend its tokens to the daemon.
 * TEAMOD_DAEMON tells the mod, loaded inside each lane, to stay out of it.
 */
export function daemonEnv(base: NodeJS.ProcessEnv, home: string, pathValue: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (!/^(CLAUDE|TEAMOD_)/.test(name)) env[name] = value;
  }
  env.TEAMOD_HOME = home;
  env.TEAMOD_DAEMON = '1';
  if (pathValue) env.PATH = pathValue;
  return env;
}

/** The home folder exists and is the person's alone. */
export function prepareHome(home: string = teamodHome()): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
}

async function waitForDaemon(timeoutMs: number): Promise<DaemonInfo | undefined> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const info = runningDaemon();
    if (info) return info;
    await sleep(POLL_MS);
  }
  return undefined;
}

/**
 * The running daemon, started if there is none. It is detached and kept alive: it has to outlive
 * this session for schedules and teammates' requests, and a second session finds and reuses it.
 */
/** Starts the engine, detached and with this process's output, and exits. */
const LAUNCHER = `const { spawn } = require('node:child_process');
const [cli, cwd] = JSON.parse(process.argv[1]);
spawn(process.execPath, [cli, 'daemon', '--keep-alive'], { detached: true, stdio: 'inherit', cwd }).unref();`;

export async function ensureDaemon(): Promise<DaemonInfo> {
  const running = runningDaemon();
  if (running) return running;
  const home = teamodHome();
  prepareHome(home);
  if (!takeLock()) {
    const started = await waitForDaemon(START_TIMEOUT_MS);
    if (started) return started;
    throw new Error(`Another start of the engine did not finish. See ${daemonLogPath()}`);
  }
  try {
    const log = openDaemonLog();
    try {
      // Started through a launcher that exits at once: the engine then belongs to no session. Claude
      // Code ends a session's processes when it closes, and the engine must outlive every session.
      const child = spawn(process.execPath, ['-e', LAUNCHER, JSON.stringify([path.join(here, '..', 'cli.js'), home])], {
        detached: true,
        stdio: ['ignore', log, log],
        env: daemonEnv(process.env, home, loginPath()),
        cwd: home,
      });
      child.unref();
    } finally {
      closeSync(log);
    }
    const started = await waitForDaemon(START_TIMEOUT_MS);
    if (!started) throw new Error(`The engine did not start. See ${daemonLogPath()}`);
    return started;
  } finally {
    releaseLock();
  }
}

/** Says where this checkout's engine is, for the mod to find (`/teamod setup`). */
export function writeRuntime(home: string = teamodHome()): string {
  prepareHome(home);
  const file = path.join(home, 'runtime.json');
  writeFileSync(file, `${JSON.stringify({ node: process.execPath, cli: path.join(here, 'cli.js') }, null, 2)}\n`, { mode: 0o600 });
  writeBrief(home);
  return file;
}
