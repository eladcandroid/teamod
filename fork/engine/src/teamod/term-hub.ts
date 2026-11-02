import type { Seg } from '../shared/text.js';
import { encodeKey, type InkKeyLike } from '../terminal/keys.js';
import { type PtyLink, TerminalEmulator } from '../terminal/emulator.js';

/** A run of a terminal row, as the mod's module draws it. Short names: a screenful is many of these. */
export interface TermSpan {
  readonly t: string;
  readonly c?: string;
  readonly b?: string;
  readonly w?: 1;
  readonly d?: 1;
  readonly i?: 1;
  readonly u?: 1;
  readonly v?: 1;
}

export interface TermFrame {
  readonly rows: ReadonlyArray<readonly TermSpan[]>;
  readonly title: string;
  readonly running: boolean;
  readonly exit?: number | null;
  readonly scrolled: number;
  readonly altScreen: boolean;
}

/** One key as the mod's module reports it (Escape never arrives: it gives the focus back). */
export interface TermKey {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
}

/** A surface takes a tree this big, in all: a screen past it draws without colours first. */
const MAX_FRAME_CHARS = 90_000;
const MAX_ROWS = 200;
const MAX_COLS = 400;

const SPECIAL: Readonly<Record<string, keyof InkKeyLike>> = {
  up: 'upArrow',
  down: 'downArrow',
  left: 'leftArrow',
  right: 'rightArrow',
  pageup: 'pageUp',
  pagedown: 'pageDown',
  home: 'home',
  end: 'end',
  return: 'return',
  enter: 'return',
  tab: 'tab',
  backspace: 'backspace',
  delete: 'delete',
  escape: 'escape',
};

/** The bytes a key sends. `ctrl+]` stands in for Esc, which a surface keeps for itself. */
export function bytesOfKey(key: TermKey, applicationCursor: boolean): string {
  if (key.ctrl && key.key === ']') return '\x1b';
  const special = SPECIAL[key.key];
  const flags: InkKeyLike = { ...(key.ctrl ? { ctrl: true } : {}), ...(key.shift ? { shift: true } : {}), ...(key.meta ? { meta: true } : {}), ...(special ? { [special]: true } : {}) };
  return encodeKey(special ? '' : key.key, flags, { applicationCursor });
}

const spanOf = (seg: Seg): TermSpan => ({
  t: seg.text,
  ...(seg.color ? { c: seg.color } : {}),
  ...(seg.bg ? { b: seg.bg } : {}),
  ...(seg.bold ? { w: 1 as const } : {}),
  ...(seg.dim ? { d: 1 as const } : {}),
  ...(seg.italic ? { i: 1 as const } : {}),
  ...(seg.underline ? { u: 1 as const } : {}),
  ...(seg.inverse ? { v: 1 as const } : {}),
});

/** A row's spans with the cell under the cursor inverted, so the cursor shows on any surface. */
function withCursor(spans: readonly TermSpan[], x: number): TermSpan[] {
  const out: TermSpan[] = [];
  let at = 0;
  let placed = false;
  for (const s of spans) {
    const chars = [...s.t];
    if (!placed && x >= at && x < at + chars.length) {
      const i = x - at;
      if (i > 0) out.push({ ...s, t: chars.slice(0, i).join('') });
      out.push({ ...s, t: chars[i] ?? ' ', v: 1 });
      if (i + 1 < chars.length) out.push({ ...s, t: chars.slice(i + 1).join('') });
      placed = true;
    } else {
      out.push(s);
    }
    at += chars.length;
  }
  if (!placed) {
    if (x > at) out.push({ t: ' '.repeat(x - at) });
    out.push({ t: ' ', v: 1 });
  }
  return out;
}

const sizeOf = (rows: ReadonlyArray<readonly TermSpan[]>): number => JSON.stringify(rows).length;

/**
 * The terminals this session has open: each a screen kept by an emulator here, the daemon's PTY
 * session behind it. Closing a screen leaves the program running, as the Mac's dock does.
 */
export class TermHub {
  private readonly open = new Map<string, { readonly emu: TerminalEmulator; rev: number; scroll: number; acked: number }>();

  constructor(
    private readonly attach: (key: string) => PtyLink,
    private readonly markDirty: () => void = () => undefined,
  ) {}

  private session(key: string, cols: number, rows: number): { readonly emu: TerminalEmulator; rev: number; scroll: number; acked: number } {
    const found = this.open.get(key);
    if (found) return found;
    const emu = new TerminalEmulator(this.attach(key), { id: key, cols, rows });
    const session = { emu, rev: 1, scroll: 0, acked: 0 };
    emu.onChange(() => {
      session.rev++;
      this.markDirty();
    });
    this.open.set(key, session);
    return session;
  }

  /** Keys from the module, each once (its `seq` goes up; what it sends again after a lost answer is skipped). */
  keys(key: string, seq: number, pressed: readonly TermKey[], cols: number, rows: number): void {
    const s = this.session(key, cols, rows);
    const fresh = pressed.slice(Math.max(0, pressed.length - Math.max(0, seq - s.acked)));
    s.acked = Math.max(s.acked, seq);
    for (const k of fresh) s.emu.write(bytesOfKey(k, s.emu.applicationCursor));
    if (fresh.length) s.scroll = 0;
  }

  /** Raw bytes, for a press (Ctrl-C has no key to reach the module). */
  write(key: string, data: string): void {
    const s = this.open.get(key);
    if (!s) return;
    s.scroll = 0;
    s.emu.write(data);
  }

  paste(key: string, text: string): void {
    this.open.get(key)?.emu.paste(text);
  }

  /** Look back through what scrolled off. */
  scroll(key: string, delta: number): void {
    const s = this.open.get(key);
    if (!s) return;
    s.scroll = Math.max(0, s.scroll + delta);
    s.rev++;
    this.markDirty();
  }

  /** The screen as text, for Copy. */
  text(key: string): string {
    const s = this.open.get(key);
    if (!s) return '';
    return s.emu
      .snapshot(s.scroll)
      .lines.map((line) => line.map((seg) => seg.text).join(''))
      .join('\n')
      .trimEnd();
  }

  /** The screen, if it changed since `rev`. */
  frame(key: string, cols: number, rows: number, rev: number): { readonly rev: number; readonly acked: number; readonly frame?: TermFrame } {
    const s = this.session(key, cols, rows);
    const c = Math.min(MAX_COLS, Math.max(20, Math.floor(cols)));
    const r = Math.min(MAX_ROWS, Math.max(4, Math.floor(rows)));
    if (c !== s.emu.size.cols || r !== s.emu.size.rows) s.emu.resize(c, r);
    if (rev === s.rev) return { rev: s.rev, acked: s.acked };
    const snap = s.emu.snapshot(s.scroll);
    let drawn: ReadonlyArray<readonly TermSpan[]> = snap.lines.map((line, y) => {
      const spans = line.filter((seg) => seg.text).map(spanOf);
      return snap.cursor && snap.cursor.y === y && s.scroll === 0 ? withCursor(spans, snap.cursor.x) : spans;
    });
    // Past what a surface takes, a screen of many colours keeps its words.
    if (sizeOf(drawn) > MAX_FRAME_CHARS) drawn = snap.lines.map((line) => [{ t: line.map((seg) => seg.text).join('') }]);
    return {
      rev: s.rev,
      acked: s.acked,
      frame: {
        rows: drawn,
        title: snap.title,
        running: s.emu.running,
        ...(snap.exited ? { exit: snap.exited.code } : {}),
        scrolled: s.scroll,
        altScreen: snap.altScreen,
      },
    };
  }

  closeOne(key: string): void {
    const s = this.open.get(key);
    if (!s) return;
    this.open.delete(key);
    s.emu.dispose();
  }

  closeAll(): void {
    for (const key of [...this.open.keys()]) this.closeOne(key);
  }
}
