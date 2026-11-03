import type { Catalog } from '../i18n.js';
import { BAND } from './band.js';
import { BOARD } from './board.js';
import { COMMON } from './common.js';
import { SENTINEL } from './sentinel.js';
import { SETTINGS } from './settings.js';
import { TASK } from './task.js';
import { TEAM } from './team.js';
import { WORK } from './work.js';

/**
 * Words two areas both draw, settled once: the shards were written side by side, and a later shard
 * would otherwise win by its place in the list. One word, one Hebrew, on every screen.
 */
const SETTLED: Catalog = {
  '1 step': 'שלב אחד',
  '{#0} steps': '{0} שלבים',
  Steps: 'שלבים',
  In: 'בתוך',
  'Looking...': 'בבדיקה...',
  'Couldn’t look: {0}': 'הבדיקה נכשלה: {0}',
  'Pull requests': 'PRs',
  'guessed from the project': 'הוסק מהפרויקט',
  Archive: 'העברה לארכיון',
  Running: 'פועל',
  Sun: 'יום א׳',
  Mon: 'יום ב׳',
  Tue: 'יום ג׳',
  Wed: 'יום ד׳',
  Thu: 'יום ה׳',
  Fri: 'יום ו׳',
  'This run failed.': 'ההרצה נכשלה.',
  Waiting: 'ממתין',
  On: 'פעיל',
  '{0} waits for you': '{0} ממתין לך',
  Resume: 'המשך',
  Where: 'מיקום',
  'No limit': 'ללא הגבלה',
};

/** Every screen's Hebrew, one shard per area so they can be written side by side. */
export const HE: Catalog = { ...COMMON, ...WORK, ...TASK, ...TEAM, ...BOARD, ...SENTINEL, ...SETTINGS, ...BAND, ...SETTLED };
