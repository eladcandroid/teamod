import { initialState } from '../src/core/store.js';
import type { AppState } from '../src/core/store.js';
import { SCREENS } from '../src/teamod/panes/index.js';
import { type ScreenHost, Screens, type Viewport } from '../src/teamod/screens.js';
import { DEFAULT_PREFS, type Prefs } from '../src/teamod/prefs.js';
import type { Node } from '../src/teamod/tree.js';

/** What a test draws for. Draw for `desktop` too where a screen differs by surface. */
export const viewport: Viewport = { surface: 'terminal', columns: 80, rows: 40 };

export const flat = (node: Node): Node[] => [node, ...(node.k === 'box' ? node.children.flatMap(flat) : [])];

/** The button with this label, if the tree has one. */
export const labelled = (node: Node, label: string): Node | undefined => flat(node).find((n) => n.k === 'button' && n.label === label);

/** Everything a tree says, one element to a line. */
export const words = (node: Node): string =>
  flat(node)
    .map((n) => (n.k === 'text' ? n.spans.map((s) => s.t).join('') : n.k === 'button' ? (n.spans?.map((s) => s.t).join('') ?? n.label) : n.k === 'md' ? n.text : n.k === 'code' ? n.source : ''))
    .join('\n');

export interface Started {
  readonly screens: Screens;
  /** Every call a press made to the engine, in order. */
  readonly calls: Array<[string, readonly unknown[]]>;
  /** Change the state a later draw sees. */
  set(next: Partial<AppState>): void;
  /** Answer a method, for `ctx.load` and friends: by name. */
  answers: Map<string, (args: readonly unknown[]) => unknown>;
  /** Let values a draw asked for land. */
  settle(): Promise<void>;
}

/** Screens over a state of the test's own, recording what they ask of the engine. */
export function start(state: Partial<AppState> = {}): Started {
  let current = { ...initialState('room'), ...state } as unknown as AppState;
  const calls: Array<[string, readonly unknown[]]> = [];
  const answers = new Map<string, (args: readonly unknown[]) => unknown>();
  // Hotkeys drawn, so tests can check them; a person sees them after pressing Keys.
  let prefs: Prefs = { ...DEFAULT_PREFS, keys: true };
  const host: ScreenHost = {
    getState: () => current,
    prefs: () => prefs,
    setPrefs: (change) => {
      prefs = { ...prefs, ...change };
    },
    call: async (method, args) => {
      calls.push([method, args]);
      return answers.get(method)?.(args);
    },
    markDirty: () => undefined,
    look: () => undefined,
  };
  return {
    screens: new Screens(host, SCREENS),
    calls,
    answers,
    set: (next) => {
      current = { ...current, ...next };
    },
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}
