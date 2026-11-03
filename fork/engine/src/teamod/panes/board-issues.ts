import { type Issue, STATUS_INFO } from '../../core/board/model.js';
import { type GhComment, type GhIssue, type GhIssueFull, type GhIssueState, type GhPull, type IssueStage, type IssuesList, type PullsList, issueStage, repoSlug, stageWords, taskForIssue } from '../../core/issues/model.js';
import type { LogItem } from '../../core/store.js';
import { teammateOn } from '../../core/team/model.js';
import { activityOf } from '../../ui/workspace-models.js';
import type { GitHubRepo } from '../../workspaces/github.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, row, span, text, title } from '../tree.js';
import { type Asked, MAIN_KEY, MORE_KEY, asking, choices, fromGitHub, notReadable, projectHere, projectSwitch, prop, readingWords, subPage, toggle, top, webLink, windowed, written } from './board-common.js';
import { ago, card, empty, findWorkspace, meta, openWorkspace, page, section } from './common.js';

/** What's read lately stays a little (the engine keeps it a minute too). */
const ISSUES_TTL_MS = 30_000;

const isLive = (ctx: Ctx, id: string): boolean => {
  const ws = findWorkspace(ctx.state, id);
  return Boolean(ws && !ws.archived);
};

/** How far things got with an issue: nothing yet, on the board, investigating, fixing, in review, done. */
function stageOf(ctx: Ctx, projectId: string, repo: Pick<GitHubRepo, 'owner' | 'repo'>, number: number): IssueStage {
  return issueStage(taskForIssue(ctx.state.board, projectId, repo, number), (id) => isLive(ctx, id), (id) => activityOf(ctx.state.log, `ws:${id}`).running);
}

const stateWords = (issue: Pick<GhIssue, 'state' | 'reason'>): { readonly label: string; readonly color?: string } => {
  if (issue.state === 'open') return { label: 'Open', color: 'success' };
  if (issue.reason === 'not_planned') return { label: 'Not planned' };
  if (issue.reason === 'duplicate') return { label: 'Duplicate' };
  return { label: 'Closed' };
};

const issueRow = (ctx: Ctx, projectId: string, repo: GitHubRepo, issue: GhIssue): Node => {
  const stage = stageWords(stageOf(ctx, projectId, repo, issue.number));
  const closed = issue.state === 'closed';
  const task = taskForIssue(ctx.state.board, projectId, repo, issue.number);
  const mate = task ? teammateOn(ctx.state.team, task, ctx.state.selfId) : undefined;
  return ctx.draw.button(`issue:${issue.number}`, `#${issue.number} ${issue.title}`, () => ctx.go({ name: 'issue', params: { project: projectId, number: String(issue.number) } }), {
    plain: true,
    spans: [
      span(`#${issue.number}  `, { dim: true }),
      span(issue.title, closed ? { dim: true } : {}),
      ...issue.labels.slice(0, 4).map((l) => span(`  ${l.name}`, { dim: true })),
      ...(mate ? [span(`  ${mate.words}`, { color: 'warning' })] : []),
      ...(stage ? [span(`  ● ${stage.label}`, stage.tone === 'claude' ? { color: 'claude' } : stage.tone === 'ok' ? { color: 'success' } : { dim: true })] : []),
      ...(issue.comments ? [span(`  ${issue.comments} comment${issue.comments === 1 ? '' : 's'}`, { dim: true })] : []),
      span(`  ${ago(issue.updatedAt)}`, { dim: true }),
    ],
  });
};

/**
 * Issues: one project's GitHub issues at a time, open or closed, newest activity first; the search
 * asks GitHub. Each says how far things got with it. An issue opens into its page.
 */
export function issuesPage(ctx: Ctx): Node {
  const { projects, here } = projectHere(ctx);
  if (!here) return page(top(ctx, 'issues'), empty('No projects yet. Issues come from a project’s GitHub repository: add a project in Work.'));
  const [state, setState] = ctx.local<GhIssueState>('board:issues:state', 'open');
  const [search, setSearch] = ctx.local(`board:issues:${here.id}:search`, '');
  const [finding, setFinding] = ctx.local('board:issues:finding', false);
  const key = `issues:${here.id}:${state}:${search}`;
  const loaded = fromGitHub(ctx, key, ISSUES_TTL_MS, (force) => ctx.call('issues.list', here.id, { state, ...(search ? { search } : {}), ...(force ? { force: true } : {}) }) as Promise<IssuesList>);
  const list = loaded.value;
  const issues = list?.kind === 'github' ? list.issues : [];
  const rows = windowed(ctx, key, issues);
  return page(
    top(ctx, 'issues'),
    projectSwitch(ctx, projects, here),
    row([
      choices(ctx, 'issues:state', [{ value: 'open' as const, label: 'Open Issues', hotkey: '1' }, { value: 'closed' as const, label: 'Closed Issues', hotkey: '2' }], state, (s) => setState(s)),
      ctx.draw.button('issues:find', search ? `Search: ${search}` : 'Search', () => setFinding(!finding), { plain: true, hotkey: 'f', dim: true }),
      list && list.kind !== 'none' && ctx.draw.button('issues:pulls', 'Pull Requests', () => ctx.go({ name: 'pulls', params: { project: here.id } }), { plain: true, hotkey: 'u', dim: true }),
      list && list.kind !== 'none' && ctx.draw.button('issues:refresh', loaded.loading ? 'Asking GitHub...' : 'Ask GitHub Again', loaded.refresh, { plain: true, hotkey: 'e', dim: true }),
    ], { gap: 2 }),
    finding &&
      ctx.draw.input(
        'issues:search',
        (value) => {
          setSearch(value?.replace(/\s+/g, ' ').trim().slice(0, 200) ?? '');
          setFinding(false);
        },
        { label: 'Search', value: search, placeholder: 'GitHub’s search words: login 500, label:bug', submitLabel: 'search', autoFocus: true },
      ),
    readingWords(ctx, key, loaded, `Asking GitHub for ${here.name}’s issues...`, 'Couldn’t read the issues'),
    list && list.kind !== 'github' && notReadable(ctx, list, 'Issues', loaded.refresh),
    list?.kind === 'github' && !issues.length && empty(search ? 'Nothing matches. Try other words, or the other tab.' : state === 'open' ? `No open issues in ${repoSlug(list.repo)}.` : `Nothing closed in ${repoSlug(list.repo)} yet.`),
    list?.kind === 'github' && issues.length > 0 && card([rows.earlier, ...rows.rows.map((issue) => issueRow(ctx, here.id, list.repo, issue)), rows.more]),
    list?.kind === 'github' && issues.length > 0 && dim(`${issues.length}${list.more ? '+' : ''} ${state} · ${repoSlug(list.repo)} · from GitHub ${ago(list.fetchedAt)}${list.more ? ' · the most recently updated: search to find others' : ''}`),
    list && list.kind !== 'none' && webLink(`${list.repo.url}/issues`, 'Open on GitHub'),
  );
}

const reviewWords = (pull: GhPull): string | undefined => (pull.review === 'APPROVED' ? 'Approved' : pull.review === 'CHANGES_REQUESTED' ? 'Changes requested' : pull.review === 'REVIEW_REQUIRED' ? 'Needs a review' : undefined);
const checksStyle = (checks: GhPull['checks']): { readonly color?: string; readonly dim?: boolean } => (checks === 'failing' ? { color: 'error' } : checks === 'passing' ? { color: 'success' } : checks === 'pending' ? { color: 'warning' } : { dim: true });

/** A project's open pull requests, anyone's: one on a worktree's branch opens that worktree, any other opens on GitHub. */
export function pullsPage(ctx: Ctx, projectId: string): Node {
  const project = ctx.state.projects.find((p) => p.id === projectId);
  if (!project) return subPage(ctx, 'issues', 'Issues', empty('That project is gone.'));
  const key = `pulls:${projectId}`;
  const loaded = fromGitHub(ctx, key, 60_000, (force) => ctx.call('issues.pulls', projectId, ...(force ? [{ force: true }] : [])) as Promise<PullsList>);
  const list = loaded.value;
  const pulls = list?.kind === 'github' ? list.pulls : [];
  const rows = windowed(ctx, key, pulls);
  const worktreeOn = (branch: string): string | undefined => project.workspaces.find((w) => !w.archived && w.branch === branch)?.id;
  const pullRow = (pull: GhPull): Node => {
    const ws = worktreeOn(pull.branch);
    const words = `#${pull.number} ${pull.title}`;
    const about = line(
      span([pull.author, pull.branch, pull.draft ? 'Draft' : undefined, reviewWords(pull)].filter(Boolean).join(' · '), { dim: true }),
      pull.checks !== 'none' ? span(`  checks ${pull.checks}`, checksStyle(pull.checks)) : undefined,
      span(`  ${ago(pull.updatedAt)}`, { dim: true }),
    );
    return col([ws ? ctx.draw.button(`pull:${pull.number}`, words, () => openWorkspace(ctx, ws), { plain: true, spans: [span(`#${pull.number}  `, { dim: true }), span(pull.title, { weight: 'bold' })] }) : (webLink(pull.url, words) ?? text(words)), about]);
  };
  return subPage(
    ctx,
    'issues',
    'Issues',
    row([text(`Pull Requests in ${project.name}`, { weight: 'bold' }), list && list.kind !== 'none' && ctx.draw.button('pulls:refresh', loaded.loading ? 'Asking GitHub...' : 'Ask GitHub Again', loaded.refresh, { plain: true, hotkey: 'e', dim: true })], { justify: 'space-between' }),
    readingWords(ctx, key, loaded, 'Asking GitHub for the open pull requests...', 'Couldn’t read the pull requests'),
    list && list.kind !== 'github' && notReadable(ctx, list, 'Pull requests', loaded.refresh),
    list?.kind === 'github' && !pulls.length && empty(`No open pull requests in ${repoSlug(list.repo)}.`),
    list?.kind === 'github' && pulls.length > 0 && card([col([rows.earlier, ...rows.rows.map(pullRow), rows.more], { gap: 1 })]),
    list?.kind === 'github' && list.total > pulls.length && dim(`${list.total} open; the latest ${pulls.length} are here.`),
    list && list.kind !== 'none' && webLink(`${list.repo.url}/pulls`, 'Show All on GitHub'),
  );
}

type Way = 'investigate' | 'fix' | 'task';

const WAYS: Readonly<Record<Way, { readonly label: string; readonly hotkey: string; readonly placeholder: string; readonly go: string; readonly what: (n: number) => string }>> = {
  investigate: { label: 'Investigate', hotkey: '1', placeholder: 'Anything to look at first? It only fails behind the proxy', go: 'Investigate', what: () => 'In a new worktree: why it happens, and a reproduction. Nothing is fixed yet.' },
  fix: { label: 'Fix It', hotkey: '2', placeholder: 'Anything the fix should do or avoid? Keep the public API as it is', go: 'Fix It', what: (n) => `In a new worktree, with a pull request that closes #${n}.` },
  task: { label: 'Make a Task', hotkey: '3', placeholder: 'Anything to add to the task?', go: 'Make Task', what: () => 'On the board as Ready, written up by the agent.' },
};

/** Hand an issue to your agent: pick what it does, say anything it should know if you like, and go. */
function composer(ctx: Ctx, projectId: string, number: number, task: Issue | undefined): Node {
  const prefix = `issue:${projectId}:${number}`;
  const ways: readonly Way[] = task ? ['investigate', 'fix'] : ['investigate', 'fix', 'task'];
  const [picked, setWay] = ctx.local<Way>(`${prefix}:way`, 'investigate');
  const [look, setLook] = ctx.local(`${prefix}:look`, false);
  const [draft, setDraft] = ctx.local(`${prefix}:note`, '');
  const [askedAnyway, setAskedAnyway] = ctx.local<string | null>(`${prefix}:anyway`, null);
  const way = ways.includes(picked) ? picked : 'investigate';
  const info = WAYS[way];
  const writing = Boolean(task?.drafting);
  const mate = task ? teammateOn(ctx.state.team, task, ctx.state.selfId) : undefined;
  const go = async (note: string, anyway: boolean): Promise<void> => {
    if (way !== 'task' && mate && !anyway) {
      setDraft(note);
      setAskedAnyway(note);
      return;
    }
    const given = note.trim();
    const extra = way === 'task' ? { ...(look ? { look: true } : {}), ...(given ? { note: given } : {}) } : { ...(given ? { note: given } : {}), ...(anyway ? { anyway: true } : {}) };
    const args = Object.keys(extra).length ? [extra] : [];
    setDraft(note);
    const work = (await ctx.call(way === 'investigate' ? 'issues.investigate' : way === 'fix' ? 'issues.fix' : 'issues.toTask', projectId, number, ...args)) as { readonly key?: string } | undefined;
    setDraft('');
    setAskedAnyway(null);
    ctx.effect({ toast: way === 'investigate' ? `The agent is investigating #${number}${work?.key ? ` (${work.key})` : ''}` : way === 'fix' ? `The agent is fixing #${number}${work?.key ? ` (${work.key})` : ''}` : look ? `${work?.key ?? 'The task'}: the agent is looking at the code to write it` : `#${number} is on the board${work?.key ? ` as ${work.key}` : ''}` });
  };
  return card([
    text(task ? `${task.key} is on the board. What should your agent do?` : 'What should your agent do?', { weight: 'bold' }),
    choices(ctx, `${prefix}:way`, ways.map((w) => ({ value: w, label: WAYS[w].label, hotkey: WAYS[w].hotkey })), way, (w) => setWay(w)),
    writing
      ? dim(`The agent is still writing ${task?.key ?? 'the task'} up; then it can start.`)
      : col([
          ctx.draw.input(`${prefix}:note`, (value) => go(value ?? '', false), { ...(draft ? { value: draft } : {}), placeholder: info.placeholder, rows: 2, submitLabel: info.go.toLowerCase() }),
          way === 'task' && toggle(ctx, `${prefix}:look`, 'Look at the code first: read-only, then the task says where it is and the likely cause', look, () => setLook(!look)),
          dim(info.what(number)),
          askedAnyway !== null && mate
            ? col([
                text(mate.words, { color: 'warning' }),
                dim(`Starting #${number} here too means two of you work on it. Ask ${mate.name} first, or start anyway.`),
                ctx.draw.button(`${prefix}:anyway`, 'Start Anyway', () => go(askedAnyway, true), { primary: true, hotkey: MAIN_KEY }),
              ])
            : ctx.draw.button(`${prefix}:go`, info.go, () => go(draft, false), { primary: true, hotkey: MAIN_KEY }),
        ]),
  ]);
}

/** The agent's last finished answer in a conversation: its report, if the conversation is loaded. */
function lastReport(log: readonly LogItem[], channel: string): string | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const l = log[i]!;
    if (l.type === 'agent' && l.channel === channel && l.status === 'done' && l.text.trim() && l.text !== '(done)') return l.text;
  }
  return undefined;
}

/** What the agent wrote into the task's context once it was asked to investigate. */
function findingsOf(task: Issue): string | undefined {
  const context = task.brief.context?.trim();
  if (!context || !task.github?.investigated) return undefined;
  return task.revisions.some((r) => r.section === 'context' && r.by.kind === 'claude') ? context : undefined;
}

function findingsIn(ctx: Ctx, stage: IssueStage): string | undefined {
  if (stage.kind === 'new' || stage.kind === 'investigating') return undefined;
  const report = stage.kind === 'investigated' ? lastReport(ctx.state.log, `ws:${stage.ws}`) : undefined;
  return report ?? findingsOf(stage.task);
}

/** What to do next, or how it's going: the one part of the page that changes as the agent works. */
function nextStep(ctx: Ctx, projectId: string, issue: GhIssueFull, stage: IssueStage): Node {
  const n = issue.number;
  if (stage.kind === 'new' || stage.kind === 'task') return composer(ctx, projectId, n, stage.kind === 'task' ? stage.task : undefined);
  const task = stage.task;
  const taskButton = ctx.draw.button(`issue:${n}:task`, `Open ${task.key}`, () => ctx.go({ name: 'task', params: { id: task.id } }), { plain: true });
  const chat = (primary: boolean): Node | undefined => {
    if (stage.kind !== 'investigating' && stage.kind !== 'investigated' && stage.kind !== 'fixing') return undefined;
    return ctx.draw.button(`issue:${n}:chat`, 'Open the Conversation', () => openWorkspace(ctx, stage.ws), primary ? { primary: true, hotkey: MAIN_KEY } : { plain: true });
  };
  const place = stage.kind === 'investigating' || stage.kind === 'investigated' || stage.kind === 'fixing' ? findWorkspace(ctx.state, stage.ws)?.name : undefined;
  const where = place ? span(`  in ${place}`, { dim: true }) : undefined;
  switch (stage.kind) {
    case 'investigating':
      return card([line(span('The agent is investigating', { color: 'claude', weight: 'bold' }), where), dim(`Finding out why it happens and reproducing it. What it finds goes into ${task.key}’s brief; nothing is fixed yet.`), row([chat(true), taskButton])]);
    case 'investigated': {
      const found = findingsIn(ctx, stage);
      return card([
        line(span('The agent investigated', { weight: 'bold' }), where),
        found ? written(found) : dim('Its report is in the conversation.'),
        ctx.draw.button(`issue:${n}:fix`, 'Fix It', async () => {
          const work = (await ctx.call('issues.fix', projectId, n)) as { readonly key?: string } | undefined;
          ctx.effect({ toast: `The agent is fixing #${n}${work?.key ? ` (${work.key})` : ''}` });
        }, { primary: true, hotkey: MAIN_KEY }),
        dim(`In the same worktree, with a pull request that closes #${n}`),
        row([chat(false), taskButton]),
      ]);
    }
    case 'fixing': {
      const said = !stage.working ? lastReport(ctx.state.log, `ws:${stage.ws}`) : undefined;
      return card([
        line(span(stage.working ? 'The agent is fixing it' : 'The agent stopped before a pull request', stage.working ? { color: 'claude', weight: 'bold' } : { weight: 'bold' }), where),
        said ? written(said) : dim(stage.working ? `Its pull request closes #${n} when it merges.` : 'See what it said in the conversation: it may need you, or it may not be a bug.'),
        row([chat(true), taskButton]),
      ]);
    }
    case 'review': {
      const pr = task.pr;
      return card([text(pr ? 'Its pull request is open' : 'In review', { weight: 'bold' }), dim(`Merging it closes #${n} and finishes ${task.key}.`), pr ? webLink(pr.url, `Open Pull Request #${pr.number}`) : undefined, taskButton]);
    }
    case 'closed':
      return card([
        text(task.status === 'done' ? `Done in ${task.key}` : `${task.key} was canceled`, { weight: 'bold', ...(task.status === 'done' ? { color: 'success' } : { dim: true }) }),
        task.status === 'done' ? (issue.state === 'open' ? dim('Its pull request closes the issue on GitHub when it merges, or close it there.') : undefined) : dim('Reopen it on its page to work on the issue again.'),
        taskButton,
      ]);
  }
}

const post = (who: string | undefined, at: number, what: string, body: string, url: string): Node =>
  col([row([line(span(who ?? 'Someone', { weight: 'bold' }), span(`  ${what} ${ago(at)}`, { dim: true })), webLink(url, 'Open on GitHub')], { justify: 'space-between' }), body.trim() ? written(body) : dim('No description.')]);

type IssueRead = { readonly repo: GitHubRepo; readonly issue: GhIssueFull };

/** One issue in full, as its pages read it. */
const readIssue = (ctx: Ctx, key: string, projectId: string, number: number): Asked<IssueRead> => fromGitHub(ctx, key, ISSUES_TTL_MS, (force) => ctx.call('issues.get', projectId, number, ...(force ? [{ force: true }] : [])) as Promise<IssueRead>);

/** One GitHub issue: what it says, what people said since, and what your agent should do about it. */
export function issuePage(ctx: Ctx, projectId: string, number: number): Node {
  const key = `issue:${projectId}#${number}`;
  const loaded = readIssue(ctx, key, projectId, number);
  const data = loaded.value;
  if (!data) return subPage(ctx, 'issues', 'Issues', readingWords(ctx, key, loaded, `Asking GitHub for issue #${number}...`, `Couldn’t read #${number}`));
  const { repo, issue } = data;
  const stage = stageOf(ctx, projectId, repo, number);
  const state = stateWords(issue);
  const [draft, setDraft] = ctx.local(`${key}:comment`, '');
  const task = stage.kind === 'new' ? undefined : stage.task;
  const thread = windowed(ctx, `${key}:thread`, issue.thread, 30);
  const hidden = issue.comments - issue.thread.length;
  return subPage(
    ctx,
    'issues',
    'Issues',
    card([text(issue.title, { weight: 'bold' }), meta(span(`● ${state.label}`, state.color ? { color: state.color } : { dim: true }), `#${number}`, `${issue.author ?? 'Someone'} opened this ${ago(issue.createdAt)}`, issue.comments > 0 && `${issue.comments} comment${issue.comments === 1 ? '' : 's'}`)]),
    readingWords(ctx, key, loaded, '', ''),
    nextStep(ctx, projectId, issue, stage),
    section('Conversation', [
      col(
        [
          post(issue.author, issue.createdAt, 'opened this', issue.body, issue.url),
          thread.earlier,
          ...thread.rows.map((c: GhComment) => post(c.author, c.createdAt, 'commented', c.body, c.url)),
          thread.more,
          (issue.moreComments || hidden > 0) && webLink(issue.url, hidden > 0 ? `${hidden} more on GitHub` : 'More on GitHub'),
        ],
        { gap: 1 },
      ),
    ]),
    ctx.draw.input(
      `${key}:comment`,
      async (value) => {
        const body = value?.trim();
        if (!body) return;
        setDraft(body);
        await ctx.call('issues.comment', projectId, number, body);
        setDraft('');
        ctx.effect({ toast: `Posted on #${number}` });
        loaded.refresh();
      },
      { ...(draft ? { value: draft } : {}), label: `Comment on #${number}`, placeholder: 'On GitHub as you, for everyone who can see the issue. Markdown works.', rows: 2, submitLabel: 'comment' },
    ),
    section('Details', [
      prop(ctx, `issue:${number}:state`, 'State', [span(`● ${state.label}`, state.color ? { color: state.color } : { dim: true })]),
      task ? prop(ctx, `issue:${number}:task-prop`, 'Task', [span(task.key), span(`  ${STATUS_INFO[task.status].label}`, { dim: true })], () => ctx.go({ name: 'task', params: { id: task.id } })) : prop(ctx, `issue:${number}:task-prop`, 'Task', 'None yet'),
      prop(ctx, `issue:${number}:labels`, 'Labels', issue.labels.length ? issue.labels.map((l) => l.name).join(', ') : 'None'),
      prop(ctx, `issue:${number}:assignees`, 'Assignees', issue.assignees.length ? issue.assignees.join(', ') : 'No one'),
      prop(ctx, `issue:${number}:updated`, 'Updated', ago(issue.updatedAt)),
      issue.closedAt ? prop(ctx, `issue:${number}:closed`, 'Closed', ago(issue.closedAt)) : undefined,
      webLink(issue.url, `${repoSlug(repo)}#${number}`),
    ]),
    row(
      [
      ctx.draw.button(`issue:${number}:refresh`, loaded.loading ? 'Asking GitHub...' : 'Ask GitHub Again', loaded.refresh, { plain: true, hotkey: 'e', dim: true }),
      ctx.draw.button(`issue:${number}:more`, 'More', () => ctx.go({ name: 'issue-more', params: { project: projectId, number: String(number) } }), { plain: true, hotkey: MORE_KEY, dim: true }),
      ],
      { gap: 2 },
    ),
  );
}

/** What else to do with an issue: post what the agent found, or copy where it is. */
export function issueMorePage(ctx: Ctx, projectId: string, number: number): Node {
  const key = `issue:${projectId}#${number}`;
  const loaded = readIssue(ctx, key, projectId, number);
  const data = loaded.value;
  if (!data) return subPage(ctx, 'issues', `#${number}`, readingWords(ctx, key, loaded, `Asking GitHub for issue #${number}...`, `Couldn’t read #${number}`));
  const { repo, issue } = data;
  const stage = stageOf(ctx, projectId, repo, number);
  const found = findingsIn(ctx, stage);
  return subPage(
    ctx,
    'issues',
    `#${number}`,
    title(issue.title),
    found !== undefined &&
      asking(ctx, `${key}:post`, {
        label: 'Post the Findings on GitHub',
        question: `Post the findings on #${number}?`,
        detail: `What the agent found goes on GitHub as a comment from you, for everyone who can see the issue.\n\n${found.length > 600 ? `${found.slice(0, 600)}...` : found}`,
        confirm: 'Post Comment',
        run: async () => {
          await ctx.call('issues.comment', projectId, number, `**Findings**\n\n${found}`);
          ctx.effect({ toast: `Posted on #${number}` });
          loaded.refresh();
        },
      }),
    ctx.draw.button(`${key}:copy`, 'Copy Link', () => ctx.effect({ copy: issue.url, toast: `Copied the link to #${number}` }), { plain: true }),
    webLink(issue.url, 'Open on GitHub'),
  );
}
