/**
 * What a pane draws, as data. Screens are written here in Node, with the whole engine at hand; the
 * mod only turns this into the surface's elements and sends presses back by key. Plain JSON: it
 * crosses a socket, and a handler stays on this side, found again by its key after any redraw.
 */
export type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile';

export interface Span {
  readonly t: string;
  readonly dim?: boolean;
  readonly color?: string;
  readonly weight?: 'semibold' | 'bold';
}

export type Node =
  | {
      readonly k: 'box';
      readonly dir?: 'row' | 'column';
      readonly gap?: number;
      readonly pad?: number;
      readonly padX?: number;
      readonly top?: number;
      readonly grow?: number;
      readonly width?: number | string;
      readonly height?: number;
      readonly justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between';
      readonly wrap?: boolean;
      readonly border?: 'single' | 'round';
      readonly children: readonly Node[];
    }
  | { readonly k: 'text'; readonly spans: readonly Span[] }
  | { readonly k: 'button'; readonly key: string; readonly label: string; readonly hotkey?: string; readonly plain?: boolean; readonly primary?: boolean; readonly dim?: boolean; readonly spans?: readonly Span[] }
  | { readonly k: 'input'; readonly key: string; readonly label?: string; readonly placeholder?: string; readonly value?: string; readonly rows?: number; readonly submitLabel?: string; readonly autoFocus?: boolean }
  | { readonly k: 'select'; readonly key: string; readonly label?: string; readonly value?: string; readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }> }
  | { readonly k: 'md'; readonly text: string }
  | { readonly k: 'code'; readonly source: string; readonly language?: string; readonly path?: string; readonly diff?: boolean; readonly startLine?: number }
  | { readonly k: 'link'; readonly href: string; readonly text: string }
  | { readonly k: 'image'; readonly key?: string; readonly png: string; readonly columns: number; readonly rows: number; readonly alt: string }
  | { readonly k: 'svg'; readonly source: string; readonly alt: string; readonly width?: number; readonly height?: number; readonly interactive?: boolean }
  | { readonly k: 'term'; readonly key: string; readonly term: string; readonly height?: number };

export type Handler = (value?: string) => unknown | Promise<unknown>;

/** What a press may ask of the mod after it's done. */
export interface Effects {
  readonly open?: string;
  readonly toast?: string;
  readonly copy?: string;
  /** A field the press brought up: the keyboard goes there, or a person's typing would press hotkeys. */
  readonly focus?: string;
}

/** The fields of a tree that ask for the keyboard. */
export const autoFocused = (node: Node): string[] => (node.k === 'box' ? node.children.flatMap(autoFocused) : node.k === 'input' && node.autoFocus ? [node.key] : []);

export const text = (t: string, style: Omit<Span, 't'> = {}): Node => ({ k: 'text', spans: [{ t, ...style }] });
export const dim = (t: string): Node => text(t, { dim: true });
export const title = (t: string): Node => text(t, { weight: 'semibold' });
export const line = (...spans: ReadonlyArray<Span | string | false | undefined>): Node => ({
  k: 'text',
  spans: spans.flatMap((s) => (s === false || s === undefined ? [] : [typeof s === 'string' ? { t: s } : s])),
});
export const span = (t: string, style: Omit<Span, 't'> = {}): Span => ({ t, ...style });

type Kids = ReadonlyArray<Node | false | undefined | null | '' | 0>;
const kids = (children: Kids): Node[] => children.filter((c): c is Node => Boolean(c));

export const col = (children: Kids, style: Partial<Extract<Node, { k: 'box' }>> = {}): Node => ({ ...style, k: 'box', dir: 'column', children: kids(children) });
export const row = (children: Kids, style: Partial<Extract<Node, { k: 'box' }>> = {}): Node => ({ ...style, k: 'box', dir: 'row', gap: style.gap ?? 1, wrap: style.wrap ?? true, children: kids(children) });
export const md = (t: string): Node => ({ k: 'md', text: t });
export const code = (source: string, opts: Omit<Extract<Node, { k: 'code' }>, 'k' | 'source'> = {}): Node => ({ k: 'code', source, ...opts });

/** One draw of a pane: its tree, and what its controls do. */
export class Draw {
  readonly handlers = new Map<string, Handler>();

  private add(key: string, handler: Handler): void {
    if (this.handlers.has(key)) throw new Error(`Two controls share the key ${key}`);
    this.handlers.set(key, handler);
  }

  button(key: string, label: string, onPress: Handler, opts: { hotkey?: string; plain?: boolean; primary?: boolean; dim?: boolean; spans?: readonly Span[] } = {}): Node {
    if (opts.hotkey !== undefined && !/^[a-z0-9]$/.test(opts.hotkey)) throw new Error(`A hotkey is one lowercase letter or digit, not ${opts.hotkey}`);
    this.add(key, onPress);
    return { k: 'button', key, label, ...opts };
  }

  input(key: string, onSubmit: Handler, opts: Omit<Extract<Node, { k: 'input' }>, 'k' | 'key'> = {}): Node {
    this.add(key, onSubmit);
    return { k: 'input', key, ...opts };
  }

  select(key: string, options: Extract<Node, { k: 'select' }>['options'], onPick: Handler, opts: { label?: string; value?: string } = {}): Node {
    this.add(key, onPick);
    return { k: 'select', key, options, ...opts };
  }
}

const ESCAPES = /\u001b(?:\[[0-9;:<=>?]*[ -/]*[@-~]|[\]PX^_][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[()][A-Za-z0-9]|[ -~])?/g;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
const clean = (t: string): string => t.replace(ESCAPES, '').replace(CONTROL, '');
const oneRow = (t: string): string => clean(t).replace(/\s*\n\s*/g, ' ');

/**
 * A tree as it may be drawn: no escape sequences, control characters or reversed text in anything
 * it says, so nobody's words can move the cursor or pass for something else. Every screen goes
 * through this on its way out.
 */
export function inert(node: Node): Node {
  switch (node.k) {
    case 'box':
      return { ...node, children: node.children.map(inert) };
    case 'text':
      return { ...node, spans: node.spans.map((s) => ({ ...s, t: oneRow(s.t) })) };
    case 'button':
      return { ...node, label: oneRow(node.label), ...(node.spans ? { spans: node.spans.map((s) => ({ ...s, t: oneRow(s.t) })) } : {}) };
    case 'input':
      return { ...node, ...(node.label ? { label: oneRow(node.label) } : {}), ...(node.placeholder ? { placeholder: oneRow(node.placeholder) } : {}), ...(node.value ? { value: clean(node.value) } : {}) };
    case 'select':
      return { ...node, ...(node.label ? { label: oneRow(node.label) } : {}), options: node.options.map((o) => ({ ...o, label: oneRow(o.label) })) };
    case 'md':
      return { ...node, text: clean(node.text) };
    case 'code':
      return { ...node, source: clean(node.source) };
    case 'image':
      return { ...node, alt: oneRow(node.alt) };
    default:
      return node;
  }
}
