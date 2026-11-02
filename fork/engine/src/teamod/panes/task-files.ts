import type { ContentResults, NameResults } from '../../core/workspace-files.js';
import type { FsEntry } from '../../protocol.js';
import { shareNameOf } from '../../shared/share-names.js';
import type { Workspace } from '../../workspaces/types.js';
import type { Ctx } from '../screens.js';
import { type Node, code, col, dim, md, row, span, text, title } from '../tree.js';

/** At most this much of a file goes to a pane; the rest opens elsewhere. */
const SHOWN_CHARS = 60_000;
const EDIT_CHARS = 20_000;

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const OPENS_ELSEWHERE = /\.(pdf|mp4|mov|webm|m4v|zip|gz|tar|dmg)$/i;
const MARKDOWN = /\.(md|markdown)$/i;

interface Location {
  readonly owner: string;
  readonly share: string;
  readonly path: string;
}

const locationOf = (ctx: Ctx, ws: Workspace, path: string): Location => ({ owner: ctx.state.selfId, share: shareNameOf(ws.id), path });

/** A folder's rows, as the engine has listed them. Unfolded folders follow their parent. */
function rowsOf(ctx: Ctx, ws: Workspace, folder: string, open: ReadonlySet<string>, setOpen: (next: ReadonlySet<string>) => void, depth: number, out: Node[]): void {
  const at = locationOf(ctx, ws, folder);
  const entries = ctx.state.dirCache[`${at.owner}:${at.share}/${folder}`] as readonly FsEntry[] | undefined;
  ctx.load(`dir:${ws.id}:${folder}`, () => ctx.call('files.loadDir', at), { ttlMs: 20_000 });
  if (!entries) {
    if (depth === 0) out.push(dim('Loading...'));
    return;
  }
  for (const entry of entries) {
    if (out.length > 300) return;
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    const indent = '  '.repeat(depth);
    if (entry.dir) {
      const unfolded = open.has(path);
      out.push(
        ctx.draw.button(`dir:${path}`, entry.name, () => {
          const next = new Set(open);
          if (unfolded) next.delete(path);
          else next.add(path);
          setOpen(next);
        }, { plain: true, spans: [span(`${indent}${unfolded ? 'v' : '>'} ${entry.name}`, { weight: 'semibold' })] }),
      );
      if (unfolded) rowsOf(ctx, ws, path, open, setOpen, depth + 1, out);
    } else {
      out.push(ctx.draw.button(`file:${path}`, entry.name, () => ctx.go({ name: 'file', params: { id: ws.id, path } }), { plain: true, spans: [span(`${indent}  ${entry.name}`)] }));
    }
  }
}

function searchResults(ctx: Ctx, ws: Workspace, query: string, inContents: boolean): Node {
  if (inContents) {
    const found = ctx.load(`find:${ws.id}:content:${query}`, async () => (await ctx.call('files.searchContent', ws.id, query, { slot: `pane:${ws.id}` })) as ContentResults);
    if (found.error) return text(found.error, { color: 'error' });
    if (!found.value) return dim('Searching...');
    if (found.value.error) return text(found.value.error, { color: 'error' });
    return col([
      dim(`${found.value.count} line${found.value.count === 1 ? '' : 's'}${found.value.truncated ? ' and more' : ''}`),
      ...found.value.files.slice(0, 40).flatMap((file) => [
        ctx.draw.button(`hit-file:${file.path}`, file.path, () => ctx.go({ name: 'file', params: { id: ws.id, path: file.path } }), { plain: true }),
        ...file.matches.slice(0, 5).map((hit) => dim(`  ${hit.line}: ${hit.text.slice(0, 120)}`)),
      ]),
    ]);
  }
  const found = ctx.load(`find:${ws.id}:name:${query}`, async () => (await ctx.call('files.searchNames', ws.id, query, { slot: `pane:${ws.id}` })) as NameResults);
  if (found.error) return text(found.error, { color: 'error' });
  if (!found.value) return dim('Searching...');
  if (found.value.error) return text(found.value.error, { color: 'error' });
  return col([
    ...found.value.files.slice(0, 100).map((file) => ctx.draw.button(`hit:${file.path}`, file.path, () => ctx.go({ name: 'file', params: { id: ws.id, path: file.path } }), { plain: true })),
    found.value.truncated && dim('And more: narrow it down.'),
  ]);
}

/** A worktree's files: a tree you unfold, and search by name or by what's in them. */
export function filesPage(ctx: Ctx, ws: Workspace): Node {
  const [open, setOpen] = ctx.local<ReadonlySet<string>>(`files:${ws.id}:open`, new Set());
  const [query, setQuery] = ctx.local(`files:${ws.id}:query`, '');
  const [inContents, setInContents] = ctx.local(`files:${ws.id}:contents`, false);
  const rows: Node[] = [];
  if (!query) rowsOf(ctx, ws, '', open, setOpen, 0, rows);
  return col(
    [
      ctx.draw.input('files-search', (value) => setQuery(value?.trim() ?? ''), { placeholder: inContents ? 'Search what’s in the files' : 'Search file names', submitLabel: 'search', ...(query ? { value: query } : {}) }),
      row([
        ctx.draw.button('files-by-name', 'Names', () => setInContents(false), { plain: true, ...(inContents ? { dim: true } : {}) }),
        ctx.draw.button('files-by-content', 'Contents', () => setInContents(true), { plain: true, ...(inContents ? {} : { dim: true }) }),
        query ? ctx.draw.button('files-clear', 'Clear', () => setQuery(''), { plain: true, dim: true }) : undefined,
        ctx.draw.button('scratch', 'Scratch', () => ctx.go({ name: 'scratch', params: { id: ws.id } }), { plain: true, hotkey: 's', dim: true }),
        ctx.draw.button('files-finder', 'Show in Finder', () => ctx.call('workspaces.openInFinder', ws.id), { plain: true, dim: true }),
      ]),
      query ? searchResults(ctx, ws, query, inContents) : col(rows),
    ],
    { gap: 1 },
  );
}

/** One file: as itself, with Edit for small text. Pictures draw where the surface can; the rest opens elsewhere. */
export function filePage(ctx: Ctx, ws: Workspace, path: string): Node {
  const at = locationOf(ctx, ws, path);
  if (OPENS_ELSEWHERE.test(path)) {
    return col([title(path), ctx.draw.button('file-open', 'Open', () => ctx.call('files.open', at), { primary: true, hotkey: 'o' }), ctx.draw.button('file-download', 'Download', () => ctx.call('files.download', at), { plain: true, dim: true })], { gap: 1 });
  }
  if (IMAGE.test(path)) {
    const image = ctx.load(`image:${ws.id}:${path}`, async () => (await ctx.call('files.readImageFile', at)) as { readonly data: string; readonly mediaType: string });
    const data = image.value?.data;
    return col(
      [
        title(path),
        image.error ? text(image.error, { color: 'error' }) : undefined,
        !image.value && !image.error ? dim('Loading...') : undefined,
        data && ctx.surface === 'terminal' && /\.png$/i.test(path) ? { k: 'image' as const, key: `img:${path}`, png: data, columns: Math.min(120, Math.max(10, ctx.columns - 2)), rows: Math.min(40, Math.max(6, ctx.rows - 8)), alt: path } : undefined,
        data && ctx.surface !== 'terminal' ? { k: 'svg' as const, source: `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:${image.value?.mediaType ?? 'image/png'};base64,${data}"/></svg>`, alt: path } : undefined,
        ctx.draw.button('file-open', 'Open', () => ctx.call('files.open', at), { plain: true, hotkey: 'o', dim: true }),
      ],
      { gap: 1 },
    );
  }
  const loaded = ctx.load(`read:${ws.id}:${path}`, async () => (await ctx.call('files.read', at)) as { readonly content: string; readonly truncated: boolean }, { ttlMs: 10_000 });
  const [editing, setEditing] = ctx.local(`file:${ws.id}:${path}:editing`, false);
  const [preview, setPreview] = ctx.local(`file:${ws.id}:${path}:preview`, true);
  const content = loaded.value?.content ?? '';
  const refresh = (): void => ctx.refresh(`read:${ws.id}:${path}`);
  const small = content.length <= EDIT_CHARS && !loaded.value?.truncated;
  const isMarkdown = MARKDOWN.test(path);
  const formatter = ctx.load(`formatter:${ws.id}:${path}`, async () => (await ctx.call('files.formatter', ws.id, path)) as { readonly available: boolean });
  return col(
    [
      title(path),
      loaded.error ? text(loaded.error, { color: 'error' }) : undefined,
      !loaded.value && !loaded.error ? dim('Loading...') : undefined,
      loaded.value &&
        row([
          small ? ctx.draw.button('file-edit', editing ? 'Cancel' : 'Edit', () => setEditing(!editing), { plain: true, hotkey: 'e' }) : undefined,
          isMarkdown ? ctx.draw.button('file-preview', preview ? 'Source' : 'Preview', () => setPreview(!preview), { plain: true, dim: true }) : undefined,
          formatter.value?.available && small
            ? ctx.draw.button('file-format', 'Format', async () => {
                const formatted = (await ctx.call('files.format', ws.id, path, content)) as string;
                await ctx.call('files.save', ws.id, path, formatted);
                refresh();
              }, { plain: true, dim: true })
            : undefined,
          ctx.draw.button('file-external', 'Open', () => ctx.call('files.open', at), { plain: true, dim: true }),
          ctx.draw.button('file-code', 'Open in Editor', () => ctx.call('workbench.openCode', ws.id, path), { plain: true, dim: true }),
        ]),
      loaded.value?.truncated ? dim('Only the start of this file: it’s large.') : undefined,
      editing
        ? ctx.draw.input(
            'file-edit-box',
            async (value) => {
              await ctx.call('files.save', ws.id, path, value ?? '');
              setEditing(false);
              refresh();
            },
            { value: content, rows: Math.min(30, Math.max(6, ctx.rows - 10)), submitLabel: 'save', autoFocus: true },
          )
        : loaded.value && (isMarkdown && preview ? md(content.slice(0, SHOWN_CHARS)) : code(content.slice(0, SHOWN_CHARS), { path, startLine: 1 })),
      content.length > SHOWN_CHARS && dim('Shows the start of it. Open it for the rest.'),
    ],
    { gap: 1 },
  );
}

interface ScratchFile {
  readonly path: string;
  readonly size: number;
  readonly mtime: number;
}

/** What your agent made along the way, newest first. */
export function scratchPage(ctx: Ctx, ws: Workspace): Node {
  const loaded = ctx.load(`scratch:${ws.id}`, async () => (await ctx.call('workspaces.scratch', ws.id)) as { readonly files: readonly ScratchFile[] } | undefined, { ttlMs: 5000 });
  const files = [...(loaded.value?.files ?? [])].sort((a, b) => b.mtime - a.mtime);
  return col(
    [
      title('Scratch'),
      loaded.error ? text(loaded.error, { color: 'error' }) : undefined,
      !loaded.value && !loaded.error ? dim('Loading...') : undefined,
      loaded.value && files.length === 0 ? dim('What your agent makes along the way lands here: screenshots, test runs, logs.') : undefined,
      ...files.slice(0, 100).map((file) =>
        ctx.draw.button(`scratch:${file.path}`, file.path, () => ctx.go({ name: 'file', params: { id: ws.id, path: file.path } }), {
          plain: true,
          spans: [span(file.path), span(`  ${Math.ceil(file.size / 1024)} KB`, { dim: true })],
        }),
      ),
    ],
    { gap: 0 },
  );
}
