import { describe, expect, it } from 'vitest';
import { ghosttyAction, ghosttyChord, ghosttyKeys, itermChord, itermKeys, menuEquivalentChord } from '../src/terminal/import/keys.js';
import { ghosttyLines, parseGhostty } from '../src/terminal/import/parsers.js';
import { TERM_BUSY, isTermBusy } from '../src/shared/terminal-keys.js';

/** ACME-535–537: how a conversation shows, and keys from your own terminal. */

describe('how a conversation shows', () => {
  it('knows a busy terminal from one that couldn’t start', () => {
    expect(isTermBusy(`Error: ${TERM_BUSY}`)).toBe(true);
    expect(isTermBusy('That workspace is archived or gone.')).toBe(false);
  });
});

describe('the terminal’s keys', () => {
  it('reads Ghostty’s keybinds', () => {
    expect(ghosttyChord('super+shift+d')).toBe('Shift+Cmd+D');
    expect(ghosttyChord('global:ctrl+alt+left')).toBe('Ctrl+Alt+Left');
    expect(ghosttyChord('ctrl+a>n')).toBeUndefined();
    expect(ghosttyChord('super+bracket_left')).toBe('Cmd+[');
    expect(ghosttyAction('new_split:down')).toBe('split_down');
    expect(ghosttyAction('goto_split:top')).toBe('focus_up');
    expect(ghosttyAction('text:\\x1bb')).toBe('text:\x1bb');
    expect(ghosttyAction('csi:A')).toBe('text:\x1b[A');
    expect(ghosttyAction('toggle_fullscreen')).toBeUndefined();
    const config = ['keybind = super+t=new_tab', 'keybind = super+t=unbind', 'keybind = alt+left=esc:b', 'keybind = super+enter=toggle_fullscreen', 'keybind = super+==increase_font_size:1', 'font-size = 14'].join('\n');
    const { keys, skipped } = ghosttyKeys(ghosttyLines(config));
    expect(keys).toEqual([
      { chord: 'Cmd+T', action: 'unbind' },
      { chord: 'Alt+Left', action: 'text:\x1bb' },
      { chord: 'Cmd+=', action: 'font_up' },
    ]);
    expect(skipped).toBe(1);
    const parsed = parseGhostty(config);
    expect(parsed.look?.keys).toHaveLength(3);
    expect(parsed.notes.join(' ')).toMatch(/One of your keys/);
  });

  it('reads iTerm2’s key mappings and menu shortcuts', () => {
    expect(itermChord('0xf702-0x280000')).toBe('Alt+Left');
    expect(itermChord('0x64-0x100000-0x2')).toBe('Cmd+D');
    expect(menuEquivalentChord('@$d')).toBe('Shift+Cmd+D');
    expect(menuEquivalentChord('@~')).toBe('Alt+Cmd+Right');
    const root = {
      GlobalKeyMap: { '0xf702-0x280000': { Action: 10, Text: 'b' }, '0x61-0x40000': { Action: 11, Text: '0x1 0x2' }, '0x71-0x100000': { Action: 99, Text: '' } },
      NSUserKeyEquivalents: { 'Split Vertically with Current Profile': '@e', 'Some Other Menu': '@j' },
    };
    const profile = { 'Keyboard Map': { '0xf703-0x280000': { Action: 12, Text: 'hi\\n' } } };
    const { keys, skipped } = itermKeys(root, profile);
    expect(keys).toEqual(
      expect.arrayContaining([
        { chord: 'Alt+Left', action: 'text:\x1bb' },
        { chord: 'Ctrl+A', action: 'text:\x01\x02' },
        { chord: 'Alt+Right', action: 'text:hi\n' },
        { chord: 'Cmd+E', action: 'split_right' },
      ]),
    );
    expect(skipped).toBe(2);
  });
});
