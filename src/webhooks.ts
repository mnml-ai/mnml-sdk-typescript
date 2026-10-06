import { createHmac, timingSafeEqual } from 'node:crypto';

import type { WebhookEvent } from './types.js';

export type { CreditsLow, WebhookEvent, WebhookEventType } from './types.js';

/**
 * Verify a webhook delivery: the Standard Webhooks scheme the API signs with
 * (`webhook-id`, `webhook-timestamp`, `webhook-signature`, HMAC-SHA256 of
 * `id.timestamp.body` under your `whsec_` secret). Pass the RAW body — the
 * exact bytes received, before any JSON parsing — or the check fails.
 *
 * Server-side only (it uses `node:crypto`), so it is its own entry point:
 * `import { verifyWebhook } from '@mnml-ai/sdk/webhooks'`.
 */

const TOLERANCE_SECS = 5 * 60;

type Headers = Record<string, string | string[] | undefined> | { get(name: string): string | null };

function header(headers: Headers, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(name: string): string | null }).get(name) ?? undefined;
  }
  const v = (headers as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? v[0] : v;
}

export class WebhookVerificationError extends Error {
  override readonly name = 'WebhookVerificationError';
}

export function signWebhook(
  secret: string,
  id: string,
  timestampSecs: number,
  body: string,
): string {
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestampSecs}.${body}`).digest('base64')}`;
}

/**
 * The parsed event, or a throw when the signature or the timestamp does not
 * hold. Narrow on `event.type` to read `event.data`.
 */
export function verifyWebhook(
  rawBody: string | Uint8Array,
  headers: Headers,
  secret: string,
  now: Date = new Date(),
): WebhookEvent {
  const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
  const id = header(headers, 'webhook-id');
  const ts = header(headers, 'webhook-timestamp');
  const sig = header(headers, 'webhook-signature');
  if (!id || !ts || !sig) throw new WebhookVerificationError('Missing webhook headers.');
  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp) || Math.abs(now.getTime() / 1000 - timestamp) > TOLERANCE_SECS) {
    throw new WebhookVerificationError('Webhook timestamp is too old or in the future.');
  }
  const expected = Buffer.from(signWebhook(secret, id, timestamp, body));
  // The header may carry several space-separated signatures (during a rotation).
  const ok = sig.split(' ').some((candidate) => {
    const got = Buffer.from(candidate);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new WebhookVerificationError('Webhook signature does not match.');
  return JSON.parse(body) as WebhookEvent;
}
