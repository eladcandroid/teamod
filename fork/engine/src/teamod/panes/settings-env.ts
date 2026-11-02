import type { EnvScope } from '../../core/env-vars.js';
import { type EnvVar, envProblems, importEnv, parseEnvText } from '../../shared/env-vars.js';
import type { Ctx, Route } from '../screens.js';
import { type Node, col, dim, line, row, span, text, title } from '../tree.js';
import { back, chrome, empty, page } from './common.js';
import { SETTINGS_PLACES, toggle } from './settings-common.js';
import { errorText, loadingWords, plural, steady, twoPress, windowed } from './work-common.js';

/**
 * Settings › Environment: variables for your shells, setup and run commands, and your agent. Yours
 * apply everywhere; a project's apply in its worktrees, over yours.
 *
 * What a pane keeps is names. A value leaves the engine only when you press Show on that one, and
 * goes again when you press Hide, leave, or a minute passes; a value you type is never drawn again.
 */

/** A scope's names and switches, with no value in them: this is all the screen's memory ever holds. */
interface EnvNames {
  readonly own: readonly string[];
  /** In the main folder's .env files, while they're included. */
  readonly file: readonly string[];
  readonly files: readonly string[];
  readonly dotenv: boolean;
  readonly claudeDotenv: boolean;
  readonly newKeysBack: boolean;
  readonly overridden: Readonly<Record<string, readonly string[]>>;
}

/** The one value showing, and on which visit to the page. */
interface Shown {
  readonly scope: string;
  readonly key: string;
  readonly value: string;
  readonly route: Route;
  readonly token: number;
}

const HIDE_AFTER_MS = 60_000;
const SHOWN = 'env:shown';

const namesKey = (scope: string): string => `env:names:${scope}`;

const readScope = async (ctx: Ctx, scope: string): Promise<EnvScope> => (await ctx.call('env.get', ...(scope ? [scope] : []))) as EnvScope;

/** Change a scope's own rows: read now (nothing's kept to go stale), then saved whole. */
async function changeVars(ctx: Ctx, scope: string, edit: (vars: readonly EnvVar[]) => readonly EnvVar[], dotenv?: boolean): Promise<void> {
  const now = await readScope(ctx, scope);
  const next = edit(now.vars);
  const problem = [...envProblems(next).values()][0];
  if (problem) throw new Error(problem);
  await ctx.call('env.set', scope || undefined, next, scope ? (dotenv ?? now.dotenv) : undefined);
  ctx.refresh(namesKey(scope));
}

let tokens = 0;

/** Show one value. It hides on its own, so one left showing doesn't stay on the screen. */
async function showValue(ctx: Ctx, scope: string, key: string): Promise<void> {
  const now = await readScope(ctx, scope);
  const value = now.vars.find((v) => v.key === key)?.value ?? now.dotenvVars?.find((v) => v.key === key)?.value;
  const token = ++tokens;
  const set = ctx.local<Shown | undefined>(SHOWN, undefined)[1];
  set(value === undefined ? undefined : { scope, key, value, route: ctx.route, token });
  setTimeout(() => {
    const [current, hide] = ctx.local<Shown | undefined>(SHOWN, undefined);
    if (current?.token === token) hide(undefined);
  }, HIDE_AFTER_MS).unref?.();
}

function varRow(ctx: Ctx, scope: string, names: EnvNames, key: string, shown: Shown | undefined, editing: string | undefined, setEditing: (next: string | undefined) => void, hide: () => void): Node {
  const own = names.own.includes(key);
  const inFile = names.file.includes(key);
  const filesLabel = names.files.length ? names.files.join(' and ') : '.env';
  const from = own && inFile ? `set here, over the ${filesLabel}` : inFile ? `from the ${filesLabel}` : '';
  const showing = shown?.key === key;
  const overridden = names.overridden[key];
  return col([
    row([
      line(span(key, { weight: 'semibold' }), from ? span(`  ${from}`, { dim: true }) : undefined),
      showing
        ? ctx.draw.button(`env:hide:${key}`, 'Hide', hide, { plain: true })
        : ctx.draw.button(`env:show:${key}`, 'Show', () => showValue(ctx, scope, key), { plain: true, dim: true }),
      ctx.draw.button(`env:change:${key}`, 'Change', () => setEditing(key), { plain: true, dim: true }),
      own ? twoPress(ctx, `env:remove:${key}`, inFile ? `Use the ${filesLabel}` : 'Remove', () => changeVars(ctx, scope, (vars) => vars.filter((v) => v.key !== key))) : undefined,
    ]),
    showing ? text(`  ${shown?.value ?? ''}`) : undefined,
    editing === key
      ? ctx.draw.input(
          `env:value:${key}`,
          async (value) => {
            setEditing(undefined);
            // Nothing typed is no change: clearing one is Remove.
            if (!value) return;
            hide();
            await changeVars(ctx, scope, (vars) => (vars.some((v) => v.key === key) ? vars.map((v) => (v.key === key ? { key, value } : v)) : [...vars, { key, value }]));
          },
          { label: `New value of ${key}`, placeholder: 'What you type isn’t shown again', submitLabel: 'save', autoFocus: true },
        )
      : undefined,
    overridden?.length ? dim(`  Not used in ${overridden.join(', ')}: ${overridden.length > 1 ? 'they set' : 'it sets'} ${key} too, and that wins. Change it there.`) : undefined,
  ]);
}

/** Add one or several: lines like KEY=value, the way a .env has them. */
function addVars(ctx: Ctx, scope: string): Node {
  const [adding, setAdding] = ctx.local(`env:adding`, false);
  const [problem, setProblem] = ctx.local<string | undefined>(`env:add-problem`, undefined);
  const said = problem ? text(problem, { color: 'error' }) : undefined;
  if (!adding) return col([ctx.draw.button('env:add', 'Add Variables', () => setAdding(true), { primary: true, hotkey: 'c' }), said]);
  return col([
    ctx.draw.input(
      'env:new',
      async (value) => {
        const parsed = parseEnvText(value ?? '');
        setProblem(undefined);
        if (!parsed.vars.length) {
          setProblem(value?.trim() ? 'Those aren’t KEY=value lines.' : undefined);
          setAdding(false);
          return;
        }
        setAdding(false);
        try {
          await changeVars(ctx, scope, (vars) => importEnv(vars, parsed.vars));
          if (parsed.skipped.length) setProblem(`${plural(parsed.skipped.length, 'line')} skipped: not KEY=value.`);
        } catch (err) {
          setProblem(errorText(err));
        }
      },
      { label: 'KEY=value lines', placeholder: 'API_URL=https://api.example.com', rows: 3, submitLabel: 'add', autoFocus: true },
    ),
    ctx.draw.button('env:add-cancel', 'Cancel', () => setAdding(false), { plain: true, dim: true }),
    said,
  ]);
}

type DbTest = { readonly ok: true; readonly from: string } | { readonly ok: false; readonly message: string };

export function envPane(ctx: Ctx): Node {
  const [scope, setScope] = ctx.local('env:scope', '');
  const project = scope ? ctx.state.projects.find((p) => p.id === scope) : undefined;
  const projects = ctx.state.projects.filter((p) => p.root);
  const loaded = steady<EnvNames>(
    ctx,
    namesKey(scope),
    async () => {
      const s = await readScope(ctx, scope);
      return {
        own: s.vars.map((v) => v.key),
        file: s.dotenv ? s.dotenvKeys : [],
        files: s.dotenvFiles ?? [],
        dotenv: s.dotenv,
        claudeDotenv: s.claudeDotenv,
        newKeysBack: s.newKeysBack ?? true,
        overridden: s.overridden ?? {},
      };
    },
    { ttlMs: 10_000 },
  );
  const names = loaded.value;
  const [shownNow, setShown] = ctx.local<Shown | undefined>(SHOWN, undefined);
  // A value shows only on the visit it was asked for. Come back another time, and it's hidden.
  const shown = shownNow && shownNow.scope === scope && shownNow.route === ctx.route ? shownNow : undefined;
  if (shownNow && !shown) setShown(undefined);
  const hide = (): void => setShown(undefined);
  const [editing, setEditing] = ctx.local<string | undefined>('env:editing', undefined);
  const [db, setDb] = ctx.local<DbTest | undefined>(`env:db:${scope}`, undefined);
  const listed = names ? [...new Set([...names.file, ...names.own])] : [];
  const window = windowed(ctx, `env:${scope}`, listed, { size: 40, keys: true });
  const keptElsewhere = project && names ? names.file.filter((k) => !names.own.includes(k)).length : 0;
  const count = (n: number): string => (n ? ` (${n})` : '');
  const keys = ctx.state.envKeys;
  const filesLabel = names?.files.length ? names.files.join(' and ') : '.env';
  return page(
    chrome(ctx, SETTINGS_PLACES, 'env'),
    back(ctx),
    dim('Given to your shells, setup and run commands, and your agent, never to a friend’s request. They stay on this computer. Changes apply to your agent’s next message and to new shells.'),
    ctx.draw.select(
      'env:scope',
      [{ value: '', label: `Everywhere${count(keys.global.length)}` }, ...projects.map((p) => ({ value: p.id, label: `${p.name}${count(keys.projects[p.root]?.keys.length ?? 0)}` }))],
      (value) => {
        setShown(undefined);
        setEditing(undefined);
        setScope(value ?? '');
      },
      { label: 'Variables for', value: scope },
    ),
    dim(scope ? 'This project’s worktrees. They win over yours.' : 'Every shell, script and agent run.'),
    loadingWords(loaded, 'Loading...', 'Couldn’t read them'),
    names &&
      project &&
      toggle(
        ctx,
        'env:dotenv',
        `Include the main folder’s ${filesLabel}`,
        names.dotenv,
        (next) => changeVars(ctx, scope, (vars) => vars, next),
        names.dotenv ? (names.file.length ? `${plural(names.file.length, 'variable')}, read fresh each time something starts.` : 'None there yet.') : 'Off: only the variables set here.',
      ),
    addVars(ctx, scope),
    names && !listed.length ? empty(project ? 'No variables yet, and no .env in the main folder.' : 'No variables yet.') : undefined,
    ...window.shown.map((key) => varRow(ctx, scope, names!, key, shown, editing, setEditing, hide)),
    window.controls,
    project && keptElsewhere > 0
      ? ctx.draw.button(
          'env:keep-copy',
          'Keep a Copy Here',
          async () => {
            const n = (await ctx.call('env.importDotenv', scope)) as number | undefined;
            ctx.effect({ toast: n ? `Copied ${plural(n, 'variable')}` : 'They’re all here already' });
            ctx.refresh(namesKey(scope));
          },
          { plain: true, dim: true },
        )
      : undefined,
    names &&
      project &&
      toggle(ctx, 'env:new-keys-back', 'New keys go to the main folder', names.newKeysBack, async (next) => {
        await ctx.call('env.newKeysBack', scope, next);
        ctx.refresh(namesKey(scope));
      }, 'A key a worktree adds to its .env is added there too, so the next worktree works. A changed value is asked about.'),
    names &&
      toggle(ctx, 'env:claude-dotenv', 'Your agent reads .env files without asking', names.claudeDotenv, async (next) => {
        await ctx.call('env.claudeDotenv', scope || undefined, next);
        ctx.refresh(namesKey(scope));
      }, project ? 'In this project. Off: it asks you each time. A friend’s request never gets them.' : 'In every project. Off: it asks you each time, or as each project says. A friend’s request never gets them.'),
    col([
      title('Database'),
      dim('Postgres for your agent’s views: DATABASE_URL (or POSTGRES_URL...), or a Supabase project’s URL and SUPABASE_DB_PASSWORD, from here or the project’s .env.'),
      row([
        ctx.draw.button(
          'env:test-db',
          'Test Connection',
          async () => {
            setDb(undefined);
            try {
              setDb((await ctx.call('env.testDatabase', ...(scope ? [scope] : []))) as DbTest);
            } catch (err) {
              setDb({ ok: false, message: errorText(err) });
            }
          },
          { plain: true, hotkey: 'd' },
        ),
        db ? (db.ok ? text(`Connected, using ${db.from}.`, { color: 'success' }) : text(db.message, { color: 'error' })) : undefined,
      ]),
    ]),
  );
}
