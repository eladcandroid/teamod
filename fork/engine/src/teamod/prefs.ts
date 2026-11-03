/**
 * teamod's own choices about how screens read, kept beside the engine's settings in the home
 * (`teamod.json`): the language, how right-to-left text is drawn, and whether hotkeys show.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type Lang, LANGS, langOf } from './i18n/i18n.js';

export interface Prefs {
  /** `auto`: the language the computer is set to. */
  readonly lang: 'auto' | Lang;
  /**
   * How a terminal gets right-to-left text. `fix`: teamod orders the letters (most terminals);
   * `terminal`: as written, for a terminal that orders them itself. `auto` tells them apart.
   */
  readonly rtl: 'auto' | 'fix' | 'terminal';
  /** Hotkeys drawn beside the controls (`w: Work`), or kept out of sight. */
  readonly keys: boolean;
}

export const DEFAULT_PREFS: Prefs = { lang: 'auto', rtl: 'auto', keys: false };

const valid = (raw: unknown): Prefs => {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    lang: v.lang === 'auto' || (LANGS as readonly unknown[]).includes(v.lang) ? (v.lang as Prefs['lang']) : DEFAULT_PREFS.lang,
    rtl: v.rtl === 'fix' || v.rtl === 'terminal' || v.rtl === 'auto' ? v.rtl : DEFAULT_PREFS.rtl,
    keys: typeof v.keys === 'boolean' ? v.keys : DEFAULT_PREFS.keys,
  };
};

/** The prefs file, read again whenever it changes (another session may have changed it). */
export class PrefsFile {
  private cached: Prefs = DEFAULT_PREFS;
  private mtime = -1;

  constructor(private readonly file: string) {}

  static in(home: string): PrefsFile {
    return new PrefsFile(path.join(home, 'teamod.json'));
  }

  get(): Prefs {
    try {
      const at = statSync(this.file).mtimeMs;
      if (at !== this.mtime) {
        this.cached = valid(JSON.parse(readFileSync(this.file, 'utf8')));
        this.mtime = at;
      }
    } catch {
      this.cached = DEFAULT_PREFS;
      this.mtime = -1;
    }
    return this.cached;
  }

  set(change: Partial<Prefs>): Prefs {
    const next = valid({ ...this.get(), ...change });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
    this.cached = next;
    this.mtime = statSync(this.file).mtimeMs;
    return next;
  }
}

let systemLang: Lang | undefined;

/** The computer's language: the locale variables, then (on a Mac) the language list in System Settings. */
export function systemLanguage(env: NodeJS.ProcessEnv = process.env): Lang {
  const named = env.LC_ALL || env.LC_MESSAGES || env.LANGUAGE?.split(':')[0] || env.LANG;
  if (named && !/^(C|POSIX)(\.|$)/i.test(named) && langOf(named) !== 'en') return langOf(named);
  if (systemLang) return systemLang;
  systemLang = 'en';
  if (process.platform === 'darwin') {
    const ran = spawnSync('defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf8', timeout: 2000 });
    const first = /"?([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)"?/.exec(ran.stdout?.replace(/[()\s]/g, ' ') ?? '')?.[1];
    systemLang = langOf(first);
  }
  return systemLang;
}

export const languageOf = (prefs: Prefs, env: NodeJS.ProcessEnv = process.env): Lang => (prefs.lang === 'auto' ? systemLanguage(env) : prefs.lang);

/**
 * Whether the terminal this session runs in orders right-to-left letters itself. Terminal.app,
 * VTE's (GNOME Terminal and its kin), Konsole and mlterm do; Ghostty, kitty, WezTerm, iTerm2 (by
 * default), Alacritty, VS Code's and tmux in front of any of them don't.
 */
export function terminalOrdersRtl(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TERM_PROGRAM === 'Apple_Terminal' || env.TERM_PROGRAM === 'mlterm') return true;
  return Boolean(env.VTE_VERSION || env.KONSOLE_VERSION);
}

/** Whether teamod must order right-to-left letters on this surface. */
export const fixesRtl = (prefs: Prefs, surface: string, env: NodeJS.ProcessEnv = process.env): boolean =>
  surface === 'terminal' && (prefs.rtl === 'fix' || (prefs.rtl === 'auto' && !terminalOrdersRtl(env)));
