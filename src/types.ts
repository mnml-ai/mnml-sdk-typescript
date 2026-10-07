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

/**
 * The engines a render or edit can name today. `engines.list()` is the live
 * list, with prices and what each one can do; an engine's display name
 * (`"v4.6"`) works as well as its id.
 */
export type EngineId =
  | 'v4.6-ultra'
  | 'v4.5-ultra'
  | 'v4.5-fast'
  | 'v4.4-ultra'
  | 'v4.4-fast'
  | 'v4.3'
  | 'v4.3-fast'
  | 'v3.1';

/** The video models. A model's name (`"v2.0 Flash"`) works as well as its id. */
export type VideoModelId = 'v2.0-flash' | 'v2.0' | 'v1.1';

/** One camera move. */
export type CameraMove =
  | 'dolly-in'
  | 'dolly-out'
  | 'truck-left'
  | 'truck-right'
  | 'pedestal-up'
  | 'pedestal-down'
  | 'pan-left'
  | 'pan-right'
  | 'tilt-up'
  | 'tilt-down'
  | 'orbit-left'
  | 'orbit-right'
  | 'zoom-in'
  | 'zoom-out';

/**
 * `static` (the default), `auto` to let the prompt decide, or one or two moves
 * joined by a comma: `"dolly-in,tilt-up"`.
 */
export type CameraMovement = 'static' | 'auto' | CameraMove | `${CameraMove},${CameraMove}`;

/** How much moves in the scene. `subtle` is the default; `auto` lets the prompt decide. */
export type VideoMotion = 'subtle' | 'balanced' | 'dynamic' | 'auto';

/**
 * An image, sent in the same call that uses it, up to 15 MB: a public
 * `https://` link, a `data:image/…;base64,` URI or base64 text, or the bytes
 * themselves (a `Uint8Array` or Node `Buffer`, an `ArrayBuffer`, a `Blob` or
 * `File`). The client sends bytes as base64.
 */
export type ImageInput = string | Uint8Array | ArrayBuffer | Blob;

/** Where an image comes from: the image itself, or a finished job. */
export type Source =
  | { image: ImageInput }
  | { job_id: string }
  /** @deprecated The same as `image`, under its first name. */
  | { image_url: string };

export type ReferenceMode = 'auto' | 'style' | 'material' | 'atmosphere' | 'color' | 'geometry';
/** Just the image (taken in the default mode), or a source with its mode. */
export type Reference = ImageInput | (Source & { mode?: ReferenceMode });

/** An area of the image, in fractions (0–1) from its top-left corner. */
export type Region =
  | { box: { x: number; y: number; width: number; height: number } }
  | { polygon: [number, number][] };

interface Common {
  /** A public https:// URL to send this job's settle event to, signed like every webhook. */
  webhook_url?: string;
}

export type CreateRender = Common &
  Partial<Source> & {
    /** Up to 4 000 characters. */
    prompt: string;
    engine?: EngineId | (string & {});
    mode?: Mode;
    /** Up to 15; how many an engine takes is `capabilities.max_references`. */
    references?: Reference[];
    /** Studio's settings for this engine and mode, name to value. Omit for Auto. */
    settings?: Record<string, string>;
    aspect_ratio?: AspectRatio;
    /** 1–4 variations of this brief, each its own job and charge. */
    count?: number;
    seed?: number;
  };

export type CreateEdit = Common &
  Source & {
    /** `edit` (the default) changes what the prompt says; `erase` removes what the region covers. */
    kind?: 'edit' | 'erase';
    prompt?: string;
    engine?: EngineId | (string & {});
    mode?: Mode;
    references?: Reference[];
    region?: Region;
    /** A PNG the size of the image, white where to change, black where to keep. */
    mask?: ImageInput;
  };

export type EnhancementKind = 'upscale' | 'enhance' | 'bg-remove' | 'outpaint';

export type CreateEnhancement = Common &
  Source & {
    kind: EnhancementKind;
    /** 0–100, for `enhance`. */
    creativity?: number;
    prompt?: string;
    /** The frame to extend to, for `outpaint`. */
    aspect_ratio?: Exclude<AspectRatio, 'auto'>;
  };

export type CreateVideo = Common &
  Source & {
    /** Default `v2.0-flash`. */
    model?: VideoModelId | (string & {});
    /** 10 or 15 on the v2.0 models (default 10); v1.1 has one fixed length. */
    duration_seconds?: number;
    camera_movement?: CameraMovement;
    motion?: VideoMotion;
    /** What should happen in the clip, in plain words. */
    prompt?: string;
    /** A last frame to move towards: the image itself, or a source. */
    end_frame?: ImageInput | Source;
    /** v1.1 only: the Cinematic variant, which needs `end_frame`. */
    cinematic?: boolean;
  };

export interface JobStarted {
  id: string;
  status: string;
  credits_charged: number;
  /** True when this answers an earlier identical request: nothing new was charged. */
  replayed: boolean;
  /** What the API changed or dropped from the request, said back instead of silently. */
  notes: string[];
}

export interface RenderStarted extends JobStarted {
  /** Every job the call started; `id` is the first. */
  ids: string[];
  /**
   * Only with `wait`: every job as `jobs.get` reads it, outputs included. Each
   * one settled when the wait ended; otherwise some are still running.
   */
  jobs?: Job[];
}

export type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'canceled';

export interface JobOutput {
  /** A signed link, served by the API. Download it before `expires_at`. */
  url: string;
  media: 'image' | 'video';
  expires_at: string;
}

export interface JobError {
  code: 'UNSAFE_CONTENT' | 'NO_CHANGE' | 'CANCELED' | 'RENDER_FAILED';
  message: string;
}

export interface Job {
  id: string;
  status: JobStatus;
  kind: string;
  engine: string | null;
  outputs: JobOutput[];
  credits_charged: number;
  credits_refunded: number;
  error: JobError | null;
  created_at: string;
  completed_at: string | null;
}

export interface JobCanceled {
  id: string;
  outcome: 'refunded' | 'requested' | 'too-late' | 'already-settled';
  credits_refunded: number;
}

export interface AccountCredits {
  /** What the next call can spend. */
  spendable: number;
}

export interface AccountKey {
  id: string;
  allowed_origins: string[];
  /** Your own daily limit for this key, or null for none. */
  daily_credit_limit: number | null;
}

export interface AccountLimits {
  /** Shared by every key on the account (free), or this key's own (paid). */
  scope: 'account' | 'key';
  requests_per_minute: number;
  /** GET requests (job polls included), counted apart from the rest. */
  reads_per_minute: number;
  concurrent_jobs: number;
  /** Credits this key may still spend per UTC day; null is no limit. */
  daily_credits: number | null;
}

export interface Account {
  id: string;
  email: string;
  name: string | null;
  /** `paid` once the account has bought credits; it sets the limits. */
  tier: 'free' | 'paid';
  credits: AccountCredits;
  key: AccountKey;
  limits: AccountLimits;
}

export interface EnginePrices {
  /** Credits for one render. */
  render: number;
  /** Credits for one edit. */
  edit: number;
}

export interface EngineCapabilities {
  text_to_render: boolean;
  masks: boolean;
  edit_references: boolean;
  max_references: number;
}

export interface Engine {
  id: string;
  name: string;
  tier: 'primary' | 'legacy';
  default: boolean;
  paid_only: boolean;
  /** Whether this account may use it now (a paid-only engine needs a paid account). */
  available: boolean;
  prices: EnginePrices;
  capabilities: EngineCapabilities;
}

export interface VideoPrice {
  /** null is the model's one fixed length. */
  duration_seconds: number | null;
  credits: number;
}

export interface VideoModel {
  id: string;
  /** Pass this, or the id, as `model`. */
  name: string;
  default: boolean;
  available: boolean;
  prices: VideoPrice[];
}

export interface Engines {
  engines: Engine[];
  video_models: VideoModel[];
}

/** `credits.low`: the balance fell under the threshold (sent at most once a day). */
export interface CreditsLow {
  balance: number;
  threshold: number;
}

interface EventBase {
  /** ISO 8601. */
  timestamp: string;
}

/**
 * A webhook message. Narrow on `type`: `data` is the job, as `jobs.get`
 * returns it, for `job.*` events. New types may be added, so ignore one you
 * do not handle.
 */
export type WebhookEvent =
  | (EventBase & { type: 'job.succeeded' | 'job.failed' | 'job.canceled'; data: Job })
  | (EventBase & { type: 'credits.low'; data: CreditsLow })
  | (EventBase & { type: 'webhook.test'; data: { message: string } });

export type WebhookEventType = WebhookEvent['type'];
