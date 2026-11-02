import { z } from 'zod';

/**
 * What only teamod's Claude Code mod asks of the core. Browser-safe: zod only. A session's tools are
 * mounted once per bridge, and closed when it ends.
 */
export const TEAMOD_API = {
  // Mount your tools for a Claude Code session (the folder it works in) → where they are and a token of its own.
  'teamod.sessionTools': { args: z.tuple([z.string().min(1).max(4096)]) },
  // That session ended: the token stops working.
  'teamod.closeSessionTools': { args: z.tuple([z.string().min(16).max(200)]) },
} as const;
