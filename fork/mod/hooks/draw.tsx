import type { EngineInterface } from 'claude-code'

import type { Node, Span, Viewport } from '../types'
import { press } from './link'

type Render = Parameters<EngineInterface['ui']['resolve']>[0]

const asText = (Text: (props: never) => unknown, spans: readonly Span[]): unknown[] =>
  spans.map(s => {
    const props = {
      children: s.t,
      ...(s.dim ? { dimColor: true } : {}),
      ...(s.color ? { color: s.color } : {}),
      ...(s.weight ? { weight: s.weight } : {}),
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
  const walk = (n: Node): unknown => {
    switch (n.k) {
      case 'box':
        return make('Box', {
          ...(n.dir ? { flexDirection: n.dir } : {}),
          ...(n.gap !== undefined ? { gap: n.gap } : {}),
          ...(n.pad !== undefined ? { padding: n.pad } : {}),
          ...(n.padX !== undefined ? { paddingX: n.padX } : {}),
          ...(n.top !== undefined ? { marginTop: n.top } : {}),
          ...(n.grow !== undefined ? { flexGrow: n.grow } : {}),
          ...(n.width !== undefined ? { width: n.width } : {}),
          ...(n.height !== undefined ? { height: n.height } : {}),
          ...(n.justify ? { justifyContent: n.justify } : {}),
          ...(n.wrap ? { flexWrap: 'wrap' } : {}),
          ...(n.border ? { borderStyle: n.border } : {}),
          children: n.children.map(walk),
        })
      case 'text':
        return make('Text', { children: asText(Text, n.spans) })
      case 'button':
        return make('Button', {
          key: n.key,
          label: n.label,
          ...(n.hotkey ? { hotkey: n.hotkey } : {}),
          ...(n.plain ? { plain: true } : {}),
          ...(n.primary ? { variant: 'primary' } : {}),
          ...(n.dim ? { dimColor: true } : {}),
          ...(n.spans ? { children: asText(Text, n.spans) } : {}),
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
      case 'select':
        if (!elements.Select) return make('Text', { dimColor: true, children: 'Open this on the terminal or desktop to choose here.' })

        return make('Select', {
          key: n.key,
          options: n.options,
          ...(n.label ? { label: n.label } : {}),
          ...(n.value !== undefined ? { value: n.value } : {}),
          onSelect: (value: string) => void press($, site, n.key, value, viewport),
        })
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
      case 'term':
        return make('Text', { dimColor: true, children: 'The terminal comes in a later phase.' })
    }
  }

  return walk(node)
}
