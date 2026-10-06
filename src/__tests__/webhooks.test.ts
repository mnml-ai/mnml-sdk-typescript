import { createHmac, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { WebhookVerificationError, signWebhook, verifyWebhook } from '../webhooks.js';

// A throwaway secret made fresh for every run: no secret, real or sample, lives in this repo.
const KEY = randomBytes(24);
const SECRET = `whsec_${KEY.toString('base64')}`;

describe('webhook verification', () => {
  it('signs as Standard Webhooks does: HMAC-SHA256 of id.timestamp.body under the decoded secret', () => {
    const expected = createHmac('sha256', KEY)
      .update('msg_1.1614265330.{"test":1}')
      .digest('base64');
    expect(signWebhook(SECRET, 'msg_1', 1614265330, '{"test":1}')).toBe(`v1,${expected}`);
    // The `whsec_` prefix is optional.
    expect(signWebhook(KEY.toString('base64'), 'msg_1', 1614265330, '{"test":1}')).toBe(
      `v1,${expected}`,
    );
  });

  const now = new Date('2026-10-04T12:00:00Z');
  const ts = Math.floor(now.getTime() / 1000);
  const body = JSON.stringify({
    type: 'job.succeeded',
    timestamp: now.toISOString(),
    data: { id: '42' },
  });
  const headers = {
    'webhook-id': 'msg_1',
    'webhook-timestamp': String(ts),
    'webhook-signature': signWebhook(SECRET, 'msg_1', ts, body),
  };

  it('returns the event for a genuine delivery, from a plain object or a Headers', () => {
    expect(verifyWebhook(body, headers, SECRET, now).data).toEqual({ id: '42' });
    expect(verifyWebhook(body, new Headers(headers), SECRET, now).type).toBe('job.succeeded');
  });

  it('accepts any one of several signatures (a rotation)', () => {
    const both = { ...headers, 'webhook-signature': `v1,bm90IGl0 ${headers['webhook-signature']}` };
    expect(() => verifyWebhook(body, both, SECRET, now)).not.toThrow();
  });

  it('refuses a changed body, another secret, an old timestamp or missing headers', () => {
    expect(() => verifyWebhook(body.replace('42', '43'), headers, SECRET, now)).toThrow(
      WebhookVerificationError,
    );
    expect(() =>
      verifyWebhook(body, headers, `whsec_${randomBytes(24).toString('base64')}`, now),
    ).toThrow(WebhookVerificationError);
    expect(() =>
      verifyWebhook(body, headers, SECRET, new Date(now.getTime() + 6 * 60_000)),
    ).toThrow(/too old/);
    expect(() => verifyWebhook(body, {}, SECRET, now)).toThrow(/Missing/);
  });

  it('narrows the event on its type', () => {
    const low = JSON.stringify({
      type: 'credits.low',
      timestamp: now.toISOString(),
      data: { balance: 40, threshold: 100 },
    });
    const event = verifyWebhook(
      low,
      { ...headers, 'webhook-signature': signWebhook(SECRET, 'msg_1', ts, low) },
      SECRET,
      now,
    );
    if (event.type !== 'credits.low') throw new Error('expected credits.low');
    expect(event.data.balance).toBeLessThan(event.data.threshold);
  });
});
