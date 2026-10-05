import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type {
  Account,
  CreateEdit,
  CreateEnhancement,
  CreateRender,
  CreateVideo,
  Job,
  JobCanceled,
  JobStarted,
  RenderStarted,
  Upload,
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
type Schema = { properties?: Record<string, Schema> };

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

/** Every key across a union's members. */
type Keys<T> = T extends unknown ? keyof T : never;
const keys = <T>(record: Record<Keys<T>, 1>) => Object.keys(record).sort();

/** The operations the client covers, by operationId. */
const COVERED: Record<string, string> = {
  getAccount: 'account.get',
  listEngines: 'engines.list',
  createUpload: 'uploads.create',
  createRender: 'renders.create',
  createEdit: 'edits.create',
  createEnhancement: 'enhancements.create',
  createVideo: 'videos.create',
  getJob: 'jobs.get',
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
        upload_id: 1,
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
        upload_id: 1,
        image_url: 1,
        job_id: 1,
        engine: 1,
        mode: 1,
        references: 1,
        region: 1,
        mask_upload_id: 1,
        webhook_url: 1,
      }),
    ).toEqual(bodyKeys('createEdit'));
    expect(
      keys<CreateEnhancement>({
        kind: 1,
        upload_id: 1,
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
        upload_id: 1,
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
      keys<RenderStarted>({ id: 1, ids: 1, status: 1, credits_charged: 1, replayed: 1, notes: 1 }),
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
      keys<Upload>({ id: 1, width: 1, height: 1, size_bytes: 1, purpose: 1, created_at: 1 }),
    ).toEqual(dataKeys('createUpload'));
    expect(
      keys<Account>({ id: 1, email: 1, name: 1, tier: 1, credits: 1, key: 1, limits: 1 }),
    ).toEqual(dataKeys('getAccount'));
  });
});
