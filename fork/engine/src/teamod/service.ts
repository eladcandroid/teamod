import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LABEL = 'dev.teamod.engine';

export interface ServiceInput {
  readonly home: string;
  readonly node: string;
  /** The daemon's own entry: the engine's `cli.js`. */
  readonly cli: string;
  readonly path: string;
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A LaunchAgent: running from login, started again if it dies, never when it stopped on purpose. */
export function launchAgent(input: ServiceInput): string {
  const env: Readonly<Record<string, string>> = { TEAMOD_HOME: input.home, TEAMOD_DAEMON: '1', PATH: input.path };
  const log = path.join(input.home, 'logs', 'daemon.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(input.node)}</string>
    <string>${xml(input.cli)}</string>
    <string>daemon</string>
    <string>--keep-alive</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env)
  .map(([k, v]) => `    <key>${k}</key><string>${xml(v)}</string>`)
  .join('\n')}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

const quoted = (s: string): string => `"${s.replace(/(["\\])/g, '\\$1')}"`;

/** The same as a systemd user unit. */
export function systemdUnit(input: ServiceInput): string {
  return `[Unit]
Description=teamod engine

[Service]
ExecStart=${quoted(input.node)} ${quoted(input.cli)} daemon --keep-alive
Environment=${quoted(`TEAMOD_HOME=${input.home}`)}
Environment=TEAMOD_DAEMON=1
Environment=${quoted(`PATH=${input.path}`)}
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

const plistPath = (): string => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const unitPath = (): string => path.join(os.homedir(), '.config', 'systemd', 'user', 'teamod-engine.service');

const run = (file: string, args: readonly string[]): { readonly ok: boolean; readonly text: string } => {
  const ran = spawnSync(file, args, { encoding: 'utf8', timeout: 15_000 });
  return { ok: ran.status === 0, text: `${ran.stdout ?? ''}${ran.stderr ?? ''}`.trim() };
};

const uid = (): number => process.getuid?.() ?? 0;

/** Keep the engine running from login, so schedules and teammates' requests work with Claude Code closed. */
export function installService(input: ServiceInput): string {
  if (process.platform === 'darwin') {
    const file = plistPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, launchAgent(input), { mode: 0o600 });
    run('launchctl', ['bootout', `gui/${uid()}/${LABEL}`]);
    const done = run('launchctl', ['bootstrap', `gui/${uid()}`, file]);
    if (!done.ok) throw new Error(`launchctl: ${done.text}`);
    return 'The engine now runs from login.';
  }
  if (process.platform === 'linux') {
    const file = unitPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, systemdUnit(input), { mode: 0o600 });
    run('systemctl', ['--user', 'daemon-reload']);
    const done = run('systemctl', ['--user', 'enable', '--now', 'teamod-engine.service']);
    if (!done.ok) throw new Error(`systemctl: ${done.text}`);
    return 'The engine now runs from login.';
  }
  throw new Error('Running from login is for macOS and Linux for now.');
}

export function removeService(): string {
  if (process.platform === 'darwin') {
    run('launchctl', ['bootout', `gui/${uid()}/${LABEL}`]);
    rmSync(plistPath(), { force: true });
  } else if (process.platform === 'linux') {
    run('systemctl', ['--user', 'disable', '--now', 'teamod-engine.service']);
    rmSync(unitPath(), { force: true });
    run('systemctl', ['--user', 'daemon-reload']);
  }
  return 'The engine no longer runs from login. It starts with your next session.';
}
