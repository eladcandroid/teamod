import type { Prefs } from '../../core/store.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, span } from '../tree.js';
import type { Place } from './common.js';

/** What the Settings panes share: their places, a switch, and a choice. */

export const SETTINGS_PLACES: readonly Place[] = [
  { id: 'general', label: 'General', hotkey: 'e', route: { name: 'home' } },
  { id: 'agent', label: 'Agent', hotkey: 'a', route: { name: 'agent' } },
  { id: 'notifications', label: 'Notifications', hotkey: 'n', route: { name: 'notifications' } },
  { id: 'worktrees', label: 'Worktrees', hotkey: 'r', route: { name: 'worktrees' } },
  { id: 'env', label: 'Environment', hotkey: 'v', route: { name: 'env' } },
  { id: 'models', label: 'Local Models', hotkey: 'm', route: { name: 'models' } },
  { id: 'tools', label: 'Skills and MCP', hotkey: 's', route: { name: 'tools' } },
  { id: 'engine', label: 'Engine', hotkey: 'x', route: { name: 'engine' } },
];

/** A settings change: `null` puts a choice back to its default. */
export type PrefsChange = { readonly [K in keyof Prefs]?: Prefs[K] | null };

export const setPrefs = (ctx: Ctx, change: PrefsChange): Promise<unknown> => ctx.call('session.setPrefs', change);

/** A switch: the row says how it is, and a press turns it the other way. */
export function toggle(ctx: Ctx, key: string, label: string, on: boolean, set: (next: boolean) => unknown, detail?: string): Node {
  return col([
    ctx.draw.button(key, label, () => set(!on), { plain: true, spans: [span(on ? 'On   ' : 'Off  ', on ? { color: 'success' } : { dim: true }), span(label)] }),
    detail ? dim(`     ${detail}`) : undefined,
  ]);
}

/** A choice of a few: the surface's own pop-up. */
export function choice(ctx: Ctx, key: string, label: string, value: string, options: ReadonlyArray<{ readonly value: string; readonly label: string }>, set: (next: string) => unknown, detail?: string): Node {
  return col([
    ctx.draw.select(
      key,
      options,
      (next) => {
        if (next !== undefined && next !== value) return set(next);
        return undefined;
      },
      { label, value },
    ),
    detail ? dim(detail) : undefined,
  ]);
}

/** A number kept among the ones offered, even if it was set by hand to something else. */
export const numberOptions = (values: readonly number[], current: number, words: (n: number) => string = String): Array<{ value: string; label: string }> =>
  [...new Set([...values, current])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: words(n) }));
