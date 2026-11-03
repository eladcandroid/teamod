import { type McpServerRow, type McpSignIn, type McpTurned, CLAUDE_AI_CONNECTORS_URL } from '../../shared/mcp.js';
import type { ClaudeSkill } from '../../shared/skills.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, row, span, text } from '../tree.js';
import { type Tone, back, card, chrome, empty, homePath, page, pill } from './common.js';
import { SETTINGS_PLACES, counted, toggle } from './settings-common.js';
import { findField, loadingWords, segments, steady, windowed } from './work-common.js';

/** Settings › Skills and MCP: the servers your own agent gets and how each is, and the skills and commands it can use. */

type McpRuntime = 'claude' | 'codex';

const WORDS: Readonly<Record<McpRuntime, { readonly name: string; readonly app: string; readonly where: string; readonly none: string }>> = {
  claude: { name: 'Claude', app: 'Claude Code', where: 'Yours, your projects’ and your plugins’, as Claude Code has them.', none: 'None yet. Add one in Claude Code (claude mcp add) or turn on a plugin that has one.' },
  codex: { name: 'Codex', app: 'Codex', where: 'Yours and your plugins’, from Codex’s own settings (~/.codex/config.toml).', none: 'None yet. Add one in Codex (codex mcp add) or turn on a plugin that has one.' },
};

const FROM: Readonly<Record<McpServerRow['from'], (where?: string) => string>> = {
  user: () => 'Yours, in every project',
  project: (where) => (where ? `Set for ${where}` : 'Set for one project'),
  plugin: (where) => (where ? `From the ${where} plugin` : 'From a plugin'),
  'claude.ai': () => 'A claude.ai connector',
};

const STATUS: Readonly<Record<McpServerRow['status'], { readonly words: string; readonly tone: Tone; readonly icon: string }>> = {
  connected: { words: 'Connected', tone: 'ok', icon: '●' },
  'needs-auth': { words: 'Needs you to sign in', tone: 'warn', icon: '●' },
  failed: { words: 'Couldn’t connect', tone: 'error', icon: '✗' },
  pending: { words: 'Still starting', tone: 'quiet', icon: '○' },
  disabled: { words: 'Turned off', tone: 'quiet', icon: '○' },
};

/** Asking means starting its agent: a list stays good a minute. */
const FRESH_MS = 60_000;

/** The server a sign-in waits on, and the page for your browser. */
interface Waiting {
  readonly name: string;
  readonly url: string;
}

function serverRow(ctx: Ctx, server: McpServerRow, runtime: McpRuntime, key: string, waiting: Waiting | undefined, setWaiting: (next: Waiting | undefined) => void, setNote: (next: string | undefined) => void): Node {
  const status = STATUS[server.status];
  const why = server.status === 'failed' && server.error ? `: ${server.error}` : '';
  const tools = server.tools !== undefined ? `, ${server.tools} ${server.tools === 1 ? 'tool' : 'tools'}` : '';
  const signIn = async (): Promise<void> => {
    setNote(undefined);
    const started = (await ctx.call('claudeCode.mcpSignIn', server.name, runtime)) as McpSignIn;
    if ('error' in started) throw new Error(started.error);
    if ('url' in started) {
      setWaiting({ name: server.name, url: started.url });
      // It waits for your browser: the press is done, the row goes on waiting.
      void (ctx.call('claudeCode.mcpSignedIn', server.name, runtime) as Promise<boolean | undefined>)
        .then((ok) => setNote(ok ? `Signed in to ${server.label}.` : `Didn’t hear back from ${server.label}. Try again when you’re ready.`))
        .catch((err: unknown) => setNote(err instanceof Error ? err.message : String(err)))
        .finally(() => {
          setWaiting(undefined);
          ctx.refresh(key);
        });
      return;
    }
    ctx.refresh(key);
  };
  const turn = async (on: boolean): Promise<void> => {
    const done = (await ctx.call('claudeCode.mcpSetEnabled', server.name, on, runtime)) as McpTurned;
    ctx.refresh(key);
    if ('error' in done) throw new Error(done.error);
  };
  return col([
    server.canTurnOff
      ? toggle(ctx, `mcp:${server.name}:on`, server.label, server.status !== 'disabled', turn)
      : line(span(server.label, { weight: 'bold' }), span('  '), pill(status.words, status.tone, status.icon)),
    dim(`${FROM[server.from](server.where)}${tools}${why}`),
    waiting?.name === server.name
      ? col([dim('Waiting for your browser...'), { k: 'link', href: waiting.url, text: 'Open the sign-in page' }])
      : server.canSignIn
        ? ctx.draw.button(`mcp:${server.name}:sign-in`, 'Sign In', signIn, { plain: true, ...(waiting ? { dim: true } : {}) })
        : server.from === 'claude.ai' && server.status === 'needs-auth'
          ? { k: 'link', href: CLAUDE_AI_CONNECTORS_URL, text: 'Open claude.ai' }
          : undefined,
  ]);
}

function mcpSection(ctx: Ctx): Node {
  const mine: McpRuntime = ctx.state.prefs.defaultAgent?.runtime === 'codex' ? 'codex' : 'claude';
  const setUp = (['claude', 'codex'] as const).filter((id) => ctx.state.runtimes.some((r) => r.id === id && r.available));
  const tabs: readonly McpRuntime[] = setUp.length > 1 ? [mine, ...setUp.filter((id) => id !== mine)] : [mine];
  const [picked, pick] = ctx.local<McpRuntime>('mcp:runtime', mine);
  const runtime = tabs.includes(picked) ? picked : mine;
  const key = `mcp:${runtime}`;
  const loaded = steady<readonly McpServerRow[]>(ctx, key, async () => ((await ctx.call('claudeCode.mcpServers', runtime)) ?? []) as readonly McpServerRow[], { ttlMs: FRESH_MS });
  const [waiting, setWaiting] = ctx.local<Waiting | undefined>('mcp:waiting', undefined);
  const [note, setNote] = ctx.local<string | undefined>('mcp:note', undefined);
  const words = WORDS[runtime];
  const rows = loaded.value ?? [];
  const window = windowed(ctx, key, rows, { size: 30 });
  return card([
    tabs.length > 1 && segments(ctx, 'mcp:tab', tabs.map((id) => ({ value: id, label: id === mine ? `${WORDS[id].name}, yours` : WORDS[id].name })), runtime, pick),
    dim(`${words.where} Only runs you start get them, never a friend’s.`),
    loaded.loading && !loaded.value ? dim(`Asking ${words.app}...`) : undefined,
    loadingWords({ ...loaded, loading: false }, '', 'Couldn’t ask'),
    loaded.value && !rows.length ? empty(words.none) : undefined,
    note ? text(note) : undefined,
    rows.length > 0 && col(window.shown.map((server) => serverRow(ctx, server, runtime, key, waiting, setWaiting, setNote)), { gap: 1, top: 1 }),
    window.controls,
    row([ctx.draw.button('mcp:check', loaded.loading ? 'Checking...' : 'Check Again', () => ctx.refresh(key), { plain: true, dim: true, hotkey: 'c' })], { top: 1 }),
  ], { title: counted('MCP servers', rows.length) });
}

const SOURCE: Readonly<Record<ClaudeSkill['source'], string>> = { project: 'this project', user: 'yours', plugin: 'a plugin' };

/** What the / list offers in a folder: the project's own skills and commands, yours, and your plugins'. */
function skillsSection(ctx: Ctx): Node {
  const projects = ctx.state.projects.filter((p) => p.root);
  const [projectId, setProject] = ctx.local('skills:project', '');
  const project = projects.find((p) => p.id === projectId);
  const dir = project?.root ?? ctx.state.home;
  const key = `skills:${dir}`;
  const loaded = ctx.load<readonly ClaudeSkill[]>(key, async () => ((await ctx.call('claudeCode.skills', 'draft', ...(dir ? [dir] : []))) ?? []) as readonly ClaudeSkill[], { ttlMs: 30_000 });
  const find = findField(ctx, 'skills', 'Find a skill or command');
  const q = find.query.toLowerCase();
  const list = (loaded.value ?? []).filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  const window = windowed(ctx, 'skills', list, { size: 30 });
  return card([
    dim('What the / list offers in a conversation.'),
    projects.length > 0 &&
      ctx.draw.select(
        'skills:project',
        [{ value: '', label: 'Yours, everywhere' }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
        (value) => setProject(value ?? ''),
        { label: 'Where', value: project?.id ?? '' },
      ),
    dir ? dim(homePath(ctx.state, dir)) : undefined,
    loadingWords(loaded, 'Looking...', 'Couldn’t look'),
    loaded.value && (loaded.value.length > 8 || q) ? find.node : undefined,
    loaded.value && !list.length ? empty(q ? `Nothing matches “${find.query}”.` : 'None here yet.') : undefined,
    list.length > 0 &&
      col(
        window.shown.map((skill) =>
          col([
            line(span(`/${skill.name}`, { weight: 'bold' }), skill.args ? span(` ${skill.args}`, { dim: true }) : undefined, span(`  ${skill.kind === 'command' ? 'a command' : 'a skill'}, ${SOURCE[skill.source]}`, { dim: true })),
            skill.description ? dim(`  ${skill.description}`) : undefined,
            skill.onCodex ? dim(`  ${skill.onCodex}`) : undefined,
          ]),
        ),
        { top: 1 },
      ),
    window.controls,
  ], { title: counted('Skills and commands', list.length) });
}

export function toolsPane(ctx: Ctx): Node {
  return page(chrome(ctx, SETTINGS_PLACES, 'tools'), back(ctx), mcpSection(ctx), skillsSection(ctx));
}
