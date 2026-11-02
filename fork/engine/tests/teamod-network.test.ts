import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mentionsSecret } from '../src/agent/policy.js';
import { teamodHome } from '../src/core/home.js';
import { teamodHomeDir, isNeverSent, isSecretPath } from '../src/core/shares.js';
import { deriveKeys } from '../src/net/crypto.js';
import { decodeInvite, encodeInvite } from '../src/net/invite.js';
import { LINK_SCHEME, newInvitation, linkOf, codeLinkOf, parseTicket, pairingSecrets } from '../src/net/mesh/invitations.js';
import { notifyNatively } from '../src/teamod/notify.js';
import { daemonEnv } from '../src/teamod/launch.js';

const realHome = (name: string, ...rest: string[]): string => path.join(os.homedir(), name, ...rest);

describe("teamod's network is its own", () => {
  const secret = 'abcdefghijklmnopqrstuv';
  const key = 'y'.repeat(52);

  it('makes teamod:// links', () => {
    expect(LINK_SCHEME).toBe('teamod://');
    const invite = newInvitation('friend');
    expect(linkOf(invite).startsWith('teamod://add#')).toBe(true);
    expect(codeLinkOf(invite).startsWith('teamod://add?code=')).toBe(true);
    expect(encodeInvite({ url: `p2p://${key}`, secret: 'k3JdQ9vXr2Lm8TzW4yBn' }).startsWith('teamod://')).toBe(true);
  });

  it.each([`teamod://add#${secret}`, `teamod://add#${secret}`, 'teamod://add?code=K7QM-4XPA-R2TD', 'teamod://join?code=K7QM-4XPA-R2TD', `add me: teamod://join#${secret} thanks`])('refuses %s', (link) => {
    expect(parseTicket(link)).toBeUndefined();
  });

  it('refuses a teamod room invite', () => {
    expect(() => decodeInvite(`teamod://${key}#k3JdQ9vXr2Lm8TzW4yBn`)).toThrow(/teamod invite/);
    expect(() => decodeInvite(`teamod://${key}#k3JdQ9vXr2Lm8TzW4yBn`)).toThrow(/teamod invite/);
  });

  it('derives pairing and room keys teamod would not', async () => {
    const { hkdfSync, scryptSync } = await import('node:crypto');
    const link = await pairingSecrets({ via: 'link', secret });
    const teamod = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'base64url'), Buffer.from('teamod-pair-link-v1'), Buffer.from('seed'), 32));
    expect(link.seed.equals(teamod)).toBe(false);

    const code = await pairingSecrets({ via: 'code', code: 'K7QM4XPAR2TD' });
    const teamodCode = scryptSync('K7QM4XPAR2TD', 'teamod-pair-code-v2', 64, { N: 1 << 16, r: 8, p: 1, maxmem: 1 << 28 });
    expect(code.seed.equals(teamodCode.subarray(0, 32))).toBe(false);

    const room = deriveKeys('a-room-secret-long-enough');
    const teamodRoom = Buffer.from(hkdfSync('sha256', Buffer.from('a-room-secret-long-enough'), Buffer.from('teamod-v1'), Buffer.from('enc'), 32));
    expect(room.enc.equals(teamodRoom)).toBe(false);
  });
});

describe("teamod's home", () => {
  const saved = { TEAMOD_HOME: process.env.TEAMOD_HOME, TEAMOD_HOME: process.env.TEAMOD_HOME, TEAMOD_HOME: process.env.TEAMOD_HOME };
  afterEach(() => {
    process.env.TEAMOD_HOME = saved.TEAMOD_HOME;
  });

  it('defaults to ~/.teamod with nothing set, and never to ~/.teamod', () => {
    delete process.env.TEAMOD_HOME;
    expect(teamodHomeDir()).toBe(realHome('.teamod'));
    expect(teamodHome()).toBe(realHome('.teamod'));
  });

  it.each(['identity.json', 'daemon.json', 'settings.json', 'friends.json', 'runtime.json', path.join('run', '123.sock')])('keeps ~/.teamod/%s secret, with no approval able to send it', (file) => {
    delete process.env.TEAMOD_HOME;
    expect(isSecretPath(realHome('.teamod', file))).toBe(true);
    expect(isNeverSent(realHome('.teamod', file))).toBe(true);
  });

  it("keeps a teammate's real ~/.teamod secret too", () => {
    delete process.env.TEAMOD_HOME;
    expect(isNeverSent(realHome('.teamod', 'identity.json'))).toBe(true);
  });

  it('leaves worktrees and the outbox usable', () => {
    delete process.env.TEAMOD_HOME;
    expect(isNeverSent(realHome('.teamod', 'workspaces', 'p', 'wt', 'file.ts'))).toBe(false);
    expect(isNeverSent(realHome('.teamod', 'outbox', 'file.png'))).toBe(false);
  });
});

describe('a shell command that reaches for the home', () => {
  it.each(['cat ~/.teamod/identity.json', 'cat "$HOME/.teamod/daemon.json"', 'tar c ~/.teamod', 'cat ~/.teamod/identity.json', 'cp ".tea"mod/daemon.json /tmp/x', 'ls .teamod/tasks/tasks.json'])('is refused: %s', (command) => {
    expect(mentionsSecret(command)).toBe(true);
  });

  it.each(['cd ~/.teamod/workspaces/p/wt && npm test', 'ls ~/.teamod/chats/c1', 'cat ~/.teamod/outbox/a.txt', 'cat ~/.teamod/tasks/work/1/out.txt', 'git status', 'echo teamodule'])('is left alone: %s', (command) => {
    expect(mentionsSecret(command)).toBe(false);
  });
});

describe('a notification from the operating system', () => {
  it('carries what a teammate wrote as arguments, never inside a script', () => {
    const run = vi.fn();
    const evil = '" & do shell script "rm -rf ~" & "';
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      notifyNatively({ title: evil, body: evil }, run as unknown as typeof execFile);
    } finally {
      Object.defineProperty(process, 'platform', { value: platform });
    }
    const [file, args] = run.mock.calls[0] as [string, string[]];
    expect(file).toBe('osascript');
    const scripts = args.slice(0, args.indexOf('--'));
    expect(scripts.join(' ')).not.toContain('rm -rf');
    expect(args.slice(args.indexOf('--') + 1)).toEqual([evil, evil]);
  });
});

describe('what the daemon inherits', () => {
  it("drops a session's tool tokens and teamod's home", () => {
    const env = daemonEnv({ TEAMOD_TOOLS_TOKEN: 't', TEAMOD_HOME: '/h/.teamod', TEAMOD_TOOLS_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'x' }, '/h/.teamod', undefined);
    expect(env.TEAMOD_TOOLS_TOKEN).toBeUndefined();
    expect(env.TEAMOD_TOOLS_TOKEN).toBeUndefined();
    expect(env.TEAMOD_HOME).toBe('/h/.teamod');
    expect(env.TEAMOD_DAEMON).toBe('1');
  });
});
