/**
 * The product is "teamod" here. The engine's own messages say "teamod"; where a screen shows them as
 * its own words (toasts, notices, system lines) they go through this. Never for what a person or an
 * agent wrote, and never for what's a name: paths, links, identifiers and anything in `code` stay.
 */
const WORD = /\bTeamod\b/g;
const NAME_BEFORE = /[/~.\-@_]/;
const NAME_AFTER = /^(?::\/\/|[./\-_@]\w)/;
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/;

const prose = (text: string): string =>
  text.replace(WORD, (word: string, at: number) => (NAME_BEFORE.test(text[at - 1] ?? '') || NAME_AFTER.test(text.slice(at + word.length)) ? word : 'teamod'));

export const brandWords = (text: string): string =>
  text
    .split(CODE)
    .map((part, i) => (i % 2 ? part : prose(part)))
    .join('');
