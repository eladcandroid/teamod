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
}

export const text = (t: string, style: Omit<Span, 't'> = {}): Node => ({ k: 'text', spans: [{ t, ...style }] });
export const dim = (t: string): Node => text(t, { dim: true });
export const title = (t: string): Node => text(t, { weight: 'semibold' });
export const line = (...spans: ReadonlyArray<Span | string | false | undefined>): Node => ({
  k: 'text',
  spans: spans.flatMap((s) => (s === false || s === undefined ? [] : [typeof s === 'string' ? { t: s } : s])),
});
export const span = (t: string, style: Omit<Span, 't'> = {}): Span => ({ t, ...style });

type Kids = ReadonlyArray<Node | false | undefined | null>;
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
