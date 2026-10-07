import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type {
  Account,
  AccountKey,
  AccountLimits,
  AspectRatio,
  CreateEdit,
  CreateEnhancement,
  CreateRender,
  CreateVideo,
  Engine,
  EngineCapabilities,
  EnginePrices,
  EnhancementKind,
  Job,
  JobCanceled,
  JobError,
  JobOutput,
  JobStarted,
  JobStatus,
  Mode,
  ReferenceMode,
  RenderStarted,
  VideoModel,
  VideoPrice,
} from '../types.js';

/*
 * The SDK against the API's own OpenAPI document: every core operation has a
 * method, and every field of every body and answer is in the types — no more,
 * no fewer. A field the API adds fails here until the SDK has it.
 */

type Spec = {
  paths: Record<string, Record<string, Operation>>;
};
type Operation = {
  operationId: string;
  'x-mnml-legacy'?: unknown;
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
};
type Schema = {
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: string[];
  anyOf?: Schema[];
};

// `spec/openapi.json` is the API's published document (`npm run spec:update` refreshes it).
const spec = JSON.parse(
  readFileSync(new URL('../../spec/openapi.json', import.meta.url), 'utf8'),
) as Spec;
const ops = Object.values(spec.paths).flatMap((p) => Object.values(p));
const op = (id: string) => ops.find((o) => o.operationId === id)!;
const bodyKeys = (id: string) =>
  Object.keys(op(id).requestBody!.content['application/json']!.schema.properties ?? {}).sort();
const dataKeys = (id: string) => {
  const ok = Object.entries(op(id).responses).find(([code]) => code.startsWith('2'))![1];
  const schema = ok.content!['application/json']!.schema;
  return Object.keys(schema.properties?.['data']?.properties ?? {}).sort();
};

/** The `data` schema of an operation's success answer. */
const data = (id: string): Schema => {
  const ok = Object.entries(op(id).responses).find(([code]) => code.startsWith('2'))![1];
  return ok.content!['application/json']!.schema.properties!['data']!;
};
const body = (id: string): Schema => op(id).requestBody!.content['application/json']!.schema;
/** A schema's keys, through an array and a nullable `anyOf`. */
const keysOf = (schema: Schema): string[] => {
  const s = schema.items ?? schema.anyOf?.find((m) => m.properties) ?? schema;
  return Object.keys(s.properties ?? {}).sort();
};
const enumOf = (schema: Schema): string[] => [...(schema.enum ?? [])].sort();

/** Every key across a union's members. */
type Keys<T> = T extends unknown ? keyof T : never;
const keys = <T>(record: Record<Keys<T>, 1>) => Object.keys(record).sort();
/** Every member of a string union. */
const members = <T extends string>(record: Record<T, 1>) => Object.keys(record).sort();

/** The operations the client covers, by operationId. */
const COVERED: Record<string, string> = {
  getAccount: 'account.get',
  listEngines: 'engines.list',
  createRender: 'renders.create',
  createEdit: 'edits.create',
  createEnhancement: 'enhancements.create',
  createVideo: 'videos.create',
  getJob: 'jobs.get',
  streamJob: 'jobs.stream',
  cancelJob: 'jobs.cancel',
};
/** Not client calls: the spec itself, and the signed output link a job hands back. */
const NOT_CALLS = new Set(['getOpenApi', 'getJobFile']);

describe('the SDK covers the spec', () => {
  it('has a method for every core operation', () => {
    const core = ops.filter((o) => !o['x-mnml-legacy'] && !NOT_CALLS.has(o.operationId));
    expect(core.map((o) => o.operationId).sort()).toEqual(Object.keys(COVERED).sort());
  });

  it('types every request body field', () => {
    expect(
      keys<CreateRender>({
        prompt: 1,
        engine: 1,
        mode: 1,
        image: 1,
        image_url: 1,
        job_id: 1,
        references: 1,
        settings: 1,
        aspect_ratio: 1,
        count: 1,
        seed: 1,
        webhook_url: 1,
      }),
    ).toEqual(bodyKeys('createRender'));
    expect(
      keys<CreateEdit>({
        kind: 1,
        prompt: 1,
        image: 1,
        image_url: 1,
        job_id: 1,
        engine: 1,
        mode: 1,
        references: 1,
        region: 1,
        mask: 1,
        webhook_url: 1,
      }),
    ).toEqual(bodyKeys('createEdit'));
    expect(
      keys<CreateEnhancement>({
        kind: 1,
        image: 1,
        image_url: 1,
        job_id: 1,
        creativity: 1,
        prompt: 1,
        aspect_ratio: 1,
        webhook_url: 1,
      }),
    ).toEqual(bodyKeys('createEnhancement'));
    expect(
      keys<CreateVideo>({
        image: 1,
        image_url: 1,
        job_id: 1,
        model: 1,
        duration_seconds: 1,
        camera_movement: 1,
        motion: 1,
        prompt: 1,
        end_frame: 1,
        cinematic: 1,
        webhook_url: 1,
      }),
    ).toEqual(bodyKeys('createVideo'));
  });

  it('types every answer field', () => {
    expect(
      keys<RenderStarted>({
        id: 1,
        ids: 1,
        status: 1,
        credits_charged: 1,
        replayed: 1,
        notes: 1,
        jobs: 1,
      }),
    ).toEqual(dataKeys('createRender'));
    for (const id of ['createEdit', 'createEnhancement', 'createVideo']) {
      expect(
        keys<JobStarted>({ id: 1, status: 1, credits_charged: 1, replayed: 1, notes: 1 }),
      ).toEqual(dataKeys(id));
    }
    expect(
      keys<Job>({
        id: 1,
        status: 1,
        kind: 1,
        engine: 1,
        outputs: 1,
        credits_charged: 1,
        credits_refunded: 1,
        error: 1,
        created_at: 1,
        completed_at: 1,
      }),
    ).toEqual(dataKeys('getJob'));
    expect(keys<JobCanceled>({ id: 1, outcome: 1, credits_refunded: 1 })).toEqual(
      dataKeys('cancelJob'),
    );
    expect(
      keys<Account>({ id: 1, email: 1, name: 1, tier: 1, credits: 1, key: 1, limits: 1 }),
    ).toEqual(dataKeys('getAccount'));
  });

  it('types the nested answers: account, engines, video models, job outputs', () => {
    const account = data('getAccount').properties!;
    expect(keys<AccountKey>({ id: 1, allowed_origins: 1, daily_credit_limit: 1 })).toEqual(
      keysOf(account['key']!),
    );
    expect(
      keys<AccountLimits>({
        scope: 1,
        requests_per_minute: 1,
        reads_per_minute: 1,
        concurrent_jobs: 1,
        daily_credits: 1,
      }),
    ).toEqual(keysOf(account['limits']!));
    const engines = data('listEngines').properties!;
    const engine = engines['engines']!.items!.properties!;
    expect(
      keys<Engine>({
        id: 1,
        name: 1,
        tier: 1,
        default: 1,
        paid_only: 1,
        available: 1,
        prices: 1,
        capabilities: 1,
      }),
    ).toEqual(keysOf(engines['engines']!));
    expect(keys<EnginePrices>({ render: 1, edit: 1 })).toEqual(keysOf(engine['prices']!));
    expect(
      keys<EngineCapabilities>({
        text_to_render: 1,
        masks: 1,
        edit_references: 1,
        max_references: 1,
      }),
    ).toEqual(keysOf(engine['capabilities']!));
    const video = engines['video_models']!;
    expect(keys<VideoModel>({ id: 1, name: 1, default: 1, available: 1, prices: 1 })).toEqual(
      keysOf(video),
    );
    expect(keys<VideoPrice>({ duration_seconds: 1, credits: 1 })).toEqual(
      keysOf(video.items!.properties!['prices']!),
    );
    const job = data('getJob').properties!;
    expect(keys<JobOutput>({ url: 1, media: 1, expires_at: 1 })).toEqual(keysOf(job['outputs']!));
    expect(keys<JobError>({ code: 1, message: 1 })).toEqual(keysOf(job['error']!));
  });

  it('names every value the API takes or answers with', () => {
    const render = body('createRender').properties!;
    expect(
      members<Mode>({
        exterior: 1,
        interior: 1,
        masterplan: 1,
        plan: 1,
        landscape: 1,
        product: 1,
        'text-to-render': 1,
      }),
    ).toEqual(enumOf(render['mode']!));
    expect(
      members<AspectRatio>({
        auto: 1,
        '1:1': 1,
        '3:2': 1,
        '4:3': 1,
        '5:4': 1,
        '16:9': 1,
        '21:9': 1,
        '2:3': 1,
        '3:4': 1,
        '4:5': 1,
        '9:16': 1,
      }),
    ).toEqual(enumOf(render['aspect_ratio']!));
    expect(
      members<ReferenceMode>({
        auto: 1,
        style: 1,
        material: 1,
        atmosphere: 1,
        color: 1,
        geometry: 1,
      }),
    ).toEqual(
      enumOf(render['references']!.items!.anyOf!.find((m) => m.properties)!.properties!['mode']!),
    );
    expect(
      members<EnhancementKind>({ upscale: 1, enhance: 1, 'bg-remove': 1, outpaint: 1 }),
    ).toEqual(enumOf(body('createEnhancement').properties!['kind']!));
    const job = data('getJob').properties!;
    expect(
      members<JobStatus>({ queued: 1, processing: 1, succeeded: 1, failed: 1, canceled: 1 }),
    ).toEqual(enumOf(job['status']!));
    expect(
      members<JobError['code']>({ UNSAFE_CONTENT: 1, NO_CHANGE: 1, CANCELED: 1, RENDER_FAILED: 1 }),
    ).toEqual(enumOf(job['error']!.anyOf!.find((m) => m.properties)!.properties!['code']!));
    expect(
      members<JobCanceled['outcome']>({
        refunded: 1,
        requested: 1,
        'too-late': 1,
        'already-settled': 1,
      }),
    ).toEqual(enumOf(data('cancelJob').properties!['outcome']!));
  });
});
