import type { Screen } from '../screens.js';
import { dim } from '../tree.js';
import { chrome, page } from './common.js';

export const sentinelPane: Screen = (ctx) => page(chrome(ctx), dim('Sentinel comes in a later phase.'));
