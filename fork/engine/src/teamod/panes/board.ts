import type { Screen } from '../screens.js';
import { dim } from '../tree.js';
import { chrome, page } from './common.js';

export const boardPane: Screen = (ctx) => page(chrome(ctx), dim('Board comes in a later phase.'));
