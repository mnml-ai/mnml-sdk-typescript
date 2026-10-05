/**
 * The mnml API's request and response shapes, as its OpenAPI document
 * (`spec/openapi.json`) states them. `coverage.test.ts` checks every field here
 * against that document, so a field the API adds or renames fails the tests
 * until it is here.
 */

export type Mode =
  'exterior' | 'interior' | 'masterplan' | 'plan' | 'landscape' | 'product' | 'text-to-render';

export type AspectRatio =
  'auto' | '1:1' | '3:2' | '4:3' | '5:4' | '16:9' | '21:9' | '2:3' | '3:4' | '4:5' | '9:16';

/** Where an image comes from: one of your uploads, a public URL, or a finished job. */
export type Source = { upload_id: string } | { image_url: string } | { job_id: string };

export type ReferenceMode = 'auto' | 'style' | 'material' | 'atmosphere' | 'color' | 'geometry';
export type Reference = Source & { mode?: ReferenceMode };

export type Region =
  | { box: { x: number; y: number; width: number; height: number } }
  | { polygon: [number, number][] };

interface Common {
  /** A public https:// URL to send this job's settle event to, signed like every webhook. */
  webhook_url?: string;
}

export type CreateRender = Common &
  Partial<Source> & {
    prompt: string;
    engine?: string;
    mode?: Mode;
    references?: Reference[];
    settings?: Record<string, string>;
    aspect_ratio?: AspectRatio;
    /** Variations of this brief, each its own job and charge. */
    count?: number;
    seed?: number;
  };

export type CreateEdit = Common &
  Source & {
    kind?: 'edit' | 'erase';
    prompt?: string;
    engine?: string;
    mode?: Mode;
    references?: Reference[];
    region?: Region;
    mask_upload_id?: string;
  };

export type EnhancementKind = 'upscale' | 'enhance' | 'bg-remove' | 'outpaint';

export type CreateEnhancement = Common &
  Source & {
    kind: EnhancementKind;
    creativity?: number;
    prompt?: string;
    aspect_ratio?: Exclude<AspectRatio, 'auto'>;
  };

export type CreateVideo = Common &
  Source & {
    model?: string;
    duration_seconds?: number;
    camera_movement?: string;
    motion?: string;
    prompt?: string;
    end_frame?: Source;
    cinematic?: boolean;
  };

export interface JobStarted {
  id: string;
  status: string;
  credits_charged: number;
  /** True when this answers an earlier identical request: nothing new was charged. */
  replayed: boolean;
  notes: string[];
}

export interface RenderStarted extends JobStarted {
  /** Every job the call started; `id` is the first. */
  ids: string[];
}

export type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'canceled';

export interface Job {
  id: string;
  status: JobStatus;
  kind: string;
  engine: string | null;
  outputs: { url: string; media: 'image' | 'video'; expires_at: string }[];
  credits_charged: number;
  credits_refunded: number;
  error: {
    code: 'UNSAFE_CONTENT' | 'NO_CHANGE' | 'CANCELED' | 'RENDER_FAILED';
    message: string;
  } | null;
  created_at: string;
  completed_at: string | null;
}

export interface JobCanceled {
  id: string;
  outcome: 'refunded' | 'requested' | 'too-late' | 'already-settled';
  credits_refunded: number;
}

export interface Upload {
  id: string;
  width: number | null;
  height: number | null;
  size_bytes: number;
  purpose: 'image' | 'mask';
  created_at: string;
}

export interface Account {
  id: string;
  email: string;
  name: string | null;
  tier: 'free' | 'paid';
  credits: { spendable: number };
  key: { id: string; allowed_origins: string[]; daily_credit_limit: number | null };
  limits: {
    scope: 'account' | 'key';
    requests_per_minute: number;
    reads_per_minute: number;
    concurrent_jobs: number;
    daily_credits: number | null;
  };
}

export interface Engines {
  engines: {
    id: string;
    name: string;
    tier: 'primary' | 'legacy';
    default: boolean;
    paid_only: boolean;
    available: boolean;
    prices: Record<string, unknown>;
    capabilities: Record<string, unknown>;
  }[];
  video_models: {
    id: string;
    name: string;
    default: boolean;
    available: boolean;
    prices: unknown[];
  }[];
}

/** A webhook message: `data` is the job as `jobs.get` returns it, for `job.*` events. */
export interface WebhookEvent<T = unknown> {
  type:
    | 'job.succeeded'
    | 'job.failed'
    | 'job.canceled'
    | 'credits.low'
    | 'webhook.test'
    | (string & {});
  timestamp: string;
  data: T;
}
