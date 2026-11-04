import { describe, expect, it } from 'vitest';
import { hasRtl, visualLines, visualText } from '../src/teamod/bidi.js';
import { socketDir } from '../src/teamod/bridge.js';
import { langOf, localize, translate } from '../src/teamod/i18n/i18n.js';
import { DEFAULT_PREFS, fixesRtl, languageOf, terminalOrdersRtl } from '../src/teamod/prefs.js';
import { markdownLines, present } from '../src/teamod/present.js';
import type { Node } from '../src/teamod/tree.js';
import { flat } from './teamod-helpers.js';

const seen = (spans: ReadonlyArray<{ t: string }>): string => spans.map((s) => s.t).join('');

describe('translating', () => {
  it('finds exact words, and leaves what it has no entry for', () => {
    expect(translate('Work', 'he')).toBe('עבודה');
    expect(translate('  Work ', 'he')).toBe('  עבודה ');
    expect(translate('Work', 'en')).toBe('Work');
    expect(translate('acme-shop', 'he')).toBe('acme-shop');
  });

  it('fills number holes only with numbers', () => {
    expect(translate('5m', 'he')).toBe('5 ד׳');
    expect(translate('Board', 'he')).toBe('לוח');
    expect(translate('Elad', 'he')).toBe('Elad');
  });

  it('reads past an icon or a colon, and translates parts joined by a dot', () => {
    expect(translate('◆ Work', 'he')).toBe('◆ עבודה');
    expect(translate('Work · Board', 'he')).toBe('עבודה · לוח');
    expect(translate('‹ Back', 'he')).toBe('‹ חזרה');
  });

  it('never touches Markdown, which holds people’s words', () => {
    const tree: Node = { k: 'box', children: [{ k: 'md', text: 'Work' }, { k: 'text', spans: [{ t: 'Work' }] }] };
    const out = flat(localize(tree, 'he'));
    expect(out.find((n) => n.k === 'md')).toEqual({ k: 'md', text: 'Work' });
    expect(out.some((n) => n.k === 'text' && n.spans[0]!.t === 'עבודה')).toBe(true);
  });

  it('knows Hebrew locales by any of their names', () => {
    for (const name of ['he', 'he_IL.UTF-8', 'he-IL', 'iw']) expect(langOf(name)).toBe('he');
    for (const name of ['en_US.UTF-8', 'hebrew-ish', undefined, '']) expect(langOf(name)).toBe('en');
    expect(languageOf({ ...DEFAULT_PREFS, lang: 'he' })).toBe('he');
    expect(languageOf({ ...DEFAULT_PREFS, lang: 'auto' }, { LANG: 'he_IL.UTF-8' })).toBe('he');
  });
});

describe('right-to-left letters', () => {
  it('puts Hebrew in the order it is seen, numbers and Latin words kept as they read', () => {
    expect(hasRtl('שלום')).toBe(true);
    expect(hasRtl('hello')).toBe(false);
    // Read right to left: שלום (עולם) 123 abc
    expect(visualText('שלום (עולם) 123 abc', 'rtl')).toBe('abc 123 )םלוע( םולש');
    expect(visualText('just Latin')).toBe('just Latin');
  });

  it('wraps a long paragraph before ordering it, so the first line holds its first words', () => {
    const { lines, base } = visualLines([{ t: 'אחת שתיים שלוש ארבע חמש שש' }], 12, 'auto');
    expect(base).toBe('rtl');
    expect(lines.length).toBeGreaterThan(1);
    expect(seen(lines[0]!)).toContain('תחא');
  });

  it('keeps each piece’s style through the reordering', () => {
    const { lines } = visualLines([{ t: 'שלום ' }, { t: 'עולם', weight: 'bold' }], 0, 'rtl');
    expect(lines[0]!.find((s) => s.weight === 'bold')?.t).toBe('םלוע');
  });

  it('is teamod’s job only on terminals that draw rows left to right', () => {
    expect(terminalOrdersRtl({ TERM_PROGRAM: 'Apple_Terminal' })).toBe(true);
    expect(terminalOrdersRtl({ VTE_VERSION: '7600' })).toBe(true);
    expect(terminalOrdersRtl({ TERM_PROGRAM: 'ghostty' })).toBe(false);
    expect(fixesRtl(DEFAULT_PREFS, 'terminal', { TERM_PROGRAM: 'ghostty' })).toBe(true);
    expect(fixesRtl(DEFAULT_PREFS, 'desktop', { TERM_PROGRAM: 'ghostty' })).toBe(false);
    expect(fixesRtl({ ...DEFAULT_PREFS, rtl: 'terminal' }, 'terminal', {})).toBe(false);
    expect(fixesRtl({ ...DEFAULT_PREFS, rtl: 'fix' }, 'terminal', { TERM_PROGRAM: 'Apple_Terminal' })).toBe(true);
  });
});

describe('presenting a screen', () => {
  const screen: Node = {
    k: 'box',
    dir: 'column',
    children: [
      { k: 'box', dir: 'row', children: [{ k: 'button', key: 'screen:work', label: 'Work', hotkey: 'w', plain: true }, { k: 'button', key: 'keys', label: 'Keys', hotkey: '0', plain: true }] },
      { k: 'text', spans: [{ t: 'Work' }] },
    ],
  };

  it('hides hotkeys unless asked, but never the one that brings them back', () => {
    const hidden = flat(present(screen, { lang: 'en', fixRtl: false, keys: false, columns: 80 }));
    expect(hidden.find((n) => n.k === 'button' && n.key === 'screen:work')).not.toHaveProperty('hotkey');
    expect(hidden.find((n) => n.k === 'button' && n.key === 'keys')).toHaveProperty('hotkey', '0');
    const shown = flat(present(screen, { lang: 'en', fixRtl: false, keys: true, columns: 80 }));
    expect(shown.find((n) => n.k === 'button' && n.key === 'screen:work')).toHaveProperty('hotkey', 'w');
  });

  it('lays a Hebrew screen out from the right, with the words in Hebrew', () => {
    const out = present(screen, { lang: 'he', fixRtl: false, keys: true, columns: 80 });
    expect(out).toMatchObject({ k: 'box', dir: 'column' });
    expect(out).not.toHaveProperty('align');
    expect(flat(out).filter((n) => n.k === 'box' && n.dir === 'row').every((n) => n.k === 'box' && n.reverse)).toBe(true);
    expect(flat(out).find((n) => n.k === 'text')).toMatchObject({ dir: 'rtl', spans: [{ t: 'עבודה' }] });
  });

  it('orders the letters itself on a terminal that won’t', () => {
    const out = present(screen, { lang: 'he', fixRtl: true, keys: true, columns: 80 });
    const words = flat(out).flatMap((n) => (n.k === 'text' ? [seen(n.spans)] : n.k === 'button' ? [n.label] : []));
    expect(words).toContain('הדובע');
  });

  it('draws an answer by its own words, whatever the language', () => {
    const answer: Node = { k: 'box', dir: 'column', children: [{ k: 'md', text: 'Hello\n\nשלום **עולם**' }] };
    const out = present(answer, { lang: 'he', fixRtl: true, keys: true, columns: 80, layoutRtl: false });
    expect(out).not.toHaveProperty('align');
    expect(flat(out).some((n) => n.k === 'box' && n.align === 'flex-end')).toBe(true);
  });

  it('turns Markdown into rows a terminal can be sent in order', () => {
    const rows = markdownLines('# כותרת\n\n- אחד\n- שתיים\n\n```js\nconst x = 1;\n```');
    expect(rows.some((n) => n.k === 'code' && n.source === 'const x = 1;')).toBe(true);
    expect(rows.some((n) => n.k === 'text' && n.spans.some((s) => s.weight === 'bold' && s.t === 'כותרת'))).toBe(true);
    expect(rows.filter((n) => n.k === 'text' && n.spans[0]?.t === '• ').length).toBe(2);
  });
});

describe('the bridge’s socket', () => {
  it('stays in the home when its path is short, else moves to a short folder of its own', () => {
    expect(socketDir('/Users/a/.teamod/run')).toBe('/Users/a/.teamod/run');
    const long = `/Users/a/${'deep/'.repeat(20)}.teamod/run`;
    const moved = socketDir(long);
    expect(moved).not.toBe(long);
    expect(Buffer.byteLength(`${moved}/4194304.sock`)).toBeLessThanOrEqual(100);
    expect(socketDir(long)).toBe(moved);
  });
});

describe('a choice among many', () => {
  it('pages past what a surface draws, keeping the picked one, and picks through', async () => {
    const { Draw, MAX_OPTIONS } = await import('../src/teamod/tree.js');
    const memory = new Map<string, unknown>();
    const local = <T,>(key: string, initial: T): [T, (next: T) => void] => [(memory.has(key) ? memory.get(key) : initial) as T, (next: T) => void memory.set(key, next)];
    const picked: string[] = [];
    const options = Array.from({ length: 73 }, (_, i) => ({ value: `p${i}`, label: `project-${i}` }));
    const drawOnce = () => {
      const d = new Draw(local);
      const node = d.select('scope', options, (v) => void picked.push(String(v)), { value: 'p70' });
      return { d, node: node as Extract<Node, { k: 'select' }> };
    };
    const first = drawOnce();
    expect(first.node.options.length).toBeLessThanOrEqual(MAX_OPTIONS);
    expect(first.node.options[0]!.value).toBe('p70');
    expect(first.node.options.some((o) => o.label.startsWith('More ›'))).toBe(true);
    await first.d.handlers.get('scope')!('__teamod:later');
    const second = drawOnce();
    expect(second.node.options.some((o) => o.value === 'p72')).toBe(true);
    expect(second.node.options.some((o) => o.label === '‹ Earlier')).toBe(true);
    await second.d.handlers.get('scope')!('p72');
    expect(picked).toEqual(['p72']);
  });
});
