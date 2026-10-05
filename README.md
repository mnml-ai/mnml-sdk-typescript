# mnml TypeScript SDK

The official TypeScript and JavaScript client for the [mnml API](https://developers.mnml.ai):
architecture renders, edits, enhancements and video, from your own product.

- Typed requests and answers, checked against the API's OpenAPI document
- Retries, timeouts and idempotency keys handled for you
- `jobs.wait()` to poll a job until it settles
- Webhook signature verification
- No dependencies. Node 18+, Deno, Bun, edge runtimes and browsers

```bash
npm install @mnml-ai/sdk
```

## Quick start

Create an API key in the [console](https://developers.mnml.ai/console/keys), then:

```ts
import { Mnml } from '@mnml-ai/sdk';

const mnml = new Mnml(); // reads MNML_API_KEY

const { id } = await mnml.renders.create({
  mode: 'exterior',
  image_url: 'https://example.com/massing.png',
  prompt: 'Timber facade, late afternoon light, olive trees',
});

const job = await mnml.jobs.wait(id);
console.log(job.status, job.outputs[0]?.url);
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

| Method                      | Endpoint                    | What it does                                        |
| --------------------------- | --------------------------- | --------------------------------------------------- |
| `renders.create(body)`      | `POST /v1/renders`          | Render from an image, or from a prompt alone        |
| `edits.create(body)`        | `POST /v1/edits`            | Edit or erase, over the whole image or a region     |
| `enhancements.create(body)` | `POST /v1/enhancements`     | Upscale, enhance, remove the background, outpaint   |
| `videos.create(body)`       | `POST /v1/videos`           | Video from a still                                  |
| `uploads.create(input)`     | `POST /v1/uploads`          | Upload an image to use as a source or mask          |
| `jobs.get(id)`              | `GET /v1/jobs/{id}`         | Read a job                                          |
| `jobs.wait(id, options?)`   | `GET /v1/jobs/{id}`         | Read a job until it succeeds, fails or is cancelled |
| `jobs.cancel(id)`           | `POST /v1/jobs/{id}/cancel` | Cancel a job (refunded if it had not produced yet)  |
| `account.get()`             | `GET /v1/account`           | Balance, tier and limits for this key               |
| `engines.list()`            | `GET /v1/engines`           | Engines, video models, prices and capabilities      |

Every method returns the answer's `data`, and takes an optional last argument
`{ idempotencyKey?, signal? }`.

### Sources

A source image is one of your uploads, a public URL, or a finished job:

```ts
await mnml.renders.create({ upload_id: upload.id, prompt: 'Brick and glass, dusk' });
await mnml.renders.create({
  image_url: 'https://example.com/plan.png',
  prompt: 'Brick and glass, dusk',
});
await mnml.edits.create({ job_id: id, prompt: 'Dark brick instead of render' });
```

### Uploads

```ts
import { readFile } from 'node:fs/promises';

const upload = await mnml.uploads.create({
  file: await readFile('massing.png'),
  filename: 'massing.png',
});
await mnml.renders.create({ upload_id: upload.id, prompt: 'Concrete and glass, overcast' });

// Or have the API fetch a public image:
await mnml.uploads.create({ url: 'https://example.com/massing.png' });
```

### Waiting for a job

```ts
const job = await mnml.jobs.wait(id, { intervalMs: 3000, timeoutMs: 10 * 60_000 });
```

`jobs.wait` throws `MnmlTimeoutError` when its own time runs out. The job keeps running, so
read it again later. Output links are signed and expire after an hour or two; download what
you want to keep. For long jobs such as video, prefer a [webhook](#webhooks) to polling.

## Errors

A refusal throws `MnmlError`, carrying the API's `code`, the HTTP `status` and the
`requestId` to quote to support:

```ts
import { MnmlError } from '@mnml-ai/sdk';

try {
  await mnml.renders.create({ image_url, prompt });
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
  }
  return new Response(null, { status: 204 });
}
```

`verifyWebhook` throws `WebhookVerificationError` on a bad signature or a stale timestamp
(over five minutes). Events: `job.succeeded`, `job.failed`, `job.canceled`, `credits.low` and
`webhook.test`. The scheme is [Standard Webhooks](https://www.standardwebhooks.com). The
webhook helpers use `node:crypto`, so they have their own entry point and stay out of browser
bundles. See [`examples/`](./examples) for Express.

## TypeScript

Request and answer types are exported: `CreateRender`, `Job`, `JobStatus`, `Account`,
`Engines`, `WebhookEvent` and more. A test in this repository checks every field against the
API's OpenAPI document ([`spec/openapi.json`](./spec/openapi.json)), so the types cannot drift
from the API.

## Links

- [Documentation](https://developers.mnml.ai/docs)
- [API reference](https://developers.mnml.ai/docs/renders)
- [Python SDK](https://github.com/mnml-ai/mnml-sdk-python)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE)
