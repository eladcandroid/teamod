import type { Tone } from '../types'

/**
 * The pictures a desktop draws: line icons for screens and things, and initials badges for
 * projects and people. Plain SVG, drawn as images (no script, nothing to press: the press is the
 * element beside it).
 */

/** Colors that read on a light and a dark theme alike. */
export const TONE_HEX: Readonly<Record<Tone, string>> = {
  ok: '#3fb950',
  warn: '#d29922',
  error: '#f85149',
  accent: '#d97757',
  info: '#d97757',
  quiet: '#8b929b',
}

/** A chip's fill: the tone's color, faint. */
export const TONE_TINT: Readonly<Record<Tone, string>> = {
  ok: 'rgba(63, 185, 80, 0.16)',
  warn: 'rgba(210, 153, 34, 0.18)',
  error: 'rgba(248, 81, 73, 0.16)',
  accent: 'rgba(217, 119, 87, 0.18)',
  info: 'rgba(217, 119, 87, 0.18)',
  quiet: 'rgba(127, 127, 127, 0.16)',
}

/** Fills behind a card, under the pointer, and behind the open tab. */
export const FILL = {
  card: 'rgba(127, 127, 127, 0.07)',
  hover: 'rgba(127, 127, 127, 0.14)',
  subtle: 'rgba(127, 127, 127, 0.08)',
  strong: 'rgba(127, 127, 127, 0.18)',
} as const

/** Each icon's strokes, on a 24 × 24 grid. */
const ICONS: Readonly<Record<string, string>> = {
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  task: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h6M15 12h6"/>',
  sentinel: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  branch: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 8v8M18 10a6 6 0 0 1-6 6H8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
}

/** What the terminal draws in an icon's place. */
export const ICON_GLYPHS: Readonly<Record<string, string>> = {
  work: '◆', task: '▸', team: '◉', board: '▤', sentinel: '◷', settings: '✱', folder: '▢', branch: '⌥',
  plus: '+', search: '⌕', check: '✓', alert: '!', chat: '◌', clock: '◷',
}

export function iconSvg(name: string, tone: Tone = 'quiet', size = 16): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${TONE_HEX[tone]}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ICONS.folder}</svg>`
}

const escapeXml = (text: string): string =>
  text.replace(/[<>&'"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch]!)

/** Up to two letters for a name: "cc-zol" → "CZ", "anatomy" → "AN". */
export function initials(name: string): string {
  const words = name.split(/[\s\-_./]+/).filter(Boolean)
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? '?').slice(0, 2)

  return letters.toUpperCase()
}

/** The same name, the same color, on every Mac. */
function hueOf(name: string): number {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0

  return hash % 360
}

export function avatarSvg(name: string, size = 28): string {
  const hue = hueOf(name)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="hsl(${hue}, 52%, 44%)"/><text x="14" y="14.5" text-anchor="middle" dominant-baseline="central" font-family="-apple-system, system-ui, sans-serif" font-size="11.5" font-weight="600" fill="#fff">${escapeXml(initials(name))}</text></svg>`
}
