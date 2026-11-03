/**
 * The words on teamod's screens in the person's language. Screens are written in English; a drawn
 * tree is translated on its way out (`localize`), so no screen has to change to be translated and
 * upstream's code stays as it is.
 *
 * A catalog maps English to the translation. A key is either the exact English text of a span,
 * label or placeholder, or a pattern with numbered holes (`{0} open · {1} shown`) for text a
 * screen builds from parts; a translation may put the holes in another order. `{#0}` is a hole
 * that only a number fills (`{#0}m` is "5m", never the "Boar" of "Board"). What has no entry
 * stays English. Text that joins parts with ` · ` is translated part by part.
 */
import type { Node, Span } from '../tree.js';
import { HE } from './he/index.js';

export type Lang = 'en' | 'he';
export const LANGS: readonly Lang[] = ['en', 'he'];

export type Catalog = Readonly<Record<string, string>>;

const CATALOGS: Readonly<Record<Exclude<Lang, 'en'>, Catalog>> = { he: HE };

/** The language a locale name or list asks for (`he_IL.UTF-8`, `he-IL`, `iw`); English otherwise. */
export function langOf(locale: string | undefined): Lang {
  const first = (locale ?? '').trim().toLowerCase();
  return /^(he|iw)([_.-]|$)/.test(first) ? 'he' : 'en';
}

/** Right-to-left languages: their screens read from the right. */
export const isRtlLang = (lang: Lang): boolean => lang === 'he';

interface Pattern {
  readonly re: RegExp;
  readonly holes: readonly number[];
  readonly out: string;
}

interface Compiled {
  readonly exact: ReadonlyMap<string, string>;
  readonly patterns: readonly Pattern[];
}

const HOLE = /\{(#?)(\d+)\}/g;
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(catalog: Catalog): Compiled {
  const exact = new Map<string, string>();
  const patterns: Pattern[] = [];
  for (const [en, out] of Object.entries(catalog)) {
    if (!out) continue;
    if (!HOLE.test(en)) {
      exact.set(en, out);
      continue;
    }
    HOLE.lastIndex = 0;
    const holes: number[] = [];
    let source = '^';
    let last = 0;
    for (const m of en.matchAll(HOLE)) {
      source += escape(en.slice(last, m.index));
      source += m[1] ? '(\\d+(?:[.,]\\d+)?)' : '(.+?)';
      holes.push(Number(m[2]));
      last = m.index + m[0].length;
    }
    source += `${escape(en.slice(last))}$`;
    patterns.push({ re: new RegExp(source, 's'), holes, out });
  }
  // The pattern with the most fixed text first: "{0} commits not in main" before "{0} commits".
  const fixed = (p: Pattern): number => p.re.source.replace(/\((?:\.\+\?|\\d\+\(\?:\[\.,\]\\d\+\)\?)\)/g, '').length;
  patterns.sort((a, b) => fixed(b) - fixed(a));
  return { exact, patterns };
}

const compiled = new Map<Lang, Compiled>();
const compiledFor = (lang: Exclude<Lang, 'en'>): Compiled => {
  let found = compiled.get(lang);
  if (!found) {
    found = compile(CATALOGS[lang]);
    compiled.set(lang, found);
  }
  return found;
};

const SEPARATOR = ' · ';

/** One piece of English in `lang`, or itself when the catalog has nothing for it. */
export function translate(text: string, lang: Lang): string {
  if (lang === 'en' || !/[A-Za-z]/.test(text)) return text;
  const lead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text)![0];
  const core = text.slice(lead.length, text.length - trail.length);
  if (!core) return text;
  const c = compiledFor(lang);
  const found = lookup(core, c, 0);
  if (found !== undefined) return `${lead}${found}${trail}`;
  // An icon before it or a colon after it ("◆ Work", "Branch:"): the words are the same words.
  const m = /^([^\p{L}\p{N}]*?)(\p{L}[\s\S]*?)([:.…?!]*)$/u.exec(core);
  if (m && (m[1] || m[3])) {
    const inner = lookup(m[2]!, c, 0);
    if (inner !== undefined) return `${lead}${m[1]}${inner}${m[3]}${trail}`;
  }
  return text;
}

function lookup(core: string, c: Compiled, depth: number): string | undefined {
  const exact = c.exact.get(core);
  if (exact !== undefined) return exact;
  for (const p of c.patterns) {
    const m = p.re.exec(core);
    if (!m) continue;
    const values = new Map<number, string>();
    p.holes.forEach((hole, i) => {
      const value = m[i + 1]!;
      // A hole's own words may be in the catalog too ("Updated {0}" with {0} = "2m ago").
      values.set(hole, depth < 2 ? (lookup(value, c, depth + 1) ?? value) : value);
    });
    return p.out.replace(HOLE, (_, _num: string, n: string) => values.get(Number(n)) ?? '');
  }
  if (depth < 2 && core.includes(SEPARATOR)) {
    const parts = core.split(SEPARATOR);
    const done = parts.map((part) => lookup(part, c, depth + 1));
    if (done.some((d) => d !== undefined)) return parts.map((part, i) => done[i] ?? part).join(SEPARATOR);
  }
  return undefined;
}

const spans = (list: readonly Span[], lang: Lang): Span[] => list.map((s) => ({ ...s, t: translate(s.t, lang) }));

/** A drawn tree in `lang`. Markdown, code, terminals and pictures hold people's own words: left as written. */
export function localize(node: Node, lang: Lang): Node {
  if (lang === 'en') return node;
  switch (node.k) {
    case 'box':
      return { ...node, children: node.children.map((c) => localize(c, lang)) };
    case 'text':
      return { ...node, spans: spans(node.spans, lang) };
    case 'button':
      return { ...node, label: translate(node.label, lang), ...(node.spans ? { spans: spans(node.spans, lang) } : {}) };
    case 'input':
      return {
        ...node,
        ...(node.label ? { label: translate(node.label, lang) } : {}),
        ...(node.placeholder ? { placeholder: translate(node.placeholder, lang) } : {}),
        ...(node.submitLabel ? { submitLabel: translate(node.submitLabel, lang) } : {}),
      };
    case 'select':
      return { ...node, ...(node.label ? { label: translate(node.label, lang) } : {}), options: node.options.map((o) => ({ ...o, label: translate(o.label, lang) })) };
    case 'image':
      return { ...node, alt: translate(node.alt, lang) };
    case 'svg':
      return { ...node, alt: translate(node.alt, lang) };
    default:
      return node;
  }
}

/** Every catalog entry's English, for checks: which screens' words have no translation yet. */
export const catalogKeys = (lang: Exclude<Lang, 'en'>): readonly string[] => Object.keys(CATALOGS[lang]);

/** Every piece of English in a tree the catalog has nothing for (what `localize` would leave as is). */
export function untranslated(node: Node, lang: Exclude<Lang, 'en'>): string[] {
  const out: string[] = [];
  const check = (t: string | undefined): void => {
    if (t && /[A-Za-z]{2}/.test(t) && translate(t, lang) === t) out.push(t.trim());
  };
  const walk = (n: Node): void => {
    switch (n.k) {
      case 'box':
        n.children.forEach(walk);
        return;
      case 'text':
        n.spans.forEach((s) => check(s.t));
        return;
      case 'button':
        if (n.spans) n.spans.forEach((s) => check(s.t));
        else check(n.label);
        return;
      case 'input':
        check(n.label);
        check(n.placeholder);
        check(n.submitLabel);
        return;
      case 'select':
        check(n.label);
        n.options.forEach((o) => check(o.label));
        return;
      default:
    }
  };
  walk(node);
  return out;
}
