import type { Prefs } from '../../core/store.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, col, dim, row, span, text } from '../tree.js';
import { type Place, type Tone, card } from './common.js';

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

/** How far a switch's label sits from the edge: its detail lines up under it. */
const SWITCH_WIDTH = 7;

/** A dim line under a setting, lined up with its label (`indent` columns in). */
export const detailLine = (words: string, indent = 0): Node =>
  indent > 0 ? row([text(' '.repeat(indent)), dim(words)], { gap: 0, wrap: false }) : dim(words);

/** A switch: the row says how it is (`● On` / `○ Off`), and a press turns it the other way. */
export function toggle(ctx: Ctx, key: string, label: string, on: boolean, set: (next: boolean) => unknown, detail?: string): Node {
  return col([
    ctx.draw.button(key, label, () => set(!on), { plain: true, spans: [span(on ? '● On ' : '○ Off', on ? { color: 'success' } : { dim: true }), span('  '), span(label)] }),
    detail ? detailLine(detail, SWITCH_WIDTH) : undefined,
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

/**
 * A settings group: a quiet card with its name on top and its settings a row each, a line of air
 * between them (`tight`: none, for a long list of switches).
 */
export const group = (name: string | undefined, settings: ReadonlyArray<Node | false | undefined | null>, opts: { readonly tone?: Tone; readonly tight?: boolean } = {}): Node =>
  card([col(settings.filter((s): s is Node => Boolean(s)), { gap: opts.tight ? 0 : 1 })], { ...(name ? { title: name } : {}), ...(opts.tone ? { tone: opts.tone } : {}) });

/** A number kept among the ones offered, even if it was set by hand to something else. */
export const numberOptions = (values: readonly number[], current: number, words: (n: number) => string = String): Array<{ value: string; label: string }> =>
  [...new Set([...values, current])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: words(n) }));

/** A card's name with how many it holds beside it, dim: `MCP servers  4`. */
export const counted = (name: string, n: number): Span[] => [span(name, { weight: 'bold' }), ...(n > 0 ? [span(`  ${n}`, { dim: true })] : [])];
