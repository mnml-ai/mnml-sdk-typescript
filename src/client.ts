import { MnmlError, MnmlTimeoutError, type MnmlIssue } from './errors.js';
import type {
  Account,
  CreateEdit,
  CreateEnhancement,
  CreateRender,
  CreateVideo,
  Engines,
  Job,
  JobCanceled,
  JobOutput,
  JobStarted,
  RenderStarted,
  Upload,
} from './types.js';

export const VERSION = '0.1.0';

const DEFAULT_BASE_URL = 'https://api.mnml.ai';

export interface MnmlOptions {
  /** Your API key (`mk_live_…`). Defaults to the `MNML_API_KEY` environment variable. */
  apiKey?: string;
  /** Defaults to `https://api.mnml.ai`. */
  baseUrl?: string;
  /** Retries for a 429, a 5xx or a dropped connection. Default 2. */
  maxRetries?: number;
  /** Per request, in milliseconds. Default 60 000. */
  timeoutMs?: number;
  /** A `fetch` to use instead of the global one. */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /**
   * Makes a retry of a spending call return the first answer instead of
   * charging again. The client makes one per call when you pass none, and
   * keeps it across its own retries.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface WaitOptions {
  /** Between reads, in milliseconds. Default 3 000 (use more for video). */
  intervalMs?: number;
  /** Give up after this long, in milliseconds. Default 10 minutes. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DownloadedFile {
  data: Uint8Array;
  contentType: string | null;
}

/** `create` and then `jobs.wait`: the idempotency key for the create, the wait's own options. */
export type CreateAndWaitOptions = Pick<RequestOptions, 'idempotencyKey'> & WaitOptions;

export type UploadInput =
  | { file: Blob | ArrayBuffer | Uint8Array; filename?: string; purpose?: 'image' | 'mask' }
  | { url: string; purpose?: 'image' | 'mask' };

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
/** A longer `Retry-After` (a daily limit runs to midnight UTC) is the caller's to handle. */
const MAX_RETRY_AFTER_MS = 60_000;
const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** The caller's signal and the per-request timeout as one signal (`AbortSignal.any` needs Node 20). */
function withTimeout(ms: number, signal?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('The request timed out.', 'TimeoutError')),
    ms,
  );
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function envKey(): string | undefined {
  return typeof process !== 'undefined' ? process.env?.['MNML_API_KEY'] : undefined;
}

/**
 * A UUID v4. `crypto.randomUUID` where the runtime has it; Node 18 has no
 * global `crypto`, and a key only has to be unique, not secret, so the
 * fallback builds the same format from `Math.random`.
 */
function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 0.5 s, 1 s, 2 s … with a little jitter. */
function backoff(attempt: number): number {
  return 500 * 2 ** attempt + Math.floor(Math.random() * 250);
}

/**
 * The mnml API client. Every call returns the answer's `data`; a refusal
 * throws `MnmlError` with the API's code.
 *
 * ```ts
 * const mnml = new Mnml();
 * const { id } = await mnml.renders.create({ prompt: 'Timber facade, dusk', image_url });
 * const job = await mnml.jobs.wait(id);
 * console.log(job.outputs[0]?.url);
 * ```
 */
export class Mnml {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MnmlOptions = {}) {
    const key = options.apiKey ?? envKey();
    if (!key) throw new Error('Pass apiKey, or set the MNML_API_KEY environment variable.');
    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    const f = options.fetch ?? globalThis.fetch;
    if (!f) throw new Error('No fetch available: use Node 18 or newer, or pass options.fetch.');
    this.fetchImpl = f;
  }

  /** Renders from a source image or a prompt alone. `count` starts several jobs at once. */
  readonly renders = {
    create: (body: CreateRender, opts?: RequestOptions) =>
      this.request<RenderStarted>('POST', '/v1/renders', { json: body, ...opts }),
    /** Starts the render and waits for every job it started (one per `count`). */
    createAndWait: async (body: CreateRender, opts: CreateAndWaitOptions = {}): Promise<Job[]> => {
      const started = await this.renders.create(body, startOptions(opts));
      return this.jobs.waitAll(started.ids, opts);
    },
  };

  /** Prompt edits and erasing, over the whole image or a region. */
  readonly edits = {
    create: (body: CreateEdit, opts?: RequestOptions) =>
      this.request<JobStarted>('POST', '/v1/edits', { json: body, ...opts }),
    createAndWait: async (body: CreateEdit, opts: CreateAndWaitOptions = {}): Promise<Job> =>
      this.jobs.wait((await this.edits.create(body, startOptions(opts))).id, opts),
  };

  /** Upscale, enhance, background removal and outpainting. */
  readonly enhancements = {
    create: (body: CreateEnhancement, opts?: RequestOptions) =>
      this.request<JobStarted>('POST', '/v1/enhancements', { json: body, ...opts }),
    createAndWait: async (body: CreateEnhancement, opts: CreateAndWaitOptions = {}): Promise<Job> =>
      this.jobs.wait((await this.enhancements.create(body, startOptions(opts))).id, opts),
  };

  /** Video from a still image. A clip takes minutes: wait with a longer `intervalMs`. */
  readonly videos = {
    create: (body: CreateVideo, opts?: RequestOptions) =>
      this.request<JobStarted>('POST', '/v1/videos', { json: body, ...opts }),
    createAndWait: async (body: CreateVideo, opts: CreateAndWaitOptions = {}): Promise<Job> =>
      this.jobs.wait((await this.videos.create(body, startOptions(opts))).id, {
        intervalMs: 10_000,
        timeoutMs: 20 * 60_000,
        ...opts,
      }),
  };

  /** Upload an image (or have the API fetch a public URL) to use as a source. */
  readonly uploads = {
    create: (input: UploadInput, opts?: RequestOptions) => {
      if ('url' in input) {
        return this.request<Upload>('POST', '/v1/uploads', { json: input, ...opts });
      }
      const form = new FormData();
      const blob = input.file instanceof Blob ? input.file : new Blob([input.file as BlobPart]);
      form.set('file', blob, input.filename ?? 'image');
      if (input.purpose) form.set('purpose', input.purpose);
      return this.request<Upload>('POST', '/v1/uploads', { form, ...opts });
    },
  };

  readonly jobs = {
    get: (id: string, opts?: RequestOptions) =>
      this.request<Job>('GET', `/v1/jobs/${encodeURIComponent(id)}`, opts),
    /** Cancels a job; one cancelled before it produced anything is refunded. */
    cancel: (id: string, opts?: RequestOptions) =>
      this.request<JobCanceled>('POST', `/v1/jobs/${encodeURIComponent(id)}/cancel`, opts),
    /** Reads the job until it succeeds, fails or is cancelled, and returns it. */
    wait: async (id: string, opts: WaitOptions = {}): Promise<Job> => {
      const interval = opts.intervalMs ?? 3000;
      const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
      for (;;) {
        const job = await this.jobs.get(id, opts.signal ? { signal: opts.signal } : undefined);
        if (TERMINAL.has(job.status)) return job;
        if (Date.now() + interval > deadline) throw new MnmlTimeoutError(id);
        await sleep(interval, opts.signal);
      }
    },
    /** `wait` for several jobs at once, such as every id a render with `count` started. */
    waitAll: (ids: readonly string[], opts: WaitOptions = {}): Promise<Job[]> =>
      Promise.all(ids.map((id) => this.jobs.wait(id, opts))),
  };

  /** A job's outputs. Their links are signed and expire, so download what you keep. */
  readonly files = {
    /**
     * The file behind an output (or its `url`): its bytes and content type
     * (`image/jpeg`, `image/png`, `image/webp` or `video/mp4`). The signature
     * in the link is the credential, so your key is not sent with it. An
     * expired link throws `MnmlError` with `NOT_FOUND`: read the job again for
     * a fresh one.
     */
    download: async (
      output: JobOutput | string,
      opts: { signal?: AbortSignal } = {},
    ): Promise<DownloadedFile> => {
      const url = typeof output === 'string' ? output : output.url;
      const res = await this.send(url, { method: 'GET', headers: this.baseHeaders() }, opts.signal);
      if (!res.ok) throw errorFrom(res, await res.json().catch(() => null));
      return {
        data: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get('content-type'),
      };
    },
  };

  /** The key's account: balance, tier and limits. */
  readonly account = {
    get: (opts?: RequestOptions) => this.request<Account>('GET', '/v1/account', opts),
  };

  /** The engines and video models, with their prices and capabilities. */
  readonly engines = {
    list: (opts?: RequestOptions) => this.request<Engines>('GET', '/v1/engines', opts),
  };

  /** Headers every call carries, the key aside. */
  private baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    // Not in a browser: a header the API's CORS rules do not allow would fail the preflight.
    if (typeof window === 'undefined') headers['user-agent'] = `mnml-sdk-typescript/${VERSION}`;
    return headers;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: RequestOptions & { json?: unknown; form?: FormData } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...this.baseHeaders(),
      authorization: `Bearer ${this.apiKey}`,
      accept: 'application/json',
    };
    if (method === 'POST') headers['idempotency-key'] = opts.idempotencyKey ?? newIdempotencyKey();
    let body: string | FormData | undefined;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.json);
    } else if (opts.form) body = opts.form;

    const res = await this.send(
      `${this.baseUrl}${path}`,
      { method, headers, ...(body !== undefined ? { body } : {}) },
      opts.signal,
    );
    const json = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (res.ok && json?.success) return json.data as T;
    throw errorFrom(res, json);
  }

  /**
   * One call with the client's retries: a 429, a 5xx or a dropped connection
   * is sent again (the same headers, so the same idempotency key) after
   * `Retry-After` or a backoff. The last answer is returned, whatever it is.
   */
  private async send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const timeout = withTimeout(this.timeoutMs, signal);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { ...init, signal: timeout.signal });
      } catch (err) {
        timeout.done();
        if (signal?.aborted || attempt >= this.maxRetries) throw err;
        await sleep(backoff(attempt), signal);
        continue;
      }
      timeout.done();
      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : backoff(attempt);
        if (wait <= MAX_RETRY_AFTER_MS) {
          await res.body?.cancel().catch(() => undefined);
          await sleep(wait, signal);
          continue;
        }
      }
      return res;
    }
  }
}

/** The create call's own options, out of a `createAndWait`'s. */
function startOptions(opts: CreateAndWaitOptions): RequestOptions {
  return {
    ...(opts.idempotencyKey !== undefined ? { idempotencyKey: opts.idempotencyKey } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
}

/** The API's answer envelope: `data` on a success, `error` on a refusal. */
type Envelope<T> = {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown; issues?: MnmlIssue[] };
};

/**
 * A refusal as `MnmlError`, from the API's error envelope when the answer has
 * one. Takes the body already read: a response's body is read once, never
 * cloned, since a cloned body stalls under Node 18's stream timers.
 */
function errorFrom(res: Response, json: Envelope<unknown> | null): MnmlError {
  const error = json && json.success === false ? json.error : undefined;
  return new MnmlError(
    error?.code ?? 'HTTP_ERROR',
    error?.message ?? `The API answered ${res.status}.`,
    res.status,
    res.headers.get('x-request-id'),
    error?.details,
    Array.isArray(error?.issues) ? error.issues : [],
  );
}
