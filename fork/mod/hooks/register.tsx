import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { draw } from './draw'
import {
  TITLES,
  commandOf,
  ensureBridge,
  forgetView,
  homeOf,
  readLink,
  readProblem,
  readRev,
  viewOf,
} from './link'

const SPIKE = 'spike'

const spikeKeys = atom({ plugin: 'teamod', key: 'spikeKeys' } as const, [], {
  shape: 'spike-keys-1',
})

/** A 2x2 PNG, enough to see whether a picture is drawn at all. */
const SPIKE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAxAAAAB0ABXXXZ6wAAAAASUVORK5CYII='
const SPIKE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" rx="6" fill="#7aa2f7"/><text x="60" y="25" font-size="14" text-anchor="middle" fill="#fff">teamod svg</text></svg>'

/** Lanes the daemon runs load user settings, so they load this mod too. It stays out of them. */
const isInLane = async ($: EngineInterface): Promise<boolean> =>
  (await $.env.get('TEAMOD_DAEMON')) === '1'

/** Runs the engine's own setup when this plugin sits in a checkout beside the engine. */
const setup = async ($: EngineInterface): Promise<string> => {
  const cli = `${$.plugin.root}/../engine/dist/teamod/cli.js`
  const found = await $.fs.stat(cli).catch(() => undefined)
  if (!found) {
    return `Build the engine first: cd ${$.plugin.root}/../engine && npm ci && npm run build. Installing without a checkout comes in a later phase.`
  }
  const ran = await $.process.run(['node', cli, 'setup', '--from-source'], {
    env: { TEAMOD_HOME: await homeOf($) },
    timeoutMs: 120_000,
  })
  if (ran.exitCode !== 0) return `Setup failed: ${ran.stderr || ran.stdout}`
  void ensureBridge($)

  return ran.stdout.trim() || 'teamod is set up.'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (await isInLane($)) return started
    await $.command.register({
      name: 'teamod',
      description: 'Open teamod: worktrees, tasks, your team and automations',
      argumentHint: '[work|task|team|board|sentinel|settings|setup|status|<engine command>]',
    })
    // A desktop session starts with no surface and says so by attaching; a `-p` run never does.
    if (e.isInteractive) void ensureBridge($)

    return started
  })

  on('session.attach', async ($, e, next) => {
    if (!(await isInLane($))) void ensureBridge($)

    return next(e)
  })

  on('command.run', { command: 'teamod' }, async ($, e) => {
    const words = e.args.trim()
    const verb = words.split(/\s+/)[0] ?? ''
    if (verb === 'setup') return { text: await setup($) }
    void ensureBridge($)
    if (verb === 'status') {
      const current = await readLink($)
      const issue = await readProblem($)
      const state = current
        ? current.connected
          ? 'connected'
          : 'reconnecting'
        : (issue?.text ?? 'starting')

      return { text: `teamod: ${state}` }
    }
    if (verb === 'spike') {
      const opened = await $.ui.open({ id: SPIKE, title: 'Spike', focus: true })

      return { text: opened.isPlaced ? 'Spike pane opened.' : `Spike pane waits: ${opened.reason}` }
    }
    const answer = await commandOf($, words)
    if (!answer) {
      return { text: (await readProblem($))?.text ?? 'teamod is still starting. Try again in a moment.' }
    }
    if (answer.open) {
      const title = answer.title ?? TITLES[answer.open] ?? answer.open
      const opened = await $.ui.open({ id: answer.open, title, focus: true })

      return { text: opened.isPlaced ? `${title} opened.` : `${title} waits: ${opened.reason}` }
    }

    return { text: answer.text ?? '' }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (TITLES[e.requestId] === undefined) return next(e)
    const { Text } = $.ui.resolve(e)
    const current = await readLink($)
    await readRev($, e.requestId)
    if (!current) {
      return <Text dimColor>{(await readProblem($))?.text ?? 'Starting teamod...'}</Text>
    }
    const viewport = {
      surface: e.surface,
      columns: e.props.bodyColumns,
      rows: e.props.scroll.bodyRows,
    }
    const view = await viewOf($, e.requestId, viewport)
    if (!view) return <Text dimColor>Starting teamod...</Text>

    return draw($, e, e.requestId, viewport, view.tree) as JSX.Element
  })

  on('ui.close', async ($, e, next) => {
    if (TITLES[e.id] !== undefined) await forgetView($, e.id).catch(() => undefined)

    return next(e)
  })

  // What waits for you, above the prompt. Nothing waiting draws nothing of ours.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await readLink($))) return next(e)
    await readRev($, 'band')
    const viewport = { surface: e.surface, columns: e.props.bodyColumns, rows: e.props.maxRows }
    const view = await viewOf($, 'band', viewport)
    if (!view?.active) return next(e)
    const { Box } = $.ui.resolve(e)
    const ours = draw($, e, 'band', viewport, view.tree) as JSX.Element
    const beneath = await next(e)

    return beneath ? (
      <Box flexDirection="column">
        {ours}
        {beneath}
      </Box>
    ) : (
      ours
    )
  })

  on('ui.message', { element: 'echo' }, async ($, e) => {
    const data = e.data as { key?: string }
    const lines = await update($, spikeKeys, keys =>
      [...keys, data.key ?? '?'].slice(-6),
    )

    return { props: { lines } }
  })

  on('ui.render', { component: 'Pane', requestId: SPIKE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    const lines = await read($, spikeKeys)

    return (
      <Box flexDirection="column">
        <Text weight="semibold">surface: {e.surface}, placement: {e.props.placement}</Text>
        {'Client' in elements ? (
          <Box height={10}>
            <elements.Client key="echo" module="./spike-client.tsx" props={{ lines }} />
          </Box>
        ) : (
          <Text dimColor>No Client on this surface.</Text>
        )}
        {'Svg' in elements && (
          <elements.Svg source={SPIKE_SVG} alt="teamod svg" width={120} height={40} />
        )}
        {'Image' in elements && (
          <elements.Image source={{ png: SPIKE_PNG }} columns={8} rows={4} alt="teamod image" />
        )}
      </Box>
    )
  })
}
