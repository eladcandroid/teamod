import { criteria, parseCriterion, tally, unexplained } from '../../core/board/criteria.js';
import { labelTitle, labelsFor } from '../../core/board/labels.js';
import { type BriefSection, type Issue, type Proof, BRIEF_SECTIONS, ESTIMATES, PRIORITIES, PRIORITY_INFO, PROVIDER_INFO, SECTION_INFO, STATUS_INFO, actorName, activityText, assigneeName, blocking, boardName, boardOf, childrenOf, findIssue, isArchived, isEpic, isFinished, isStartable, issueById, matches, progressOf, reposAlong, reposOf, taskFiles, taskProof, worktreeDoing } from '../../core/board/model.js';
import { issueStage } from '../../core/issues/model.js';
import { waitingOn, waitingWords, workingOn, workingWords } from '../../core/team/model.js';
import type { AgentRef } from '../../protocol.js';
import { agentName } from '../../shared/agent-label.js';
import { activityOf } from '../../ui/workspace-models.js';
import type { Workspace } from '../../workspaces/types.js';
import type { Ctx } from '../screens.js';
import { type Node, code, col, dim, line, row, span, text, title } from '../tree.js';
import { MAIN_KEY, MORE_KEY, agentRows, asking, choices, field, myAgent, openStarted, prop, sharedWith, subPage, top, webLink, windowed, written } from './board-common.js';
import { MOVES, assigneeChoices, dueText, toggleCheck } from './board-model.js';
import { matesOf, priorityStyle, selfOf, soloOn, statusStyle } from './board-tasks.js';
import { ago, back, empty, findWorkspace, homePath, openWorkspace, page } from './common.js';

/** A page holds several lists: each shows this many until asked for more. */
const PAGE_ROWS = 20;

const stillThere = (ctx: Ctx, backTo: string): Node => subPage(ctx, 'tasks', backTo, empty('This task isn’t here anymore. It may have been deleted.'));

/**
 * The worktree a task has or had: the last one that did it, even once it's archived. `had`: some
 * worktree did it, so that's where its work is and the page offers no Start. A worktree carrying
 * its work counts as the one doing it.
 */
function worktreeOfTask(ctx: Ctx, issue: Issue): { readonly ws: Workspace | undefined; readonly live: Workspace | undefined; readonly had: boolean } {
  const last = issue.worktrees.at(-1);
  const own = last ? findWorkspace(ctx.state, last) : undefined;
  const carrier = issue.carriedBy ? findWorkspace(ctx.state, issue.carriedBy) : undefined;
  const doing = worktreeDoing(issue, (id) => (id === own?.id ? !own.archived : id === carrier?.id ? !carrier.archived : false));
  const live = doing && doing === own?.id ? own : doing && doing === carrier?.id ? carrier : undefined;
  const ws = live ?? own;
  return { ws, live, had: Boolean(ws) || issue.worktrees.length > 0 || issue.activity.some((a) => a.kind === 'worktree') };
}

const planOfIssue = (ctx: Ctx, issue: Issue) => (issue.plan ? ctx.state.plans.plans.find((p) => p.id === issue.plan?.id) : undefined);

/** Who a Start uses: its own agent, else its plan's, else yours. */
const ownAgent = (ctx: Ctx, issue: Issue): AgentRef | undefined => issue.agent ?? planOfIssue(ctx, issue)?.agent;

/** A new worktree, In Progress, its agent on it with its brief, and you there. */
async function startTask(ctx: Ctx, issue: Issue, opts: { readonly agent?: AgentRef; readonly bare?: boolean } = {}): Promise<void> {
  const who = opts.agent ?? ownAgent(ctx, issue);
  const ws = await ctx.call('board.start', issue.id, opts.bare ? {} : { claude: true, ...(who ? { agent: who } : {}) });
  if (typeof ws === 'string') openStarted(ctx, ws);
}

/** Whether the agent has investigated this task's GitHub issue and stopped: then Fix It is the one main action. */
function investigated(ctx: Ctx, issue: Issue): boolean {
  if (!issue.github || isArchived(issue)) return false;
  const live = (id: string): boolean => {
    const w = findWorkspace(ctx.state, id);
    return Boolean(w && !w.archived);
  };
  return issueStage(issue, live, (id) => activityOf(ctx.state.log, `ws:${id}`).running).kind === 'investigated';
}

function prLink(pr: NonNullable<Issue['pr']>): Node | undefined {
  const checks = pr.checks === 'none' ? '' : ` · checks ${pr.checks}`;
  return webLink(pr.url, `PR #${pr.number} ${pr.title} (${pr.state === 'OPEN' ? (pr.draft ? 'draft' : 'open') : pr.state === 'MERGED' ? 'merged' : 'closed'}${checks})`);
}

/** What to do next: open the worktree doing it, or start one; finished work says how it ended. */
function nextStep(ctx: Ctx, issue: Issue): Node | undefined {
  const { ws, live, had } = worktreeOfTask(ctx, issue);
  const openIt = (key: string, label: string, id: string, primary: boolean): Node => ctx.draw.button(key, label, () => openWorkspace(ctx, id), primary ? { primary: true, hotkey: MAIN_KEY } : { plain: true });
  const planHere = planOfIssue(ctx, issue);
  if (isFinished(issue.status)) {
    const what = issue.status === 'in_review' ? (issue.pr ? 'In review · its pull request is open' : 'In review') : issue.status === 'in_plan' ? 'Merged into the plan · ships with the plan’s pull request' : planHere ? 'Done · shipped with the plan' : 'Done';
    const pr = issue.status === 'in_plan' ? (planHere?.pr ?? issue.pr) : issue.pr;
    return col([
      line(span(what, statusStyle(issue.status)), issue.branch ? span(`  ${issue.branch}`, { dim: true }) : undefined),
      pr ? prLink(pr) : undefined,
      row([
        live ? openIt(`task:${issue.id}:open`, 'Open Worktree', live.id, true) : ws ? openIt(`task:${issue.id}:open`, 'Open the Conversation', ws.id, true) : undefined,
        planHere && ctx.draw.button(`task:${issue.id}:plan`, 'Open the Plan', () => ctx.go({ name: 'plan', params: { id: planHere.id } }), { plain: true }),
      ]),
    ]);
  }
  if (!STATUS_INFO[issue.status].open && !live) return undefined;
  const writing = Boolean(issue.drafting);
  if (had || live) {
    const fixFirst = investigated(ctx, issue);
    const number = issue.github?.number;
    return col([
      row([
        fixFirst && number !== undefined
          ? ctx.draw.button(
              `task:${issue.id}:fix`,
              'Fix It',
              async () => {
                const work = (await ctx.call('issues.fix', issue.projectId, number)) as { readonly key?: string } | undefined;
                ctx.effect({ toast: `The agent is fixing #${number}${work?.key ? ` (${work.key})` : ''}` });
              },
              { primary: true, hotkey: MAIN_KEY },
            )
          : undefined,
        live ? openIt(`task:${issue.id}:open`, 'Open Worktree', live.id, !fixFirst) : ws ? openIt(`task:${issue.id}:open`, 'Open the Conversation', ws.id, false) : undefined,
      ]),
      live ? line(span(live.name, { dim: true }), issue.branch ? span(`  on ${issue.branch}`, { dim: true }) : undefined) : dim(ws ? `${ws.name} is archived` : 'Its worktree was removed'),
      issue.pr ? prLink(issue.pr) : undefined,
    ]);
  }
  const who = ownAgent(ctx, issue);
  const along = reposAlong(ctx.state.board, issue).map((r) => ctx.state.projects.find((p) => p.id === r)?.name ?? r);
  return col([
    writing ? dim('You can start it once its brief is written.') : ctx.draw.button(`start:${issue.id}`, 'Start', () => startTask(ctx, issue), { primary: true, hotkey: MAIN_KEY }),
    !writing && dim(along.length ? `A worktree in each of its repos (${along.join(', ')} too), with ${who ? agentName(who) : 'your agent'} working on ${issue.key} across them` : `A new worktree from the latest origin, with ${who ? agentName(who) : 'your agent'} working on ${issue.key}${issue.brief.goal ? ' from this brief' : ''}`),
  ]);
}

/** Who works it: the agent at work in its worktree, or the one that will when it starts. */
function agentWords(ctx: Ctx, issue: Issue): string | undefined {
  const { live } = worktreeOfTask(ctx, issue);
  if (live) return agentName(live.agent ?? myAgent(ctx), { model: true });
  if (!isStartable(issue)) return undefined;
  const who = ownAgent(ctx, issue);
  return who ? agentName(who, { model: true }) : `Your agent (${agentName(myAgent(ctx))})`;
}

/** Every property, each one a press that opens what changes it. */
function properties(ctx: Ctx, issue: Issue): Node {
  const board = ctx.state.board;
  const params = (name: string): Readonly<Record<string, string>> => ({ id: issue.id, field: name });
  const edit = (name: string, label: string, value: string, style: Omit<ReturnType<typeof span>, 't'> = {}): Node => prop(ctx, `prop:${issue.id}:${name}`, label, [span(value, style)], () => ctx.go({ name: 'task-edit', params: params(name) }));
  const self = ctx.state.selfId;
  const parent = issue.parent ? issueById(board, issue.parent) : undefined;
  const due = issue.due ? dueText(issue.due) : undefined;
  const repos = reposOf(board, boardOf(issue));
  const several = repos.length > 1 || !repos.includes(issue.projectId);
  const project = ctx.state.projects.find((p) => p.id === issue.projectId);
  const words = agentWords(ctx, issue);
  const { live } = worktreeOfTask(ctx, issue);
  const onPlan = planOfIssue(ctx, issue);
  return col([
    edit('priority', 'Priority', PRIORITY_INFO[issue.priority].label, priorityStyle(issue.priority)),
    several ? edit('repo', 'Repo', project?.name ?? 'Repo') : undefined,
    soloOn(ctx, issue.projectId) ? undefined : edit('assignee', 'Assignee', assigneeName(issue.assignee, self)),
    words ? prop(ctx, `prop:${issue.id}:agent`, 'Agent', words, () => (live ? openWorkspace(ctx, live.id) : ctx.go({ name: 'task-agent', params: { id: issue.id } }))) : undefined,
    edit('labels', 'Labels', issue.labels.length ? issue.labels.map(labelTitle).join(', ') : 'Add Label'),
    edit('estimate', 'Estimate', issue.estimate ? String(issue.estimate) : 'None'),
    edit('due', 'Due', issue.due ? `${issue.due} · ${due?.text ?? ''}` : 'Set Due Date', due?.late && STATUS_INFO[issue.status].open ? { color: 'error' } : {}),
    edit('parent', 'Parent', parent ? `${parent.key} ${parent.title}` : 'Set Parent'),
    prop(ctx, `prop:${issue.id}:board`, several ? 'Board' : 'Project', several ? boardName(board, boardOf(issue), (id) => ctx.state.projects.find((p) => p.id === id)?.name) : (project?.name ?? '-')),
    issue.branch ? prop(ctx, `prop:${issue.id}:branch`, 'Branch', issue.branch) : undefined,
    onPlan ? prop(ctx, `prop:${issue.id}:plan`, 'Plan', (onPlan.body ?? onPlan.draft)?.title ?? 'New plan', () => ctx.go({ name: 'plan', params: { id: onPlan.id } })) : undefined,
    issue.github ? prop(ctx, `prop:${issue.id}:github`, 'GitHub', `${issue.github.repo}#${issue.github.number}`, () => ctx.go({ name: 'issue', params: { project: issue.projectId, number: String(issue.github?.number ?? '') } })) : undefined,
    issue.link ? webLink(issue.link.url, `${PROVIDER_INFO[issue.link.provider].label}: ${issue.link.key}`) : undefined,
    prop(ctx, `prop:${issue.id}:created`, 'Created', `${ago(issue.createdAt)} by ${actorName(issue.createdBy, self)}`),
    prop(ctx, `prop:${issue.id}:updated`, 'Updated', ago(issue.updatedAt)),
  ]);
}

/** A section's checklist: each "- [ ]" a press to tick; one explained says why it isn't ticked. */
function checklist(ctx: Ctx, issue: Issue, words: string): Node {
  let n = -1;
  return col(
    words.split('\n').flatMap((raw) => {
      const c = parseCriterion(raw);
      if (!c) return raw.trim() ? [dim(raw.replace(/^\s*[-*]\s+/, ''))] : [];
      n++;
      const index = n;
      const mark = c.state === 'done' ? '[x]' : c.state === 'deferred' ? '[~]' : c.state === 'not_done' ? '[-]' : '[ ]';
      return [
        ctx.draw.button(`check:${issue.id}:${index}`, `${mark} ${c.text}`, () => ctx.call('board.editBrief', issue.id, 'acceptance', toggleCheck(words, index), 'ticked a criterion'), {
          plain: true,
          spans: [span(`${mark} `, c.state === 'done' ? { color: 'success' } : { dim: true }), span(c.text), ...(c.reason ? [span(`  ${c.state === 'deferred' ? 'Deferred' : 'Not done'}: ${c.reason}`, { dim: true })] : [])],
        }),
      ];
    }),
  );
}

/** A section of the brief: what later agents and people rely on. Its versions are kept. */
function briefSection(ctx: Ctx, issue: Issue, section: BriefSection): Node {
  const words = issue.brief[section] ?? '';
  const info = SECTION_INFO[section];
  const versions = issue.revisions.filter((r) => r.section === section).length;
  const ticks = section === 'acceptance' ? tally(words) : undefined;
  const count = ticks?.total ? `${ticks.done} of ${ticks.total}${ticks.deferred ? ` · ${ticks.deferred} deferred` : ''}${ticks.notDone ? ` · ${ticks.notDone} not done` : ''}` : undefined;
  return col([
    row([
      line(span(info.label, { weight: 'semibold' }), count ? span(`  ${count}`, { dim: true }) : undefined),
      ctx.draw.button(`brief:${section}:edit`, 'Edit', () => ctx.go({ name: 'task-brief', params: { id: issue.id, section } }), { plain: true, dim: true }),
      versions > 0 && ctx.draw.button(`brief:${section}:history`, `History (${versions})`, () => ctx.go({ name: 'task-history', params: { id: issue.id, section } }), { plain: true, dim: true }),
    ]),
    words ? (section === 'acceptance' && criteria(words).length ? checklist(ctx, issue, words) : written(words)) : dim(`${info.hint}...`),
  ]);
}

function brief(ctx: Ctx, issue: Issue): Node {
  if (issue.drafting) return col([text('Your agent is writing this task...', { color: 'claude' })]);
  const filled = BRIEF_SECTIONS.filter((s) => issue.brief[s] || s === 'goal');
  const missing = BRIEF_SECTIONS.filter((s) => !filled.includes(s));
  return col(
    [
      ...filled.map((s) => briefSection(ctx, issue, s)),
      missing.length > 0 && row([dim('Add'), ...missing.map((s) => ctx.draw.button(`brief:${s}:add`, SECTION_INFO[s].label, () => ctx.go({ name: 'task-brief', params: { id: issue.id, section: s } }), { plain: true, dim: true }))]),
    ],
    { gap: 1 },
  );
}

/** Another task named on this one's page: its status, key and title; a press opens it. */
function taskLine(ctx: Ctx, key: string, other: Issue, remove?: { readonly label: string; readonly run: () => unknown }): Node {
  const closed = !STATUS_INFO[other.status].open;
  return row([
    ctx.draw.button(`${key}:open`, `${other.key} ${other.title}`, () => ctx.go({ name: 'task', params: { id: other.id } }), { plain: true, spans: [span(`${STATUS_INFO[other.status].label}  `, statusStyle(other.status)), span(`${other.key}  `, { dim: true }), span(other.title, closed ? { dim: true } : {})] }),
    remove && ctx.draw.button(`${key}:remove`, remove.label, remove.run, { plain: true, dim: true }),
  ]);
}

function subTasks(ctx: Ctx, issue: Issue): Node {
  const board = ctx.state.board;
  const kids = childrenOf(board, issue);
  const progress = progressOf(board, issue);
  const list = windowed(ctx, `task:${issue.id}:kids`, kids, PAGE_ROWS);
  return col([
    line(span('Sub-tasks', { weight: 'semibold' }), progress.total ? span(`  ${progress.done} of ${progress.total}`, { dim: true }) : undefined),
    list.earlier,
    ...list.rows.map((k) => taskLine(ctx, `kid:${k.id}`, k, { label: 'Make It a Task of Its Own', run: () => ctx.call('board.update', k.id, { parent: null }) })),
    list.more,
    !isArchived(issue) &&
      ctx.draw.input(
        `task:${issue.id}:subtask`,
        async (value) => {
          const words = value?.trim();
          if (words) await ctx.call('board.create', { projectId: issue.projectId, title: words, parent: issue.id, status: issue.status === 'backlog' ? 'backlog' : 'todo' });
        },
        { placeholder: 'Add a sub-task', submitLabel: 'add' },
      ),
  ]);
}

type Relation = 'blocked_by' | 'blocks' | 'related';

/** Blocked by, blocks, related: what waits on what. */
function relatedTo(ctx: Ctx, issue: Issue): ReadonlyArray<{ readonly rel: Relation; readonly title: string; readonly hint: string; readonly items: readonly Issue[] }> {
  const board = ctx.state.board;
  const known = (ids: readonly string[]): Issue[] => ids.map((id) => issueById(board, id)).filter((i): i is Issue => Boolean(i));
  return [
    { rel: 'blocked_by', title: 'Blocked by', hint: 'Tasks that must be done first', items: known(issue.blockedBy) },
    { rel: 'blocks', title: 'Blocks', hint: 'Tasks waiting on this one', items: blocking(board, issue) },
    { rel: 'related', title: 'Related', hint: 'Worth knowing about', items: known(issue.related) },
  ];
}

function relations(ctx: Ctx, issue: Issue): Node {
  return col(
    relatedTo(ctx, issue).map((g) => {
      const list = windowed(ctx, `rel:${issue.id}:${g.rel}`, g.items, PAGE_ROWS);
      return col([
        row([text(g.title, { weight: 'semibold' }), ctx.draw.button(`rel:${g.rel}:add`, 'Add', () => ctx.go({ name: 'task-relate', params: { id: issue.id, rel: g.rel } }), { plain: true, dim: true })]),
        g.items.length ? undefined : dim(g.hint),
        list.earlier,
        ...list.rows.map((other) => taskLine(ctx, `rel:${g.rel}:${other.id}`, other, { label: 'Remove', run: () => ctx.call('board.relate', issue.id, g.rel, other.id, false) })),
        list.more,
      ]);
    }),
    { gap: 1 },
  );
}

/** One piece of proof or one file: what it is and where, and its way out. A picture is named here, drawn in its worktree. */
function proofItem(ctx: Ctx, issue: Issue, proof: Proof): Node {
  const gone = proof.gone ? (proof.bytes !== undefined ? 'let go when the task was archived' : 'removed with its worktree') : proof.thumb ? 'kept small' : undefined;
  return col([
    row([
      line(span(proof.title), gone ? span(`  ${gone}`, { dim: true }) : undefined, span(`  ${actorName(proof.by, ctx.state.selfId)} · ${ago(proof.at)}`, { dim: true })),
      ctx.draw.button(`proof:${proof.id}:remove`, 'Remove', () => ctx.call('board.removeProof', issue.id, proof.id), { plain: true, dim: true }),
    ]),
    proof.url ? webLink(proof.url, proof.url) : undefined,
    proof.path && !proof.gone ? dim(homePath(ctx.state, proof.path)) : undefined,
    proof.body && (proof.kind === 'text' || proof.kind === 'graph') ? code(proof.body, proof.kind === 'graph' ? { language: 'json' } : {}) : undefined,
  ]);
}

function proofList(ctx: Ctx, issue: Issue, as: 'proof' | 'file'): Node {
  const items = (as === 'file' ? taskFiles(issue) : taskProof(issue)).slice().reverse();
  const list = windowed(ctx, `task:${issue.id}:${as}`, items, PAGE_ROWS);
  return col([
    row([
      line(span(as === 'file' ? 'Files' : 'Proof', { weight: 'semibold' }), items.length ? span(`  ${items.length}`, { dim: true }) : undefined),
      ctx.draw.button(`${as}:add`, as === 'file' ? 'Add Files' : 'Add Proof', () => ctx.go({ name: 'task-proof', params: { id: issue.id, as } }), { plain: true, dim: true }),
    ]),
    items.length === 0 && dim(as === 'file' ? 'Files added for the work to use show here. Your agent gets them too.' : 'Screenshots, pages and results that show it works. The agent adds them as it goes.'),
    list.earlier,
    ...list.rows.map((p) => proofItem(ctx, issue, p)),
    list.more,
  ]);
}

/** What happened to a task, oldest first: changes as quiet lines, comments and notes in full, and the comment box. */
function activity(ctx: Ctx, issue: Issue): Node {
  const self = ctx.state.selfId;
  const [draft, setDraft] = ctx.local(`task:${issue.id}:comment`, '');
  const newest = issue.activity.slice().reverse();
  const list = windowed(ctx, `task:${issue.id}:activity`, newest, 30, { more: 'Show earlier', earlier: 'Show later' });
  return col(
    [
      text('Activity', { weight: 'semibold' }),
      list.more,
      ...list.rows
        .slice()
        .reverse()
        .map((e) =>
          e.body
            ? col([line(span(actorName(e.by, self), { weight: 'semibold' }), span(`  ${ago(e.at)}`, { dim: true })), written(e.body)])
            : line(span(`${actorName(e.by, self)} ${activityText(e, self)}`, { dim: true }), span(`  ${ago(e.at)}`, { dim: true })),
        ),
      list.earlier,
      issue.drafting
        ? dim('You can comment once the task is written.')
        : ctx.draw.input(
            `task:${issue.id}:comment`,
            async (value) => {
              const words = value?.trim();
              if (!words) return;
              setDraft(words);
              await ctx.call('board.comment', issue.id, words);
              setDraft('');
            },
            { ...(draft ? { value: draft } : {}), placeholder: 'Leave a comment. Markdown works.', rows: 2, submitLabel: 'comment' },
          ),
    ],
    { gap: 1 },
  );
}

/** One task: what to do next, then its brief, its parts, what waits on what, proof and everything that happened. */
export function taskPage(ctx: Ctx, ref: string): Node {
  const board = ctx.state.board;
  const issue = findIssue(board, ref);
  if (!board.enabled) return page(top(ctx, 'tasks'), empty('Tasks are off: the engine isn’t running its board.'));
  if (!issue) return stillThere(ctx, 'Tasks');
  const parent = issue.parent ? issueById(board, issue.parent) : undefined;
  const progress = progressOf(board, issue);
  const open = STATUS_INFO[issue.status].open;
  const shared = sharedWith(ctx, issue.projectId);
  const kids = board.issues.filter((i) => i.parent === issue.id && i.private).length;
  const unticked = unexplained(issue.brief.acceptance);
  const working = workingWords(workingOn(ctx.state.team, issue.id).map((p) => p.name));
  const waiting = waitingWords(waitingOn(ctx.state.team, issue.id));
  const proofFirst = isFinished(issue.status) && taskProof(issue).length > 0;
  return page(
    top(ctx, 'tasks'),
    back(ctx, 'Tasks'),
    col([
      parent && ctx.draw.button(`task:${issue.id}:parent`, `${parent.key} ${parent.title}`, () => ctx.go({ name: 'task', params: { id: parent.id } }), { plain: true, spans: [span('Part of ', { dim: true }), span(`${parent.key} ${parent.title}`, { dim: true })] }),
      isEpic(board, issue) && dim(`Epic${progress.total ? ` · ${progress.done} of ${progress.total} sub-tasks done` : ''}`),
      line(span(issue.key, { dim: true }), span(`  ${STATUS_INFO[issue.status].label}`, statusStyle(issue.status))),
      title(issue.title),
    ]),
    working ? text(working, { color: 'claude' }) : undefined,
    waiting ? dim(waiting) : undefined,
    issue.private &&
      !isArchived(issue) &&
      row([
        dim(`Private. Only you see it${shared ? '; your team won’t until you share it' : ''}.`),
        shared &&
          ctx.draw.button(`task:${issue.id}:share`, 'Share with Team', async () => {
            await ctx.call('board.setPrivate', issue.id, false);
            ctx.effect({ toast: `Shared ${issue.key}${kids ? ' and its sub-tasks' : ''} with the team` });
          }, { plain: true }),
      ]),
    isArchived(issue) &&
      col([
        dim(`Archived ${ago(issue.archivedAt ?? issue.updatedAt)}. Its words and history are kept${issue.proof.some((p) => p.thumb || p.bytes !== undefined) ? '; its screenshots were kept small and its other proof files let go' : ''}.`),
        row([
          ctx.draw.button(`task:${issue.id}:unarchive`, 'Restore', async () => {
            await ctx.call('board.unarchive', issue.id);
            ctx.effect({ toast: `${issue.key} is back on the board` });
          }, { primary: true, hotkey: MAIN_KEY }),
          removeTask(ctx, issue, true),
        ]),
      ]),
    issue.worktreeGone &&
      col([
        dim('Its worktree was put away before the task was done.'),
        row([
          ctx.draw.button(`task:${issue.id}:gone:keep`, 'Keep As Is', () => ctx.call('board.settleGone', issue.id, 'keep'), { plain: true, dim: true }),
          ctx.draw.button(`task:${issue.id}:gone:backlog`, 'Back to Backlog', () => ctx.call('board.settleGone', issue.id, 'backlog'), { plain: true }),
          ctx.draw.button(`task:${issue.id}:gone:cancel`, 'Cancel Task', () => ctx.call('board.settleGone', issue.id, 'canceled'), { plain: true }),
        ]),
      ]),
    issue.needsChecks && open && unticked.length > 0 && text(`Needs its checks. ${unticked.length === 1 ? 'A criterion is' : `${unticked.length} criteria are`} neither ticked nor explained, so it stays out of review: tick each one, or add “— deferred: why” after it.`, { color: 'warning' }),
    !isArchived(issue) && nextStep(ctx, issue),
    !isArchived(issue) && moveTo(ctx, issue),
    proofFirst && proofList(ctx, issue, 'proof'),
    brief(ctx, issue),
    proofList(ctx, issue, 'file'),
    subTasks(ctx, issue),
    relations(ctx, issue),
    !proofFirst && proofList(ctx, issue, 'proof'),
    properties(ctx, issue),
    activity(ctx, issue),
    ctx.draw.button(`task:${issue.id}:more`, 'More', () => ctx.go({ name: 'task-more', params: { id: issue.id } }), { plain: true, hotkey: MORE_KEY, dim: true }),
  );
}

/** The board's columns as presses, in place of dragging its card. */
function moveTo(ctx: Ctx, issue: Issue): Node {
  return row([dim('Move to'), ...MOVES.filter((s) => s !== issue.status).map((s) => ctx.draw.button(`move:${issue.id}:${s}`, STATUS_INFO[s].label, () => ctx.call('board.move', issue.id, s), { plain: true, dim: true }))]);
}

function removeTask(ctx: Ctx, issue: Issue, forGood: boolean): Node {
  return asking(ctx, `task:${issue.id}:delete`, {
    label: forGood ? 'Delete for Good' : 'Delete Task',
    question: `Delete ${issue.key}${forGood ? ' for good' : ''}?`,
    detail: forGood ? `“${issue.title}”, its brief, its history and what’s left of its proof go away. This can’t be undone.` : `“${issue.title}”, its brief and its history go away. Its sub-tasks stay, as tasks of their own. Its worktree isn’t touched.`,
    confirm: forGood ? 'Delete for Good' : 'Delete Task',
    danger: true,
    run: async () => {
      await ctx.call('board.remove', issue.id);
      ctx.effect({ toast: `Deleted ${issue.key}` });
      ctx.nav.back(ctx.pane);
    },
  });
}

/** Everything else a task can do, out of the way. */
export function taskMorePage(ctx: Ctx, ref: string): Node {
  const issue = findIssue(ctx.state.board, ref);
  if (!issue) return stillThere(ctx, 'Tasks');
  const { live } = worktreeOfTask(ctx, issue);
  const startable = isStartable(issue);
  const shared = sharedWith(ctx, issue.projectId);
  const writing = Boolean(issue.drafting);
  if (isArchived(issue)) {
    return subPage(
      ctx,
      'tasks',
      issue.key,
      title(issue.title),
      ctx.draw.button(`more:${issue.id}:unarchive`, 'Restore from Archive', async () => {
        await ctx.call('board.unarchive', issue.id);
        ctx.effect({ toast: `${issue.key} is back on the board` });
      }, { plain: true }),
      ctx.draw.button(`more:${issue.id}:copy`, 'Copy Key', () => ctx.effect({ copy: issue.key, toast: `Copied ${issue.key}` }), { plain: true }),
      removeTask(ctx, issue, true),
    );
  }
  return subPage(
    ctx,
    'tasks',
    issue.key,
    title(issue.title),
    !writing && ctx.draw.button(`more:${issue.id}:rename`, 'Rename', () => ctx.go({ name: 'task-edit', params: { id: issue.id, field: 'title' } }), { plain: true }),
    !live && startable && !writing && ctx.draw.button(`more:${issue.id}:start-with`, 'Start with Another Agent', () => ctx.go({ name: 'task-start-with', params: { id: issue.id } }), { plain: true }),
    !live && startable && !writing && ctx.draw.button(`more:${issue.id}:start-bare`, 'Start Worktree Only', () => startTask(ctx, issue, { bare: true }), { plain: true }),
    live && ctx.draw.button(`more:${issue.id}:reveal`, 'Reveal Folder', () => ctx.call('workspaces.openInFinder', live.id), { plain: true }),
    !startable &&
      ctx.draw.button(`more:${issue.id}:reopen`, 'Reopen the Task', async () => {
        await ctx.call('board.update', issue.id, { status: 'todo' });
        ctx.effect({ toast: `Reopened ${issue.key}` });
      }, { plain: true }),
    !live && startable && ctx.draw.button(`more:${issue.id}:agent`, 'Agent for This Task', () => ctx.go({ name: 'task-agent', params: { id: issue.id } }), { plain: true }),
    ctx.draw.button(`more:${issue.id}:subtask`, 'Add Sub-task', () => ctx.go({ name: 'new-task', params: { parent: issue.id, board: boardOf(issue), project: issue.projectId } }), { plain: true }),
    issue.private
      ? ctx.draw.button(`more:${issue.id}:share`, 'Share with Team', async () => {
          await ctx.call('board.setPrivate', issue.id, false);
          ctx.effect({ toast: `Shared ${issue.key} with the team` });
        }, { plain: true })
      : shared
        ? ctx.draw.button(`more:${issue.id}:private`, 'Make Private', async () => {
            await ctx.call('board.setPrivate', issue.id, true);
            ctx.effect({ toast: `${issue.key} is private: only you see it` });
          }, { plain: true })
        : undefined,
    !STATUS_INFO[issue.status].open &&
      ctx.draw.button(`more:${issue.id}:archive`, 'Archive', async () => {
        await ctx.call('board.archive', issue.id);
        ctx.effect({ toast: `Archived ${issue.key}` });
      }, { plain: true }),
    ctx.draw.button(`more:${issue.id}:copy`, 'Copy Key', () => ctx.effect({ copy: issue.key, toast: `Copied ${issue.key}` }), { plain: true }),
    ctx.draw.button(`more:${issue.id}:copy-title`, 'Copy Title and Key', () => ctx.effect({ copy: `${issue.key} ${issue.title}`, toast: 'Copied' }), { plain: true }),
    removeTask(ctx, issue, false),
  );
}

/** A task picked from the rest, narrowed by words: a parent, or what waits on what. */
function taskPicker(ctx: Ctx, key: string, candidates: readonly Issue[], pick: (other: Issue) => unknown): Node {
  const [query, setQuery] = ctx.local(`${key}:query`, '');
  const found = candidates.filter((i) => !i.archivedAt && matches(i, query));
  const list = windowed(ctx, key, found);
  return col([
    ctx.draw.input(`${key}:find`, (value) => setQuery(value?.trim() ?? ''), { label: 'Find', value: query, placeholder: 'Words in its title, key or brief', submitLabel: 'find' }),
    found.length === 0 && empty('Nothing matches.'),
    list.earlier,
    ...list.rows.map((other) =>
      ctx.draw.button(`${key}:${other.id}`, `${other.key} ${other.title}`, () => pick(other), { plain: true, spans: [span(`${STATUS_INFO[other.status].label}  `, statusStyle(other.status)), span(`${other.key}  `, { dim: true }), span(other.title)] }),
    ),
    list.more,
  ]);
}

/** One property, changed: each opened from its row on the page. */
export function taskEditPage(ctx: Ctx, ref: string, what: string): Node {
  const board = ctx.state.board;
  const issue = findIssue(board, ref);
  if (!issue) return stillThere(ctx, 'Tasks');
  const sheet = (...children: ReadonlyArray<Node | false | undefined | null>): Node => subPage(ctx, 'tasks', issue.key, title(issue.title), ...children);
  const update = async (patch: Record<string, unknown>): Promise<void> => {
    await ctx.call('board.update', issue.id, patch);
    ctx.nav.back(ctx.pane);
  };
  switch (what) {
    case 'title':
      return sheet(
        ctx.draw.input(
          `edit:${issue.id}:title`,
          async (value) => {
            const next = value?.replace(/\s+/g, ' ').trim();
            if (next && next !== issue.title) await update({ title: next });
            else ctx.nav.back(ctx.pane);
          },
          { label: 'Title', value: issue.title, submitLabel: 'rename', autoFocus: true },
        ),
      );
    case 'priority':
      return sheet(field('Priority', choices(ctx, `edit:${issue.id}:priority`, PRIORITIES.map((p) => ({ value: p, label: PRIORITY_INFO[p].label })), issue.priority, (priority) => update({ priority }))));
    case 'assignee': {
      const who = assigneeChoices(selfOf(ctx), matesOf(ctx, issue.projectId), issue.assignee);
      return sheet(
        field(
          'Who it’s for',
          choices(ctx, `edit:${issue.id}:assignee`, [{ value: '', label: 'No one' }, ...who.map((c) => ({ value: c.key, label: c.label }))], issue.assignee ? `person:${issue.assignee.id}` : '', (key) => update({ assignee: who.find((c) => c.key === key)?.assignee ?? null })),
        ),
      );
    }
    case 'labels': {
      const set = labelsFor(board, boardOf(issue));
      const names = [...new Set([...set.map((l) => l.name), ...issue.labels])];
      const flip = (name: string): Promise<unknown> => ctx.call('board.update', issue.id, { labels: issue.labels.includes(name) ? issue.labels.filter((l) => l !== name) : [...issue.labels, name] });
      return sheet(
        field(
          'Labels',
          ...names.map((name) => ctx.draw.button(`edit:${issue.id}:label:${name}`, `${issue.labels.includes(name) ? '[x]' : '[ ]'} ${labelTitle(name)}`, () => flip(name), { plain: true, ...(issue.labels.includes(name) ? {} : { dim: true }) })),
        ),
        ctx.draw.button(`edit:${issue.id}:new-label`, 'New Label', () => ctx.go({ name: 'labels', params: { project: boardOf(issue), issue: issue.id } }), { plain: true }),
      );
    }
    case 'estimate':
      return sheet(
        field(
          'Estimate',
          choices(ctx, `edit:${issue.id}:estimate`, [{ value: 'none', label: 'None' }, ...ESTIMATES.map((n) => ({ value: String(n), label: String(n) }))], issue.estimate ? String(issue.estimate) : 'none', (n) => update({ estimate: n === 'none' ? null : Number(n) })),
        ),
      );
    case 'due':
      return sheet(
        ctx.draw.input(
          `edit:${issue.id}:due`,
          async (value) => {
            const day = value?.trim();
            if (!day) return update({ due: null });
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('A date like 2026-11-30');
            return update({ due: day });
          },
          { label: 'Due', value: issue.due ?? '', placeholder: 'YYYY-MM-DD', submitLabel: 'set', autoFocus: true },
        ),
        Boolean(issue.due) && ctx.draw.button(`edit:${issue.id}:no-due`, 'Remove the Due Date', () => update({ due: null }), { plain: true }),
      );
    case 'parent': {
      const parent = issue.parent ? issueById(board, issue.parent) : undefined;
      const candidates = board.issues.filter((i) => i.id !== issue.id && boardOf(i) === boardOf(issue) && i.parent !== issue.id);
      return sheet(
        parent && row([line(span('Part of ', { dim: true }), `${parent.key} ${parent.title}`), ctx.draw.button(`edit:${issue.id}:no-parent`, 'Make It a Task of Its Own', () => update({ parent: null }), { plain: true })]),
        !parent && dim('Pick the task this one is part of.'),
        taskPicker(ctx, `edit:${issue.id}:parent`, candidates, (other) => update({ parent: other.id })),
      );
    }
    case 'repo': {
      const repos = [...new Set([...reposOf(board, boardOf(issue)), issue.projectId])].filter((r) => ctx.state.projects.some((p) => p.id === r && p.root));
      const name = (id: string): string => ctx.state.projects.find((p) => p.id === id)?.name ?? id;
      return sheet(
        field('The repo it runs in: Start makes its worktree there', choices(ctx, `edit:${issue.id}:repo`, repos.map((r) => ({ value: r, label: name(r) })), issue.projectId, async (projectId) => {
          await update({ projectId });
          ctx.effect({ toast: `It runs in ${name(projectId)} now` });
        })),
        ctx.draw.button(`edit:${issue.id}:repos`, 'Repos on This Board', () => ctx.go({ name: 'board-settings', params: { board: boardOf(issue) } }), { plain: true, dim: true }),
      );
    }
    default:
      return sheet(empty('Nothing to change there.'));
  }
}

/** Write one section of the brief: the old text is kept as a version. */
export function taskBriefPage(ctx: Ctx, ref: string, section: BriefSection): Node {
  const issue = findIssue(ctx.state.board, ref);
  if (!issue) return stillThere(ctx, 'Tasks');
  const info = SECTION_INFO[section];
  const words = issue.brief[section] ?? '';
  // What you wrote stays open if it didn't save; otherwise the box holds the section as it is now.
  const [unsaved, setUnsaved] = ctx.local<string | null>(`task:${issue.id}:brief:${section}:unsaved`, null);
  return subPage(
    ctx,
    'tasks',
    issue.key,
    col([title(info.label), dim(info.hint)]),
    ctx.draw.input(
      `brief:${issue.id}:${section}`,
      async (value) => {
        const next = value ?? '';
        setUnsaved(next);
        if (next.trim() !== words.trim()) await ctx.call('board.editBrief', issue.id, section, next);
        setUnsaved(null);
        ctx.nav.back(ctx.pane);
      },
      { value: unsaved ?? words, rows: 10, placeholder: info.hint, submitLabel: 'save', autoFocus: true },
    ),
    dim(`Markdown${section === 'acceptance' ? '. “- [ ]” makes a checkbox, “— deferred: why” after one explains it' : ''}.`),
  );
}

/** A section's versions, newest first: who, when, why, what it said; Restore puts one back. */
export function taskHistoryPage(ctx: Ctx, ref: string, section: BriefSection): Node {
  const issue = findIssue(ctx.state.board, ref);
  if (!issue) return stillThere(ctx, 'Tasks');
  const self = ctx.state.selfId;
  const versions = issue.revisions.filter((r) => r.section === section).slice().reverse();
  return subPage(
    ctx,
    'tasks',
    issue.key,
    title(`${SECTION_INFO[section].label}: history`),
    versions.length === 0 && empty('No earlier versions yet.'),
    ...versions.map((r, i) =>
      col([
        line(span(actorName(r.by, self), { weight: 'semibold' }), span(`  ${ago(r.at)}`, { dim: true }), r.reason ? span(`  ${r.reason}`, { dim: true }) : undefined),
        r.before.trim() ? written(r.before) : dim('Empty before'),
        r.before.trim() || i > 0
          ? ctx.draw.button(`history:${r.id}:restore`, 'Restore This', async () => {
              await ctx.call('board.restoreRevision', issue.id, r.id);
              ctx.effect({ toast: 'Restored that version' });
              ctx.nav.back(ctx.pane);
            }, { plain: true })
          : undefined,
      ]),
    ),
  );
}

/** Add to Blocked by, Blocks or Related. */
export function taskRelatePage(ctx: Ctx, ref: string, rel: string): Node {
  const board = ctx.state.board;
  const issue = findIssue(board, ref);
  if (!issue) return stillThere(ctx, 'Tasks');
  const group = relatedTo(ctx, issue).find((g) => g.rel === rel);
  if (!group) return subPage(ctx, 'tasks', issue.key, empty('Nothing to add there.'));
  const candidates = board.issues.filter((i) => i.id !== issue.id && !group.items.some((x) => x.id === i.id));
  return subPage(
    ctx,
    'tasks',
    issue.key,
    col([title(group.title), dim(group.hint)]),
    taskPicker(ctx, `relate:${issue.id}:${rel}`, candidates, async (other) => {
      await ctx.call('board.relate', issue.id, group.rel, other.id, true);
      ctx.nav.back(ctx.pane);
    }),
  );
}

const IMAGE = /\.(png|jpe?g|gif|webp|heic|svg)$/i;

/** Add proof (a page, a file, a result in words), or a file for the work to use. */
export function taskProofPage(ctx: Ctx, ref: string, as: 'proof' | 'file'): Node {
  const issue = findIssue(ctx.state.board, ref);
  if (!issue) return stillThere(ctx, 'Tasks');
  const context = as === 'file';
  const done = (): void => ctx.nav.back(ctx.pane);
  return subPage(
    ctx,
    'tasks',
    issue.key,
    col([title(context ? 'Add a File' : 'Add Proof'), dim(context ? 'A copy is kept with the task, and the agent doing it gets its path.' : 'A picture, a page or a result that shows it works.')]),
    ctx.draw.input(
      'proof:path',
      async (value) => {
        const file = value?.trim();
        if (!file) return;
        const name = file.split('/').pop() ?? file;
        await ctx.call('board.addProof', issue.id, { kind: IMAGE.test(file) ? 'image' : 'file', title: name.slice(0, 120), path: file, ...(context ? { context: true } : {}) });
        done();
      },
      { label: 'File', placeholder: '/path/to/screenshot.png', submitLabel: 'add', autoFocus: true },
    ),
    !context &&
      ctx.draw.input(
        'proof:link',
        async (value) => {
          const url = value?.trim();
          if (!url) return;
          const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
          let host: string;
          try {
            host = new URL(full).hostname;
          } catch {
            throw new Error('That doesn’t look like a link');
          }
          await ctx.call('board.addProof', issue.id, { kind: 'url', title: host.slice(0, 120), url: full });
          done();
        },
        { label: 'Link', placeholder: 'https://preview.example.com/checkout', submitLabel: 'add' },
      ),
    !context &&
      ctx.draw.input(
        'proof:text',
        async (value) => {
          const body = value?.trim();
          if (!body) return;
          await ctx.call('board.addProof', issue.id, { kind: 'text', title: (body.split('\n')[0] ?? 'Result').slice(0, 120), body });
          done();
        },
        { label: 'Result', placeholder: 'What it printed, in words', rows: 3, submitLabel: 'add' },
      ),
  );
}

/** Who works a task when it starts: its own agent, or your default. A worktree already on it keeps its agent. */
export function taskAgentPage(ctx: Ctx, ref: string): Node {
  const issue = findIssue(ctx.state.board, ref);
  if (!issue) return stillThere(ctx, 'Tasks');
  return subPage(
    ctx,
    'tasks',
    issue.key,
    col([title('Agent for This Task'), dim('Who works on it when it starts: its worktree runs this agent and model.')]),
    ...agentRows(ctx, `agent:${issue.id}`, issue.agent, async (agent) => {
      const said = await ctx.call('board.setAgent', issue.id, agent ?? null);
      if (typeof said === 'string') ctx.effect({ toast: said });
      ctx.nav.back(ctx.pane);
    }),
  );
}

/** Start with another agent, this start only: the task's own agent stays as it is. */
export function taskStartWithPage(ctx: Ctx, ref: string): Node {
  const issue = findIssue(ctx.state.board, ref);
  if (!issue) return stillThere(ctx, 'Tasks');
  const own = ownAgent(ctx, issue);
  return subPage(
    ctx,
    'tasks',
    issue.key,
    col([title('Start with Another Agent'), dim('For this start only.')]),
    ...agentRows(ctx, `start-with:${issue.id}`, own, (agent) => startTask(ctx, issue, { agent: agent ?? myAgent(ctx) })),
  );
}
