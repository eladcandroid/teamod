import type { Screen, SiteId } from '../screens.js';
import { bandView } from './band.js';
import { boardPane } from './board.js';
import { sentinelPane } from './sentinel.js';
import { settingsPane } from './settings.js';
import { taskPane } from './task.js';
import { teamPane } from './team.js';
import { workPane } from './work.js';

export const SCREENS: Readonly<Record<SiteId, Screen>> = {
  work: workPane,
  task: taskPane,
  team: teamPane,
  board: boardPane,
  sentinel: sentinelPane,
  settings: settingsPane,
  band: bandView,
};
