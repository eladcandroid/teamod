import os from 'node:os';
import path from 'node:path';

/**
 * teamod's home, set before anything of the engine loads: import this file first.
 *
 * `TEAMOD_HOME` if set, else ~/.teamod; set here so every part of the engine reads the same one.
 */
export const teamodHome = (env: NodeJS.ProcessEnv = process.env): string => env.TEAMOD_HOME || path.join(os.homedir(), '.teamod');

process.env.TEAMOD_HOME = teamodHome();
