import type { PrConversation } from '../../core/work-store.js';
import type { GitFix, GitTrouble } from '../../shared/git-trouble.js';
import type { CommitDetail, HistoryFilters, LogPage } from '../../workspaces/history.js';
import type { MergePreview } from '../../workspaces/merge-preview.js';
import type { Workspace } from '../../workspaces/types.js';
import type { Ctx } from '../screens.js';
import { type Node, code, col, dim, line, row, span, text, title } from '../tree.js';
import { peerText } from './common.js';

/** A base can be a whole commit hash: no one reads forty characters. */
const shortRef = (ref: string): string => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);

type Retry = 'pr' | 'pr_draft' | 'merge_base' | 'none';

/** It couldn't reach GitHub: what's wrong in words, and what can fix it. */
function troubleCard(ctx: Ctx, ws: Workspace, trouble: { readonly at: GitTrouble; readonly retry: Retry }, clear: () => void): Node {
  const [main, ...rest] = trouble.at.fixes;
  const [more, setMore] = ctx.local(`trouble:${ws.id}:more`, false);
  const fix = (one: GitFix, primary: boolean): Node =>
    ctx.draw.button(
      `git-fix:${one.id}`,
      one.label,
      async () => {
        clear();
        await ctx.call('workbench.gitFix', ws.id, one.id, trouble.retry);
      },
      primary ? { primary: true } : { plain: true },
    );
  return col([
    text(trouble.at.title, { color: 'warning', weight: 'semibold' }),
    dim(trouble.at.explain),
    row([main ? fix(main, true) : undefined, rest.length > 0 ? ctx.draw.button('git-fix-more', more ? 'Less' : 'More', () => setMore(!more), { plain: true, dim: true }) : undefined, ctx.draw.button('git-fix-close', 'Close', clear, { plain: true, dim: true })]),
    main?.command ? code(main.command, { language: 'sh' }) : undefined,
    ...(more ? rest.map((one) => col([fix(one, false), dim(one.detail)])) : []),
  ]);
}

function pullRequestStrip(ctx: Ctx, ws: Workspace): Node {
  const pr = ctx.state.prs[ws.id];
  const [trouble, setTrouble] = ctx.local<{ readonly at: GitTrouble; readonly retry: Retry } | undefined>(`trouble:${ws.id}`, undefined);
  /** A GitHub step: when it can't reach GitHub, the answer says what can fix that. */
  const github = (retry: Retry, step: () => Promise<unknown>) => async (): Promise<void> => {
    const answer = (await step()) as { readonly trouble?: GitTrouble } | undefined;
    if (answer?.trouble) setTrouble({ at: answer.trouble, retry });
  };
  if (trouble) return troubleCard(ctx, ws, trouble, () => setTrouble(undefined));
  if (!pr) {
    return row([
      ctx.draw.button('pr-quick', 'Create Pull Request', github('pr', () => ctx.call('workbench.quickPr', ws.id)), { hotkey: 'r' }),
      ctx.draw.button('pr-draft', 'Draft', github('pr_draft', () => ctx.call('workbench.quickPr', ws.id, { draft: true })), { plain: true, dim: true }),
      ctx.draw.button('pr-agent', 'Let the Agent Write It', () => ctx.call('workbench.createPr', ws.id), { plain: true, dim: true }),
      ctx.draw.button('merge-base', 'Push to Base', github('merge_base', () => ctx.call('workbench.mergeToBase', ws.id)), { plain: true, dim: true }),
    ]);
  }
  const open = pr.state === 'OPEN';
  const checks = pr.checks === 'failing' ? span('checks failing', { color: 'error' }) : pr.checks === 'passing' ? span('checks passing', { color: 'success' }) : pr.checks === 'pending' ? span('checks running', { dim: true }) : undefined;
  const waiting = ws.mergeWhenReady;
  return col([
    line(span(`PR #${pr.number} `, { weight: 'semibold' }), pr.title, pr.draft ? span('  draft', { dim: true }) : undefined, pr.state !== 'OPEN' ? span(`  ${pr.state.toLowerCase()}`, { dim: true }) : undefined),
    line(checks, pr.review === 'APPROVED' ? span('  approved', { color: 'success' }) : pr.review === 'CHANGES_REQUESTED' ? span('  changes requested', { color: 'warning' }) : undefined, pr.conflicts ? span('  conflicts', { color: 'error' }) : undefined, pr.mergeState === 'behind' ? span('  behind its base', { dim: true }) : undefined),
    waiting && dim(`Merges by ${waiting.method} once its checks pass.`),
    row([
      open && !waiting ? ctx.draw.button('pr-merge', 'Merge', () => ctx.go({ name: 'merge-pr', params: { id: ws.id } }), { primary: true, hotkey: 'e' }) : undefined,
      waiting ? ctx.draw.button('pr-cancel-wait', 'Don’t Merge', () => ctx.call('workbench.cancelMergeWhenReady', ws.id), {}) : undefined,
      ctx.draw.button('pr-open', 'Open on GitHub', () => ctx.call('workbench.openPr', ws.id), { plain: true, dim: true }),
      ctx.draw.button('pr-talk', 'Conversation', () => ctx.go({ name: 'pr', params: { id: ws.id } }), { plain: true, dim: true }),
      open && pr.checks === 'failing' ? ctx.draw.button('pr-fix', 'Fix Checks', () => ctx.call('workbench.fixChecks', ws.id), { plain: true }) : undefined,
      open && pr.conflicts ? ctx.draw.button('pr-conflicts', 'Resolve Conflicts', () => ctx.call('workbench.resolvePrConflicts', ws.id), { plain: true }) : undefined,
      open && pr.mergeState === 'behind' ? ctx.draw.button('pr-update', 'Update Branch', github('none', () => ctx.call('workbench.prStep', ws.id, 'update_branch')), { plain: true }) : undefined,
      open && pr.draft ? ctx.draw.button('pr-ready', 'Ready for Review', () => ctx.call('workbench.prStep', ws.id, 'ready'), { plain: true }) : undefined,
      pr.state === 'MERGED' ? ctx.draw.button('pr-continue', 'Continue After Merge', () => ctx.call('workbench.continueAfterMerge', ws.id), { plain: true }) : undefined,
      ctx.draw.button('pr-refresh', 'Refresh', () => ctx.call('workbench.refreshPrs', ws.id), { plain: true, dim: true }),
    ]),
  ]);
}

/** How the PR merges: the one question, then it goes. */
export function mergePrPage(ctx: Ctx, ws: Workspace): Node {
  const [method, setMethod] = ctx.local<'squash' | 'merge' | 'rebase'>(`merge:${ws.id}:method`, 'squash');
  const [remove, setRemove] = ctx.local(`merge:${ws.id}:delete`, true);
  const merge = async (auto: boolean): Promise<void> => {
    await ctx.call('workbench.mergePr', ws.id, { method, deleteBranch: remove, ...(auto ? { auto: true } : {}) });
    ctx.nav.back(ctx.pane);
  };
  return col(
    [
      title('Merge this pull request'),
      ctx.draw.select('merge-how', [{ value: 'squash', label: 'Squash' }, { value: 'merge', label: 'Merge commit' }, { value: 'rebase', label: 'Rebase' }], (value) => setMethod((value ?? 'squash') as 'squash' | 'merge' | 'rebase'), { label: 'How', value: method }),
      ctx.draw.button('merge-delete', remove ? '[x] Delete the branch' : '[ ] Delete the branch', () => setRemove(!remove), { plain: true }),
      row([ctx.draw.button('merge-now', 'Merge', () => merge(false), { primary: true, hotkey: 'e' }), ctx.draw.button('merge-ready', 'Merge When Ready', () => merge(true), {})]),
    ],
    { gap: 1 },
  );
}

/** Comments and review threads on the PR, and replying. */
export function prPage(ctx: Ctx, ws: Workspace): Node {
  const loaded = ctx.load(`pr:${ws.id}`, async () => (await ctx.call('workbench.prConversation', ws.id)) as PrConversation, { ttlMs: 30_000 });
  const talk = loaded.value;
  const refresh = (): void => ctx.refresh(`pr:${ws.id}`);
  return col(
    [
      title('Pull request conversation'),
      loaded.error ? text(loaded.error, { color: 'error' }) : undefined,
      !talk && dim('Loading...'),
      ctx.draw.button('pr-address', 'Have the Agent Address Comments', () => ctx.call('workbench.addressPrComments', ws.id), { hotkey: 'a' }),
      talk?.more ? dim('GitHub has more than this: open it there for the rest.') : undefined,
      ...(talk?.reviews ?? []).slice(-50).map((c) => col([line(span(c.author, { weight: 'semibold' }), span(`  ${c.state.toLowerCase().replace('_', ' ')}`, { dim: true })), c.body ? { k: 'md' as const, text: peerText(c.body) } : undefined])),
      ...(talk?.comments ?? []).slice(-50).map((c) => col([line(span(c.author, { weight: 'semibold' })), { k: 'md' as const, text: peerText(c.body) }])),
      ...(talk?.threads ?? []).slice(-50).map((thread) =>
        col([
          line(span(`${thread.path}${thread.line ? `:${thread.line}` : ''}`, { dim: true }), thread.resolved ? span('  resolved', { dim: true }) : undefined, thread.outdated ? span('  outdated', { dim: true }) : undefined),
          thread.diffHunk ? code(thread.diffHunk, { diff: true, path: thread.path }) : undefined,
          ...thread.comments.map((c) => col([line(span(c.author, { weight: 'semibold' })), { k: 'md' as const, text: peerText(c.body) }])),
          row([
            ctx.draw.button(`pr-code:${thread.id}`, 'Open the Code', () => ctx.call('workbench.openCode', ws.id, thread.path, thread.line), { plain: true, dim: true }),
            ctx.draw.button(`pr-address:${thread.id}`, 'Have the Agent Address It', () => ctx.call('workbench.addressPrComments', ws.id, thread.id), { plain: true, dim: true }),
            ctx.draw.button(
              `pr-resolve:${thread.id}`,
              thread.resolved ? 'Unresolve' : 'Resolve',
              async () => {
                await ctx.call('workbench.prPost', ws.id, { kind: thread.resolved ? 'unresolve' : 'resolve', thread: thread.id });
                refresh();
              },
              { plain: true, dim: true },
            ),
          ]),
          ctx.draw.input(
            `pr-reply:${thread.id}`,
            async (value) => {
              if (value?.trim()) await ctx.call('workbench.prPost', ws.id, { kind: 'reply', thread: thread.id, body: value.trim() });
              refresh();
            },
            { placeholder: 'Reply', submitLabel: 'reply' },
          ),
        ]),
      ),
      ctx.draw.input(
        'pr-comment',
        async (value) => {
          if (value?.trim()) await ctx.call('workbench.prPost', ws.id, { kind: 'comment', body: value.trim() });
          refresh();
        },
        { placeholder: 'Comment on the pull request', submitLabel: 'comment' },
      ),
    ],
    { gap: 1 },
  );
}

/** What's different here: the files, one's diff, then what to do about it. */
export function changesPage(ctx: Ctx, ws: Workspace): Node {
  ctx.load(`review:${ws.id}`, () => ctx.call('workspaces.review', ws.id), { ttlMs: 15_000 });
  const review = ctx.state.review?.workspaceId === ws.id ? ctx.state.review : undefined;
  const files = review?.data?.files ?? [];
  const [committing, setCommitting] = ctx.local(`changes:${ws.id}:committing`, false);
  const reload = (): void => ctx.refresh(`review:${ws.id}`);
  const selected = review?.selected ?? 0;
  const conflicts = ctx.state.conflicts[ws.id];
  return col(
    [
      pullRequestStrip(ctx, ws),
      conflicts?.length ? col([text(`Merge conflicts in ${conflicts.length} file${conflicts.length === 1 ? '' : 's'}`, { color: 'error' }), ...conflicts.slice(0, 20).map((f) => dim(f))]) : undefined,
      row([
        files.length > 0 ? ctx.draw.button('commit', 'Commit', () => setCommitting(true), { hotkey: 'i' }) : undefined,
        ctx.draw.button('merge-check', 'Merge', () => ctx.go({ name: 'merge', params: { id: ws.id } }), { plain: true, hotkey: 'e', dim: true }),
        ctx.draw.button('review-agent', 'Have the Agent Review', () => ctx.call('workspaces.askClaudeToReview', ws.id), { plain: true, dim: true }),
        ctx.draw.button('history', 'History', () => ctx.go({ name: 'history', params: { id: ws.id } }), { plain: true, hotkey: 'y', dim: true }),
        ctx.draw.button('review-reload', 'Refresh', reload, { plain: true, dim: true }),
      ]),
      committing &&
        ctx.draw.input(
          'commit-message',
          async (value) => {
            setCommitting(false);
            await ctx.call('workspaces.commit', ws.id, value?.trim() || undefined);
            reload();
          },
          { label: 'Message', placeholder: 'Empty: your agent writes it', submitLabel: 'commit', autoFocus: true },
        ),
      review?.error ? text(review.error, { color: 'error' }) : undefined,
      review?.loading ? dim('Loading...') : undefined,
      review?.data && files.length === 0 ? dim(`Nothing differs from ${shortRef(review.data.base)}.`) : undefined,
      files.length > 0 &&
        col([
          dim(`${files.length} file${files.length === 1 ? '' : 's'} changed from ${shortRef(review?.data?.base ?? 'its base')}`),
          ...files.slice(0, 100).map((file, i) =>
            ctx.draw.button(`change:${file.path}`, file.path, () => ctx.call('workspaces.selectFile', i), {
              plain: true,
              ...(i === selected ? {} : { dim: true }),
              spans: [span(`${file.path}  `, i === selected ? { weight: 'semibold' } : {}), span(`+${file.added}`, { color: 'success' }), span(` -${file.removed}`, { color: 'error' }), file.state !== 'modified' ? span(`  ${file.state}`, { dim: true }) : span('')],
            }),
          ),
        ]),
      review?.diff ? code(review.diff, { diff: true, ...(files[selected] ? { path: files[selected].path } : {}) }) : undefined,
    ],
    { gap: 1 },
  );
}

/** Before a merge: where it goes and what would stop it. */
export function mergePage(ctx: Ctx, ws: Workspace): Node {
  const loaded = ctx.load(`preview:${ws.id}`, async () => (await ctx.call('git.mergePreview', ws.id)) as MergePreview, { ttlMs: 15_000 });
  const preview = loaded.value;
  const stops = preview
    ? [
        ...(preview.conflicts?.length ? [`Conflicts in ${preview.conflicts.length} file${preview.conflicts.length === 1 ? '' : 's'}: ${preview.conflicts.slice(0, 5).join(', ')}`] : []),
        ...(preview.folderChanges.length ? [`The main folder has ${preview.folderChanges.length} uncommitted change${preview.folderChanges.length === 1 ? '' : 's'}.`] : []),
        ...(preview.folderOn && preview.folderOn !== preview.into ? [`The main folder is on ${preview.folderOn}, not ${preview.into}.`] : []),
        ...(preview.uncommitted ? [`${preview.uncommitted} uncommitted file${preview.uncommitted === 1 ? '' : 's'} here wouldn’t come along.`] : []),
      ]
    : [];
  return col(
    [
      title(`Merge ${ws.name}`),
      loaded.error ? text(loaded.error, { color: 'error' }) : undefined,
      !preview && dim('Looking...'),
      preview && dim(`${preview.from} into ${preview.into}: ${preview.commitCount} commit${preview.commitCount === 1 ? '' : 's'}, ${preview.files} file${preview.files === 1 ? '' : 's'}, +${preview.insertions} -${preview.deletions}.`),
      ...stops.map((stop) => text(stop, { color: 'warning' })),
      row([
        ctx.draw.button('merge-go', 'Merge', async () => {
          await ctx.call('workspaces.merge', ws.id);
          ctx.nav.back(ctx.pane);
        }, { primary: true, hotkey: 'e' }),
        ctx.draw.button('merge-ask', 'Have the Agent Merge', () => ctx.call('workspaces.askClaudeToMerge', ws.id), {}),
      ]),
    ],
    { gap: 1 },
  );
}

/** A page of commits; each opens, and a worktree can start from one. */
export function historyPage(ctx: Ctx, ws: Workspace): Node {
  const [author, setAuthor] = ctx.local(`history:${ws.id}:author`, '');
  const filters = ctx.load(`history:${ws.id}:filters`, async () => (await ctx.call('git.filters', ws.id)) as HistoryFilters);
  const loaded = ctx.load(`history:${ws.id}:log:${author}`, async () => (await ctx.call('git.log', ws.id, { limit: 100, ...(author ? { author } : {}) })) as LogPage, { ttlMs: 30_000 });
  const authors = filters.value?.authors ?? [];
  return col(
    [
      title('History'),
      loaded.error ? text(loaded.error, { color: 'error' }) : undefined,
      !loaded.value && dim('Loading...'),
      authors.length > 0
        ? ctx.draw.select('history-author', [{ value: '', label: 'Everyone' }, ...authors.slice(0, 30).map((a) => ({ value: a.email, label: a.name }))], (value) => setAuthor(value ?? ''), { label: 'By', value: author })
        : undefined,
      ...(loaded.value?.commits ?? []).map((c) =>
        ctx.draw.button(`commit:${c.hash}`, c.subject, () => ctx.go({ name: 'commit', params: { id: ws.id, hash: c.hash } }), { plain: true, spans: [span(`${c.short} `, { dim: true }), span(c.subject)] }),
      ),
    ],
    { gap: 0 },
  );
}

export function commitPage(ctx: Ctx, ws: Workspace, hash: string): Node {
  const loaded = ctx.load(`commit:${ws.id}:${hash}`, async () => (await ctx.call('git.commit', ws.id, hash)) as CommitDetail);
  const detail = loaded.value;
  const [starting, setStarting] = ctx.local(`commit:${hash}:starting`, false);
  return col(
    [
      title(detail?.commit.subject ?? hash.slice(0, 7)),
      detail && dim(`${detail.commit.author.name} · ${new Date(detail.commit.date).toLocaleString()}`),
      loaded.error ? text(loaded.error, { color: 'error' }) : undefined,
      detail?.commit.body ? { k: 'md' as const, text: peerText(detail.commit.body) } : undefined,
      starting
        ? ctx.draw.input(
            'commit-worktree-name',
            async (value) => {
              setStarting(false);
              await ctx.call('git.worktreeAt', ws.projectId, hash, value?.trim() || undefined);
            },
            { label: 'Name', placeholder: 'A name for the worktree', submitLabel: 'start', autoFocus: true },
          )
        : ctx.draw.button('commit-worktree', 'Start a Worktree Here', () => setStarting(true), { plain: true }),
      ...(detail?.files ?? []).slice(0, 50).flatMap((file) => [line(span(file.path, { weight: 'semibold' }), span(`  +${file.added} -${file.removed}`, { dim: true })), file.diff ? code(file.diff, { diff: true, path: file.path }) : dim('No diff to show.')]),
    ],
    { gap: 1 },
  );
}
