import { type GhJob, type GhRun, type GhRunFull, type GhStep, type GhWorkflow, RUNS_IDLE_MS, RUNS_LIVE_MS, type RunTone, type RunsList, durationWords, eventWords, fileName, isLive, jobsSummary, pollEvery, runDuration, runTone, shortSha, sortJobs, sortRuns, spanOf, statusWords } from '../../core/ci/model.js';
import { repoSlug } from '../../core/issues/model.js';
import type { GitHubRepo } from '../../workspaces/github.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, code, col, dim, line, row, span, text, title } from '../tree.js';
import { type Asked, MAIN_KEY, MORE_KEY, asking, drawAgain, fromGitHub, notReadable, projectHere, projectSwitch, prop, readingWords, subPage, top, webLink, windowed } from './board-common.js';
import { ago, card, empty, meta, page, section } from './common.js';

/** How a run, job or step is going, in the surface's own colors. */
const toneStyle = (tone: RunTone): Omit<Span, 't'> => (tone === 'passed' ? { color: 'success' } : tone === 'failed' ? { color: 'error' } : tone === 'running' ? { color: 'claude' } : tone === 'queued' || tone === 'waiting' ? { color: 'warning' } : { dim: true });

const runRow = (ctx: Ctx, projectId: string, run: GhRun): Node => {
  const now = Date.now();
  const where = [run.branch, run.prs.length ? `#${run.prs[0]}` : undefined].filter(Boolean).join(' · ');
  return ctx.draw.button(`run:${run.id}`, run.title, () => ctx.go({ name: 'run', params: { project: projectId, run: String(run.id) } }), {
    plain: true,
    spans: [
      span(`● ${statusWords(run)}  `, toneStyle(runTone(run))),
      span(run.title),
      span(`  ${run.workflow} #${run.number}`, { dim: true }),
      span(`  ${eventWords(run.event)}`, { dim: true }),
      ...(where ? [span(`  ${where}`, { dim: true })] : []),
      ...(run.actor ? [span(`  ${run.actor}`, { dim: true })] : []),
      span(`  ${durationWords(runDuration(run, now))}`, { dim: true }),
      span(`  ${ago(run.createdAt, now)}`, { dim: true }),
    ],
  });
};

/** What a project's runs are filtered by: one workflow's, one branch's, or every one. */
function runFilters(ctx: Ctx, projectId: string): { readonly workflow: string; readonly branch: string; readonly setWorkflow: (next: string) => void; readonly setBranch: (next: string) => void } {
  const [workflow, setWorkflow] = ctx.local(`actions:${projectId}:workflow`, '');
  const [branch, setBranch] = ctx.local(`actions:${projectId}:branch`, '');
  return { workflow, branch, setWorkflow, setBranch };
}

/**
 * Actions: one project's latest workflow runs, running ones on top, asked for again every few
 * seconds while one runs. A workflow or a branch narrows them. A run opens into its page.
 */
export function actionsPage(ctx: Ctx): Node {
  const { projects, here } = projectHere(ctx);
  if (!here) return page(top(ctx, 'actions'), empty('No projects yet. Actions come from a project’s GitHub repository: add a project in Work.'));
  const { workflow, branch, setWorkflow, setBranch } = runFilters(ctx, here.id);
  const [narrowing, setNarrowing] = ctx.local('actions:narrowing', false);
  const key = `runs:${here.id}:${workflow}:${branch}`;
  const loaded = fromGitHub(ctx, key, RUNS_LIVE_MS, (force) => ctx.call('ci.runs', here.id, { ...(workflow ? { workflow } : {}), ...(branch ? { branch } : {}), ...(force ? { force: true } : {}) }) as Promise<RunsList>);
  const list = loaded.value;
  const runs = list?.kind === 'github' ? sortRuns(list.runs) : [];
  const live = runs.some(isLive);
  if (list?.kind === 'github') drawAgain(ctx, key, pollEvery(runs));
  const flows = list?.kind === 'github' ? fromGitHub(ctx, `workflows:${here.id}`, 60_000, () => ctx.call('ci.workflows', here.id) as Promise<{ readonly repo: GitHubRepo; readonly workflows: readonly GhWorkflow[] }>) : undefined;
  const known = (flows?.value?.workflows ?? []).filter((f) => f.id);
  const rows = windowed(ctx, key, runs);
  const flowList = windowed(ctx, `actions:flows:${here.id}`, known);
  return page(
    top(ctx, 'actions'),
    projectSwitch(ctx, projects, here),
    row([
      ctx.draw.button('actions:runs', 'Runs', () => undefined, { plain: true, hotkey: '1', spans: [span('Runs', { color: 'claude', weight: 'bold' })] }),
      ctx.draw.button('actions:workflows', 'Workflows', () => ctx.go({ name: 'workflows', params: { project: here.id } }), { plain: true, hotkey: '2', dim: true }),
      list?.kind === 'github' && ctx.draw.button('actions:filter', workflow || branch ? `Only ${[workflow ? (known.find((f) => f.path === workflow)?.name ?? fileName(workflow)) : '', branch].filter(Boolean).join(' on ')}` : 'Filter', () => setNarrowing(!narrowing), { plain: true, hotkey: 'f', dim: true }),
      list && list.kind !== 'none' && ctx.draw.button('actions:refresh', loaded.loading ? 'Asking GitHub...' : 'Ask GitHub Again', loaded.refresh, { plain: true, hotkey: 'e', dim: true }),
    ], { gap: 2 }),
    narrowing &&
      col([
        row([
          ctx.draw.button('actions:all', 'All Workflows', () => setWorkflow(''), { plain: true, ...(workflow ? { dim: true } : {}) }),
          flowList.earlier,
          ...flowList.rows.map((f) => ctx.draw.button(`actions:flow:${f.path}`, f.name, () => setWorkflow(f.path), { plain: true, ...(workflow === f.path ? {} : { dim: true }) })),
          flowList.more,
        ]),
        ctx.draw.input('actions:branch', (value) => setBranch(value?.trim() ?? ''), { label: 'Branch', value: branch, placeholder: 'One branch’s runs. Empty: every branch.', submitLabel: 'filter', autoFocus: true }),
      ]),
    readingWords(ctx, key, loaded, `Asking GitHub for ${here.name}’s workflow runs...`, 'Couldn’t read the runs'),
    list && list.kind !== 'github' && notReadable(ctx, list, 'Actions', loaded.refresh),
    list?.kind === 'github' && !runs.length && empty(workflow || branch ? 'No runs like that yet. Pick another workflow or branch.' : `Nothing has run in ${repoSlug(list.repo)}. Add a workflow under .github/workflows and push it.`),
    list?.kind === 'github' && runs.length > 0 && card([rows.earlier, ...rows.rows.map((run) => runRow(ctx, here.id, run)), rows.more]),
    list?.kind === 'github' && runs.length > 0 && dim(`${live ? `${runs.filter(isLive).length} running · ` : ''}${runs.length}${list.more ? '+' : ''} run${runs.length === 1 && !list.more ? '' : 's'} · ${repoSlug(list.repo)} · from GitHub ${ago(list.fetchedAt)}${live ? ' · watching, every few seconds' : ''}`),
    list && list.kind !== 'none' && webLink(`${list.repo.url}/actions`, 'Open on GitHub'),
  );
}

/** Each workflow: its name and file, how its last run went, and its YAML a press away. */
export function workflowsPage(ctx: Ctx, projectId: string): Node {
  const project = ctx.state.projects.find((p) => p.id === projectId);
  if (!project) return subPage(ctx, 'actions', 'Actions', empty('That project is gone.'));
  const key = `workflows:${projectId}`;
  const loaded = fromGitHub(ctx, key, 60_000, (force) => ctx.call('ci.workflows', projectId, ...(force ? [{ force: true }] : [])) as Promise<{ readonly repo: GitHubRepo; readonly workflows: readonly GhWorkflow[] }>);
  const flows = loaded.value?.workflows ?? [];
  const runs = fromGitHub(ctx, `runs:${projectId}::`, RUNS_LIVE_MS, () => ctx.call('ci.runs', projectId, {}) as Promise<RunsList>).value;
  const lastOf = (path: string): GhRun | undefined => (runs?.kind === 'github' ? sortRuns(runs.runs).find((r) => r.path === path) : undefined);
  const rows = windowed(ctx, key, flows);
  return subPage(
    ctx,
    'actions',
    'Actions',
    row([text(`Workflows in ${project.name}`, { weight: 'bold' }), ctx.draw.button('workflows:refresh', loaded.loading ? 'Asking GitHub...' : 'Ask GitHub Again', loaded.refresh, { plain: true, hotkey: 'e', dim: true })], { justify: 'space-between' }),
    readingWords(ctx, key, loaded, 'Reading the workflows, from the project’s folder and GitHub...', 'Couldn’t read the workflows'),
    loaded.value && !flows.length && empty('No workflows yet. Workflows live in .github/workflows. Ask your agent to set one up, then push it.'),
    rows.earlier,
    ...rows.rows.map((flow) => workflowCard(ctx, projectId, flow, lastOf(flow.path))),
    rows.more,
  );
}

function workflowCard(ctx: Ctx, projectId: string, flow: GhWorkflow, last: GhRun | undefined): Node {
  const [open, setOpen] = ctx.local(`workflow:${projectId}:${flow.path}:open`, false);
  const off = flow.state !== 'active' && flow.state !== 'not_pushed';
  return card([
    line(span(flow.name, { weight: 'bold' }), flow.state === 'not_pushed' ? span('  ● Not pushed yet', { color: 'warning' }) : off ? span('  ● Turned off', { dim: true }) : undefined),
    dim(flow.path),
    last &&
      ctx.draw.button(`workflow:${flow.path}:last`, last.title, () => ctx.go({ name: 'run', params: { project: projectId, run: String(last.id) } }), {
        plain: true,
        spans: [span('Last run  ', { dim: true }), span(`● ${statusWords(last)}  `, toneStyle(runTone(last))), span(last.title), span(`  ${ago(last.createdAt)}`, { dim: true })],
      }),
    row([
      flow.file !== undefined ? ctx.draw.button(`workflow:${flow.path}:yaml`, open ? 'Hide the YAML' : 'Show the YAML', () => setOpen(!open), { plain: true, dim: true }) : dim('GitHub didn’t give this file.'),
      flow.url ? webLink(flow.url, 'Open on GitHub') : undefined,
    ], { gap: 2 }),
    open && flow.file !== undefined && code(flow.file, { language: 'yaml', path: flow.path }),
  ]);
}

const stepRow = (step: GhStep, now: number): Node => {
  const tone = runTone(step);
  const took = spanOf(step, now);
  return line(span(`${statusWords(step)}  `, toneStyle(tone)), span(`${step.number}  `, { dim: true }), span(step.name), took !== undefined && tone !== 'skipped' ? span(`  ${durationWords(took)}`, { dim: true }) : undefined);
};

/** A job: how it went and how long, its steps (open while it runs or once it fails), and where a failed one failed. */
function jobCard(ctx: Ctx, projectId: string, runId: number, job: GhJob, now: number): Node {
  const tone = runTone(job);
  const [opened, setOpened] = ctx.local<boolean | null>(`run:${runId}:job:${job.id}:open`, null);
  const open = opened ?? (tone === 'failed' || tone === 'running');
  const took = spanOf(job, now);
  const steps = windowed(ctx, `job:${job.id}:steps`, job.steps);
  return col([
    ctx.draw.button(`job:${job.id}`, job.name, () => setOpened(!open), {
      plain: true,
      spans: [span(`${open ? '▾' : '▸'} `, { dim: true }), span(`● ${statusWords(job)}  `, toneStyle(tone)), span(job.name, { weight: 'bold' }), ...(job.runner ? [span(`  ${job.runner}`, { dim: true })] : []), ...(took !== undefined ? [span(`  ${durationWords(took)}`, { dim: true })] : [])],
    }),
    open && (job.steps.length ? col([steps.earlier, ...steps.rows.map((s) => stepRow(s, now)), steps.more], { padX: 2 }) : dim(isLive(job) ? 'Waiting for a runner...' : 'No steps ran.')),
    open &&
      row(
        [
          tone === 'failed' && ctx.draw.button(`job:${job.id}:log`, 'Show Where It Failed', () => ctx.go({ name: 'log', params: { project: projectId, run: String(runId), job: String(job.id) } }), { plain: true }),
          job.url ? webLink(job.url, 'Full Log on GitHub') : undefined,
        ],
        { padX: 2 },
      ),
  ]);
}

/** One run with its jobs, as its pages read it. */
const readRun = (ctx: Ctx, key: string, projectId: string, runId: number): Asked<{ readonly repo: GitHubRepo; readonly run: GhRunFull }> => fromGitHub(ctx, key, RUNS_LIVE_MS, (force) => ctx.call('ci.run', projectId, runId, ...(force ? [{ force: true }] : [])) as Promise<{ readonly repo: GitHubRepo; readonly run: GhRunFull }>);

/** One workflow run, to watch: every job and its steps with their times, asked for again while it runs. */
export function runPage(ctx: Ctx, projectId: string, runId: number): Node {
  const key = `run:${projectId}#${runId}`;
  const loaded = readRun(ctx, key, projectId, runId);
  const data = loaded.value;
  if (!data) return subPage(ctx, 'actions', 'Actions', readingWords(ctx, key, loaded, 'Asking GitHub for the run’s jobs and steps...', 'Couldn’t read the run'));
  const { repo, run } = data;
  const live = isLive(run);
  drawAgain(ctx, key, live ? RUNS_LIVE_MS : RUNS_IDLE_MS);
  const tone = runTone(run);
  const failed = !live && (tone === 'failed' || tone === 'cancelled');
  const now = Date.now();
  const jobs = windowed(ctx, `${key}:jobs`, sortJobs(run.jobs));
  const rerun = async (only: boolean): Promise<void> => {
    await ctx.call('ci.rerun', projectId, runId, ...(only ? [{ failed: true }] : []));
    ctx.effect({ toast: only ? 'Running the failed jobs again' : 'Running it again' });
    loaded.refresh();
  };
  return subPage(
    ctx,
    'actions',
    'Actions',
    card([text(run.title, { weight: 'bold' }), meta(span(`● ${statusWords(run)}`, toneStyle(tone)), durationWords(runDuration(run, now)), jobsSummary(run.jobs))], failed ? { tone: 'error' } : {}),
    readingWords(ctx, key, loaded, '', ''),
    failed && ctx.draw.button(`run:${runId}:rerun-failed`, 'Re-run Failed Jobs', () => rerun(true), { primary: true, hotkey: MAIN_KEY }),
    live &&
      asking(ctx, `run:${runId}:cancel`, {
        label: 'Cancel Run',
        question: 'Cancel this run?',
        detail: `“${run.title}” stops where it is. You can run it again later.`,
        confirm: 'Cancel Run',
        danger: true,
        run: async () => {
          await ctx.call('ci.cancel', projectId, runId);
          ctx.effect({ toast: 'Cancelling the run' });
          loaded.refresh();
        },
      }),
    section('Jobs', [run.jobs.length ? card([jobs.earlier, ...jobs.rows.map((job) => jobCard(ctx, projectId, runId, job, now)), jobs.more]) : dim(live ? 'Waiting for a runner to pick it up...' : 'This run has no jobs.')], run.jobs.length),
    section('Details', [
      prop(ctx, `run:${runId}:workflow`, 'Workflow', `${run.workflow}${run.path ? ` · ${fileName(run.path)}` : ''} #${run.number}${run.attempt > 1 ? ` · attempt ${run.attempt}` : ''}`),
      prop(ctx, `run:${runId}:started-by`, 'Started by', `${eventWords(run.event)}${run.actor ? ` · ${run.actor}` : ''}`),
      run.branch ? prop(ctx, `run:${runId}:branch`, 'Branch', run.branch) : undefined,
      run.prs[0] !== undefined ? webLink(`${repo.url}/pull/${run.prs[0]}`, `Pull request #${run.prs[0]}`) : undefined,
      run.sha ? webLink(`${repo.url}/commit/${run.sha}`, `Commit ${shortSha(run.sha)}`) : undefined,
      prop(ctx, `run:${runId}:started`, 'Started', ago(run.startedAt, now)),
      webLink(run.url, `${repoSlug(repo)} #${run.number}`),
    ]),
    row([
      ctx.draw.button(`run:${runId}:refresh`, loaded.loading ? 'Asking GitHub...' : 'Ask GitHub Again', loaded.refresh, { plain: true, hotkey: 'e', dim: true }),
      !live && ctx.draw.button(`run:${runId}:more`, 'More', () => ctx.go({ name: 'run-more', params: { project: projectId, run: String(runId) } }), { plain: true, hotkey: MORE_KEY, dim: true }),
    ], { gap: 2 }),
  );
}

/** What else to do with a run that's over. */
export function runMorePage(ctx: Ctx, projectId: string, runId: number): Node {
  const key = `run:${projectId}#${runId}`;
  const loaded = readRun(ctx, key, projectId, runId);
  const run = loaded.value?.run;
  if (!run) return subPage(ctx, 'actions', 'Run', readingWords(ctx, key, loaded, 'Asking GitHub for the run...', 'Couldn’t read the run'));
  return subPage(
    ctx,
    'actions',
    'Run',
    title(run.title),
    ctx.draw.button(`run:${runId}:rerun-all`, 'Re-run All Jobs', async () => {
      await ctx.call('ci.rerun', projectId, runId);
      ctx.effect({ toast: 'Running it again' });
      ctx.nav.back(ctx.pane);
    }, { plain: true }),
    ctx.draw.button(`run:${runId}:copy`, 'Copy Link', () => ctx.effect({ copy: run.url, toast: 'Copied the link to the run' }), { plain: true }),
  );
}

/** The end of a failed job's log, where it failed. */
export function logPage(ctx: Ctx, projectId: string, jobId: number): Node {
  const key = `log:${projectId}#${jobId}`;
  const loaded = fromGitHub(ctx, key, 5 * 60_000, () => ctx.call('ci.log', projectId, jobId) as Promise<string>);
  return subPage(ctx, 'actions', 'Run', title('Where It Failed'), readingWords(ctx, key, loaded, 'Reading the log...', 'Couldn’t read the log'), loaded.value !== undefined && (loaded.value ? code(loaded.value) : dim('The log is empty.')));
}
