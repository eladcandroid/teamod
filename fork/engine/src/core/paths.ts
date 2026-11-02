import os from 'node:os';
import { isUnder } from '../shared/path-inside.js';

/**
 * "/Users/bob/api" → "~/api" (only a leading home folder, so "/Users/bob2" stays as is). teamod's
 * folder reads ~/.teamod even where it's named by the old ~/.teamod or ~/.teamod, linked in place by the renames.
 */
export const tilde = (p: string, home = os.homedir()): string => (p === home ? '~' : isUnder(home, p) ? `~${p.slice(home.length)}` : p).replace(/^~\/\.teamod?(?=\/|$)/, '~/.teamod');
