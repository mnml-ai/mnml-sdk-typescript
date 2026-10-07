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
      image: 'https://e.com/a.png',
    });
    expect(started.credits_charged).toBe(25);
    const [call] = f.calls;
    expect(call!.url).toBe('https://api.mnml.ai/v1/renders');
    expect(header(call!, 'authorization')).toBe('Bearer mk_live_x');
    expect(JSON.parse(call!.init.body as string)).toEqual({
      prompt: 'Timber facade',
      image: 'https://e.com/a.png',
    });
    expect(header(call!, 'idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(header(call!, 'user-agent')).toMatch(/^mnml-sdk-typescript\/\d+\.\d+\.\d+$/);
  });

  it('sends bytes as a base64 data URI, and a string as it is', async () => {
    const started = { id: '1', status: 'queued', credits_charged: 25, replayed: false, notes: [] };
    const f = fakeFetch([ok({ ...started, ids: ['1'] }, 202), ok(started, 202), ok(started, 202)]);
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 4, 5]);
    const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
    await mnml.renders.create({
      prompt: 'Timber facade',
      image: png,
      references: [
        'https://e.com/ref.png',
        new Blob([jpeg]),
        { image: jpeg.buffer, mode: 'material' },
      ],
    });
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({
      prompt: 'Timber facade',
      image: `data:image/png;base64,${b64(png)}`,
      references: [
        'https://e.com/ref.png',
        `data:image/jpeg;base64,${b64(jpeg)}`,
        { image: `data:image/jpeg;base64,${b64(jpeg)}`, mode: 'material' },
      ],
    });
    await mnml.edits.create({ image: 'https://e.com/a.png', prompt: 'A green roof', mask: png });
    expect(JSON.parse(f.calls[1]!.init.body as string)).toMatchObject({
      image: 'https://e.com/a.png',
      mask: `data:image/png;base64,${b64(png)}`,
    });
    await mnml.videos.create({ job_id: '12', end_frame: Buffer.from(jpeg) });
    expect(JSON.parse(f.calls[2]!.init.body as string)).toEqual({
      job_id: '12',
      end_frame: `data:image/jpeg;base64,${b64(jpeg)}`,
    });
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

  it('waits for a job to settle, asking the API to hold each read', async () => {
    vi.useFakeTimers();
    const job = (status: string) => ok({ id: '9', status, outputs: [] });
    const f = fakeFetch([job('queued'), job('processing'), job('succeeded')]);
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl });
    const p = mnml.jobs.wait('9', { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toMatchObject({ status: 'succeeded' });
    expect(f.calls.map((c) => c.url)).toEqual(
      Array(3).fill('https://api.mnml.ai/v1/jobs/9?wait=90'),
    );
  });

  it('asks for no longer than the wait has left, and reads plainly at the end', async () => {
    const f = fakeFetch([
      ok({ id: '9', status: 'processing', outputs: [] }),
      ok({ id: '9', status: 'succeeded', outputs: [] }),
      ok({ id: '9', status: 'succeeded', outputs: [] }),
    ]);
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl });
    await mnml.jobs.wait('9', { intervalMs: 0, timeoutMs: 30_500 });
    expect(f.calls[0]!.url).toBe('https://api.mnml.ai/v1/jobs/9?wait=30');
    await mnml.jobs.get('9');
    expect(f.calls[2]!.url).toBe('https://api.mnml.ai/v1/jobs/9');
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

  it('starts a render and waits for every job its count started', async () => {
    vi.useFakeTimers();
    const job = (id: string, status: string) => ok({ id, status, outputs: [] });
    const f = fakeFetch([
      ok(
        {
          id: '1',
          ids: ['1', '2'],
          status: 'queued',
          credits_charged: 2,
          replayed: false,
          notes: [],
        },
        202,
      ),
      job('1', 'processing'),
      job('2', 'succeeded'),
      job('1', 'succeeded'),
    ]);
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl });
    const p = mnml.renders.createAndWait(
      { prompt: 'x', count: 2 },
      { idempotencyKey: 'brief-1', intervalMs: 1000 },
    );
    await vi.advanceTimersByTimeAsync(1000);
    const jobs = await p;
    expect(jobs.map((j) => [j.id, j.status])).toEqual([
      ['1', 'succeeded'],
      ['2', 'succeeded'],
    ]);
    expect(header(f.calls[0]!, 'idempotency-key')).toBe('brief-1');
    expect(f.calls.slice(1).every((c) => c.init.method === 'GET')).toBe(true);
  });

  it('asks the API to hold a render, and polls nothing when it comes back settled', async () => {
    const done = { id: '7', status: 'succeeded', outputs: [{ url: 'u', media: 'image' }] };
    const f = fakeFetch([
      ok({
        id: '7',
        ids: ['7'],
        status: 'succeeded',
        credits_charged: 25,
        replayed: false,
        notes: [],
        jobs: [done],
      }),
      ok(
        { id: '8', ids: ['8'], status: 'queued', credits_charged: 25, replayed: false, notes: [] },
        202,
      ),
    ]);
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl });
    const jobs = await mnml.renders.createAndWait({ prompt: 'x' });
    expect(jobs).toEqual([done]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe('https://api.mnml.ai/v1/renders?wait=90');
    await mnml.renders.create({ prompt: 'x' }, { wait: 30 });
    expect(f.calls[1]!.url).toBe('https://api.mnml.ai/v1/renders?wait=30');
  });

  it('starts an edit and returns the settled job', async () => {
    const f = fakeFetch([
      ok({ id: '5', status: 'queued', credits_charged: 1, replayed: false, notes: [] }, 202),
      ok({ id: '5', status: 'failed', outputs: [], error: { code: 'NO_CHANGE', message: 'm' } }),
    ]);
    const job = await new Mnml({ apiKey: 'k', fetch: f.impl }).edits.createAndWait({
      job_id: '3',
      prompt: 'Dark brick',
    });
    expect(job).toMatchObject({ id: '5', status: 'failed' });
    expect(f.calls[1]!.url).toBe('https://api.mnml.ai/v1/jobs/5?wait=90');
  });

  it('downloads an output without sending the key', async () => {
    const f = fakeFetch([
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    ]);
    const mnml = new Mnml({ apiKey: 'mk_live_x', fetch: f.impl });
    const url = 'https://api.mnml.ai/v1/files/9?exp=1&sig=abc';
    const file = await mnml.files.download({ url, media: 'image', expires_at: 'x' });
    expect([...file.data]).toEqual([137, 80, 78, 71]);
    expect(file.contentType).toBe('image/png');
    expect(f.calls[0]!.url).toBe(url);
    expect(header(f.calls[0]!, 'authorization')).toBeUndefined();
  });

  it('throws NOT_FOUND for an expired output link', async () => {
    const f = fakeFetch([fail(404, 'NOT_FOUND')]);
    const mnml = new Mnml({ apiKey: 'k', fetch: f.impl });
    await expect(
      mnml.files.download('https://api.mnml.ai/v1/files/9?exp=1&sig=x'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});
