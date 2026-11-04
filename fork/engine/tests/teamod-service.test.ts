import { describe, expect, it } from 'vitest';
import { launchAgent, systemdUnit } from '../src/teamod/service.js';

const input = { home: '/h/.teamod', node: '/n/node', cli: '/e/dist/cli.js', path: '/usr/bin:/a&b' };

describe('running from login', () => {
  it('runs the daemon, marked as teamod, with no token anywhere in it', () => {
    const plist = launchAgent(input);
    expect(plist).toContain('<string>/n/node</string>');
    expect(plist).toContain('<string>--keep-alive</string>');
    expect(plist).toContain('<key>TEAMOD_DAEMON</key><string>1</string>');
    expect(plist).toContain('/usr/bin:/a&amp;b');
    expect(plist).not.toMatch(/token/i);
    expect(systemdUnit(input)).toContain('ExecStart="/n/node" "/e/dist/cli.js" daemon --keep-alive');
  });

  it('is started again if it dies, not if you stopped it', () => {
    expect(launchAgent(input)).toContain('<key>SuccessfulExit</key><false/>');
    expect(systemdUnit(input)).toContain('Restart=on-failure');
  });
});
