import type { Screen } from '../screens.js';
import { dim } from '../tree.js';
import { chrome, page } from './common.js';

export const teamPane: Screen = (ctx) => page(chrome(ctx), dim('Team comes in a later phase.'));
