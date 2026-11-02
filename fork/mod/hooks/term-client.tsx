import type { ClientKeyEvent, ClientModule } from 'claude-code'

type Span = {
  t: string
  c?: string
  b?: string
  w?: 1
  d?: 1
  i?: 1
  u?: 1
  v?: 1
}
type Frame = { rows: Span[][]; running: boolean; exit?: number | null; scrolled: number }

type Props = {
  term: string
  rev?: number
  acked?: number
  frame?: Frame
  /** Tell the bridge what to attach to, and at what size. */
  height: number
}

type Box = {
  seq: number
  /** Keys sent and not yet answered for, oldest first, each with its number. */
  pending: { seq: number; key: ClientKeyEvent }[]
  frame?: Frame
  rev: number
  stop: () => void
}

const POLL_MS = 80
const MAX_PENDING = 200

/**
 * A terminal's screen. Runs on the drawing thread: it holds the last frame, and
 * every tick posts its unanswered keys and the size it has. A later post in the
 * same frame replaces an undelivered one, so keys stay here until acknowledged.
 */
const TermClient: ClientModule<Props, Box> = (props, surface) => {
  const { Box: Row, Text } = surface.elements
  if (!surface.state) {
    const box: Box = { seq: 0, pending: [], rev: 0, stop: () => undefined }
    const post = (): void => {
      surface.post({
        term: props.term,
        rev: box.rev,
        seq: box.seq,
        keys: box.pending.map(one => one.key),
        cols: surface.columns,
        rows: surface.rows,
      })
    }
    surface.onKey(key => {
      box.seq += 1
      box.pending = [...box.pending, { seq: box.seq, key }].slice(-MAX_PENDING)
      post()
    })
    box.stop = surface.every(POLL_MS, post)
    surface.setState(box)
  }
  const box = surface.state
  if (box) {
    if (props.frame) box.frame = props.frame
    if (props.rev !== undefined) box.rev = props.rev
    if (props.acked !== undefined) {
      const acked = props.acked
      box.pending = box.pending.filter(one => one.seq > acked)
    }
  }
  const frame = box?.frame
  if (!frame) return Text({ dimColor: true, children: 'Opening the terminal... click here to type.' })

  return Row({
    flexDirection: 'column',
    children: frame.rows.map(spans =>
      Text({
        wrap: 'truncate',
        children:
          spans.length === 0
            ? ' '
            : spans.map(s =>
                Text({
                  children: s.t,
                  ...(s.c ? { color: s.c } : {}),
                  ...(s.b ? { backgroundColor: s.b } : {}),
                  ...(s.w ? { weight: 'bold' as const } : {}),
                  ...(s.d ? { dimColor: true } : {}),
                  ...(s.i ? { italic: true } : {}),
                  ...(s.u ? { underline: true } : {}),
                  ...(s.v ? { inverse: true } : {}),
                }),
              ),
      }),
    ),
  })
}

export default TermClient
