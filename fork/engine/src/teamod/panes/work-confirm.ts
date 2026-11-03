import { assistantChannel, assistantChatTitle } from '../../shared/assistant.js';
import { worktreeOrigin } from '../../workspaces/origin.js';
import type { Workspace } from '../../workspaces/types.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, span } from '../tree.js';
import { type Tone, actions, back, card, chrome, empty, findWorkspace, homePath, page } from './common.js';
import { backTo, eachOf, placesOf, plural } from './work-common.js';

/**
 * Everything that loses something asks here first, with what it keeps and what it loses, in the
 * words teamod's own alerts use: a page with one Confirm, and Back to change your mind.
 */

interface Ask {
  readonly heading: string;
  readonly words: ReadonlyArray<Node | undefined>;
  readonly label: string;
  readonly run: () => Promise<unknown>;
  /** The route to come back to, when the page it was asked from may be gone. */
  readonly backTo?: string;
  /** `error` for what can't be undone; a question that keeps everything is a warning. */
  readonly tone?: Tone;
}

const gone = (ctx: Ctx, words: string): Node => page(chrome(ctx, placesOf(ctx)), back(ctx), empty(words));

function asking(ctx: Ctx, ask: Ask): Node {
  const confirm = ctx.draw.button(
    'confirm',
    ask.label,
    async () => {
      // Asked and answered: the page goes at once, and the disk work goes on behind it, as each row says.
      const running = ask.run();
      if (ask.backTo) backTo(ctx, ask.backTo);
      else ctx.nav.back(ctx.pane);
      // The page it was asked from may be about what's going.
      const under = ctx.nav.routeOf(ctx.pane);
      if (under.name === 'worktree' && (ctx.route.params?.ids ?? ctx.route.params?.id ?? '').split(',').includes(under.params?.id ?? '')) ctx.nav.back(ctx.pane);
      await running;
    },
    { primary: true, hotkey: 'c' },
  );
  return page(chrome(ctx, placesOf(ctx)), back(ctx, 'Cancel'), card([col(ask.words, { gap: 1, top: 1 }), actions(confirm)], { title: ask.heading, tone: ask.tone ?? 'warn' }));
}

/** A sentence in parts, each its own piece of text, so each part is translated as written. */
const said = (...parts: ReadonlyArray<string | false | undefined | 0>): Node => line(...parts.flatMap((p) => (p ? [span(p, { dim: true })] : [])));

const workspacesOf = (ctx: Ctx, ids: readonly string[]): Workspace[] => ids.flatMap((id) => findWorkspace(ctx.state, id) ?? []);

const each = async (ctx: Ctx, list: readonly Workspace[], method: string, how?: 'sequential'): Promise<void> => {
  ctx.local<readonly string[]>('worktrees:ticked', [])[1]([]);
  const failed = await eachOf(list.map((w) => w.id), (id) => ctx.call(method, id), how);
  if (failed) ctx.effect({ toast: failed });
};

function archiveAsk(ctx: Ctx, list: readonly Workspace[]): Node {
  const n = list.length;
  const outside = list.filter((w) => worktreeOrigin(w) === 'external').length;
  return asking(ctx, {
    heading: `Archive ${plural(n, 'worktree')}?`,
    words: [
      dim(`Everything of yours in ${n === 1 ? 'it' : 'them'} is kept: uncommitted work, new files and ignored files like .env. ${n === 1 ? 'Its' : 'Their'} build files are removed, and ${n === 1 ? 'the folder goes' : 'the folders go'}.`),
      dim(`${n === 1 ? 'Its branch and conversation stay' : 'Their branches and conversations stay'}. Restore ${n === 1 ? 'it' : 'any of them'} from Archived on the Worktrees page, as ${n === 1 ? 'it was' : 'they were'}.`),
      outside ? dim(`${outside === 1 ? 'One was' : `${outside} were`} made outside: the app that made ${outside === 1 ? 'it' : 'them'} may still have ${outside === 1 ? 'it' : 'them'} open.`) : undefined,
    ],
    label: `Archive ${plural(n, 'Worktree')}`,
    run: () => each(ctx, list, 'workspaces.archive'),
  });
}

function freeAsk(ctx: Ctx, list: readonly Workspace[]): Node {
  return asking(ctx, {
    heading: `Remove build files from ${plural(list.length, 'worktree')}?`,
    words: [
      dim('Deletes what the project makes again by itself: node_modules, build output and caches.'),
      dim('Your work stays: files, commits, uncommitted changes, ignored files like .env, and the worktrees themselves. To work in one again, run its setup (npm install and the like).'),
    ],
    label: 'Remove Build Files',
    run: () => each(ctx, list, 'workspaces.freeSpace', 'sequential'),
  });
}

function deleteAsk(ctx: Ctx, list: readonly Workspace[]): Node {
  const n = list.length;
  const archived = list.some((w) => w.archived);
  const noun = list.every((w) => w.kind === 'chat') ? 'chat' : 'worktree';
  const own = list.filter((w) => worktreeOrigin(w) === 'teamod');
  const words: Array<Node | undefined> = [];
  if (archived) {
    const saved = list.filter((w) => w.archive).length;
    const branches = own.filter((w) => w.branch).length;
    words.push(
      said(
        saved && (saved === n ? (n === 1 ? 'Its archive' : 'Their archives') : plural(saved, 'archive')),
        saved && ' (uncommitted work and files of yours kept when archived) ',
        saved && branches && 'and ',
        branches && `${branches === 1 ? 'the branch' : `${branches} branches`} teamod made (commits only there) `,
        saved || branches ? `go, with ${n === 1 ? 'its conversation' : 'their conversations'}.` : `${n === 1 ? 'Its conversation goes' : 'Their conversations go'}.`,
        ' Branches other tools made are kept.',
      ),
    );
  } else {
    const files = own.reduce((k, w) => k + (w.status?.changed ?? 0), 0);
    const commits = own.filter((w) => w.branch).reduce((k, w) => k + (w.status?.ahead ?? 0), 0);
    const branches = own.filter((w) => w.branch).length;
    const theirs = n - own.length;
    words.push(
      said(
        n === 1 ? 'Its folder goes, with its conversation' : 'Their folders go, with their conversations',
        branches && ` and ${branches === 1 ? 'the branch' : `the ${branches} branches`} teamod made`,
        branches && commits && ` (${plural(commits, 'commit')} not in main)`,
        '.',
        files && ` ${plural(files, 'uncommitted file')} ${files === 1 ? 'is' : 'are'} lost.`,
      ),
      theirs ? said(`${n === 1 ? 'It was' : theirs === 1 ? 'One was' : `${theirs} were`} made outside or by a sub-agent:`, ` ${theirs === 1 ? 'its branch is' : 'their branches are'} kept, and git won’t delete one with uncommitted changes.`) : undefined,
    );
  }
  words.push(said('You can’t undo this.', !archived && ` To keep the work, archive ${n === 1 ? 'it' : 'them'} instead.`));
  return asking(ctx, { tone: 'error', heading: `Delete ${plural(n, archived ? `archived ${noun}` : noun)} permanently?`, words, label: `Delete ${plural(n, noun === 'chat' ? 'Chat' : 'Worktree')}`, run: () => each(ctx, list, 'workspaces.remove') });
}

export function confirmPage(ctx: Ctx): Node {
  const params = ctx.route.params ?? {};
  const ids = (params.ids ?? '').split(',').filter(Boolean);
  switch (params.act) {
    case 'archive':
    case 'free':
    case 'delete': {
      const list = workspacesOf(ctx, ids);
      if (!list.length) return gone(ctx, 'Those worktrees are gone.');
      return params.act === 'archive' ? archiveAsk(ctx, list) : params.act === 'free' ? freeAsk(ctx, list) : deleteAsk(ctx, list);
    }
    case 'remove-other': {
      const ws = params.id ? findWorkspace(ctx.state, params.id) : undefined;
      if (!ws) return gone(ctx, 'That worktree is gone.');
      const changed = ws.status?.changed ?? 0;
      return asking(ctx, {
        heading: `Remove “${ws.name}”?`,
        words: [
          said('The engine deletes its folder and git’s record of it. ', ws.branch ? `The branch ${ws.branch} stays, so nothing committed is lost.` : 'It isn’t on a branch, so commits only it has may be hard to find later.'),
          changed ? dim(`It has ${plural(changed, 'uncommitted change')}. They’ll be lost.`) : undefined,
          dim('If you still use it in the app that made it, remove it there instead: that app would show it as missing.'),
        ],
        label: changed ? 'Remove Anyway' : 'Remove',
        run: () => ctx.call('workspaces.removeOther', ws.id, changed > 0),
      });
    }
    case 'clean-agents': {
      const project = ctx.state.projects.find((p) => p.id === params.project);
      if (!project) return gone(ctx, 'That project is gone.');
      const finished = project.workspaces.filter((w) => !w.archived && worktreeOrigin(w) === 'agent' && w.status?.changed === 0).length;
      return asking(ctx, {
        heading: `Remove ${plural(finished, 'finished sub-agent worktree')} in ${project.name}?`,
        words: [dim('Those with no uncommitted changes go. Their branches are kept, so no commits are lost.')],
        label: `Remove ${finished}`,
        run: () => ctx.call('workspaces.cleanAgentWorktrees', project.id),
      });
    }
    case 'clean-others': {
      const project = ctx.state.projects.find((p) => p.id === params.project);
      if (!project) return gone(ctx, 'That project is gone.');
      return asking(ctx, {
        heading: `Clean up ${plural(ids.length, 'worktree')} in ${project.name}?`,
        words: [dim('They have nothing of their own: no uncommitted changes, and their work is merged or their folder is gone. Branches stay, so nothing committed is lost. One that changed since stays too.')],
        label: `Remove ${ids.length}`,
        run: async () => {
          await ctx.call('workspaces.cleanUpOthers', project.id, ids);
          ctx.refresh(`stale:${project.id}`);
        },
      });
    }
    case 'remove-project': {
      const project = ctx.state.projects.find((p) => p.id === params.project);
      if (!project) return gone(ctx, 'That project is gone.');
      const worktrees = project.workspaces.filter((w) => w.kind === 'worktree' && !w.archived && worktreeOrigin(w) === 'teamod').length;
      return asking(ctx, {
        heading: `Delete “${project.name}” from teamod?`,
        words: [
          said(
            'It leaves teamod: this list, its group and Hidden Projects.',
            worktrees > 0 && ` The ${plural(worktrees, 'worktree')} made for it ${worktrees === 1 ? 'goes' : 'go'} too: archived first, so everything of yours in ${worktrees === 1 ? 'it' : 'them'} is kept, then ${worktrees === 1 ? 'its folder is' : 'their folders are'} removed. Add the project again to restore ${worktrees === 1 ? 'it' : 'them'}.`,
          ),
          dim(`Your project folder ${homePath(ctx.state, project.root)} isn’t touched: nothing in it is deleted or moved to the Trash.`),
        ],
        label: 'Delete from teamod',
        run: () => ctx.call('workspaces.removeProject', project.id),
        backTo: 'projects',
      });
    }
    case 'delete-chat': {
      const chat = params.chat ?? '';
      const channel = assistantChannel(chat);
      const last = ctx.state.assistant.chats.length <= 1;
      return asking(ctx, {
        tone: 'error',
        heading: `Delete “${assistantChatTitle(channel, ctx.state.log)}”?`,
        words: [said('Its messages go for good, and your agent forgets the conversation. Files it made stay in its folder.', last && ' A fresh chat takes its place.')],
        label: 'Delete Chat',
        run: () => ctx.call('assistant.deleteChat', chat),
      });
    }
    default:
      return gone(ctx, 'Nothing to ask about.');
  }
}
