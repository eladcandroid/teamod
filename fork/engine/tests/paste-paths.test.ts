import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathInfo } from '../src/core/attachments.js';

describe('what a pasted path is here', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'teamod-paste-'));
  const png = path.join(dir, 'Shot 1.png');
  writeFileSync(png, 'x');
  mkdirSync(path.join(dir, 'folder'));

  it('tells files, folders and nothing apart', () => {
    expect(pathInfo(png)).toMatchObject({ path: png, name: 'Shot 1.png', kind: 'file', size: 1, image: true });
    expect(pathInfo(path.join(dir, 'folder')).kind).toBe('folder');
    expect(pathInfo(path.join(dir, 'gone.png')).kind).toBe('missing');
    expect(pathInfo('relative.png').kind).toBe('missing');
    expect(pathInfo('~/x').path).toBe(path.join(os.homedir(), 'x'));
  });
});
