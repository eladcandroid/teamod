import { DEFAULT_KEEP_CHATS, KEEP_CHATS_INFO, STEP_INFO, type MetricSeries, type RunDetail, type RunSummary, type Sentinel, type StepRun, firstLine, isLive } from '../../core/sentinel/model.js';
import { formatMetric } from '../../core/sentinel/metrics.js';
import type { Ctx } from '../screens.js';
import { type Node, code, col, dim, line, md, row, span, text, title } from '../tree.js';
import { back, empty, openWorkspace, page, peerText } from './common.js';
import { askRoute } from './sentinel-asks.js';
import { attention, loadNote, openChannel, openSentinel, top, webLink, windowed } from './sentinel-common.js';
import { STEP_STATE_WORDS, durationText, hasOwnChat, headlineOf, isRunning, runLine, runStyle, runWord, stepStyle } from './sentinel-model.js';

/** One run: its line, each step with how it went (its output a press away), its report, what it kept and left; a merge waiting has its decision on top. */

const runKey = (runId: string, going: boolean): string => `sentinel:run:${runId}:${going ? 'live' : 'ended'}`;

/** A run as far as it's known: the state is newer than what was read (a step just ended), so its states and line win. */
function runOf(detail: RunDetail | undefined, summary: RunSummary | undefined): (RunSummary & { readonly steps: readonly StepRun[] }) | undefined {
  if (!summary) return detail?.run;
  if (!detail) return summary;
  return { ...detail.run, ...summary, steps: detail.run.steps.map((st) => ({ ...st, ...summary.steps.find((x) => x.id === st.id) })) };
}

function loadRun(ctx: Ctx, runId: string) {
  const s = ctx.state.sentinel;
  const summary = s.runs.find((r) => r.id === runId);
  const going = summary ? isLive(summary.state) : false;
  // Read again as it goes; once more when it ends, then that's what it is.
  const loaded = ctx.load<RunDetail | undefined>(runKey(runId, going), async () => (await ctx.call('sentinel.runGet', runId)) as RunDetail | undefined, going ? { ttlMs: 2000 } : {});
  return { loaded, summary, run: runOf(loaded.value, summary) };
}

function stepRow(ctx: Ctx, run: RunSummary, st: StepRun, index: number, item: Sentinel | undefined, now: number, gone: string | undefined): Node {
  const step = item?.steps.find((x) => x.id === st.id);
  const took = st.startedAt !== undefined ? `  ${durationText((st.endedAt ?? now) - st.startedAt)}${st.state === 'running' ? ' so far' : ''}` : '';
  const [shown, setShown] = ctx.local(`sn:run:${run.id}:output:${st.id}`, false);
  const own = st.channel !== undefined && st.channel !== (run.worktreeId ? `ws:${run.worktreeId}` : undefined);
  return col([
    line(span(`${STEP_STATE_WORDS[st.state]}  `, stepStyle(st.state)), span(step?.name ?? `Step ${index + 1}`), span(`${step ? `  ${STEP_INFO[step.kind].label}` : ''}${took}`, { dim: true })),
    st.why ? text(st.why, st.state === 'failed' ? { color: 'error' } : { dim: true }) : undefined,
    st.state === 'waiting' && dim('Waiting for the steps before it'),
    st.channel && own && gone ? dim(gone) : undefined,
    st.channel && !(own && gone) ? ctx.draw.button(`run:session:${st.id}`, st.state === 'running' ? 'Watch the Agent Work' : 'The Agent’s Session', () => openChannel(ctx, st.channel!), { plain: true, dim: true }) : undefined,
    st.output ? ctx.draw.button(`run:output:${st.id}`, shown ? 'Hide Output' : 'Show Output', () => setShown(!shown), { plain: true, dim: true }) : undefined,
    shown && st.output ? code(st.output) : undefined,
  ]);
}

/** What this run kept: each number its sentinel holds a point of, each table it filled. */
function keptBy(ctx: Ctx, run: RunSummary): Node | undefined {
  const all = Object.values(ctx.state.sentinel.metrics?.[run.sentinelId] ?? {});
  const kept = all.flatMap((m) => {
    const point = m.points.find((p) => p.runId === run.id);
    return point || m.rowsRunId === run.id ? [{ m, value: point?.value }] : [];
  });
  if (!kept.length) return undefined;
  const open = (m: MetricSeries): void => ctx.go(m.kind === 'rows' ? { name: 'rows', params: { id: run.sentinelId, name: m.name, run: run.id } } : { name: 'metric', params: { id: run.sentinelId, name: m.name } });
  const shown = windowed(ctx, `run:kept:${run.id}`, kept, { page: 20 });
  return col([
    title('What it kept'),
    shown.before,
    ...shown.shown.map(({ m, value }) =>
      ctx.draw.button(`run:kept:${m.name}`, m.label, () => open(m), {
        plain: true,
        spans: [span(m.label), span(m.kind === 'rows' ? `  ${value ?? m.rows?.length ?? 0} rows` : m.kind === 'series' ? `  ${value ?? m.series?.length ?? 0} points` : m.kind === 'output' ? '  its output' : value !== undefined ? `  ${formatMetric(value, m.unit)}` : '', { dim: true })],
      }),
    ),
    shown.after,
  ]);
}

/** What it left: a pull request, a worktree, tasks. */
function leftBy(ctx: Ctx, run: RunSummary): Node | undefined {
  if (!run.pr && !run.worktreeId && !run.tasks.length) return undefined;
  const issues = ctx.state.board.issues;
  const tasks = windowed(ctx, `run:tasks:${run.id}`, [...new Set(run.tasks)], { page: 20 });
  return col([
    title('What it left'),
    run.pr ? webLink(run.pr.url, `Pull request #${run.pr.number}`) : undefined,
    run.worktreeId ? ctx.draw.button('run:worktree', 'Its Worktree', () => openWorkspace(ctx, run.worktreeId!), { plain: true }) : undefined,
    tasks.before,
    ...tasks.shown.map((key) => {
      const issue = issues.find((i) => i.key === key);
      return issue ? ctx.draw.button(`run:task:${key}`, `${key} ${issue.title}`, () => ctx.show('board', { name: 'task', params: { id: issue.id } }), { plain: true }) : dim(key);
    }),
    tasks.after,
  ]);
}

export function runPage(ctx: Ctx, runId: string): Node {
  const s = ctx.state.sentinel;
  const { loaded, run } = loadRun(ctx, runId);
  if (!run) return page(top(ctx, 'sentinels'), back(ctx), loadNote(loaded, 'Reading the run...') ?? empty('This run isn’t here anymore.'));
  const now = Date.now();
  const item = s.items.find((x) => x.id === run.sentinelId);
  const name = item?.name ?? loaded.value?.sentinel?.name;
  const waiting = run.state === 'needs-you';
  const why = run.steps.find((x) => x.why && x.state === 'running')?.why;
  // Put away as its sentinel keeps chats: the report and outputs stay, the chat doesn't.
  const gone = run.chatDeleted ? 'You deleted its chat. The report and outputs stay here.' : run.putAway ? `Its chat was put away: ${item ? `${item.name} ${KEEP_CHATS_INFO[item.keepChats ?? DEFAULT_KEEP_CHATS].keeps}` : 'its sentinel keeps fewer chats'}. The report and outputs stay here.` : undefined;
  const report = loaded.value?.report;
  const working = run.steps.find((st) => st.channel && st.state === 'running')?.channel;
  return page(
    top(ctx, 'sentinels'),
    back(ctx),
    col([title(headlineOf(run)), dim(runLine(run, name, s, now)), line(span(runWord(run.state), runStyle(run.state)))]),
    waiting &&
      col([
        line(span(run.pr ? `Pull request #${run.pr.number} waits for you. ` : 'This run waits for you. ', { weight: 'semibold' }), span(why ?? 'Merge it, or leave it open for now.')),
        row([
          ctx.draw.button('run:merge', 'Merge', async () => {
            await ctx.call('sentinel.decide', run.id, 'merge');
            ctx.effect({ toast: run.pr ? `Merged #${run.pr.number}` : 'Merged' });
          }, { primary: true, hotkey: 'e' }),
          ctx.draw.button('run:skip', 'Not Now', async () => {
            await ctx.call('sentinel.decide', run.id, 'skip');
            ctx.effect({ toast: run.pr ? `#${run.pr.number} stays open` : 'Not now' });
          }, { hotkey: 'n' }),
        ]),
      ]),
    run.state === 'failed' && run.why ? text(firstLine(run.why, 400), { color: 'error' }) : undefined,
    (run.state === 'stopped' || run.state === 'skipped') && run.why ? dim(firstLine(run.why, 400)) : undefined,
    attention(ctx, working),
    row([
      isRunning(run.state) &&
        ctx.draw.button('run:stop', 'Stop', async () => {
          await ctx.call('sentinel.stop', run.id);
          ctx.effect({ toast: 'Stopped' });
        }, { hotkey: 'x' }),
      item && ctx.draw.button('run:files', 'Files', () => ctx.go({ name: 'files', params: { id: item.id, run: run.id } }), { plain: true, dim: true, hotkey: 'f' }),
      ctx.draw.button('run:more', 'More', () => ctx.go({ name: 'run-more', params: { id: run.sentinelId, run: run.id } }), { plain: true, dim: true, hotkey: 'm' }),
    ]),
    col([title('Steps'), run.steps.length === 0 && dim('No steps ran.'), ...run.steps.map((st, i) => stepRow(ctx, run, st, i, item, now, gone))], { gap: 1 }),
    report ? col([title('Report'), md(peerText(report))]) : loadNote(loaded, 'Reading the report...'),
    keptBy(ctx, run),
    leftBy(ctx, run),
  );
}

/** What's advanced about a run: its chat, where it's kept, and deleting what it left. */
export function runMorePage(ctx: Ctx, runId: string): Node {
  const { loaded, run } = loadRun(ctx, runId);
  if (!run) return page(top(ctx, 'sentinels'), back(ctx), loadNote(loaded, 'Reading the run...') ?? empty('This run isn’t here anymore.'));
  const item = ctx.state.sentinel.items.find((x) => x.id === run.sentinelId);
  const ended = !isLive(run.state);
  const chat = run.putAway ? undefined : (run.channel ?? run.steps.find((x) => x.channel)?.channel);
  return page(
    top(ctx, 'sentinels'),
    back(ctx, 'Run'),
    title(headlineOf(run)),
    chat ? ctx.draw.button('more:chat', 'Open Chat', () => openChannel(ctx, chat), { plain: true, hotkey: 'e' }) : undefined,
    item ? ctx.draw.button('more:sentinel', `Open ${item.name}`, () => openSentinel(ctx, item.id), { plain: true, hotkey: 'i' }) : undefined,
    ctx.draw.button('more:reveal', 'Show in Finder', () => ctx.call('sentinel.dataReveal', run.sentinelId, run.id), { plain: true, hotkey: 'f' }),
    ended && hasOwnChat(run) ? ctx.draw.button('more:delete-chat', 'Delete Chat...', () => ctx.go(askRoute('run-chat', { id: run.sentinelId, run: run.id })), { plain: true }) : undefined,
    ended ? ctx.draw.button('more:delete-run', 'Delete Run...', () => ctx.go(askRoute('run', { id: run.sentinelId, run: run.id })), { plain: true, hotkey: 'x' }) : undefined,
    !ended && dim('A run still going isn’t deleted: stop it first.'),
  );
}
