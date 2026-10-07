# mnml TypeScript SDK

The official TypeScript and JavaScript client for the [mnml API](https://developers.mnml.ai):
architecture renders, edits, enhancements and video, from your own product.

- Typed requests and answers, checked against the API's OpenAPI document
- Every endpoint of API v1: renders, edits, enhancements, video, uploads, jobs, account, engines
- Retries, timeouts and idempotency keys handled for you
- `createAndWait()` and `jobs.wait()` to poll a job until it settles, `files.download()` to keep
  its output
- Webhook signature verification, with typed events
- No dependencies. Node 18+, Deno, Bun, edge runtimes and browsers

```bash
npm install @mnml-ai/sdk
```

## Quick start

Create an API key in the [console](https://developers.mnml.ai/console/keys), then:

```ts
import { Mnml } from '@mnml-ai/sdk';

const mnml = new Mnml(); // reads MNML_API_KEY

const [job] = await mnml.renders.createAndWait({
  mode: 'exterior',
  image: 'https://example.com/massing.png', // or the file's bytes: await readFile('massing.png')
  prompt: 'Timber facade, late afternoon light, olive trees',
});
console.log(job?.status, job?.outputs[0]?.url);
```

Every call spends credits from your prepaid API balance. Top it up in dollars on
[Billing](https://developers.mnml.ai/console/billing).

## Configuration

```ts
const mnml = new Mnml({
  apiKey: process.env.MNML_API_KEY, // the default
  maxRetries: 2, // retries for a 429, a 5xx or a dropped connection
  timeoutMs: 60_000, // per request
});
```

Keep your key on the server. If you must call from a browser, restrict the key to your
site's origins on the [API keys](https://developers.mnml.ai/console/keys) page.

## Methods

| Method                                 | Endpoint                    | What it does                                        |
| -------------------------------------- | --------------------------- | --------------------------------------------------- |
| `renders.create(body)`                 | `POST /v1/renders`          | Render from an image, or from a prompt alone        |
| `edits.create(body)`                   | `POST /v1/edits`            | Edit or erase, over the whole image or a region     |
| `enhancements.create(body)`            | `POST /v1/enhancements`     | Upscale, enhance, remove the background, outpaint   |
| `videos.create(body)`                  | `POST /v1/videos`           | Video from a still                                  |
| `uploads.create(input)`                | `POST /v1/uploads`          | Optional: one image reused across calls             |
| `jobs.get(id)`                         | `GET /v1/jobs/{id}`         | Read a job                                          |
| `jobs.cancel(id)`                      | `POST /v1/jobs/{id}/cancel` | Cancel a job (refunded if it had not produced yet)  |
| `account.get()`                        | `GET /v1/account`           | Balance, tier and limits for this key               |
| `engines.list()`                       | `GET /v1/engines`           | Engines, video models, prices and capabilities      |
| `files.download(output)`               | `GET /v1/files/{id}`        | A job output's bytes, from its signed link          |
| `jobs.wait(id, options?)`              | `GET /v1/jobs/{id}`         | Read a job until it succeeds, fails or is cancelled |
| `jobs.waitAll(ids, options?)`          | `GET /v1/jobs/{id}`         | `wait` for several jobs at once                     |
| `<resource>.createAndWait(body, opt?)` | the create, then the job    | Start a job and wait for it (a render: every job)   |

Every method returns the answer's `data`, and takes an optional last argument
`{ idempotencyKey?, signal? }`. `createAndWait` is on `renders`, `edits`, `enhancements` and
`videos`; a render returns one job per `count`, the others one job.

### Engines, modes and settings

`engine`, `mode`, `aspect_ratio`, `camera_movement`, `motion` and the video `model` are typed
with the values the API takes, so your editor completes them. `engines.list()` is the live list,
with each engine's price and what it can do:

```ts
const { engines, video_models } = await mnml.engines.list();
for (const e of engines) console.log(e.id, e.prices.render, e.capabilities.max_references);
```

### Images

Send the image in the same call, with no upload step. `image` takes a public link, a
`data:image/…;base64,` URI or base64 text, or the bytes themselves (a `Buffer` or
`Uint8Array`, an `ArrayBuffer`, a `Blob` or `File`). JPEG, PNG or WebP, up to 15 MB:

```ts
import { readFile } from 'node:fs/promises';

await mnml.renders.create({ image: await readFile('plan.png'), prompt: 'Brick and glass, dusk' });
await mnml.renders.create({
  image: 'https://example.com/plan.png',
  prompt: 'Brick and glass, dusk',
});
await mnml.edits.create({ job_id: id, prompt: 'Dark brick instead of render' }); // a finished job
```

References, an edit's `mask` and a video's `end_frame` take an image the same way:

```ts
await mnml.renders.create({
  image: await readFile('massing.png'),
  prompt: 'Concrete and glass, overcast',
  references: [
    await readFile('material-board.jpg'),
    { image: 'https://example.com/mood.jpg', mode: 'atmosphere' },
  ],
});
```

### Uploads (optional)

To use one image in many calls, upload it once and pass its `upload_id`:

```ts
const upload = await mnml.uploads.create({
  file: await readFile('massing.png'),
  filename: 'massing.png',
});
await mnml.renders.create({ upload_id: upload.id, prompt: 'Concrete and glass, overcast' });

// Or have the API fetch a public image:
await mnml.uploads.create({ url: 'https://example.com/massing.png' });
```

### Edits, enhancements and video

```ts
// Change one thing, inside a box (fractions of the image from its top-left)
await mnml.edits.create({
  job_id: id,
  prompt: 'A red front door',
  region: { box: { x: 0.4, y: 0.5, width: 0.2, height: 0.4 } },
});

// Remove what a region covers
await mnml.edits.create({
  job_id: id,
  kind: 'erase',
  region: { box: { x: 0.1, y: 0.6, width: 0.2, height: 0.3 } },
});

// Upscale, enhance, cut out, or extend to a new frame
await mnml.enhancements.create({ job_id: id, kind: 'outpaint', aspect_ratio: '16:9' });

// A ten-second camera move
await mnml.videos.create({
  job_id: id,
  model: 'v2.0-flash',
  duration_seconds: 10,
  camera_movement: 'orbit-right',
});
```

### Waiting for a job

A render can come back finished from the create call itself: pass `wait` (1–60 seconds) and
the answer's `jobs` carry the outputs. `renders.createAndWait` does this for you, and polls only
when a render is still running after that.

```ts
const started = await mnml.renders.create({ image, prompt }, { wait: 60 });
console.log(started.jobs?.[0]?.outputs[0]?.url); // set when it finished within the minute

const job = await mnml.jobs.wait(id, { intervalMs: 3000, timeoutMs: 10 * 60_000 });
```

`jobs.wait` throws `MnmlTimeoutError` when its own time runs out. The job keeps running, so
read it again later. `videos.createAndWait` reads every 10 seconds for up to 20 minutes unless
you say otherwise. For long jobs such as video, a [webhook](#webhooks) beats polling.

### Downloading outputs

Output links are signed and expire after an hour or two. Download what you want to keep:

```ts
import { writeFile } from 'node:fs/promises';

const file = await mnml.files.download(job.outputs[0]!);
await writeFile(`render.${file.contentType?.split('/')[1] ?? 'jpg'}`, file.data);
```

The link's signature is its credential, so your key is not sent with it. An expired link throws
`MnmlError` with `NOT_FOUND`; read the job again for fresh links.

## Errors

A refusal throws `MnmlError`, carrying the API's `code`, the HTTP `status` and the
`requestId` to quote to support:

```ts
import { MnmlError } from '@mnml-ai/sdk';

try {
  await mnml.renders.create({ image, prompt });
} catch (err) {
  if (err instanceof MnmlError && err.code === 'INSUFFICIENT_CREDITS') {
    // Top up, then send it again.
  }
  throw err;
}
```

On `VALIDATION_FAILED`, `err.issues` lists each refused field. Every code is described at
[developers.mnml.ai/docs/errors](https://developers.mnml.ai/docs/errors).

## Retries and idempotency

The client retries a `429`, a `5xx` or a dropped connection, twice by default. It waits out
`Retry-After` when that is a minute or less, and otherwise hands the error back to you. That
covers a daily limit, which resets at midnight UTC.

Every call that can spend credits carries an `Idempotency-Key`, and the client reuses the same
key across its own retries, so a retry never charges twice. To make your own retries safe as
well, pass a key you choose:

```ts
await mnml.renders.create(body, { idempotencyKey: `order-${orderId}` });
```

## Webhooks

Add an endpoint and copy its signing secret on the
[Webhooks](https://developers.mnml.ai/console/webhooks) page. Then verify each delivery with
the raw request body, before parsing it:

```ts
import { verifyWebhook } from '@mnml-ai/sdk/webhooks';

// Next.js App Router
export async function POST(request: Request) {
  const event = verifyWebhook(
    await request.text(),
    request.headers,
    process.env.MNML_WEBHOOK_SECRET!,
  );
  if (event.type === 'job.succeeded') {
    // event.data is the job, as jobs.get returns it
  } else if (event.type === 'credits.low') {
    // event.data is { balance, threshold }
  }
  return new Response(null, { status: 204 });
}
```

`verifyWebhook` throws `WebhookVerificationError` on a bad signature or a stale timestamp
(over five minutes). Events: `job.succeeded`, `job.failed`, `job.canceled`, `credits.low` and
`webhook.test`; `WebhookEvent` narrows `data` on `type`. The scheme is [Standard Webhooks](https://www.standardwebhooks.com). The
webhook helpers use `node:crypto`, so they have their own entry point and stay out of browser
bundles. See [`examples/`](./examples) for Express.

## TypeScript

Request and answer types are exported: `CreateRender`, `Job`, `JobStatus`, `Account`,
`Engines`, `EngineId`, `CameraMovement`, `WebhookEvent` and more. A test in this repository checks every field against the
API's OpenAPI document ([`spec/openapi.json`](./spec/openapi.json)), so the types cannot drift
from the API.

## Moving from the v3 API

The v3 routes (`/v1/archDiffusion-v46`, `/v1/upscale`, `/v1/status/{id}` …) still answer on
`api.mnml.ai`, deprecated, so nothing breaks while you move. The SDK speaks API v1 only. Each
old route has a v1 call that does the same job:

| v3 route                                                      | SDK call                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| `archDiffusion-v46`                                           | `renders.create({ engine: 'v4.6-ultra', … })`                 |
| `archDiffusion-v45`, `-v45-lite`                              | `renders.create({ engine: 'v4.5-ultra' })`, `'v4.5-fast'`     |
| `archDiffusion-v44`, `-v44-lite`                              | `renders.create({ engine: 'v4.4-ultra' })`, `'v4.4-fast'`     |
| `archDiffusion-v43`, `-v43-lite`, `-v42`, `-v42-lite`, `-v41` | `renders.create({ engine: 'v4.3' })`, `'v4.3-fast'`           |
| `mixture-of-experts`                                          | `renders.create({ mode, … })` (`expert_name` is the `mode`)   |
| `exterior`, `interior`, `sketch-to-img`                       | `renders.create({ engine: 'v3.1', mode, … })`                 |
| `style/transfer`                                              | `renders.create({ references: [{ …, mode: 'style' }], … })`   |
| `imagine-ai`                                                  | `renders.create({ mode: 'text-to-render', prompt })`          |
| `virtual-staging-ai` (v1 and v2)                              | `renders.create({ mode: 'interior', … })`                     |
| `inpaint`                                                     | `edits.create({ prompt, mask })` or `region`                  |
| `ai-eraser`                                                   | `edits.create({ kind: 'erase', region })`                     |
| `upscale`, `render/enhancer`                                  | `enhancements.create({ kind: 'upscale' })`, `kind: 'enhance'` |
| `video-v20-flash`, `video-v20-cinematic`, `video-ai`          | `videos.create({ model: 'v2.0-flash' })`, `'v2.0'`, `'v1.1'`  |
| `status/{id}` (v1 and v2)                                     | `jobs.get(id)` or `jobs.wait(id)`                             |
| `credits`                                                     | `account.get()`                                               |

v1 takes the image in the request too, as `image`: its bytes, a public link or base64. An
`upload_id` (from `uploads.create`) or a finished `job_id` also works. The full guide is at
[developers.mnml.ai/docs/migrate](https://developers.mnml.ai/docs/migrate).

## Links

- [Documentation](https://developers.mnml.ai/docs)
- [API reference](https://developers.mnml.ai/docs/renders)
- [Python SDK](https://github.com/mnml-ai/mnml-sdk-python)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE)
