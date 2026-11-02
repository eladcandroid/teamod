import { createBoardTools } from './board-tools.js';
import { createDashboardTools } from './dashboard-tools.js';
import { createMacTools } from './mac-tools.js';
import { createPhoneTools } from './phone-tools.js';
import { createPlanTools } from './plan-tools.js';
import { createSentinelTools } from './sentinel-tools.js';
import { createTaskTools } from './task-tools.js';
import type { ToolSuite } from './tool-kit.js';
import { createRoomTools } from './tools.js';
import type { AgentRunInput, RoomBridge } from './types.js';
import { type ViewShelf, createViewTools } from './view-tools.js';

/**
 * teamod's tools for one run, by server name: the one registry both mounts serve (Claude's
 * in-process servers, the stdio server for any other runtime). Which suites a run gets is decided
 * here alone, from its input.
 */
export function runToolSuites(input: AgentRunInput, bridge: RoomBridge, shelf: ViewShelf, cwd: string): Record<string, ToolSuite> {
  const askOnly = input.place?.askOnly;
  // A friend's task brings the tools its owner allowed (the screen, device info) as a server of their own.
  const task = input.taskTools ? createTaskTools(input.taskTools) : undefined;
  return {
    teamod: createRoomTools(bridge, askOnly ? input.continueInWorktree : undefined, askOnly ? undefined : input.setup, input.dialogue),
    ...(task ? { teamod_task: task } : {}),
    // Your own runs get the task board (core/board): the task they're doing, and tools to keep it true.
    ...(input.board ? { teamod_board: createBoardTools(input.board) } : {}),
    // Your own runs get sentinels (core/sentinel): list, set up, run, pause; inside a run, stop it.
    ...(input.sentinelTools ? { teamod_sentinel: createSentinelTools(input.sentinelTools) } : {}),
    ...(input.dashboardTools ? { teamod_dashboard: createDashboardTools(input.dashboardTools) } : {}),
    // A plan's home conversation gets the plan's tools (core/plans).
    ...(input.planTools ? { teamod_plan: createPlanTools(input.planTools) } : {}),
    // "Your Mac" gets its own tools (core/assistant).
    ...(input.macTools ? { teamod_mac: createMacTools(input.macTools) } : {}),
    // Your own runs can drive your phone (core/phone, ACME-150).
    ...(input.phoneTools ? { teamod_phone: createPhoneTools(input.phoneTools) } : {}),
    teamod_view: createViewTools(shelf, cwd),
  };
}
