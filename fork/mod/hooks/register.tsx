import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WorkView } from '../types'
import { call, ensureBridge, homeOf, readLink, readProblem, readRev, viewOf } from './link'

const WORK = 'work'
const SPIKE = 'spike'

const isAdding = atom({ plugin: 'teamod', key: 'isAdding' } as const, false)
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
      argumentHint: '[setup|status|spike]',
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
    const verb = e.args.trim().split(/\s+/)[0] ?? ''
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
    const opened = await $.ui.open({ id: WORK, title: 'Work', focus: true })

    return { text: opened.isPlaced ? 'Work pane opened.' : `Work pane waits: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: WORK }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const current = await readLink($)
    const issue = await readProblem($)
    await readRev($, WORK)
    if (!current) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{issue?.text ?? 'Starting teamod...'}</Text>
        </Box>
      )
    }
    const view = await viewOf<WorkView>($, WORK)
    const adding = await read($, isAdding)
    const addProject = async (path: string): Promise<void> => {
      await update($, isAdding, () => false)
      const added = await call($, 'projects.add', [path.trim()])
      if (!added.ok) $.ui.toast(`Could not add it: ${added.error}`)
    }

    return (
      <Box flexDirection="column">
        {!current.connected && <Text color="warning">Reconnecting to the engine...</Text>}
        {adding && 'Input' in elements ? (
          <elements.Input
            key="add-path"
            label="Folder"
            placeholder="/path/to/repository"
            submitLabel="add"
            autoFocus
            onSubmit={value => void addProject(value)}
          />
        ) : (
          <Button key="add" hotkey="a" onPress={() => void update($, isAdding, () => true)}>
            Add Project
          </Button>
        )}
        {view?.projects.length === 0 && <Text dimColor>No projects yet.</Text>}
        {view?.projects.map(project => (
          <Box flexDirection="column">
            <Text weight="semibold">{project.name}</Text>
            <Text dimColor>
              {project.root} · {project.worktrees} worktree{project.worktrees === 1 ? '' : 's'}
            </Text>
            {project.error !== undefined && <Text color="error">{project.error}</Text>}
          </Box>
        ))}
      </Box>
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
