import type { Screen, SiteId } from '../screens.js';
import { dim } from '../tree.js';
import { chrome, page } from './common.js';
import { bandView } from './band.js';
import { taskPane } from './task.js';
import { workPane } from './work.js';

const later =
  (name: string): Screen =>
  (ctx) =>
    page(chrome(ctx), dim(`${name} comes in a later phase.`));

export const SCREENS: Readonly<Record<SiteId, Screen>> = {
  work: workPane,
  task: taskPane,
  team: later('Team'),
  board: later('Board'),
  sentinel: later('Sentinel'),
  settings: later('Settings'),
  band: bandView,
};
