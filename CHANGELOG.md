# Changelog

All notable changes to this package are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## 0.1.0 — unreleased

First release.

- Speaks API v2: every call is under `/v2` (`/v1` is now the mnmlai.dev API, which the SDK
  does not call). `uploads.create`, `upload_id` and `mask_upload_id` are gone, as the API no
  longer has uploads: send the image in the call, or a finished `job_id`.
- `jobs.stream(id)`: follow a job over one connection (Server-Sent Events), as an async
  iterator of `JobEvent`s: `job` as it changes, then `done`, `timeout` or `error`.

- `image` on every create call: the image in the same call, as bytes (`Buffer`, `Uint8Array`,
  `ArrayBuffer`, `Blob`), a public link or base64. No upload step. Each reference, an edit's
  `mask` and a video's `end_frame` take an image the same way; a reference can be just the
  image. `image_url` still works and is deprecated.
- `wait` (1–90 seconds) on `renders.create` and `jobs.get`: the API holds the answer until the
  job settles. `createAndWait` and `jobs.wait` use it, so a render is one or two calls, not a
  polling loop.

- `Mnml` client for the mnml API v2: renders, edits, enhancements, videos, jobs
  (`get`, `wait`, `waitAll`, `cancel`), account and engines.
- `createAndWait` on renders, edits, enhancements and videos: start a job and wait for it.
- `files.download(output)`: a job output's bytes and content type, from its signed link,
  without sending the key.
- Types for every field the API takes and answers with, the nested ones included (engine prices
  and capabilities, video prices, account limits), and the values it accepts: engine and video
  model ids, camera moves, motion, modes, aspect ratios.
- `WebhookEvent` as a union that narrows `data` on `type` (`job.*`, `credits.low`, `webhook.test`).
- A migration table from the mnmlai.dev routes to SDK calls.
- Retries for 429, 5xx and dropped connections, with `Retry-After` up to a minute.
- An `Idempotency-Key` on every spending call, kept across retries.
- `MnmlError` with the API's `code`, `status`, `requestId` and validation `issues`.
- `@mnml-ai/sdk/webhooks`: `verifyWebhook` and `signWebhook` (Standard Webhooks).
- ESM and CommonJS builds with type declarations. Node 18+.
