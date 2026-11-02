import type { CcAgent, CcOutputFile, CcOutputs, CcSession, CcSteps, CcTask, CcTaskOutput } from '../../core/claude-code/model.js';
import type { StepRecord } from '../../shared/steps.js';
import type { Workspace } from '../../workspaces/types.js';
import type { Ctx } from '../screens.js';
import { type Node, code, col, dim, line, span, text, title } from '../tree.js';
import { ago } from './common.js';

const REFRESH_MS = 2000;

const mark = (status: string): ReturnType<typeof span> =>
  status === 'running' ? span('… ', { color: 'claude' }) : status === 'failed' || status === 'stopped' ? span('! ', { color: 'error' }) : span('  ', { dim: true });

const sessionOf = (ctx: Ctx, ws: Workspace): CcSession | undefined => ctx.state.claudeCode.sessions.find((s) => s.workspaceId === ws.id);

/** Sub-agents and background work of this worktree's conversation, live, from Claude Code's own files. */
export function agentsPage(ctx: Ctx, ws: Workspace): Node {
  const session = sessionOf(ctx, ws);
  const agents = session?.agents ?? [];
  const tasks = session?.tasks ?? [];
  if (!session || (!agents.length && !tasks.length)) return dim('No sub-agents or background work here yet.');
  const row1 = (agent: CcAgent): Node =>
    ctx.draw.button(`cc-agent:${agent.id}`, agent.description, () => ctx.go({ name: 'cc-agent', params: { id: ws.id, session: session.id, agent: agent.id } }), {
      plain: true,
      spans: [mark(agent.status), span(agent.description), span(`  ${agent.type}, ${ago(agent.lastAt)}`, { dim: true }), agent.step ? span(`  ${agent.step}`, { dim: true }) : span('')],
    });
  const row2 = (task: CcTask): Node =>
    ctx.draw.button(`cc-task:${task.id}`, task.description, () => ctx.go({ name: 'cc-task', params: { id: ws.id, session: session.id, task: task.id, ...(task.agentId ? { agent: task.agentId } : {}) } }), {
      plain: true,
      spans: [mark(task.status), span(task.description), span(`  ${task.kind === 'monitor' ? 'watch' : 'command'}`, { dim: true })],
    });
  return col(
    [
      agents.length > 0 && col([dim(`Sub-agents (${agents.length})`), ...agents.slice(0, 100).map(row1)]),
      tasks.length > 0 && col([dim(`Background (${tasks.length})`), ...tasks.slice(0, 100).map(row2)]),
    ],
    { gap: 1 },
  );
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
  return col(
    [
      title(agent?.description ?? 'Sub-agent'),
      agent && dim(`${agent.type} · ${agent.status}${agent.step ? ` · ${agent.step}` : ''}`),
      steps.value?.missing ? dim('Its transcript isn’t being watched any more.') : undefined,
      ...(steps.value?.steps ?? []).map((step) => {
        const words = step.text.split('\n')[0]?.slice(0, 200) || step.tool || 'A step';
        const prefix = span(step.status === 'running' ? '… ' : step.status === 'error' ? '! ' : '  ', step.status === 'error' ? { color: 'error' } : { dim: true });
        return step.detail
          ? ctx.draw.button(`cc-step:${step.seq}`, words, () => ctx.go({ name: 'cc-step', params: { id: ws.id, session: sessionId, agent: agentId, seq: String(step.seq) } }), { plain: true, spans: [prefix, span(words)] })
          : line(prefix, span(words, step.kind === 'tool' ? {} : { dim: true }));
      }),
      made.length > 0 &&
        col([
          dim(`It made or looked at (${made.length})`),
          ...made.slice(0, 50).map((output) =>
            ctx.draw.button(`cc-output:${output.path}`, output.path, () => ctx.go({ name: 'cc-output', params: { id: ws.id, session: sessionId, agent: agentId, path: output.path } }), {
              plain: true,
              spans: [span(output.path.split('/').slice(-2).join('/')), span(`  ${output.how}`, { dim: true })],
            }),
          ),
        ]),
    ],
    { gap: 1 },
  );
}

export function agentStepPage(ctx: Ctx, sessionId: string, agentId: string, seq: number): Node {
  const step = ctx.load(`cc:${sessionId}:${agentId}:step:${seq}`, async () => (await ctx.call('claudeCode.step', sessionId, agentId, seq)) as StepRecord | undefined);
  const record = step.value;
  if (!record) return dim(step.loading ? 'Loading...' : 'That step isn’t kept any more.');
  const input = record.input ? (typeof record.input.command === 'string' ? record.input.command : JSON.stringify(record.input, null, 2)) : undefined;
  return col(
    [
      title(record.label ?? record.title),
      record.text ? text(record.text) : undefined,
      input ? col([dim('In'), code(input)]) : undefined,
      record.output ? col([dim('Out'), code(record.output)]) : undefined,
      record.isError && text('It failed.', { color: 'error' }),
    ],
    { gap: 1 },
  );
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
      title(file.split('/').slice(-2).join('/')),
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
      title(task?.description ?? 'Background work'),
      task && line(span(task.command, { dim: true })),
      task?.summary ? dim(task.summary) : undefined,
      output.value ? code(output.value.text) : dim(output.loading ? 'Loading...' : 'No output yet.'),
      output.value?.truncated && dim('Only the end of it.'),
    ],
    { gap: 1 },
  );
}
