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
  };

  /** Prompt edits and erasing, over the whole image or a region. */
  readonly edits = {
    create: (body: CreateEdit, opts?: RequestOptions) =>
      this.request<JobStarted>('POST', '/v1/edits', { json: body, ...opts }),
  };

  /** Upscale, enhance, background removal and outpainting. */
  readonly enhancements = {
    create: (body: CreateEnhancement, opts?: RequestOptions) =>
      this.request<JobStarted>('POST', '/v1/enhancements', { json: body, ...opts }),
  };

  /** Video from a still image. */
  readonly videos = {
    create: (body: CreateVideo, opts?: RequestOptions) =>
      this.request<JobStarted>('POST', '/v1/videos', { json: body, ...opts }),
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
  };

  /** The key's account: balance, tier and limits. */
  readonly account = {
    get: (opts?: RequestOptions) => this.request<Account>('GET', '/v1/account', opts),
  };

  /** The engines and video models, with their prices and capabilities. */
  readonly engines = {
    list: (opts?: RequestOptions) => this.request<Engines>('GET', '/v1/engines', opts),
  };

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: RequestOptions & { json?: unknown; form?: FormData } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      accept: 'application/json',
    };
    // Not in a browser: a header the API's CORS rules do not allow would fail the preflight.
    if (typeof window === 'undefined') headers['user-agent'] = `mnml-sdk-typescript/${VERSION}`;
    if (method === 'POST') headers['idempotency-key'] = opts.idempotencyKey ?? newIdempotencyKey();
    let body: string | FormData | undefined;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.json);
    } else if (opts.form) body = opts.form;

    for (let attempt = 0; ; attempt += 1) {
      const timeout = withTimeout(this.timeoutMs, opts.signal);
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers,
          ...(body !== undefined ? { body } : {}),
          signal: timeout.signal,
        });
      } catch (err) {
        timeout.done();
        if (opts.signal?.aborted || attempt >= this.maxRetries) throw err;
        await sleep(backoff(attempt), opts.signal);
        continue;
      }
      timeout.done();
      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : backoff(attempt);
        if (wait <= MAX_RETRY_AFTER_MS) {
          await res.body?.cancel().catch(() => undefined);
          await sleep(wait, opts.signal);
          continue;
        }
      }
      const json = (await res.json().catch(() => null)) as
        | { success: true; data: T }
        | {
            success: false;
            error?: { code?: string; message?: string; details?: unknown; issues?: MnmlIssue[] };
          }
        | null;
      if (res.ok && json && json.success) return json.data;
      const error = json && !json.success ? json.error : undefined;
      throw new MnmlError(
        error?.code ?? 'HTTP_ERROR',
        error?.message ?? `The API answered ${res.status}.`,
        res.status,
        res.headers.get('x-request-id'),
        error?.details,
        Array.isArray(error?.issues) ? error.issues : [],
      );
    }
  }
}
