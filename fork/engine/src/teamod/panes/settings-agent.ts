import { isRunning } from '../../core/store.js';
import { ASSISTANT_TITLE, isAssistant } from '../../shared/assistant.js';
import { AUTO_COMPACT_MAX, AUTO_COMPACT_MIN } from '../../shared/context-usage.js';
import { CHAT_LIMIT_NONE, CHAT_LIMIT_PRESETS } from '../../shared/chat-limit.js';
import { type RuntimeChoice, type RuntimeState } from '../../shared/agent-runtimes.js';
import { PARALLEL_RUNS_MAX, PARALLEL_RUNS_MIN } from '../../shared/run-slots.js';
import { decodeFailure } from '../../shared/run-failure.js';
import { EFFORTS, type Effort } from '../../shared/settings-schema.js';
import { globalShellId, globalShellNumber, isGlobalShell } from '../../shared/terminal-keys.js';
import { agentChoices, agentForChoice, choiceForAgent } from '../../ui/agent-choice.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, row, span, text, title } from '../tree.js';
import { back, card, chrome, empty, findWorkspace, page, pill } from './common.js';
import { SETTINGS_PLACES, choice, group, numberOptions, setPrefs, toggle } from './settings-common.js';
import { plural, twoPress } from './work-common.js';

/** Settings › Agent: who your agent is, how it works, whether each agent here is ready, and the pull request instructions. */

const CLAUDE = 'claude';
/** Codex's own install, in a terminal; or its app. */
const CODEX_NPM = 'npm i -g @openai/codex';
const CODEX_DOWNLOAD = 'https://developers.openai.com/codex';

const EFFORT_LABELS: Readonly<Record<Effort, string>> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' };

const STATE_WORDS: Readonly<Record<RuntimeState, string>> = { ready: 'Ready', signed_out: 'Not signed in', missing: 'Not installed', no_endpoint: 'No endpoint' };

/** What each agent is, or what's missing. */
const DETAIL: Readonly<Record<string, Partial<Record<RuntimeState, string>> & { readonly ready: string }>> = {
  claude: { ready: 'Through Claude Code.', signed_out: 'Sign in once with your account or an API key.', missing: 'Sign in once with your account or an API key.' },
  codex: { ready: 'Through the Codex app or its command line.', signed_out: 'Installed. Sign in once with your account or an API key.', missing: 'Install the Codex app, or in a terminal:' },
  local: { ready: 'A model of your own: Ollama on this computer, or an endpoint you added. Free.', no_endpoint: 'Ollama on this computer, or any endpoint you add. Free, on your own models.' },
};

const stateOf = (r: RuntimeChoice, checked: boolean): RuntimeState | undefined => r.state ?? (r.available ? 'ready' : checked ? (r.id === 'local' ? 'no_endpoint' : 'missing') : undefined);

/** Your agents: each one with where it stands on this computer, and its one fix. */
function agentsSection(ctx: Ctx, mine: string): Node {
  const check = ctx.load('agents:checked', () => ctx.call('workbench.checkAgents'), { ttlMs: 60_000 });
  const checked = !check.loading;
  return group('Your agents', [
    ...ctx.state.runtimes.map((r) => {
      const state = stateOf(r, checked);
      const detail = (state && DETAIL[r.id]?.[state]) ?? (state === 'ready' || !state ? (DETAIL[r.id]?.ready ?? '') : (r.fix ?? r.why ?? ''));
      const fixes = state === 'signed_out' ? (r.id === 'local' ? 'set_up' : 'sign_in') : state === 'no_endpoint' ? 'set_up' : state === 'missing' ? (r.id === 'local' ? 'set_up' : r.id === CLAUDE ? 'sign_in' : r.id === 'codex' ? 'install' : undefined) : undefined;
      return col([
        row(
          [
            line(span(r.label, { weight: 'bold' }), span('  '), state ? pill(STATE_WORDS[state], state === 'ready' ? 'ok' : 'warn') : pill('Checking...', 'quiet', '○'), r.id === mine && state === 'ready' ? span('  · yours', { dim: true }) : undefined),
            fixes === 'sign_in'
              ? ctx.draw.button(`agents:${r.id}:sign-in`, 'Sign In', async () => {
                  await ctx.call('workbench.agentSignIn', r.id);
                  ctx.refresh('agents:checked');
                }, { plain: true })
              : undefined,
            fixes === 'install' ? ctx.draw.button(`agents:${r.id}:install`, 'Copy the Command', () => ctx.effect({ copy: CODEX_NPM, toast: `Copied: ${CODEX_NPM}` }), { plain: true }) : undefined,
            fixes === 'set_up' ? ctx.draw.button(`agents:${r.id}:set-up`, 'Set Up', () => ctx.go({ name: 'models' }), { plain: true }) : undefined,
          ],
          { justify: 'space-between' },
        ),
        detail ? (fixes === 'install' ? line(span(`${detail} `, { dim: true }), span(CODEX_NPM)) : dim(detail)) : undefined,
        fixes === 'install' ? { k: 'link', href: CODEX_DOWNLOAD, text: 'The Codex app' } : undefined,
      ]);
    }),
    row([check.loading ? dim('Checking...') : ctx.draw.button('agents:check', 'Check Again', () => ctx.refresh('agents:checked'), { plain: true, dim: true, hotkey: 'c' }), signInStuck(ctx)], { gap: 3 }),
    check.error ? text(`Couldn’t check: ${check.error}`, { color: 'error' }) : undefined,
  ]);
}

/** Conversations stopped because Claude Code isn't signed in: signing in here lets each go on where it left off. */
function stuckChannels(ctx: Ctx): readonly string[] {
  const latest = new Map<string, boolean>();
  for (const item of ctx.state.log) {
    if (item.type !== 'agent' || item.owner !== ctx.state.selfId) continue;
    if (isRunning(item.status)) {
      latest.set(item.channel, false);
      continue;
    }
    const failure = item.status === 'error' ? decodeFailure(item.text) : undefined;
    latest.set(item.channel, failure?.kind === 'signed_out' && (failure.runtime ?? CLAUDE) === CLAUDE);
  }
  return [...latest].filter(([, stuck]) => stuck).map(([channel]) => channel);
}

function signInStuck(ctx: Ctx): Node | undefined {
  const stuck = stuckChannels(ctx);
  if (!stuck.length) return undefined;
  return ctx.draw.button('agents:stuck', `Sign In and Go On (${stuck.length})`, () => ctx.go({ name: 'sign-in' }), { plain: true, spans: [span(`Sign In and Go On (${stuck.length})`, { color: 'warning' })] });
}

const nameOfChannel = (ctx: Ctx, channel: string): string => {
  if (isAssistant(channel)) return ASSISTANT_TITLE;
  const ws = channel.startsWith('ws:') ? findWorkspace(ctx.state, channel.slice(3)) : undefined;
  return ws?.name ?? channel;
};

/** The conversation that stopped goes on once the sign-in ends well; it runs in a shell of its own. */
export function signInPage(ctx: Ctx): Node {
  const stuck = stuckChannels(ctx);
  const nextShell = (): string => globalShellId(Math.max(0, ...Object.keys(ctx.state.terminals).filter(isGlobalShell).map(globalShellNumber)) + 1);
  const [problem, setProblem] = ctx.local<string | undefined>('sign-in:problem', undefined);
  // It answers when the sign-in ends, in your browser and a shell: the press is done long before.
  const go = (channel: string, how: 'claudeai' | 'console') => (): void => {
    setProblem(undefined);
    void ctx.call('workbench.signInClaude', nextShell(), channel, how).catch((err: unknown) => setProblem(err instanceof Error ? err.message : String(err)));
  };
  return page(
    chrome(ctx, SETTINGS_PLACES, 'agent'),
    back(ctx, 'Agent'),
    title('Sign In and Go On'),
    stuck.length === 0 && empty('Nothing is waiting for a sign-in now.'),
    stuck.length > 0 && dim('It runs the sign-in in one of your shells, then the agent goes on where it left off.'),
    ...stuck.map((channel, i) =>
      card(
        [
          line(pill('Stopped: not signed in', 'warn')),
          row([
            ctx.draw.button(`sign-in:${channel}:claudeai`, 'Claude Account with Subscription', go(channel, 'claudeai'), { plain: i > 0, ...(i === 0 ? { primary: true } : {}) }),
            ctx.draw.button(`sign-in:${channel}:console`, 'Anthropic Console Account', go(channel, 'console'), { plain: true }),
          ], { top: 1, gap: 2 }),
        ],
        { title: nameOfChannel(ctx, channel), tone: 'warn' },
      ),
    ),
    problem ? text(problem, { color: 'error' }) : undefined,
  );
}

/** What to look at: the agent you chose (Claude's model is the model setting; another runtime's comes with the agent). */
const myRuntime = (ctx: Ctx): string => ctx.state.prefs.defaultAgent?.runtime ?? CLAUDE;
const myModel = (ctx: Ctx): string => {
  const { defaultAgent, model } = ctx.state.prefs;
  return defaultAgent && defaultAgent.runtime !== CLAUDE ? (defaultAgent.model ?? '') : (defaultAgent?.model ?? model ?? '');
};

/** Your agent: one pick of runtime and model, for every conversation that picked none of its own and for @you. */
function yourAgent(ctx: Ctx): Node {
  const runtime = myRuntime(ctx);
  const model = myModel(ctx);
  const choices = agentChoices(ctx.state.runtimes, ctx.state.models);
  const offered = choices.filter((c) => !c.disabled).map((c) => ({ value: c.value, label: c.label }));
  const value = choiceForAgent({ runtime, label: '', ...(model ? { model } : {}) });
  const options = offered.some((o) => o.value === value) ? offered : [{ value, label: model || runtime }, ...offered];
  const models = runtime === CLAUDE ? ctx.state.models : (ctx.state.runtimes.find((r) => r.id === runtime)?.models ?? []);
  const takes = new Set<string>(models.find((m) => m.value === model)?.efforts ?? EFFORTS);
  const effort = ctx.state.prefs.effort;
  return group('Your agent', [
    choice(
      ctx,
      'agent:mine',
      'Your agent',
      value,
      options,
      async (next) => {
        const ref = agentForChoice(next, ctx.state.runtimes);
        if (ref.runtime === CLAUDE) {
          await setPrefs(ctx, { defaultAgent: null });
          await ctx.call('workbench.setModel', undefined, ref.model ?? '');
        } else await setPrefs(ctx, { defaultAgent: ref });
      },
      'Runs every new conversation and answers when friends write @you. A conversation can pick another in its own box; a project, under its More.',
    ),
    choices.some((c) => c.disabled && !c.model) && col(choices.filter((c) => c.disabled && !c.model).map((c) => line(span(c.label, { dim: true, weight: 'bold' }), span(`  ${c.why ?? 'not set up here'}`, { dim: true })))),
    choice(
      ctx,
      'agent:effort',
      'Thinking effort',
      effort ?? '',
      [{ value: '', label: 'Auto: your agent decides, case by case' }, ...EFFORTS.filter((e) => takes.has(e) || e === effort).map((e) => ({ value: e, label: EFFORT_LABELS[e] }))],
      (next) => setPrefs(ctx, { effort: (next || null) as Effort | null }),
      takes.size < EFFORTS.length ? 'Only the levels this model takes.' : undefined,
    ),
  ]);
}

/** How your agent works in the chat: sub-agents, its context, how many at once, its scratch folder. */
function working(ctx: Ctx): Node {
  const p = ctx.state.prefs;
  const compactSteps = [AUTO_COMPACT_MIN, 75, 80, 85, 90, AUTO_COMPACT_MAX];
  return group('In the chat', [
    choice(ctx, 'pref:subagents', 'Sub-agents', p.subagents, [{ value: 'full', label: 'Every step' }, { value: 'compact', label: 'One line each' }, { value: 'hidden', label: 'Just a count' }], (next) => setPrefs(ctx, { subagents: next as typeof p.subagents })),
    toggle(ctx, 'pref:contextMeter', 'Context meter', p.contextMeter, (next) => setPrefs(ctx, { contextMeter: next }), 'How full each conversation is, beside the box you type in.'),
    toggle(ctx, 'pref:autoCompact', 'Auto-compact when the context is nearly full', p.autoCompact, (next) => setPrefs(ctx, { autoCompact: next }), p.autoCompact ? 'Between turns, your agent summarizes what it’s keeping and carries on. Nothing leaves the chat.' : 'Your agent still compacts on its own right at the limit, so a run never breaks.'),
    p.autoCompact && choice(ctx, 'pref:autoCompactAt', 'Compact at', String(p.autoCompactAt), numberOptions(compactSteps, p.autoCompactAt, (n) => `${n}% full`), (next) => setPrefs(ctx, { autoCompactAt: Number(next) })),
    choice(
      ctx,
      'pref:parallelRuns',
      'Conversations your agent works in at once',
      String(p.parallelRuns),
      numberOptions([PARALLEL_RUNS_MIN, 2, 3, 5, 8, 10, 15, 20, PARALLEL_RUNS_MAX], p.parallelRuns),
      (next) => setPrefs(ctx, { parallelRuns: Number(next) }),
      `Up to ${p.parallelRuns} at the same time. Past that, a message waits its turn and says so.`,
    ),
    choice(
      ctx,
      'pref:chatLimit',
      'Chats kept at once',
      String(p.chatLimit),
      [...numberOptions(CHAT_LIMIT_PRESETS.filter((n) => n !== CHAT_LIMIT_NONE), p.chatLimit === CHAT_LIMIT_NONE ? CHAT_LIMIT_PRESETS[0] : p.chatLimit, (n) => `${n} chats`), { value: String(CHAT_LIMIT_NONE), label: 'No limit' }],
      (next) => setPrefs(ctx, { chatLimit: Number(next) }),
      p.chatLimit === CHAT_LIMIT_NONE ? 'Your Mac and Sentinel keep as many chats as you start.' : `Your Mac and Sentinel each keep up to ${p.chatLimit}. Past that, delete one or raise this.`,
    ),
    toggle(ctx, 'pref:scratchFolder', 'Give your agent a scratch folder', p.scratchFolder, (next) => setPrefs(ctx, { scratchFolder: next }), 'Screenshots, JSON, logs and notes it makes while it works go to the worktree’s .teamod/scratch/ folder, kept out of git.'),
  ]);
}

/** Pull request instructions and templates. */
function prAndTemplates(ctx: Ctx): Node {
  const custom = ctx.state.prCustom;
  return group('Pull requests and templates', [
    col([
      row(
        [
          line(span('Pull request instructions  ', { dim: true }), custom ? pill('Customized', 'accent') : span('Built-in')),
          row([ctx.draw.button('pr:edit', 'Edit', () => ctx.call('workbench.editPrPrompt'), { plain: true, hotkey: 'd' }), custom && twoPress(ctx, 'pr:reset', 'Reset', () => ctx.call('workbench.resetPrPrompt'))], { gap: 2 }),
        ],
        { justify: 'space-between' },
      ),
      custom ? undefined : dim('Edit opens them in your editor. The next pull request uses what you save.'),
    ]),
    row(
      [line(span('Templates  ', { dim: true }), plural(ctx.state.templates.length, 'way to start a task', 'ways to start a task')), ctx.draw.button('templates', 'Manage', () => ctx.show('work', { name: 'templates' }), { plain: true, hotkey: 'z' })],
      { justify: 'space-between' },
    ),
  ]);
}

export function agentPane(ctx: Ctx): Node {
  return page(chrome(ctx, SETTINGS_PLACES, 'agent'), back(ctx), yourAgent(ctx), agentsSection(ctx, myRuntime(ctx)), working(ctx), prAndTemplates(ctx));
}
