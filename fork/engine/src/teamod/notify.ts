import { execFile } from 'node:child_process';
import type { DesktopNote } from '../core/notify.js';

/**
 * A notification from the operating system. Used when no session is attached to say it, and by the
 * bridge, because Claude Code's own notification has no surface on desktop.
 *
 * What's shown can come from a teammate, so it goes as arguments, never as part of a script.
 */
export function notifyNatively(note: Pick<DesktopNote, 'title' | 'body'>, run: typeof execFile = execFile): void {
  const quiet = (): void => undefined;
  if (process.platform === 'darwin') {
    run('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', '--', note.title, note.body], quiet);
  } else if (process.platform === 'linux') {
    run('notify-send', ['--', note.title, note.body], quiet);
  }
}
