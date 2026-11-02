import { type Tile, tileTitle } from '../../core/sentinel/dashboard-model.js';
import { ACCESS_INFO, type Access, type MergeStep, sentinelChatChannel, sentinelChatTitle } from '../../core/sentinel/model.js';
import type { Ctx, Route } from '../screens.js';
import { type Node, text, title } from '../tree.js';
import { back, empty, page } from './common.js';
import { type Here, leave, top } from './sentinel-common.js';
import { patchStep } from './sentinel-model.js';

/**
 * What asks first, in one place: deleting anything, widening what a sentinel may do, and a new
 * secret. Each is a page of its own with one thing to press; Back is the way out, and nothing has
 * happened until the press. The question is worked out from the state as it is now, so it can never
 * ask about something that changed meanwhile.
 */

export type AskWhat = 'remove' | 'rotate' | 'access' | 'merge-alone' | 'remove-step' | 'run-chat' | 'run' | 'board' | 'tile' | 'chat' | 'chat-clear';

export const askRoute = (what: AskWhat, params: Readonly<Record<string, string>>): Route => ({ name: 'ask', params: { what, ...params } });

/** Where the webhook page keeps its address: its secret is in it, so only that page ever reads this. */
export const webhookKey = (id: string): string => `sentinel:webhook:${id}`;

interface Asking {
  readonly here: Here;
  readonly title: string;
  readonly message: string;
  readonly confirm: string;
  run(): Promise<void>;
}

function asking(ctx: Ctx, p: Readonly<Record<string, string>>): Asking | undefined {
  const s = ctx.state.sentinel;
  const item = p.id ? s.items.find((x) => x.id === p.id) : undefined;
  switch (p.what) {
    case 'remove':
      if (!item) return undefined;
      return {
        here: 'sentinels',
        title: `Delete “${item.name}”?`,
        message: 'It stops watching, and a run going now stops. Its past runs’ reports go with the next clean-up. This can’t be undone.',
        confirm: 'Delete Sentinel',
        run: async () => {
          await ctx.call('sentinel.remove', item.id);
          leave(ctx, (route) => route.params?.id === item.id);
          ctx.effect({ toast: `Deleted ${item.name}` });
        },
      };
    case 'rotate':
      if (!item) return undefined;
      return {
        here: 'sentinels',
        title: `A new secret for “${item.name}”?`,
        message: 'Its URL and its signing secret change, and the old ones stop working at once: whatever posts to it (GitHub, Stripe) needs the new URL, and GitHub the new secret.',
        confirm: 'Rotate Secret',
        run: async () => {
          await ctx.call('sentinel.rotateSecret', item.id);
          ctx.refresh(webhookKey(item.id));
          leave(ctx);
          ctx.effect({ toast: 'A new secret: show and copy the new URL' });
        },
      };
    case 'access': {
      const access = p.access as Access | undefined;
      const info = access ? ACCESS_INFO[access] : undefined;
      if (!item || !access || !info) return undefined;
      return {
        here: 'sentinels',
        title: `Give “${item.name}” ${info.label} access?`,
        message: `${info.sentence}. It applies from its next run${item.paused ? '' : ', and this sentinel is on'}.`,
        confirm: `Give ${info.label} Access`,
        run: async () => {
          await ctx.call('sentinel.update', item.id, { access });
          leave(ctx);
        },
      };
    }
    case 'merge-alone': {
      const step = item?.steps.find((x): x is MergeStep => x.id === p.step && x.kind === 'merge');
      if (!item || !step) return undefined;
      return {
        here: 'sentinels',
        title: 'Merge without asking?',
        message: 'This sentinel will merge its pull request by itself once every check passes and the agent’s review says ship. A hold still asks you. You can turn asking back on here any time.',
        confirm: 'Merge Without Asking',
        run: async () => {
          await ctx.call('sentinel.update', item.id, { steps: patchStep<MergeStep>(item.steps, step.id, { require: { checks: true, approval: false } }) });
          leave(ctx);
        },
      };
    }
    case 'remove-step': {
      const step = item?.steps.find((x) => x.id === p.step);
      if (!item || !step) return undefined;
      return {
        here: 'sentinels',
        title: `Remove “${step.name}”?`,
        message: 'This step and what it says go from the sentinel. Past runs keep their outputs.',
        confirm: 'Remove Step',
        run: async () => {
          await ctx.call('sentinel.update', item.id, { steps: item.steps.filter((x) => x.id !== step.id) });
          leave(ctx, (route) => route.params?.step === step.id);
        },
      };
    }
    case 'run-chat':
      if (!p.run) return undefined;
      return {
        here: 'sentinels',
        title: 'Delete this run’s chat?',
        message: 'Its agent’s conversation goes for good. The run, its report and its steps’ outputs stay here.',
        confirm: 'Delete Chat',
        run: async () => {
          await ctx.call('sentinel.runDelete', p.run, 'chat');
          leave(ctx);
          ctx.effect({ toast: 'Deleted the run’s chat' });
        },
      };
    case 'run':
      if (!p.run) return undefined;
      return {
        here: 'sentinels',
        title: 'Delete this run?',
        message: 'Its agent’s conversation, its report, its steps’ outputs and its folder go for good. A worktree it made and numbers it kept stay.',
        confirm: 'Delete Run',
        run: async () => {
          await ctx.call('sentinel.runDelete', p.run, 'run');
          leave(ctx, (route) => route.params?.run === p.run);
          ctx.effect({ toast: 'Deleted the run' });
        },
      };
    case 'board': {
      const board = s.dashboards?.find((d) => d.id === p.board);
      if (!board) return undefined;
      return {
        here: 'dashboards',
        title: `Delete “${board.name}”?`,
        message: 'Its tiles go; the numbers stay with their sentinels, and other boards keep theirs.',
        confirm: 'Delete Board',
        run: async () => {
          await ctx.call('dashboard.remove', board.id);
          leave(ctx, (route) => route.params?.board === board.id);
          ctx.effect({ toast: `Deleted ${board.name}` });
        },
      };
    }
    case 'tile': {
      const board = s.dashboards?.find((d) => d.id === p.board);
      const tile: Tile | undefined = board?.tiles.find((t) => t.id === p.tile);
      if (!board || !tile) return undefined;
      return {
        here: 'dashboards',
        title: `Remove “${tileTitle(s, tile) || 'this tile'}”?`,
        message: 'It goes from this board. What it shows stays with its sentinel.',
        confirm: 'Remove Tile',
        run: async () => {
          await ctx.call('dashboard.removeTile', board.id, tile.id);
          leave(ctx, (route) => route.params?.tile === tile.id);
        },
      };
    }
    case 'chat':
    case 'chat-clear': {
      const chat = p.chat;
      if (!chat) return undefined;
      const name = sentinelChatTitle(sentinelChatChannel(chat), ctx.state.log);
      if (p.what === 'chat-clear') {
        return {
          here: 'chat',
          title: `Clear “${name}”?`,
          message: 'Its messages go, and the agent starts afresh. The chat stays.',
          confirm: 'Clear Chat',
          run: async () => {
            await ctx.call('sentinel.chatClear', chat);
            leave(ctx);
            ctx.effect({ toast: 'Cleared. The agent starts a fresh conversation here' });
          },
        };
      }
      return {
        here: 'chat',
        title: `Delete “${name}”?`,
        message: 'Its messages and the agent’s memory of it go for good. Your sentinels and dashboards stay as they are.',
        confirm: 'Delete Chat',
        run: async () => {
          await ctx.call('sentinel.chatDelete', chat);
          leave(ctx, (route) => route.params?.chat === chat);
          ctx.effect({ toast: 'Deleted the chat' });
        },
      };
    }
    default:
      return undefined;
  }
}

export function askPage(ctx: Ctx): Node {
  const now = asking(ctx, ctx.route.params ?? {});
  if (!now) return page(top(ctx), back(ctx), empty('That is no longer there.'));
  return page(top(ctx, now.here), back(ctx, 'Cancel'), title(now.title), text(now.message), ctx.draw.button('ask:yes', now.confirm, () => now.run(), { primary: true, hotkey: 'y' }));
}
