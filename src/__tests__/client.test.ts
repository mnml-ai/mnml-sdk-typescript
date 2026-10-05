import { afterEach, describe, expect, it, vi } from 'vitest';

import { Mnml, MnmlError, MnmlTimeoutError } from '../index.js';

/* The client against a fake API: envelope, retries, idempotency, polling, uploads. */

type Call = { url: string; init: RequestInit };

function fakeFetch(answers: (Response | Error)[]) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return next;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'x-request-id': 'req_1' },
  });
const fail = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ success: false, error: { code, message: `${code} happened` } }), {
    status,
    headers: { 'x-request-id': 'req_2', ...headers },
  });

const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

afterEach(() => {
  vi.useRealTimers();
});

describe('Mnml', () => {
  it('needs a key', () => {
    const saved = process.env['MNML_API_KEY'];
    delete process.env['MNML_API_KEY'];
    expect(() => new Mnml()).toThrow(/MNML_API_KEY/);
    if (saved !== undefined) process.env['MNML_API_KEY'] = saved;
  });

  it('sends the key and the body, and returns data', async () => {
    const f = fakeFetch([
      ok(
        { id: '1', ids: ['1'], status: 'queued', credits_charged: 25, replayed: false, notes: [] },
        202,
      ),
    ]);
    const mnml = new Mnml({ apiKey: 'mk_live_x', fetch: f.impl });
    const started = await mnml.renders.create({
      prompt: 'Timber facade',
      image_url: 'https://e.com/a.png',
    });
    expect(started.credits_charged).toBe(25);
    const [call] = f.calls;
    expect(call!.url).toBe('https://api.mnml.ai/v1/renders');
    expect(header(call!, 'authorization')).toBe('Bearer mk_live_x');
    expect(JSON.parse(call!.init.body as string)).toEqual({
      prompt: 'Timber facade',
      image_url: 'https://e.com/a.png',
    });
    expect(header(call!, 'idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(header(call!, 'user-agent')).toMatch(/^mnml-sdk-typescript\/\d+\.\d+\.\d+$/);
  });

  it('sends no idempotency key on a read', async () => {
    const f = fakeFetch([ok({ engines: [], video_models: [] })]);
    await new Mnml({ apiKey: 'k', fetch: f.impl }).engines.list();
    expect(header(f.calls[0]!, 'idempotency-key')).toBeUndefined();
  });

  it('retries a dropped connection, then answers', async () => {
    vi.useFakeTimers();
    const f = fakeFetch([new TypeError('fetch failed'), ok({ id: 'a' })]);
    const p = new Mnml({ apiKey: 'k', fetch: f.impl }).account.get();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toMatchObject({ id: 'a' });
    expect(f.calls).toHaveLength(2);
  });

  it('does not retry once the caller aborts', async () => {
    const controller = new AbortController();
    const f = fakeFetch([new DOMException('aborted', 'AbortError')]);
    controller.abort();
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl });
    await expect(mnml.account.get({ signal: controller.signal })).rejects.toBeDefined();
    expect(f.calls).toHaveLength(1);
  });

  it('keeps a key you pass, across retries', async () => {
    vi.useFakeTimers();
    const f = fakeFetch([fail(500, 'INTERNAL'), ok({ id: '1', ids: ['1'] }, 202)]);
    const p = new Mnml({ apiKey: 'k', fetch: f.impl }).renders.create(
      { prompt: 'x' },
      { idempotencyKey: 'mine-1' },
    );
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(f.calls.map((c) => header(c, 'idempotency-key'))).toEqual(['mine-1', 'mine-1']);
  });

  it('retries a 429 after Retry-After with the same idempotency key', async () => {
    vi.useFakeTimers();
    const f = fakeFetch([
      fail(429, 'RATE_LIMITED', { 'retry-after': '2' }),
      ok({ id: '7', status: 'queued', credits_charged: 5, replayed: false, notes: [] }, 202),
    ]);
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl });
    const p = mnml.edits.create({ job_id: '3', prompt: 'Dark brick' });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toMatchObject({ id: '7' });
    expect(f.calls).toHaveLength(2);
    expect(header(f.calls[0]!, 'idempotency-key')).toBe(header(f.calls[1]!, 'idempotency-key'));
  });

  it('throws the API’s own error, with its code and request id', async () => {
    const f = fakeFetch([fail(402, 'INSUFFICIENT_CREDITS')]);
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl });
    const err = await mnml.videos.create({ job_id: '3' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MnmlError);
    expect(err).toMatchObject({ code: 'INSUFFICIENT_CREDITS', status: 402, requestId: 'req_2' });
  });

  it('hands back a long Retry-After (a daily limit) instead of sleeping on it', async () => {
    const f = fakeFetch([fail(429, 'RATE_LIMITED', { 'retry-after': '3600' })]);
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl });
    await expect(mnml.account.get()).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(f.calls).toHaveLength(1);
  });

  it('lists the fields a validation refusal names', async () => {
    const body = {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Check the fields.',
        issues: [{ path: 'prompt', message: 'Required' }],
      },
    };
    const f = fakeFetch([new Response(JSON.stringify(body), { status: 400 })]);
    const err = await new Mnml({ apiKey: 'k', fetch: f.impl }).renders
      .create({ prompt: '' })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'VALIDATION_FAILED',
      issues: [{ path: 'prompt', message: 'Required' }],
    });
  });

  it('gives up after maxRetries on a 5xx', async () => {
    const f = fakeFetch([
      fail(503, 'SERVICE_UNAVAILABLE', { 'retry-after': '0.001' }),
      fail(503, 'SERVICE_UNAVAILABLE'),
    ]);
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl, maxRetries: 1 });
    await expect(mnml.account.get()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(f.calls).toHaveLength(2);
  });

  it('waits for a job to settle', async () => {
    vi.useFakeTimers();
    const job = (status: string) => ok({ id: '9', status, outputs: [] });
    const f = fakeFetch([job('queued'), job('processing'), job('succeeded')]);
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl });
    const p = mnml.jobs.wait('9', { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toMatchObject({ status: 'succeeded' });
    expect(f.calls.every((c) => c.url.endsWith('/v1/jobs/9'))).toBe(true);
  });

  it('stops waiting at the deadline, leaving the job running', async () => {
    const f = fakeFetch([ok({ id: '9', status: 'processing', outputs: [] })]);
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl });
    await expect(mnml.jobs.wait('9', { intervalMs: 1000, timeoutMs: 10 })).rejects.toBeInstanceOf(
      MnmlTimeoutError,
    );
  });

  it('uploads a file as multipart, or a URL as JSON', async () => {
    const uploaded = {
      id: 'u1',
      width: 1,
      height: 1,
      size_bytes: 3,
      purpose: 'image',
      created_at: 'x',
    };
    const f = fakeFetch([ok(uploaded, 201), ok(uploaded, 201)]);
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl, baseUrl: 'https://api.example.com/' });
    await mnml.uploads.create({
      file: new Uint8Array([1, 2, 3]),
      filename: 'a.png',
      purpose: 'mask',
    });
    const form = f.calls[0]!.init.body as FormData;
    expect(form.get('purpose')).toBe('mask');
    expect((form.get('file') as File).name).toBe('a.png');
    expect(f.calls[0]!.url).toBe('https://api.example.com/v1/uploads');
    await mnml.uploads.create({ url: 'https://e.com/a.png' });
    expect(JSON.parse(f.calls[1]!.init.body as string)).toEqual({ url: 'https://e.com/a.png' });
  });
});
