#!/usr/bin/env node
// `env.js` first: it sets the home before anything of the engine reads it.
import { teamodHome } from './env.js';
import path from 'node:path';
import { runningDaemon } from '../daemon/files.js';
import { installedVersion } from '../core/version.js';
import { Bridge, connectAsMod } from './bridge.js';
import { ensureDaemon, writeRuntime } from './launch.js';

const USAGE = `teamod's engine, for the Claude Code mod.

Usage:
  cli.js setup --from-source   record this checkout as the engine to run
  cli.js up                    start the daemon if it isn't running
  cli.js status                say whether the daemon is running
  cli.js stop                  stop the daemon
  cli.js bridge                link one session to the daemon (started by the mod)
`;

const PARENT_CHECK_MS = 5000;

async function runBridge(): Promise<void> {
  const parent = process.ppid;
  const bridge = new Bridge({
    runDir: path.join(teamodHome(), 'run'),
    connect: async () => {
      const info = await ensureDaemon();
      return connectAsMod(info.port, info.token, installedVersion());
    },
    out: (line) => void process.stdout.write(`${JSON.stringify(line)}\n`),
    log: (line) => void process.stderr.write(`${line}\n`),
  });
  const leave = (): void => {
    void bridge.stop().finally(() => process.exit(0));
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, leave);
  // The session can end without telling this child: its parent changes when it does.
  setInterval(() => {
    if (process.ppid !== parent) leave();
  }, PARENT_CHECK_MS).unref();
  // A pipe to a session that's gone: nothing more to say to anyone.
  process.stdout.on('error', leave);
  await bridge.start();
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'setup': {
      if (!rest.includes('--from-source')) throw new Error('Only --from-source for now.');
      process.stdout.write(`teamod is set up (${writeRuntime()}).\n`);
      return;
    }
    case 'up': {
      const info = await ensureDaemon();
      process.stdout.write(`Engine running, pid ${info.pid}.\n`);
      return;
    }
    case 'status': {
      const info = runningDaemon();
      process.stdout.write(info ? `Engine running, pid ${info.pid}, version ${info.version}.\n` : 'Engine not running.\n');
      return;
    }
    case 'stop': {
      const info = runningDaemon();
      if (info) process.kill(info.pid, 'SIGTERM');
      process.stdout.write(info ? `Asked the engine (pid ${info.pid}) to stop.\n` : 'Engine not running.\n');
      return;
    }
    case 'bridge':
      await runBridge();
      return;
    default:
      process.stdout.write(USAGE);
      process.exitCode = command === undefined || command === '--help' ? 0 : 1;
  }
}

main().catch((err: unknown) => {
  const text = err instanceof Error ? err.message : String(err);
  if (process.argv[2] === 'bridge') process.stdout.write(`${JSON.stringify({ t: 'error', text })}\n`);
  process.stderr.write(`teamod: ${text}\n`);
  process.exit(1);
});
