# Changelog

All notable changes to this package are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## 0.2.0 — unreleased

Amounts in US dollars. API v2 now answers every amount in dollars beside the credits; the SDK
types the dollar fields and steers you to them. Nothing is removed, so 0.1.0 code still
compiles.

- New fields, each a number of US dollars to four decimals: `charged_usd` on every create call
  (`RenderStarted`, `JobStarted`); `charged_usd` and `refunded_usd` on `Job`; `refunded_usd` on
  `JobCanceled`; `balance_usd`, `key.daily_limit_usd` and `limits.daily_usd` on `Account`;
  `render_usd` and `edit_usd` on `EnginePrices`; `usd` on `VideoPrice`; `balance_usd` and
  `threshold_usd` on the `credits.low` webhook's `CreditsLow`.
- Deprecated (`@deprecated`, removed in a later release): `credits_charged`,
  `credits_refunded`, `Account.credits` (`AccountCredits.spendable`), `daily_credit_limit`,
  `daily_credits`, `EnginePrices.render` and `edit`, `VideoPrice.credits`, and
  `CreditsLow.balance` and `threshold`. Each names the dollar field to read instead.
- `spec/openapi.json` refreshed (Nov 9 2026). The coverage test now also checks that the SDK
  deprecates exactly the fields the spec does.
- README and examples read the dollar fields.

## 0.1.0

First release.

- Speaks API v2: every call is under `/v2` (`/v1` is now the mnmlai.dev API, which the SDK
  does not call). `uploads.create`, `upload_id` and `mask_upload_id` are gone, as the API no
  longer has uploads: send the image in the call, or a finished `job_id`.
- A create call's `status` is typed `JobStatus`, as the API now promises (it once answered
  the raw stored status on an idempotent replay). `spec/openapi.json` refreshed (Oct 18 2026).
- `jobs.stream(id)`: follow a job over one connection (Server-Sent Events), as an async
  iterator of `JobStreamEvent`s: `job` as it changes, then `done`, `timeout` or `error`.

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
