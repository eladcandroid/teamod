/**
 * Right-to-left text for terminals that draw every row left to right (Ghostty, kitty, WezTerm,
 * VS Code's, xterm.js): letters are put in the order they are seen, line by line, after wrapping
 * to the width there is. Terminals that order text themselves (Terminal.app, GNOME's, Konsole)
 * get it as written; so do surfaces that aren't terminals.
 */
import bidiFactory from 'bidi-js';
import stringWidth from 'string-width';
import type { Span } from './tree.js';

const bidi = bidiFactory();

/** Hebrew, Arabic, Syriac, Thaana, NKo and their presentation forms. */
const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
export const hasRtl = (text: string): boolean => RTL_CHAR.test(text);

export type Direction = 'ltr' | 'rtl' | 'auto';

/** Which way a paragraph reads, by its first strong letter. */
export function baseOf(text: string): 'ltr' | 'rtl' {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return 'rtl';
    if (/\p{L}/u.test(ch)) return 'ltr';
  }
  return 'ltr';
}

interface Char {
  ch: string;
  span: number;
}

const charsOf = (spans: readonly Span[]): Char[] => spans.flatMap((s, span) => Array.from(s.t, (ch) => ({ ch, span })));

/** One line of styled characters in the order they are seen. */
function reorderLine(chars: readonly Char[], direction: 'ltr' | 'rtl'): Char[] {
  const text = chars.map((c) => c.ch).join('');
  if (!hasRtl(text) && direction === 'ltr') return [...chars];
  // bidi-js counts UTF-16 units; work on code units and map back.
  const units: Char[] = [];
  for (const c of chars) for (let i = 0; i < c.ch.length; i++) units.push({ ch: c.ch[i]!, span: c.span });
  const levels = bidi.getEmbeddingLevels(text, direction);
  const order = units.map((_, i) => i);
  for (const [start, end] of bidi.getReorderSegments(text, levels)) {
    const flipped = order.slice(start, end + 1).reverse();
    order.splice(start, flipped.length, ...flipped);
  }
  const mirrored = bidi.getMirroredCharactersMap(text, levels);
  const out: Char[] = [];
  for (let i = 0; i < order.length; i++) {
    const at = order[i]!;
    const unit = units[at]!;
    const ch = mirrored.get(at) ?? unit.ch;
    // A surrogate pair flipped by a segment is put back in its own order.
    const next = order[i + 1];
    if (/[\udc00-\udfff]/.test(ch) && next !== undefined && /[\ud800-\udbff]/.test(units[next]!.ch)) {
      out.push({ ch: units[next]!.ch + ch, span: unit.span });
      i++;
      continue;
    }
    out.push({ ch, span: unit.span });
  }
  return out;
}

/** Characters back into spans, a span per run of one style. */
function toSpans(chars: readonly Char[], styles: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const c of chars) {
    const last = out.at(-1);
    const style = styles[c.span]!;
    if (last && (last as Span & { s?: number }).s === c.span) {
      (last as { t: string }).t += c.ch;
    } else {
      out.push({ ...style, t: c.ch, s: c.span } as Span & { s: number });
    }
  }
  return out.map(({ s: _s, ...span }: Span & { s?: number }) => span);
}

/** Word-wraps characters to `width` columns, as written (before any reordering). */
function wrap(chars: readonly Char[], width: number): Char[][] {
  if (width < 4) return [[...chars]];
  const lines: Char[][] = [];
  let line: Char[] = [];
  let lineWidth = 0;
  let word: Char[] = [];
  let wordWidth = 0;
  const flushWord = (): void => {
    if (!word.length) return;
    if (lineWidth + wordWidth > width && line.length) {
      while (line.length && line.at(-1)!.ch === ' ') line.pop();
      lines.push(line);
      line = [];
      lineWidth = 0;
      while (word.length && word[0]!.ch === ' ') {
        word.shift();
        wordWidth--;
      }
    }
    // A word longer than the line is cut where it must be.
    while (wordWidth > width) {
      let cut = 0;
      let w = 0;
      while (cut < word.length && w + stringWidth(word[cut]!.ch) <= width - lineWidth) w += stringWidth(word[cut++]!.ch);
      line.push(...word.slice(0, cut));
      lines.push(line);
      line = [];
      lineWidth = 0;
      word = word.slice(cut);
      wordWidth -= w;
    }
    line.push(...word);
    lineWidth += wordWidth;
    word = [];
    wordWidth = 0;
  };
  for (const c of chars) {
    if (c.ch === ' ') {
      flushWord();
      word.push(c);
      wordWidth += 1;
      flushWord();
      continue;
    }
    word.push(c);
    wordWidth += stringWidth(c.ch);
  }
  flushWord();
  if (line.length || !lines.length) lines.push(line);
  return lines;
}

/**
 * A paragraph of styled text as the lines a terminal must be sent, each already in the order it is
 * seen: wrapped to `width` (0: no wrapping), then reordered with `direction` as its base.
 */
export function visualLines(spans: readonly Span[], width: number, direction: Direction = 'auto'): { lines: Span[][]; base: 'ltr' | 'rtl' } {
  const chars = charsOf(spans);
  const text = chars.map((c) => c.ch).join('');
  const base = direction === 'auto' ? baseOf(text) : direction;
  const lines = (width > 0 ? wrap(chars, width) : [chars]).map((line) => toSpans(reorderLine(line, base), spans));
  return { lines, base };
}

/** One row's text in the order it is seen (no wrapping): a label, a placeholder. */
export function visualText(text: string, direction: Direction = 'auto'): string {
  if (!hasRtl(text)) return text;
  return visualLines([{ t: text }], 0, direction).lines[0]!.map((s) => s.t).join('');
}
