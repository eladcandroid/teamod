/**
 * The last step of every drawing: a screen's tree as this person reads it. Translated to their
 * language; laid out from the right for a right-to-left one; right-to-left letters put in the order
 * they are seen where the terminal won't do it; and hotkeys kept out of sight unless asked for.
 */
import stringWidth from 'string-width';
import { baseOf, hasRtl, visualLines, visualText } from './bidi.js';
import { type Lang, isRtlLang, localize } from './i18n/i18n.js';
import type { Node, Span } from './tree.js';

export interface Presentation {
  readonly lang: Lang;
  /** Order right-to-left letters here (a terminal that won't). */
  readonly fixRtl: boolean;
  /** Draw hotkeys beside controls. */
  readonly keys: boolean;
  /** The columns the tree is drawn in. */
  readonly columns: number;
  /** Where it's drawn (a desktop draws hotkeys as badges on every control). */
  readonly surface?: string;
  /**
   * Lay the screen out from the right. Left out: as the language reads. An answer in the chat
   * follows its own words instead (each paragraph by its first letter), whatever the language.
   */
  readonly layoutRtl?: boolean;
}

/** Controls whose hotkey always shows: the one that brings the others back. */
export const ALWAYS_KEYED = new Set(['keys']);

export function present(tree: Node, p: Presentation): Node {
  const rtl = p.layoutRtl ?? isRtlLang(p.lang);
  let out = localize(tree, p.lang);
  if (!p.keys) out = hideKeys(out, p.surface !== undefined && p.surface !== 'terminal');
  return arrange(out, { rtl, fix: p.fixRtl, width: p.columns, inRow: false });
}

/**
 * Plain controls lose their `w:`; a press still works by pointer and by the focus. On a desktop,
 * which badges every control's hotkey, all of them do.
 */
function hideKeys(node: Node, all = false): Node {
  if (node.k === 'box') return { ...node, children: node.children.map((c) => hideKeys(c, all)) };
  if (node.k === 'button' && node.hotkey && (node.plain || all) && !ALWAYS_KEYED.has(node.key)) {
    const { hotkey: _hotkey, ...rest } = node;
    return rest;
  }
  return node;
}

interface Where {
  readonly rtl: boolean;
  readonly fix: boolean;
  /** Columns left for this node (0: not known, in a row). */
  readonly width: number;
  readonly inRow: boolean;
}

const spanText = (spans: readonly Span[]): string => spans.map((s) => s.t).join('');

function arrange(node: Node, w: Where): Node {
  switch (node.k) {
    case 'box': {
      const inner = Math.max(0, w.width - (node.border ? 2 : 0) - 2 * (node.pad ?? 0) - 2 * (node.padX ?? 0));
      const isRow = node.dir === 'row';
      const widths = isRow ? rowWidths(node.children, inner, node.gap ?? 0) : undefined;
      const children = node.children.map((c, i) => arrange(c, { ...w, width: widths ? widths[i]! : inner, inRow: isRow || w.inRow }));
      if (!w.rtl) return { ...node, children };
      if (isRow) return { ...node, reverse: !node.reverse, children };
      // A column keeps its width (a card spans the pane); what sits in it goes against the right edge.
      return { ...node, children: children.map(againstRight) };
    }
    case 'text': {
      const all = spanText(node.spans);
      // The surface orders the letters: say which way a row with any right-to-left text reads. A
      // row of only Latin text (a path, a branch) stays left to right, or its slashes would move.
      if (!w.fix) return hasRtl(all) ? { ...node, dir: w.rtl ? 'rtl' : baseOf(all) } : node;
      if (!hasRtl(all)) return node;
      const direction = w.rtl ? 'rtl' : 'auto';
      const fits = w.width === 0 || stringWidth(all) <= w.width;
      const { lines, base } = visualLines(node.spans, fits ? 0 : w.width, direction);
      if (lines.length === 1 && (base === 'ltr' || w.inRow)) return { k: 'text', spans: lines[0]! };
      // A right-to-left paragraph sits against the right edge, every line of it.
      return { k: 'box', dir: 'column', ...(base === 'rtl' ? { align: 'flex-end' } : {}), children: lines.map((spans) => ({ k: 'text', spans })) };
    }
    case 'button': {
      if (!w.fix) return node;
      const direction = w.rtl ? 'rtl' : 'auto';
      return {
        ...node,
        label: visualText(node.label, direction),
        ...(node.spans && hasRtl(spanText(node.spans)) ? { spans: visualLines(node.spans, 0, direction).lines[0]! } : {}),
      };
    }
    case 'input':
      return w.fix ? { ...node, ...(node.label ? { label: visualText(node.label) } : {}), ...(node.placeholder ? { placeholder: visualText(node.placeholder) } : {}), ...(node.submitLabel ? { submitLabel: visualText(node.submitLabel) } : {}) } : node;
    case 'select': {
      if (!w.fix) return node;
      const options = node.options.map((o) => ({ ...o, label: visualText(o.label, w.rtl ? 'rtl' : 'auto') }));
      // The terminal draws `label: value` left to right; a right-to-left label goes on its own row.
      if (w.rtl && node.label) {
        const { label, ...bare } = node;
        return { k: 'box', dir: 'column', align: 'flex-end', children: [arrange({ k: 'text', spans: [{ t: label, weight: 'semibold' }] }, w), { ...bare, options }] };
      }
      return { ...node, ...(node.label ? { label: visualText(node.label) } : {}), options };
    }
    case 'link':
      return w.fix ? { ...node, text: visualText(node.text, w.rtl ? 'rtl' : 'auto') } : node;
    case 'md':
      return w.fix && hasRtl(node.text) ? arrange({ k: 'box', dir: 'column', children: markdownLines(node.text) }, w) : node;
    default:
      return node;
  }
}

/** A row's worth of content pushed to the right edge; boxes, code and terminals keep their width. */
function againstRight(node: Node): Node {
  switch (node.k) {
    case 'text':
    case 'button':
    case 'input':
    case 'select':
    case 'link':
      return { k: 'box', dir: 'row', reverse: true, children: [node] };
    default:
      return node;
  }
}

/** What a node takes across, as near as can be told before the surface lays it out. */
function natural(node: Node): number {
  switch (node.k) {
    case 'text':
      return stringWidth(spanText(node.spans));
    case 'button':
      return stringWidth(node.spans ? spanText(node.spans) : node.label) + (node.plain ? (node.hotkey ? 3 : 0) : 4);
    case 'box': {
      const pad = (node.border ? 2 : 0) + 2 * (node.pad ?? 0) + 2 * (node.padX ?? 0);
      if (typeof node.width === 'number') return node.width;
      const sizes = node.children.map(natural);
      return pad + (node.dir === 'row' ? sizes.reduce((a, b) => a + b, 0) + (node.gap ?? 0) * Math.max(0, sizes.length - 1) : Math.max(0, ...sizes));
    }
    default:
      return 0;
  }
}

/**
 * The columns each child of a row gets: what it takes, and the rest of the row to the widest piece
 * of text, the one that may need to wrap.
 */
function rowWidths(children: readonly Node[], width: number, gap: number): number[] {
  if (width <= 0) return children.map(() => 0);
  const sizes = children.map(natural);
  const flexible = sizes.reduce((best, size, i) => (children[i]!.k !== 'button' && size > (sizes[best] ?? -1) ? i : best), -1);
  if (flexible < 0) return sizes;
  const others = sizes.reduce((sum, size, i) => (i === flexible ? sum : sum + size), 0) + gap * Math.max(0, children.length - 1);
  return sizes.map((size, i) => (i === flexible ? Math.max(8, width - others) : size));
}

/**
 * Markdown as plain styled rows, for right-to-left text a terminal can't order: the terminal's own
 * Markdown would send the letters as written. Headings, emphasis, inline code, lists, quotes and
 * links read as they should; a fenced block stays code.
 */
export function markdownLines(source: string): Node[] {
  const out: Node[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) out.push({ k: 'text', spans: inline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!); i++) body.push(lines[i]!);
      out.push({ k: 'code', source: body.join('\n'), ...(fence[2] ? { language: fence[2] } : {}) });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      out.push({ k: 'text', spans: inline(heading[2]!).map((s) => ({ ...s, weight: 'bold' as const })) });
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const marker = /\d/.test(item[2]!) ? `${item[2]!.replace(')', '.')} ` : '• ';
      out.push({ k: 'text', spans: [{ t: `${' '.repeat(Math.min(item[1]!.length, 6))}${marker}` }, ...inline(item[3]!)] });
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      out.push({ k: 'text', spans: [{ t: '│ ', dim: true }, ...inline(quote[1]!).map((s) => ({ ...s, dim: true }))] });
      continue;
    }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flush();
      out.push({ k: 'text', spans: [{ t: '───', dim: true }] });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  // A blank row between blocks, as Markdown is drawn.
  return out.flatMap((n, i) => (i === 0 ? [n] : [{ k: 'text', spans: [{ t: '' }] } as Node, n]));
}

/** Inline Markdown: **bold**, *italic* (drawn plain), `code`, [text](link). */
function inline(text: string): Span[] {
  const out: Span[] = [];
  const re = /(\*\*|__)(.+?)\1|`([^`]+)`|\[([^\]]+)\]\([^)]*\)|(\*|_)([^*_]+)\5/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ t: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ t: m[2], weight: 'bold' });
    else if (m[3] !== undefined) out.push({ t: m[3], color: 'claude' });
    else if (m[4] !== undefined) out.push({ t: m[4], color: 'claude' });
    else out.push({ t: m[6] ?? '' });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out.length ? out : [{ t: '' }];
}
