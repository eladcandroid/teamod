import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { prefsFrom } from '../src/core/store.js';
import { PrefsPatch } from '../src/ipc/api.js';
import { BRANCH_PREFIX_RE, Settings } from '../src/shared/settings-schema.js';
import { isOwnBranch, WorkspaceManager } from '../src/workspaces/manager.js';
import { WorkspaceStore } from '../src/workspaces/store.js';

/** What new worktrees' branches start with is yours to pick (Settings › Workspaces), teamod/ until you do. */

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

async function manager(): Promise<{ mgr: WorkspaceManager; root: string; id: string }> {
  const base = mkdtempSync(path.join(os.tmpdir(), 'teamod-prefix-'));
  const root = path.join(base, 'code', 'app');
  mkdirSync(root, { recursive: true });
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 'Tess');
  writeFileSync(path.join(root, 'a.txt'), 'a\n');
  sh(root, 'add', '.');
  sh(root, 'commit', '-qm', 'init');
  const store = new WorkspaceStore(path.join(base, 'home'));
  store.saveConfig({ roots: [path.join(base, 'code')], projects: [], hidden: [] });
  const mgr = new WorkspaceManager(store);
  await mgr.refresh();
  return { mgr, root, id: mgr.list.find((p) => p.root)!.id };
}

describe('branch prefix', () => {
  it('is teamod/ by default, and a bad saved one falls back to it', () => {
    expect(prefsFrom(Settings.parse({})).branchPrefix).toBe('teamod/');
    expect(Settings.parse({ branchPrefix: '../x' }).branchPrefix).toBe('teamod/');
    expect(Settings.parse({ branchPrefix: '' }).branchPrefix).toBe('');
  });

  it('takes what git would, and nothing else', () => {
    for (const ok of ['', 'kai/', 'feat/', 'kai-', 'team/kai/', 'k.u/']) expect(BRANCH_PREFIX_RE.test(ok), ok).toBe(true);
    for (const bad of ['/x', '-x', '.x', 'a..b', 'a//b', 'a/.b', 'a b', 'a~', 'a:b', 'x'.repeat(41)]) expect(BRANCH_PREFIX_RE.test(bad), bad).toBe(false);
    expect(PrefsPatch.safeParse({ branchPrefix: 'a b' }).success).toBe(false);
  });

  it('new branches use the prefix you chose', async () => {
    const { mgr, root } = await manager();
    expect(await mgr.freeBranchName(root, 'Fix login')).toBe('teamod/fix-login');
    mgr.branchPrefix = () => 'kai/';
    expect(await mgr.freeBranchName(root, 'Fix login')).toBe('kai/fix-login');
    mgr.branchPrefix = () => '';
    sh(root, 'branch', 'fix-login');
    expect(await mgr.freeBranchName(root, 'Fix login')).toBe('fix-login-2');
  });

  it("renaming a worktree only renames teamod's own branch", () => {
    expect(isOwnBranch('teamod/quick', 'quick', 'kai/')).toBe(true);
    expect(isOwnBranch('teamod/quick', 'quick', '')).toBe(true);
    expect(isOwnBranch('kai/quick', 'quick', 'kai/')).toBe(true);
    expect(isOwnBranch('quick', 'quick', '')).toBe(true);
    expect(isOwnBranch('quick-2', 'quick', '')).toBe(true);
    expect(isOwnBranch('feature-x', 'quick', '')).toBe(false);
    expect(isOwnBranch('kai-quick', 'quick', 'kai-')).toBe(true);
    expect(isOwnBranch('kai-other', 'quick', 'kai-')).toBe(false);
  });
});
