import type { EngineInterface } from 'claude-code'

import type { Node, Span, Viewport } from '../types'
import { press } from './link'
import { FILL, ICON_GLYPHS, TONE_HEX, TONE_TINT, avatarSvg, iconSvg } from './pictures'

type Render = Parameters<EngineInterface['ui']['resolve']>[0]

/**
 * A tree's spacing is in character cells; a desktop sizes its own steps, and a cell there would be
 * far wider than it reads on the terminal.
 */
/** The most options a Select may carry. */
const MAX_OPTIONS = 64

const step = (cells: number): number | 'sm' | 'md' | 'lg' => (cells <= 0 ? 0 : cells === 1 ? 'sm' : cells === 2 ? 'md' : 'lg')

const asText = (Text: (props: never) => unknown, spans: readonly Span[], desktop = false): unknown[] =>
  spans.map(s => {
    // A state chip, on a desktop: its words on the tone's tint, without the terminal's dot.
    if (desktop && s.tone) {
      const words = s.t.replace(/^●\s*/, '')

      return Text({
        children: ` ${words} `,
        backgroundColor: TONE_TINT[s.tone],
        ...(s.tone === 'quiet' ? {} : { color: TONE_HEX[s.tone] }),
        size: s.size ?? 'footnote',
        weight: 'medium',
      } as never)
    }
    const props = {
      children: s.t,
      ...(s.dim ? { dimColor: true } : {}),
      ...(s.color ? { color: s.color } : {}),
      ...(s.weight ? { weight: s.weight } : {}),
      ...(s.inverse ? { inverse: true } : {}),
      ...(s.size ? { size: s.size } : {}),
    }

    return Text(props as never)
  })

/**
 * Turns a tree from the bridge into this surface's elements. What a surface
 * cannot draw (no Input on mobile, no Image off the terminal) says so in words;
 * the bridge already chose by surface, so that is a safety, not a path.
 */
export function draw(
  $: EngineInterface,
  e: Render,
  site: string,
  viewport: Viewport,
  node: Node,
): unknown {
  const elements = $.ui.resolve(e) as unknown as Record<string, (props: never) => unknown>
  const make = (name: string, props: Record<string, unknown>): unknown =>
    elements[name]!(props as never)
  const Text = elements.Text!
  const desktop = viewport.surface !== 'terminal'
  const space = (cells: number): unknown => (desktop ? step(cells) : cells)
  const walk = (n: Node): unknown => {
    switch (n.k) {
      case 'box':
        if (desktop && n.card) {
          // A card, on a desktop: filled and rounded, lit under the pointer when it opens something.
          return make('Box', {
            flexDirection: n.dir ?? 'column',
            ...(n.key ? { key: n.key } : {}),
            ...(n.key && n.hover ? { hover: { backgroundColor: FILL.hover } } : {}),
            ...(n.align ? { alignItems: n.align } : {}),
            gap: 'sm',
            padding: 'md',
            marginTop: 'sm',
            backgroundColor: FILL.card,
            borderStyle: 'round',
            ...(n.borderColor ? { borderColor: n.borderColor } : { borderDimColor: true }),
            children: n.children.map(walk),
          })
        }
        return make('Box', {
          ...(n.dir || n.reverse ? { flexDirection: `${n.dir ?? 'row'}${n.reverse ? '-reverse' : ''}` } : {}),
          ...(n.align ? { alignItems: n.align } : {}),
          ...(desktop && n.dir === 'row' ? { alignItems: n.align ?? 'center' } : {}),
          ...(n.gap !== undefined ? { gap: space(n.gap) } : {}),
          ...(n.pad !== undefined ? { padding: space(n.pad) } : {}),
          ...(n.padX !== undefined ? { paddingX: space(n.padX) } : {}),
          ...(n.top !== undefined ? { marginTop: space(n.top) } : {}),
          ...(desktop && n.bg ? { backgroundColor: FILL[n.bg] } : {}),
          ...(desktop && n.key ? { key: n.key } : {}),
          ...(desktop && n.key && n.hover ? { hover: { backgroundColor: FILL.hover } } : {}),
          ...(n.grow !== undefined ? { flexGrow: n.grow } : {}),
          ...(n.width !== undefined ? { width: n.width } : {}),
          ...(n.height !== undefined ? { height: n.height } : {}),
          ...(n.justify ? { justifyContent: n.justify } : {}),
          ...(n.wrap ? { flexWrap: 'wrap' } : {}),
          ...(n.border ? { borderStyle: n.border } : {}),
          ...(n.borderColor ? { borderColor: n.borderColor } : {}),
          ...(n.borderDim ? { borderDimColor: true } : {}),
          children: n.children.map(walk),
        })
      case 'text':
        return make('Text', { ...(n.dir ? { dir: n.dir } : {}), children: asText(Text, n.spans, desktop) })
      case 'button':
        return make('Button', {
          key: n.key,
          label: n.label,
          ...(n.hotkey ? { hotkey: n.hotkey } : {}),
          ...(n.plain ? { plain: true } : {}),
          ...(n.primary ? { variant: 'primary' } : {}),
          ...(n.dim ? { dimColor: true } : {}),
          // A pill, on a desktop: the open tab filled and rounded; the whole pill is the press.
          ...(desktop && n.pill === 'on' ? { backgroundColor: FILL.strong, borderStyle: 'round', borderDimColor: true } : {}),
          ...(n.spans ? { children: asText(Text, n.spans, desktop) } : {}),
          onPress: () => void press($, site, n.key, undefined, viewport),
        })
      case 'input':
        if (!elements.Input) return make('Text', { dimColor: true, children: 'Open this on the terminal or desktop to type here.' })

        return make('Input', {
          key: n.key,
          ...(n.label ? { label: n.label } : {}),
          ...(n.placeholder ? { placeholder: n.placeholder } : {}),
          ...(n.value !== undefined ? { value: n.value } : {}),
          ...(n.rows ? { rows: n.rows } : {}),
          ...(n.submitLabel ? { submitLabel: n.submitLabel } : {}),
          ...(n.autoFocus ? { autoFocus: true } : {}),
          onSubmit: (value: string) => void press($, site, n.key, value, viewport),
        })
      case 'select': {
        if (!elements.Select) return make('Text', { dimColor: true, children: 'Open this on the terminal or desktop to choose here.' })
        // What Claude Code refuses would blank the whole pane: unique values, 1 to 64 of them.
        const options = n.options.filter((o, i) => n.options.findIndex(other => other.value === o.value) === i)
        if (!options.length) return make('Text', { dimColor: true, children: n.label ? `${n.label}: none` : 'Nothing to choose.' })
        const picked = options.find(o => o.value === n.value)
        const drawn = options.length <= MAX_OPTIONS ? options : [...(picked ? [picked] : []), ...options.filter(o => o !== picked).slice(0, MAX_OPTIONS - (picked ? 1 : 0))]

        return make('Select', {
          key: n.key,
          options: drawn,
          ...(n.label ? { label: n.label } : {}),
          ...(picked ? { value: n.value } : {}),
          onSelect: (value: string) => void press($, site, n.key, value, viewport),
        })
      }
      case 'md':
        return make('Markdown', { text: n.text })
      case 'code':
        return make('Code', {
          source: n.source,
          ...(n.language ? { language: n.language } : {}),
          ...(n.path ? { path: n.path } : {}),
          ...(n.diff ? { format: 'diff' } : {}),
          ...(n.startLine !== undefined ? { startLine: n.startLine } : {}),
        })
      case 'link':
        return make('Link', { href: n.href, label: n.text })
      case 'image':
        if (!elements.Image) return make('Text', { dimColor: true, children: n.alt })

        return make('Image', {
          ...(n.key ? { key: n.key } : {}),
          source: { png: n.png },
          columns: n.columns,
          rows: n.rows,
          alt: n.alt,
        })
      case 'svg':
        if (!elements.Svg) return make('Text', { dimColor: true, children: n.alt })

        return make('Svg', {
          source: n.source,
          alt: n.alt,
          ...(n.width !== undefined ? { width: n.width } : {}),
          ...(n.height !== undefined ? { height: n.height } : {}),
          ...(n.interactive ? { isInteractive: true } : {}),
        })
      case 'icon':
        if (desktop && elements.Svg) return make('Svg', { source: iconSvg(n.name, n.tone, n.size ?? 16), alt: n.name, width: n.size ?? 16, height: n.size ?? 16 })

        return make('Text', { ...(n.tone && n.tone !== 'quiet' ? { color: TONE_HEX[n.tone] } : { dimColor: true }), children: ICON_GLYPHS[n.name] ?? '·' })
      case 'avatar':
        if (!desktop || !elements.Svg) return null

        return make('Svg', { source: avatarSvg(n.name, n.size ?? 28), alt: n.name, width: n.size ?? 28, height: n.size ?? 28 })
      case 'term': {
        const Client = elements.Client as unknown as ((props: Record<string, unknown>) => JSX.Element) | undefined
        if (!Client) return make('Text', { dimColor: true, children: 'The terminal draws on the Claude Code terminal and desktop.' })

        return <Client key={n.key} module="./term-client.tsx" width="100%" height={n.height ?? 24} props={{ term: n.term, height: n.height ?? 24 }} />
      }
    }
  }

  return walk(node)
}
