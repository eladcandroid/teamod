import { describe, expect, it } from 'vitest';
import { type CompactMark, type DomainState, type LogItem, initialState, reduce } from '../src/core/store.js';
import { compactText, parseContextEvent } from '../src/core/context-log.js';

const CH = 'ws:w1';
const ev = (event: 'context' | 'compact', data: object, ts = 1000, requestId = 'r1') =>
  ({ type: 'agent_event' as const, owner: 'me', requestId, requester: 'me', event, text: JSON.stringify(data), ts, channel: CH, itemId: requestId });
/** A compaction divider in the chat. */
type CompactItem = Extract<LogItem, { type: 'system' }> & { readonly compact: CompactMark };
const isCompactItem = (l: LogItem): l is CompactItem => l.type === 'system' && Boolean((l as { compact?: CompactMark }).compact);
const dividers = (s: DomainState) => s.log.filter(isCompactItem);

describe('compaction in the chat', () => {
  it('shows "Compacting…" where it starts, then the result there, with the summary Claude kept', () => {
    let s = initialState('room');
    s = reduce(s, ev('context', { used: 172_000, window: 200_000 }));
    s = reduce(s, { type: 'system', text: 'something else happened', channel: CH, id: 'x', ts: 1500 });
    s = reduce(s, ev('context', { compacting: true, trigger: 'auto', used: 172_000, window: 200_000 }, 2000, 'compact-1'));
    expect(s.context[CH]).toMatchObject({ used: 172_000, compacting: true });
    expect(dividers(s)).toHaveLength(1);
    expect(dividers(s)[0]).toMatchObject({ compact: { state: 'running', trigger: 'auto' }, text: 'Compacting the conversation…' });
    // A message lands after it started; the divider stays where the compaction began.
    s = reduce(s, { type: 'system', text: 'later', channel: CH, id: 'y', ts: 2500 });
    s = reduce(s, ev('compact', { pre: 172_000, post: 21_000, trigger: 'auto', summary: '## Kept\n- the plan' }, 3000, 'compact-1'));
    const [d] = dividers(s);
    expect(d).toMatchObject({ ts: 2000, compact: { state: 'done', pre: 172_000, post: 21_000, trigger: 'auto', summary: '## Kept\n- the plan' }, text: 'Context compacted: 172k → 21k tokens (88% freed)' });
    expect(s.log.map((l) => l.id)).toEqual(['x', d!.id, 'y']);
    expect(s.context[CH]).toEqual({ used: 21_000, window: 200_000 });
    expect(s.compactions[CH]).toEqual({ pre: 172_000, post: 21_000, at: 3000 });
  });

  it('adds a summary that arrives after its compaction to that divider', () => {
    let s = initialState('room');
    s = reduce(s, ev('compact', { pre: 150_000, post: 18_000, key: 'b1' }, 1000));
    s = reduce(s, ev('compact', { pre: 120_000, post: 15_000, key: 'b2' }, 2000, 'r2'));
    s = reduce(s, ev('compact', { key: 'b1', summary: 'first summary' }, 3000));
    expect(dividers(s).map((d) => d.compact.summary)).toEqual(['first summary', undefined]);
    // Without a key: the newest one that has none yet.
    s = reduce(s, ev('compact', { summary: 'second summary' }, 4000));
    expect(dividers(s).map((d) => d.compact.summary)).toEqual(['first summary', 'second summary']);
    // The same compaction reported again doesn't add a second divider.
    s = reduce(s, ev('compact', { pre: 120_000, post: 15_000, key: 'b2' }, 5000, 'r3'));
    expect(dividers(s)).toHaveLength(2);
    // A summary for nothing known is ignored.
    expect(reduce(s, ev('compact', { key: 'nope', summary: 'x' }))).toBe(s);
  });

  it('says a compaction didn’t finish when it stops before Claude is done (nothing is lost)', () => {
    let s = initialState('room');
    s = reduce(s, ev('context', { compacting: true }, 1000, 'compact-2'));
    expect(s.context[CH]).toMatchObject({ used: 0, compacting: true });
    s = reduce(s, ev('context', { compacting: false, used: 160_000, window: 200_000 }, 2000, 'compact-2'));
    expect(dividers(s)[0]).toMatchObject({ level: 'warn', compact: { state: 'failed' } });
    expect(s.context[CH]).toEqual({ used: 160_000, window: 200_000 });
    expect(compactText({ state: 'failed' })).toMatch(/unchanged/);
  });

  it('keeps the breakdown and model with the numbers until new numbers come', () => {
    let s = initialState('room');
    s = reduce(s, ev('context', { used: 90_000, window: 1_000_000, model: 'opus[1m]', breakdown: { conversation: 50_000, tools: 30_000, system: 10_000 } }));
    s = reduce(s, ev('context', { used: 95_000 }));
    expect(s.context[CH]).toEqual({ used: 95_000, window: 1_000_000, model: 'opus[1m]' });
  });

  it('reads peers’ JSON defensively', () => {
    expect(parseContextEvent('not json')).toBeUndefined();
    expect(parseContextEvent('7')).toBeUndefined();
    expect(parseContextEvent(JSON.stringify({ used: -5, window: 'big', trigger: 'sometimes', summary: '  ', breakdown: { conversation: 1 }, key: 3 }))).toEqual({});
    expect(parseContextEvent(JSON.stringify({ summary: 'x'.repeat(50_000) }))!.summary).toHaveLength(40_000);
  });
});
