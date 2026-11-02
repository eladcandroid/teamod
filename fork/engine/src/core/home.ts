import { existsSync, lstatSync, realpathSync, renameSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { teamodEnv } from './teamod-env.js';

/** The folders teamod's home had before, newest first: teamod's, then teamod's. */
const LEGACY = ['.teamod', '.teamod'];

/** ~/.teamod, or where the old home stayed when it couldn't move (checked once per process). */
let settled: string | undefined;

const present = (p: string): boolean => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Move an existing ~/.teamod (or ~/.teamod) to ~/.teamod, once, keeping a link at the old place so
 * saved projects, worktree paths and git's own worktree links keep working untouched. A real folder
 * right in `homeDir` is renamed; one that is a link elsewhere stays there, and ~/.teamod links to it.
 * Does nothing when ~/.teamod is already there (or nothing old is). Never loses the old path: when
 * the link back can't be made, the folder goes back where it was and that path is returned.
 */
export function migrateHome(homeDir: string): string {
  const home = path.join(homeDir, '.teamod');
  if (present(home)) return home;
  const old = LEGACY.map((name) => path.join(homeDir, name)).find((p) => existsSync(p));
  if (!old) return home;
  try {
    const real = realpathSync(old);
    if (path.dirname(real) !== realpathSync(homeDir)) {
      symlinkSync(real, home, 'dir');
      return home;
    }
    renameSync(real, home);
    try {
      symlinkSync(home, real, 'dir');
    } catch {
      renameSync(home, real);
      return old;
    }
    return home;
  } catch {
    // Someone else moved it at the same moment, or the folder can't be renamed: use what's there.
    return present(home) ? home : old;
  }
}

/**
 * Where teamod keeps settings, projects and worktrees: ~/.teamod (or $TEAMOD_HOME; $TEAMOD_HOME and
 * $TEAMOD_HOME from before the rename still count). An older ~/.teamod moves there on first run.
 */
export function teamodHome(): string {
  const fromEnv = teamodEnv('HOME') ?? process.env.TEAMOD_HOME;
  if (fromEnv) return fromEnv;
  // teamod's own home. Never the migration below: a teammate's real ~/.teamod stays teamod's.
  return (settled ??= path.join(os.homedir(), '.teamod'));
}
