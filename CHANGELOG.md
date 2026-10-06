# Changelog

All notable changes to this package are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## 0.1.0 — unreleased

First release.

- `Mnml` client for the mnml API v1: renders, edits, enhancements, videos, uploads, jobs
  (`get`, `wait`, `waitAll`, `cancel`), account and engines.
- `createAndWait` on renders, edits, enhancements and videos: start a job and wait for it.
- `files.download(output)`: a job output's bytes and content type, from its signed link,
  without sending the key.
- Types for every field the API takes and answers with, the nested ones included (engine prices
  and capabilities, video prices, account limits), and the values it accepts: engine and video
  model ids, camera moves, motion, modes, aspect ratios.
- `WebhookEvent` as a union that narrows `data` on `type` (`job.*`, `credits.low`, `webhook.test`).
- A migration table from the v3 routes to SDK calls.
- Retries for 429, 5xx and dropped connections, with `Retry-After` up to a minute.
- An `Idempotency-Key` on every spending call, kept across retries.
- `MnmlError` with the API's `code`, `status`, `requestId` and validation `issues`.
- `@mnml-ai/sdk/webhooks`: `verifyWebhook` and `signWebhook` (Standard Webhooks).
- ESM and CommonJS builds with type declarations. Node 18+.
