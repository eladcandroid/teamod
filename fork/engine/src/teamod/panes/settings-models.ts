import { type EndpointView, OLLAMA_URL, modelsOfEndpoint } from '../../shared/local-endpoints.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, col, dim, line, row, span, text, title } from '../tree.js';
import { back, chrome, empty, page } from './common.js';
import { SETTINGS_PLACES } from './settings-common.js';
import { field, loadingWords, steady, twoPress } from './work-common.js';

/**
 * Settings › Local Models: Anthropic-compatible endpoints your agent can run on. Each is kept on
 * this computer with your other secrets; its key is never shown again, only whether it has one.
 */

const LIST = 'endpoints';

/** The list. Opening the page looks at each again (a look takes a moment); after that, what was last seen. */
function endpointsOf(ctx: Ctx): ReturnType<typeof steady<readonly EndpointView[]>> {
  return steady<readonly EndpointView[]>(
    ctx,
    LIST,
    async () => {
      const [looked, setLooked] = ctx.local('endpoints:looked', false);
      setLooked(true);
      return ((await ctx.call(looked ? 'env.endpoints' : 'env.checkEndpoints')) ?? []) as readonly EndpointView[];
    },
    { ttlMs: 15_000 },
  );
}

function statusOf(e: EndpointView): { readonly style: Omit<Span, 't'>; readonly words: string } {
  if (e.reachable === undefined) return { style: { dim: true }, words: 'Not looked at yet' };
  if (!e.reachable) return { style: { color: 'error' }, words: e.builtIn ? 'Not running on this computer' : 'Not answering' };
  const models = modelsOfEndpoint(e);
  return models.length ? { style: { color: 'success' }, words: `${models.length} model${models.length === 1 ? '' : 's'}: ${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}` } : { style: { color: 'warning' }, words: 'Answering, no models yet' };
}

export function modelsPane(ctx: Ctx): Node {
  const loaded = endpointsOf(ctx);
  const list = loaded.value ?? [];
  return page(
    chrome(ctx, SETTINGS_PLACES, 'models'),
    back(ctx),
    dim('Ollama on this computer, or any Anthropic-compatible address (LiteLLM, a company proxy). Same tools and features; how good the answers are depends on the model. Pick one in the agent picker.'),
    ctx.draw.button('endpoint:add', 'Add Endpoint', () => ctx.go({ name: 'endpoint' }), { primary: true, hotkey: 'c' }),
    loadingWords(loaded, 'Looking...', 'Couldn’t look'),
    loaded.value && !list.length ? empty('No endpoints yet.') : undefined,
    ...list.map((e) => {
      const status = statusOf(e);
      return col([
        row([
          line(span(e.builtIn ? 'Ollama on this computer' : e.label, { weight: 'semibold' }), span(`  ${status.words}`, status.style)),
          ctx.draw.button(`endpoint:${e.id}:edit`, e.builtIn ? 'Set Up' : 'Edit', () => ctx.go({ name: 'endpoint', params: { id: e.id } }), { plain: true, dim: true }),
          e.builtIn ? undefined : twoPress(ctx, `endpoint:${e.id}:remove`, 'Remove', async () => {
            await ctx.call('env.removeEndpoint', e.id);
            ctx.refresh(LIST);
          }),
        ]),
        dim(e.builtIn && !e.reachable ? 'Install it from ollama.com, start it with OLLAMA_CONTEXT_LENGTH=32768 ollama serve, and pull a model (ollama pull qwen3-coder).' : `${e.baseUrl}${e.hasKey ? '  key saved' : ''}`),
      ]);
    }),
    ctx.draw.button('endpoint:check', 'Check Again', async () => {
      await ctx.call('env.checkEndpoints');
      ctx.refresh(LIST);
    }, { plain: true, dim: true, hotkey: 'd' }),
  );
}

interface Draft {
  readonly label: string;
  readonly baseUrl: string;
  /** Typed here, on its way to the engine: never drawn. */
  readonly key: string;
  readonly clearKey: boolean;
  readonly models: string;
}

/** One endpoint: a field at a time, then Save. The key is write-only. */
export function endpointPage(ctx: Ctx, id: string | undefined): Node {
  const loaded = endpointsOf(ctx);
  const endpoint = id ? loaded.value?.find((e) => e.id === id) : undefined;
  if (id && !endpoint) return page(chrome(ctx, SETTINGS_PLACES, 'models'), back(ctx), loaded.loading ? dim('Loading...') : empty('That endpoint is gone.'));
  const anOllama = loaded.value?.some((e) => !e.builtIn && e.baseUrl === OLLAMA_URL);
  const start: Draft = endpoint ? { label: endpoint.label, baseUrl: endpoint.baseUrl, key: '', clearKey: false, models: endpoint.models.join(', ') } : { label: anOllama ? '' : 'Ollama', baseUrl: anOllama ? '' : OLLAMA_URL, key: '', clearKey: false, models: '' };
  const memory = `endpoint:${id ?? 'new'}:draft`;
  const [saved, setDraft] = ctx.local<Draft | undefined>(memory, undefined);
  const draft = saved ?? start;
  const [problem, setProblem] = ctx.local<string | undefined>(`endpoint:${id ?? 'new'}:problem`, undefined);
  const edit = (patch: Partial<Draft>): void => setDraft({ ...draft, ...patch });
  const hasKey = endpoint?.hasKey ?? false;
  const keyWords = draft.key ? 'Typed, saved with the rest' : draft.clearKey ? 'Goes when you save' : hasKey ? 'Saved (type to replace)' : '';
  const ready = Boolean(draft.label.trim() && draft.baseUrl.trim());
  return page(
    chrome(ctx, SETTINGS_PLACES, 'models'),
    back(ctx, 'Local Models'),
    title(endpoint ? (endpoint.builtIn ? 'Ollama on This Computer' : endpoint.label) : 'New Endpoint'),
    field(ctx, 'endpoint:label', 'Name', draft.label, (label) => edit({ label }), { placeholder: 'Work proxy' }),
    field(ctx, 'endpoint:url', 'Address', draft.baseUrl, (baseUrl) => edit({ baseUrl }), { placeholder: OLLAMA_URL }),
    field(ctx, 'endpoint:key', 'Key', keyWords, (key) => edit({ key, clearKey: false }), { secret: true, placeholder: 'What you type isn’t shown again', none: 'None (Ollama needs none)' }),
    hasKey && !draft.key ? ctx.draw.button('endpoint:clear-key', draft.clearKey ? 'Keep the Key' : 'Remove the Key', () => edit({ clearKey: !draft.clearKey }), { plain: true, dim: true }) : undefined,
    field(ctx, 'endpoint:models', 'Models', draft.models, (models) => edit({ models }), { placeholder: 'Comma-separated', none: 'The ones it lists' }),
    problem ? text(problem, { color: 'error' }) : undefined,
    ctx.draw.button(
      'endpoint:save',
      'Save',
      async () => {
        if (!ready) {
          setProblem('It needs a name and an address.');
          return;
        }
        setProblem(undefined);
        await ctx.call('env.saveEndpoint', {
          ...(endpoint && !endpoint.builtIn ? { id: endpoint.id } : {}),
          label: draft.label.trim(),
          baseUrl: draft.baseUrl.trim(),
          ...(draft.key ? { key: draft.key } : draft.clearKey ? { key: '' } : {}),
          models: draft.models.split(/[,\n]/).map((m) => m.trim()).filter(Boolean),
        });
        setDraft(undefined);
        ctx.refresh(LIST);
        ctx.nav.back(ctx.pane);
      },
      { primary: true, hotkey: 'c' },
    ),
  );
}
