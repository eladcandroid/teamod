import type { CcAgent, CcOutputFile, CcOutputs, CcSession, CcSteps, CcTask, CcTaskOutput } from '../../core/claude-code/model.js';
import type { StepRecord } from '../../shared/steps.js';
import type { Workspace } from '../../workspaces/types.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, code, col, dim, line, span, text } from '../tree.js';
import { type Tone, ago, card, empty, meta, pill, section } from './common.js';

const REFRESH_MS = 2000;

/** A sub-agent's or a background command's state, in a word and a color. */
const STATE: Readonly<Record<string, { readonly label: string; readonly tone: Tone; readonly icon: string }>> = {
  running: { label: 'Running', tone: 'accent', icon: '●' },
  finished: { label: 'Done', tone: 'ok', icon: '✓' },
  failed: { label: 'Failed', tone: 'error', icon: '✗' },
  stopped: { label: 'Stopped', tone: 'quiet', icon: '■' },
  idle: { label: 'Idle', tone: 'quiet', icon: '○' },
};
const statePill = (status: string): Span => {
  const s = STATE[status] ?? { label: status, tone: 'quiet' as const, icon: '●' };
  return pill(s.label, s.tone, s.icon);
};

const mark = (status: string): Span =>
  status === 'running' ? span('… ', { color: 'claude' }) : status === 'failed' || status === 'stopped' ? span('✗ ', { color: 'error' }) : span('· ', { dim: true });

const sessionOf = (ctx: Ctx, ws: Workspace): CcSession | undefined => ctx.state.claudeCode.sessions.find((s) => s.workspaceId === ws.id);

/** Up to this many sub-agents are cards; more are rows. */
const CARDS = 10;

/** Sub-agents and background work of this worktree's conversation, live, from Claude Code's own files. */
export function agentsPage(ctx: Ctx, ws: Workspace): Node {
  const session = sessionOf(ctx, ws);
  const agents = session?.agents ?? [];
  const tasks = session?.tasks ?? [];
  if (!session || (!agents.length && !tasks.length)) return empty('No sub-agents or background work here yet.');
  const open = (agent: CcAgent) => () => ctx.go({ name: 'cc-agent', params: { id: ws.id, session: session.id, agent: agent.id } });
  const agentCard = (agent: CcAgent): Node =>
    card(
      [
        ctx.draw.button(`cc-agent:${agent.id}`, agent.description, open(agent), { plain: true, spans: [span(agent.description, { weight: 'bold' })] }),
        meta(statePill(agent.status), agent.type, ago(agent.lastAt)),
        agent.step ? dim(agent.step) : undefined,
      ],
      agent.status === 'failed' ? { tone: 'error' } : {},
    );
  const agentRow = (agent: CcAgent): Node =>
    ctx.draw.button(`cc-agent:${agent.id}`, agent.description, open(agent), {
      plain: true,
      spans: [mark(agent.status), span(agent.description), span(`  ${agent.type} · ${ago(agent.lastAt)}`, { dim: true }), agent.step ? span(`  ${agent.step}`, { dim: true }) : span('')],
    });
  const taskRow = (task: CcTask): Node =>
    ctx.draw.button(`cc-task:${task.id}`, task.description, () => ctx.go({ name: 'cc-task', params: { id: ws.id, session: session.id, task: task.id, ...(task.agentId ? { agent: task.agentId } : {}) } }), {
      plain: true,
      spans: [mark(task.status), span(task.description), span(`  ${task.kind === 'monitor' ? 'watch' : 'command'}`, { dim: true })],
    });
  const shown = agents.slice(0, 100);
  return col([
    agents.length > 0 && section('Sub-agents', shown.length <= CARDS ? shown.map(agentCard) : shown.map(agentRow), agents.length),
    tasks.length > 0 && section('Background', tasks.slice(0, 100).map(taskRow), tasks.length),
  ]);
}

/** One sub-agent's transcript and what it made. */
export function agentPage(ctx: Ctx, ws: Workspace, sessionId: string, agentId: string): Node {
  const session = ctx.state.claudeCode.sessions.find((s) => s.id === sessionId);
  const agent = session?.agents.find((a) => a.id === agentId);
  // One that finished a while ago is found again and followed.
  if (!agent) ctx.load(`cc:${agentId}:find`, () => ctx.call('claudeCode.findAgent', agentId));
  const steps = ctx.load(`cc:${sessionId}:${agentId}:steps`, async () => (await ctx.call('claudeCode.steps', sessionId, agentId, { limit: 100 })) as CcSteps, { ttlMs: REFRESH_MS });
  const outputs = ctx.load(`cc:${sessionId}:${agentId}:outputs`, async () => (await ctx.call('claudeCode.outputs', sessionId, agentId)) as CcOutputs, { ttlMs: 5000 });
  const made = outputs.value?.outputs ?? [];
  const transcript = steps.value?.steps ?? [];
  return col([
    card(
      [
        agent ? meta(statePill(agent.status), agent.type, ago(agent.lastAt)) : undefined,
        agent?.step ? dim(agent.step) : undefined,
        steps.value?.missing ? dim('Its transcript isn’t being watched any more.') : undefined,
      ],
      { title: agent?.description ?? 'Sub-agent', ...(agent?.status === 'failed' ? { tone: 'error' as const } : {}) },
    ),
    transcript.length > 0 &&
      section(
        'Steps',
        transcript.map((step) => {
          const words = step.text.split('\n')[0]?.slice(0, 200) || step.tool || 'A step';
          const prefix = span(step.status === 'running' ? '… ' : step.status === 'error' ? '✗ ' : '· ', step.status === 'error' ? { color: 'error' } : step.status === 'running' ? { color: 'claude' } : { dim: true });
          return step.detail
            ? ctx.draw.button(`cc-step:${step.seq}`, words, () => ctx.go({ name: 'cc-step', params: { id: ws.id, session: sessionId, agent: agentId, seq: String(step.seq) } }), { plain: true, spans: [prefix, span(words)] })
            : line(prefix, span(words, step.kind === 'tool' ? {} : { dim: true }));
        }),
        transcript.length,
      ),
    made.length > 0 &&
      section(
        'It made or looked at',
        made.slice(0, 50).map((output) =>
          ctx.draw.button(`cc-output:${output.path}`, output.path, () => ctx.go({ name: 'cc-output', params: { id: ws.id, session: sessionId, agent: agentId, path: output.path } }), {
            plain: true,
            spans: [span(output.path.split('/').slice(-2).join('/')), span(`  ${output.how}`, { dim: true })],
          }),
        ),
        made.length,
      ),
  ]);
}

export function agentStepPage(ctx: Ctx, sessionId: string, agentId: string, seq: number): Node {
  const step = ctx.load(`cc:${sessionId}:${agentId}:step:${seq}`, async () => (await ctx.call('claudeCode.step', sessionId, agentId, seq)) as StepRecord | undefined);
  const record = step.value;
  if (!record) return dim(step.loading ? 'Loading...' : 'That step isn’t kept any more.');
  const input = record.input ? (typeof record.input.command === 'string' ? record.input.command : JSON.stringify(record.input, null, 2)) : undefined;
  return col([
    card([record.text ? text(record.text) : undefined, record.isError && text('It failed.', { color: 'error' })], { title: record.label ?? record.title, ...(record.isError ? { tone: 'error' as const } : {}) }),
    input ? section('Input', [code(input)]) : undefined,
    record.output ? section('Output', [code(record.output)]) : undefined,
  ]);
}

/** One thing a sub-agent made: a file it wrote or looked at, secrets redacted by the engine. */
export function agentOutputPage(ctx: Ctx, sessionId: string, agentId: string, file: string): Node {
  const output = ctx.load(`cc:${sessionId}:${agentId}:output:${file}`, async () => (await ctx.call('claudeCode.output', sessionId, agentId, file)) as CcOutputFile | undefined);
  const content = output.value;
  if (output.error) return text(output.error, { color: 'error' });
  if (!content) return dim(output.loading ? 'Loading...' : 'It’s gone from disk.');
  const png = content.kind === 'image' && content.mime === 'image/png' ? content.data : undefined;
  return col(
    [
      line(span(file.split('/').slice(-2).join('/'), { weight: 'bold' })),
      png && ctx.surface === 'terminal' ? { k: 'image' as const, key: `cc-img:${file}`, png, columns: Math.min(120, Math.max(10, ctx.columns - 2)), rows: Math.min(40, Math.max(6, ctx.rows - 8)), alt: file } : undefined,
      content.text !== undefined ? code(content.text, { path: file }) : undefined,
      content.truncated && dim('Cut to fit.'),
      content.text === undefined && !png ? dim(`A ${content.kind} file.`) : undefined,
    ],
    { gap: 1 },
  );
}

/** The end of a background command's output, live. */
export function agentTaskPage(ctx: Ctx, sessionId: string, agentId: string | undefined, taskId: string): Node {
  const task = ctx.state.claudeCode.sessions.find((s) => s.id === sessionId)?.tasks?.find((t) => t.id === taskId);
  const output = ctx.load(`cc:${sessionId}:task:${taskId}`, async () => (await ctx.call('claudeCode.taskOutput', sessionId, agentId, taskId)) as CcTaskOutput | undefined, { ttlMs: REFRESH_MS });
  return col(
    [
      card(
        [
          task ? meta(statePill(task.status), task.kind === 'monitor' ? 'watch' : 'command') : undefined,
          task && line(span(`$ ${task.command}`, { dim: true })),
          task?.summary ? dim(task.summary) : undefined,
        ],
        { title: task?.description ?? 'Background work', ...(task?.status === 'failed' ? { tone: 'error' as const } : {}) },
      ),
      output.value ? code(output.value.text) : dim(output.loading ? 'Loading...' : 'No output yet.'),
      output.value?.truncated && dim('Only the end of it.'),
    ],
    { gap: 1 },
  );
}
