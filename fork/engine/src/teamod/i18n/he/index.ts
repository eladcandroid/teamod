import type { Catalog } from '../i18n.js';
import { BAND } from './band.js';
import { BOARD } from './board.js';
import { COMMON } from './common.js';
import { SENTINEL } from './sentinel.js';
import { SETTINGS } from './settings.js';
import { TASK } from './task.js';
import { TEAM } from './team.js';
import { WORK } from './work.js';

/** Every screen's Hebrew, one shard per area so they can be written side by side. */
export const HE: Catalog = { ...COMMON, ...WORK, ...TASK, ...TEAM, ...BOARD, ...SENTINEL, ...SETTINGS, ...BAND };
