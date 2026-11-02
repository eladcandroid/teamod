import { agentTermId, globalShellId, globalShellNumber, isGlobalShell, runId, setupId, shellId, terminalLabel } from '../../shared/terminal-keys.js';
import type { Workspace } from '../../workspaces/types.js';
import type { Ctx } from '../screens.js';
import { richNodes } from '../rich/rich.js';
import { type Node, col, dim, row, text, title } from '../tree.js';

/** How tall a terminal draws, given what the pane has. */
const TERM_ROWS_SPARE = 9;

const sizeOf = (ctx: Ctx): { cols: number; rows: number } => ({ cols: Math.max(20, ctx.columns - 1), rows: Math.max(8, ctx.rows - TERM_ROWS_SPARE) });

/** The terminals of this worktree that exist: its shell, setup, run, agent, and shells opened here. */
function keysOf(ctx: Ctx, ws: Workspace): string[] {
  const own = [shellId(ws.id), setupId(ws.id), runId(ws.id), agentTermId(ws.id)].filter((key) => key in ctx.state.terminals);
  const [extras] = ctx.local<readonly string[]>(`term:${ws.id}:extras`, []);
  return [...own, ...extras.filter((key) => key in ctx.state.terminals)];
}

function nextShell(ctx: Ctx): string {
  const used = Object.keys(ctx.state.terminals).filter(isGlobalShell).map(globalShellNumber);
  return globalShellId(Math.max(0, ...used) + 1);
}

/** A worktree's terminals: the daemon's own sessions, kept running when this closes. */
export function terminalPage(ctx: Ctx, ws: Workspace): Node {
  if (ctx.surface === 'vscode' || ctx.surface === 'mobile') {
    return col([dim('The terminal draws on the Claude Code terminal and desktop.')]);
  }
  const size = sizeOf(ctx);
  const keys = keysOf(ctx, ws);
  const [wanted, setWanted] = ctx.local<string | undefined>(`term:${ws.id}:shown`, undefined);
  const [extras, setExtras] = ctx.local<readonly string[]>(`term:${ws.id}:extras`, []);
  const [renaming, setRenaming] = ctx.local(`term:${ws.id}:renaming`, false);
  const shown = wanted && keys.includes(wanted) ? wanted : keys[0];
  // The worktree's own shell opens the first time you come here.
  ctx.load(`term:${ws.id}:shell`, () => ctx.call('terminals.shell', ws.id, size));
  const hub = ctx.terminals;
  const exited = shown !== undefined && shown in ctx.state.termExits;
  return col([
    row([
      ...keys.map((key) =>
        ctx.draw.button(`term-tab:${key}`, terminalLabel(key, ctx.state.termNames), () => setWanted(key), { plain: true, ...(key === shown ? {} : { dim: true }) }),
      ),
      ctx.draw.button(
        'term-new',
        'New',
        async () => {
          const key = nextShell(ctx);
          await ctx.call('terminals.global', key, ws.path, size);
          setExtras([...extras, key]);
          setWanted(key);
        },
        { plain: true, hotkey: 'n', dim: true },
      ),
      ctx.draw.button('term-run', 'Run', () => ctx.call('workbench.run', ws.id), { plain: true, hotkey: 'u', dim: true }),
      runId(ws.id) in ctx.state.terminals ? ctx.draw.button('term-stop-run', 'Stop Run', () => ctx.call('workbench.stopRun', ws.id), { plain: true, dim: true }) : undefined,
      ctx.draw.button('term-setup', 'Setup', () => ctx.call('workbench.runSetup', ws.id), { plain: true, dim: true }),
      ctx.draw.button('term-agent', 'Agent', () => ctx.call('agentTerm.open', ws.id, size), { plain: true, dim: true }),
      ctx.state.agentTerms[ws.id] ? ctx.draw.button('term-take-over', 'Back to Chat', () => ctx.call('agentTerm.takeOver', ws.id), { plain: true, dim: true }) : undefined,
      ctx.draw.button('term-scripts', 'Scripts', () => ctx.go({ name: 'scripts', params: { id: ws.id } }), { plain: true, dim: true }),
    ]),
    shown === undefined ? dim('Opening a shell...') : undefined,
    shown !== undefined && { k: 'term', key: `term:${shown}`, term: shown, height: size.rows },
    shown !== undefined &&
      row([
        ctx.draw.button('term-ctrl-c', 'Ctrl-C', () => hub?.write(shown, '\x03'), { plain: true, dim: true }),
        ctx.draw.button('term-ctrl-z', 'Ctrl-Z', () => hub?.write(shown, '\x1a'), { plain: true, dim: true }),
        ctx.draw.button('term-ctrl-d', 'Ctrl-D', () => hub?.write(shown, '\x04'), { plain: true, dim: true }),
        ctx.draw.button('term-esc', 'Esc', () => hub?.write(shown, '\x1b'), { plain: true, dim: true }),
        ctx.draw.button('term-up', 'Scroll Up', () => hub?.scroll(shown, size.rows - 1), { plain: true, dim: true }),
        ctx.draw.button('term-down', 'Scroll Down', () => hub?.scroll(shown, 1 - size.rows), { plain: true, dim: true }),
        ctx.draw.button('term-copy', 'Copy Screen', () => ctx.call('session.copyText', hub?.text(shown) ?? ''), { plain: true, dim: true }),
        ctx.draw.button('term-rename', 'Rename', () => setRenaming(true), { plain: true, dim: true }),
        exited ? ctx.draw.button('term-restart', 'Restart', () => ctx.call('terminals.restart', shown), { hotkey: 'r', primary: true }) : undefined,
        ctx.draw.button(
          'term-close',
          'Close',
          async () => {
            hub?.closeOne(shown);
            await ctx.call('terminals.close', shown);
            setWanted(undefined);
          },
          { plain: true, dim: true },
        ),
      ]),
    renaming && shown !== undefined
      ? ctx.draw.input(
          'term-name',
          async (value) => {
            setRenaming(false);
            await ctx.call('terminals.rename', shown, value?.trim() ?? '');
          },
          { label: 'Name', value: terminalLabel(shown, ctx.state.termNames), submitLabel: 'rename', autoFocus: true },
        )
      : undefined,
    exited ? text(`It ended${ctx.state.termExits[shown!] !== null ? ` with code ${ctx.state.termExits[shown!]}` : ''}.`, { dim: true }) : undefined,
    ctx.state.agentTerms[ws.id]
      ? ctx.draw.input(
          'term-visual',
          (value) => {
            const n = Number(value?.trim());
            if (Number.isInteger(n) && n > 0) ctx.go({ name: 'visual', params: { id: ws.id, n: String(n) } });
          },
          { label: 'Show visual', placeholder: 'The number in its link', submitLabel: 'show' },
        )
      : undefined,
    dim('Click the screen to type. Esc gives the keyboard back; Ctrl-] sends Esc to the program.'),
  ]);
}

/** A visual the agent's own terminal linked to: its block, drawn as a chat would. */
export function visualPage(ctx: Ctx, ws: Workspace, n: number): Node {
  const loaded = ctx.load(`visual:${ws.id}:${n}`, async () => (await ctx.call('agentTerm.visual', ws.id, n)) as string | undefined);
  if (loaded.error) return text(loaded.error, { color: 'error' });
  if (!loaded.value) return dim(loaded.loading ? 'Loading...' : 'That visual isn’t kept any more.');
  return col(richNodes(ctx, loaded.value), { gap: 1 });
}

/** What runs when this project's worktrees open, and on Run. Kept in the project. */
export function scriptsPage(ctx: Ctx, ws: Workspace): Node {
  const project = ctx.state.projects.find((p) => p.id === ws.projectId);
  const scripts = project?.scripts;
  return col(
    [
      title('Scripts'),
      dim('Setup runs in each new worktree. Run is what the Run button starts.'),
      ...(['setup', 'run'] as const).map((kind) =>
        ctx.draw.input(`script:${kind}`, (value) => ctx.call('workbench.setScript', ws.projectId, kind, value?.trim() ?? ''), { label: kind === 'setup' ? 'Setup' : 'Run', value: scripts?.[kind]?.command ?? '', placeholder: 'A shell command', submitLabel: 'save' }),
      ),
    ],
    { gap: 1 },
  );
}
