import os from 'node:os';
import path from 'node:path';
import { teamodEnv } from './teamod-env.js';

/** Where teamod keeps settings, projects and worktrees: $TEAMOD_HOME, or ~/.teamod. */
export function teamodHome(): string {
  return teamodEnv('HOME') ?? path.join(os.homedir(), '.teamod');
}
