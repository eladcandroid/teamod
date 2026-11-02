import type { SessionTools } from '../agent/runtime/claude/terminal.js';
import type { Session } from '../core/session.js';
import type { Args, Method } from './api.js';

/** What each `teamod.*` method does (see teamod-api.ts). */

type TeamodMethod = Extract<Method, `teamod.${string}`>;
type TeamodHandlers = { readonly [M in TeamodMethod]: (s: Session, ...args: Args<M>) => unknown };

/** The sessions' tools still mounted, by token: an ended session's bridge says so, or the oldest makes room. */
const MAX_MOUNTED = 32;
const mounted = new Map<string, SessionTools>();

export const TEAMOD_HANDLERS = {
  'teamod.sessionTools': async (s, cwd) => {
    const tools = await s.host.sessionTools(cwd);
    mounted.set(tools.token, tools);
    for (const [token, old] of mounted) {
      if (mounted.size <= MAX_MOUNTED) break;
      old.close();
      mounted.delete(token);
    }
    return { url: tools.url, token: tools.token, suites: tools.suites };
  },
  'teamod.closeSessionTools': (_s, token) => {
    mounted.get(token)?.close();
    mounted.delete(token);
  },
} satisfies TeamodHandlers;
