import os from 'node:os';
import path from 'node:path';

/**
 * teamod's home, set before anything of the engine loads: import this file first.
 *
 * It always wins over an inherited TEAMOD_HOME. A session started inside teamod's own terminal
 * inherits that variable, and following it would attach teamod to the person's real teamod.
 */
export const teamodHome = (env: NodeJS.ProcessEnv = process.env): string => env.TEAMOD_HOME || path.join(os.homedir(), '.teamod');

process.env.TEAMOD_HOME = teamodHome();
