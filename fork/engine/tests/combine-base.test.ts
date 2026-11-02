import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { combineBranches, neededBranches } from '../src/workspaces/git.js';
import { WorkspaceManager } from '../src/workspaces/manager.js';
import { WorkspaceStore } from '../src/workspaces/store.js';

/** A task that builds on several unmerged branches starts from them combined (teamod/<key>-base). */

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

function repo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'teamod-combine-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 'Tess');
  writeFileSync(path.join(dir, 'shared.txt'), 'one\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-qm', 'init');
  return dir;
}

/** A branch from `from` with one commit writing `file`. */
function branch(dir: string, name: string, file: string, text: string, from = 'main'): void {
  sh(dir, 'checkout', '-q', '-b', name, from);
  writeFileSync(path.join(dir, file), text);
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-qm', `work on ${name}`);
  sh(dir, 'checkout', '-q', 'main');
}

const hidden = (): string => path.join(mkdtempSync(path.join(os.tmpdir(), 'teamod-bases-')), 'acme-10-base');
const has = (dir: string, ref: string, file: string): boolean => sh(dir, 'ls-tree', '--name-only', ref).split('\n').includes(file);
const parents = (dir: string, ref: string): number => sh(dir, 'rev-list', '--parents', '-n', '1', ref).trim().split(' ').length - 1;

describe('combining the branches a task builds on', () => {
  it('two unmerged branches: the first with the other merged in (--no-ff); the hidden worktree goes', async () => {
    const dir = repo();
    branch(dir, 'teamod/acme-9', 'nine.txt', '9\n');
    branch(dir, 'teamod/acme-27', 'twenty-seven.txt', '27\n');
    const at = hidden();
    const res = await combineBranches(dir, at, 'teamod/acme-10-base', ['teamod/acme-9', 'teamod/acme-27']);
    expect(res).toEqual({ ok: true, branch: 'teamod/acme-10-base' });
    expect(has(dir, 'teamod/acme-10-base', 'nine.txt') && has(dir, 'teamod/acme-10-base', 'twenty-seven.txt')).toBe(true);
    expect(parents(dir, 'teamod/acme-10-base')).toBe(2);
    expect(sh(dir, 'merge-base', '--is-ancestor', 'teamod/acme-9', 'teamod/acme-10-base')).toBe('');
    expect(existsSync(at)).toBe(false);
    expect(sh(dir, 'worktree', 'list')).not.toContain('acme-10-base');
  });

  it('three unmerged branches: all three in, one merge commit each for the others', async () => {
    const dir = repo();
    branch(dir, 'a', 'a.txt', 'a\n');
    branch(dir, 'b', 'b.txt', 'b\n');
    branch(dir, 'c', 'c.txt', 'c\n');
    expect(await combineBranches(dir, hidden(), 'teamod/acme-12-base', ['a', 'b', 'c'])).toMatchObject({ ok: true });
    for (const f of ['a.txt', 'b.txt', 'c.txt']) expect(has(dir, 'teamod/acme-12-base', f)).toBe(true);
    expect(sh(dir, 'rev-list', '--merges', '--count', 'a..teamod/acme-12-base').trim()).toBe('2');
  });

  it('a branch already in another one (ACME-31 contains ACME-27) is needed once; one already in main not at all', async () => {
    const dir = repo();
    branch(dir, 'teamod/acme-27', 'x.txt', '27\n');
    branch(dir, 'teamod/acme-31', 'y.txt', '31\n', 'teamod/acme-27');
    branch(dir, 'teamod/acme-9', 'z.txt', '9\n');
    branch(dir, 'teamod/acme-5', 'w.txt', '5\n');
    sh(dir, 'merge', '-q', '--no-ff', '--no-edit', 'teamod/acme-5');
    expect(await neededBranches(dir, ['teamod/acme-27', 'teamod/acme-31', 'teamod/acme-9', 'teamod/acme-5'], 'main')).toEqual(['teamod/acme-31', 'teamod/acme-9']);
    // Combined anyway, a branch already in is skipped (no second merge).
    expect(await combineBranches(dir, hidden(), 'teamod/acme-40-base', ['teamod/acme-31', 'teamod/acme-27'])).toMatchObject({ ok: true });
    expect(sh(dir, 'rev-parse', 'teamod/acme-40-base').trim()).toBe(sh(dir, 'rev-parse', 'teamod/acme-31').trim());
    // Two names for one commit: the first counts.
    sh(dir, 'branch', 'same', 'teamod/acme-9');
    expect(await neededBranches(dir, ['teamod/acme-9', 'same'])).toEqual(['teamod/acme-9']);
  });

  it('a conflict is left in the hidden worktree; fixed there, running it again commits and finishes', async () => {
    const dir = repo();
    branch(dir, 'teamod/acme-9', 'shared.txt', 'nine\n');
    branch(dir, 'teamod/acme-27', 'shared.txt', 'twenty-seven\n');
    branch(dir, 'teamod/acme-30', 'thirty.txt', '30\n');
    const at = hidden();
    const first = await combineBranches(dir, at, 'teamod/acme-10-base', ['teamod/acme-9', 'teamod/acme-27', 'teamod/acme-30']);
    expect(first).toEqual({ ok: false, branch: 'teamod/acme-10-base', dir: at, merging: 'teamod/acme-27', files: ['shared.txt'] });
    expect(readFileSync(path.join(at, 'shared.txt'), 'utf8')).toContain('<<<<<<<');
    // Not fixed yet: still the conflict (with the branch it was merging).
    expect(await combineBranches(dir, at, 'teamod/acme-10-base', ['teamod/acme-9', 'teamod/acme-27', 'teamod/acme-30'])).toMatchObject({ ok: false, merging: 'teamod/acme-27', files: ['shared.txt'] });
    // Claude's fix-up: markers gone (no git).
    writeFileSync(path.join(at, 'shared.txt'), 'nine and twenty-seven\n');
    expect(await combineBranches(dir, at, 'teamod/acme-10-base', ['teamod/acme-9', 'teamod/acme-27', 'teamod/acme-30'])).toEqual({ ok: true, branch: 'teamod/acme-10-base' });
    expect(sh(dir, 'show', 'teamod/acme-10-base:shared.txt')).toBe('nine and twenty-seven\n');
    expect(has(dir, 'teamod/acme-10-base', 'thirty.txt')).toBe(true);
    expect(existsSync(at)).toBe(false);
  });

  it('through the manager: teamod/<key>-base in a hidden worktree that never shows as the project’s; one branch needed is just that one', async () => {
    const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'teamod-combine-m-')));
    const dir = path.join(base, 'code', 'app');
    mkdirSync(dir, { recursive: true });
    sh(dir, 'init', '-q', '-b', 'main');
    sh(dir, 'config', 'user.email', 't@t');
    sh(dir, 'config', 'user.name', 'Tess');
    writeFileSync(path.join(dir, 'shared.txt'), 'one\n');
    sh(dir, 'add', '.');
    sh(dir, 'commit', '-qm', 'init');
    branch(dir, 'teamod/acme-9', 'shared.txt', 'nine\n');
    branch(dir, 'teamod/acme-27', 'shared.txt', 'twenty-seven\n');
    branch(dir, 'teamod/acme-31', 'more.txt', '31\n', 'teamod/acme-27');
    const store = new WorkspaceStore(path.join(base, 'home'));
    store.saveConfig({ roots: [path.join(base, 'code')], projects: [], hidden: [] });
    const manager = new WorkspaceManager(store);
    await manager.refresh();
    const project = manager.list.find((p) => p.root)!;
    expect(await manager.combineBase(project.id, 'ACME-40', ['teamod/acme-27', 'teamod/acme-31'])).toEqual({ ok: true, branch: 'teamod/acme-31' });
    const res = await manager.combineBase(project.id, 'ACME-10', ['teamod/acme-9', 'teamod/acme-27']);
    expect(res).toMatchObject({ ok: false, branch: 'teamod/acme-10-base', merging: 'teamod/acme-27', files: ['shared.txt'] });
    if (res.ok) return;
    expect(res.dir.startsWith(manager.basesDir + path.sep)).toBe(true);
    expect(sh(dir, 'worktree', 'list')).toContain('acme-10-base');
    await manager.refresh();
    expect(manager.list.find((p) => p.id === project.id)!.workspaces.map((w) => w.path)).not.toContain(res.dir);
  });
});
