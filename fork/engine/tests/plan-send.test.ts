import { describe, expect, it } from 'vitest';
import { attachment, expandChips, registerAttachment } from '../src/core/attachments.js';

describe('plan chat Retry (ACME-69)', () => {
  it('teamod keeps an image after its message took it, so a later expand still links it', () => {
    const a = registerAttachment('/tmp/teamod-test/shot.png', 2048);
    const first = expandChips(`see [image ${a.n}]`, 'me');
    // Sending (and the box's take) doesn't forget it: a Retry expands it the same way.
    expect(attachment(a.n)).toEqual(a);
    expect(expandChips(`see [image ${a.n}]`, 'me').text).toBe(first.text);
    expect(first.text).toContain('shot.png');
  });
});
