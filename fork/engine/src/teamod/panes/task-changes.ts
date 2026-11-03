import type { PrConversation } from '../../core/work-store.js';
import type { GitFix, GitTrouble } from '../../shared/git-trouble.js';
import type { CommitDetail, HistoryFilters, LogPage } from '../../workspaces/history.js';
import type { MergePreview } from '../../workspaces/merge-preview.js';
import type { Workspace } from '../../workspaces/types.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, code, col, dim, line, row, span, text } from '../tree.js';
import { actions, card, meta, peerText, pill, section } from './common.js';

/** A base can be a whole commit hash: no one reads forty characters. */
const shortRef = (ref: string): string => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const kept = <T>(list: ReadonlyArray<T | false | undefined | null | ''>): T[] => list.filter((x): x is T => Boolean(x));

/** Lines added and taken away, green and red. */
const plusMinus = (added: number, removed: number): Span[] => [span(`+${added}`, { color: 'success' }), span(` -${removed}`, { color: 'error' })];
const DOT = span(' · ', { dim: true });

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
  return card(
    [
      dim(trouble.at.explain),
      main?.command ? code(main.command, { language: 'sh' }) : undefined,
      actions(main ? fix(main, true) : undefined, rest.length > 0 ? ctx.draw.button('git-fix-more', more ? 'Less' : 'More', () => setMore(!more), { plain: true, dim: true }) : undefined, ctx.draw.button('git-fix-close', 'Close', clear, { plain: true, dim: true })),
      ...(more ? rest.map((one) => col([fix(one, false), dim(one.detail)], { top: 1 })) : []),
    ],
    { title: trouble.at.title, tone: 'warn' },
  );
}

/** The pull request as a card: its state in pills, Merge as the main action. */
function pullRequestCard(ctx: Ctx, ws: Workspace, mainTaken: boolean): Node {
  const pr = ctx.state.prs[ws.id];
  const [trouble, setTrouble] = ctx.local<{ readonly at: GitTrouble; readonly retry: Retry } | undefined>(`trouble:${ws.id}`, undefined);
  /** A GitHub step: when it can't reach GitHub, the answer says what can fix that. */
  const github = (retry: Retry, step: () => Promise<unknown>) => async (): Promise<void> => {
    const answer = (await step()) as { readonly trouble?: GitTrouble } | undefined;
    if (answer?.trouble) setTrouble({ at: answer.trouble, retry });
  };
  if (trouble) return troubleCard(ctx, ws, trouble, () => setTrouble(undefined));
  if (!pr) {
    return card(
      [
        dim('None yet. Open one on GitHub, or push straight to the base.'),
        actions(
          ctx.draw.button('pr-quick', 'Create Pull Request', github('pr', () => ctx.call('workbench.quickPr', ws.id)), { hotkey: 'r' }),
          ctx.draw.button('pr-draft', 'Draft', github('pr_draft', () => ctx.call('workbench.quickPr', ws.id, { draft: true })), { plain: true, dim: true }),
          ctx.draw.button('pr-agent', 'Let the Agent Write It', () => ctx.call('workbench.createPr', ws.id), { plain: true, dim: true }),
          ctx.draw.button('merge-base', 'Push to Base', github('merge_base', () => ctx.call('workbench.mergeToBase', ws.id)), { plain: true, dim: true }),
        ),
      ],
      { title: 'Pull request' },
    );
  }
  const open = pr.state === 'OPEN';
  const checks = pr.checks === 'failing' ? pill('checks failing', 'error', '✗') : pr.checks === 'passing' ? pill('checks passing', 'ok', '✓') : pr.checks === 'pending' ? pill('checks running', 'quiet', '…') : undefined;
  const waiting = ws.mergeWhenReady;
  const tone = open && (pr.conflicts || pr.checks === 'failing') ? 'error' : pr.state === 'MERGED' ? 'ok' : undefined;
  const states = kept<Span>([
    pr.state !== 'OPEN' && pill(pr.state.toLowerCase(), pr.state === 'MERGED' ? 'ok' : 'quiet'),
    pr.draft && span('draft', { dim: true }),
    checks,
    pr.review === 'APPROVED' ? pill('approved', 'ok', '✓') : pr.review === 'CHANGES_REQUESTED' ? pill('changes requested', 'warn') : undefined,
    pr.conflicts && pill('conflicts', 'error', '!'),
    pr.mergeState === 'behind' && span('behind its base', { dim: true }),
  ]);
  return card(
    [
      states.length > 0 && meta(...states),
      waiting && dim(`Merges by ${waiting.method} once its checks pass.`),
      actions(
        open && !waiting ? ctx.draw.button('pr-merge', 'Merge', () => ctx.go({ name: 'merge-pr', params: { id: ws.id } }), { ...(mainTaken ? {} : { primary: true }), hotkey: 'e' }) : undefined,
        waiting ? ctx.draw.button('pr-cancel-wait', 'Don’t Merge', () => ctx.call('workbench.cancelMergeWhenReady', ws.id), {}) : undefined,
        open && pr.checks === 'failing' ? ctx.draw.button('pr-fix', 'Fix Checks', () => ctx.call('workbench.fixChecks', ws.id), { plain: true }) : undefined,
        open && pr.conflicts ? ctx.draw.button('pr-conflicts', 'Resolve Conflicts', () => ctx.call('workbench.resolvePrConflicts', ws.id), { plain: true }) : undefined,
        open && pr.mergeState === 'behind' ? ctx.draw.button('pr-update', 'Update Branch', github('none', () => ctx.call('workbench.prStep', ws.id, 'update_branch')), { plain: true }) : undefined,
        open && pr.draft ? ctx.draw.button('pr-ready', 'Ready for Review', () => ctx.call('workbench.prStep', ws.id, 'ready'), { plain: true }) : undefined,
        pr.state === 'MERGED' ? ctx.draw.button('pr-continue', 'Continue After Merge', () => ctx.call('workbench.continueAfterMerge', ws.id), { plain: true }) : undefined,
        ctx.draw.button('pr-talk', 'Conversation', () => ctx.go({ name: 'pr', params: { id: ws.id } }), { plain: true, dim: true }),
        ctx.draw.button('pr-open', 'Open on GitHub', () => ctx.call('workbench.openPr', ws.id), { plain: true, dim: true }),
        ctx.draw.button('pr-refresh', 'Refresh', () => ctx.call('workbench.refreshPrs', ws.id), { plain: true, dim: true }),
      ),
    ],
    { title: [span(`PR #${pr.number}`, { weight: 'bold' }), span(`  ${pr.title}`, { weight: 'bold' })], ...(tone ? { tone } : {}) },
  );
}

/** How the PR merges: the one question, then it goes. */
export function mergePrPage(ctx: Ctx, ws: Workspace): Node {
  const [method, setMethod] = ctx.local<'squash' | 'merge' | 'rebase'>(`merge:${ws.id}:method`, 'squash');
  const [remove, setRemove] = ctx.local(`merge:${ws.id}:delete`, true);
  const merge = async (auto: boolean): Promise<void> => {
    await ctx.call('workbench.mergePr', ws.id, { method, deleteBranch: remove, ...(auto ? { auto: true } : {}) });
    ctx.nav.back(ctx.pane);
  };
  return card(
    [
      ctx.draw.select('merge-how', [{ value: 'squash', label: 'Squash' }, { value: 'merge', label: 'Merge commit' }, { value: 'rebase', label: 'Rebase' }], (value) => setMethod((value ?? 'squash') as 'squash' | 'merge' | 'rebase'), { label: 'How', value: method }),
      ctx.draw.button('merge-delete', remove ? '[x] Delete the branch' : '[ ] Delete the branch', () => setRemove(!remove), {
        plain: true,
        spans: [span(remove ? '[x] ' : '[ ] ', remove ? { color: 'claude' } : { dim: true }), span('Delete the branch')],
      }),
      actions(ctx.draw.button('merge-now', 'Merge', () => merge(false), { primary: true, hotkey: 'e' }), ctx.draw.button('merge-ready', 'Merge When Ready', () => merge(true), {})),
    ],
    { title: 'Merge this pull request' },
  );
}

/** Who wrote it, and the words, as a conversation reads. */
const said = (author: string, body: string | undefined, ...rest: ReadonlyArray<Span | false | undefined>): Node =>
  col([line(span(author, { weight: 'semibold' }), ...rest), body ? { k: 'md' as const, text: peerText(body) } : undefined]);

/** Comments and review threads on the PR, and replying. */
export function prPage(ctx: Ctx, ws: Workspace): Node {
  const loaded = ctx.load(`pr:${ws.id}`, async () => (await ctx.call('workbench.prConversation', ws.id)) as PrConversation, { ttlMs: 30_000 });
  const talk = loaded.value;
  const refresh = (): void => ctx.refresh(`pr:${ws.id}`);
  const reviews = (talk?.reviews ?? []).slice(-50);
  const comments = (talk?.comments ?? []).slice(-50);
  const threads = (talk?.threads ?? []).slice(-50);
  return col(
    [
      card(
        [
          loaded.error ? text(loaded.error, { color: 'error' }) : undefined,
          !talk && dim('Loading...'),
          talk?.more ? dim('GitHub has more than this: open it there for the rest.') : undefined,
          actions(ctx.draw.button('pr-address', 'Have the Agent Address Comments', () => ctx.call('workbench.addressPrComments', ws.id), { hotkey: 'a' })),
        ],
        { title: 'Pull request conversation' },
      ),
      reviews.length + comments.length > 0 &&
        section(
          'Comments',
          [
            ...reviews.map((c) => said(c.author, c.body, span(' · ', { dim: true }), span(c.state.toLowerCase().replace('_', ' '), { dim: true }))),
            ...comments.map((c) => said(c.author, c.body)),
          ].map((n, i) => (i ? col([n], { top: 1 }) : n)),
          reviews.length + comments.length,
        ),
      threads.length > 0 &&
        section(
          'Threads',
          threads.map((thread) =>
            card(
              [
                (thread.resolved || thread.outdated) && meta(thread.resolved && pill('resolved', 'ok', '✓'), thread.outdated && span('outdated', { dim: true })),
                thread.diffHunk ? code(thread.diffHunk, { diff: true, path: thread.path }) : undefined,
                ...thread.comments.map((c) => said(c.author, c.body)),
                actions(
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
                ),
                ctx.draw.input(
                  `pr-reply:${thread.id}`,
                  async (value) => {
                    if (value?.trim()) await ctx.call('workbench.prPost', ws.id, { kind: 'reply', thread: thread.id, body: value.trim() });
                    refresh();
                  },
                  { placeholder: 'Reply', submitLabel: 'reply' },
                ),
              ],
              { title: [span(`${thread.path}${thread.line ? `:${thread.line}` : ''}`, { weight: 'bold' })] },
            ),
          ),
          threads.length,
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

/** What's different here: a summary card with what to do about it, the files, then one's diff. */
export function changesPage(ctx: Ctx, ws: Workspace): Node {
  ctx.load(`review:${ws.id}`, () => ctx.call('workspaces.review', ws.id), { ttlMs: 15_000 });
  const review = ctx.state.review?.workspaceId === ws.id ? ctx.state.review : undefined;
  const files = review?.data?.files ?? [];
  const [committing, setCommitting] = ctx.local(`changes:${ws.id}:committing`, false);
  const reload = (): void => ctx.refresh(`review:${ws.id}`);
  const selected = review?.selected ?? 0;
  const conflicts = ctx.state.conflicts[ws.id];
  const pr = ctx.state.prs[ws.id];
  // One main action: what fixes GitHub when it failed, else Merge on an open pull request, else Commit.
  const [trouble] = ctx.local<unknown>(`trouble:${ws.id}`, undefined);
  const prMerges = pr?.state === 'OPEN' && !ws.mergeWhenReady;
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const base = shortRef(review?.data?.base ?? 'its base');
  return col(
    [
      conflicts?.length
        ? card(conflicts.slice(0, 20).map((f) => dim(f)), { title: `Merge conflicts in ${plural(conflicts.length, 'file')}`, tone: 'error' })
        : undefined,
      card(
        [
          review?.error ? text(review.error, { color: 'error' }) : undefined,
          review?.loading ? dim('Loading...') : undefined,
          review?.data && files.length === 0 ? dim(`Nothing differs from ${shortRef(review.data.base)}.`) : undefined,
          files.length > 0 && line(span('from ', { dim: true }), span(base, { dim: true }), DOT, ...plusMinus(added, removed)),
          files.length > 0 &&
            col(
              files.slice(0, 100).map((file, i) =>
                ctx.draw.button(`change:${file.path}`, file.path, () => ctx.call('workspaces.selectFile', i), {
                  plain: true,
                  ...(i === selected ? {} : { dim: true }),
                  spans: kept<Span>([
                    span(i === selected ? '▸ ' : '  ', { color: 'claude' }),
                    span(`${file.path}  `, i === selected ? { weight: 'semibold' } : {}),
                    ...plusMinus(file.added, file.removed),
                    file.state !== 'modified' && span(`  ${file.state}`, { dim: true }),
                  ]),
                }),
              ),
              { top: 1 },
            ),
          actions(
            files.length > 0 ? ctx.draw.button('commit', 'Commit', () => setCommitting(true), { hotkey: 'i', ...(prMerges || trouble ? {} : { primary: true }) }) : undefined,
            ctx.draw.button('merge-check', 'Merge', () => ctx.go({ name: 'merge', params: { id: ws.id } }), { plain: true, hotkey: 'e', dim: true }),
            ctx.draw.button('history', 'History', () => ctx.go({ name: 'history', params: { id: ws.id } }), { plain: true, hotkey: 'y', dim: true }),
            ctx.draw.button('review-agent', 'Have the Agent Review', () => ctx.call('workspaces.askClaudeToReview', ws.id), { plain: true, dim: true }),
            ctx.draw.button('review-reload', 'Refresh', reload, { plain: true, dim: true }),
          ),
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
        ],
        { title: files.length > 0 ? `${plural(files.length, 'file')} changed` : 'Changes' },
      ),
      pullRequestCard(ctx, ws, !prMerges),
      review?.diff ? section(files[selected]?.path ?? 'Diff', [code(review.diff, { diff: true, ...(files[selected] ? { path: files[selected].path } : {}) })]) : undefined,
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
        ...(preview.conflicts?.length ? [`Conflicts in ${plural(preview.conflicts.length, 'file')}: ${preview.conflicts.slice(0, 5).join(', ')}`] : []),
        ...(preview.folderChanges.length ? [`The main folder has ${plural(preview.folderChanges.length, 'uncommitted change')}.`] : []),
        ...(preview.folderOn && preview.folderOn !== preview.into ? [`The main folder is on ${preview.folderOn}, not ${preview.into}.`] : []),
        ...(preview.uncommitted ? [`${plural(preview.uncommitted, 'uncommitted file')} here wouldn’t come along.`] : []),
      ]
    : [];
  return card(
    [
      loaded.error ? text(loaded.error, { color: 'error' }) : undefined,
      !preview && dim('Looking...'),
      preview && line(span(preview.from, { dim: true }), span(' → ', { dim: true }), span(preview.into, { weight: 'semibold' })),
      preview && line(span(plural(preview.commitCount, 'commit'), { dim: true }), DOT, span(plural(preview.files, 'file'), { dim: true }), DOT, ...plusMinus(preview.insertions, preview.deletions)),
      ...stops.map((stop) => text(stop, { color: 'warning' })),
      actions(
        ctx.draw.button('merge-go', 'Merge', async () => {
          await ctx.call('workspaces.merge', ws.id);
          ctx.nav.back(ctx.pane);
        }, { primary: true, hotkey: 'e' }),
        ctx.draw.button('merge-ask', 'Have the Agent Merge', () => ctx.call('workspaces.askClaudeToMerge', ws.id), {}),
      ),
    ],
    { title: [span('Merge', { weight: 'bold' }), span(` ${ws.name}`, { weight: 'bold' })], ...(stops.length ? { tone: 'warn' as const } : {}) },
  );
}

/** A page of commits; each opens, and a worktree can start from one. */
export function historyPage(ctx: Ctx, ws: Workspace): Node {
  const [author, setAuthor] = ctx.local(`history:${ws.id}:author`, '');
  const filters = ctx.load(`history:${ws.id}:filters`, async () => (await ctx.call('git.filters', ws.id)) as HistoryFilters);
  const loaded = ctx.load(`history:${ws.id}:log:${author}`, async () => (await ctx.call('git.log', ws.id, { limit: 100, ...(author ? { author } : {}) })) as LogPage, { ttlMs: 30_000 });
  const authors = filters.value?.authors ?? [];
  const commits = loaded.value?.commits ?? [];
  return col(
    [
      authors.length > 0
        ? ctx.draw.select('history-author', [{ value: '', label: 'Everyone' }, ...authors.slice(0, 30).map((a) => ({ value: a.email, label: a.name }))], (value) => setAuthor(value ?? ''), { label: 'By', value: author })
        : undefined,
      section(
        'History',
        [
          loaded.error ? text(loaded.error, { color: 'error' }) : undefined,
          !loaded.value && dim('Loading...'),
          ...commits.map((c) =>
            ctx.draw.button(`commit:${c.hash}`, c.subject, () => ctx.go({ name: 'commit', params: { id: ws.id, hash: c.hash } }), { plain: true, spans: [span(`${c.short}  `, { dim: true }), span(c.subject)] }),
          ),
        ],
        loaded.value ? commits.length : undefined,
      ),
    ],
    { gap: 0 },
  );
}

export function commitPage(ctx: Ctx, ws: Workspace, hash: string): Node {
  const loaded = ctx.load(`commit:${ws.id}:${hash}`, async () => (await ctx.call('git.commit', ws.id, hash)) as CommitDetail);
  const detail = loaded.value;
  const [starting, setStarting] = ctx.local(`commit:${hash}:starting`, false);
  const files = (detail?.files ?? []).slice(0, 50);
  return col(
    [
      card(
        [
          detail && meta(span(hash.slice(0, 7), { dim: true }), detail.commit.author.name, new Date(detail.commit.date).toLocaleString()),
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
            : actions(ctx.draw.button('commit-worktree', 'Start a Worktree Here', () => setStarting(true), { plain: true })),
        ],
        { title: detail?.commit.subject ?? hash.slice(0, 7) },
      ),
      files.length > 0 &&
        section(
          'Files',
          files.flatMap((file) => [line(span(file.path, { weight: 'semibold' }), span('  '), ...plusMinus(file.added, file.removed)), file.diff ? code(file.diff, { diff: true, path: file.path }) : dim('No diff to show.')]),
          detail?.files.length,
        ),
    ],
    { gap: 1 },
  );
}
