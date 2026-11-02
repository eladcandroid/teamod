import type { Screen } from '../screens.js';
import { dim } from '../tree.js';
import { chrome, page } from './common.js';

export const settingsPane: Screen = (ctx) => page(chrome(ctx), dim('Settings comes in a later phase.'));
