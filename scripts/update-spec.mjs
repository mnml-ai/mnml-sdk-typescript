// Refreshes spec/openapi.json from the API's published OpenAPI document.
// The coverage test then says which types need to change.
import { writeFile } from 'node:fs/promises';

const url = process.env.MNML_OPENAPI_URL ?? 'https://api.mnml.ai/v2/openapi.json';
const res = await fetch(url);
if (!res.ok) throw new Error(`${url} answered ${res.status}`);
const spec = await res.json();
await writeFile(
  new URL('../spec/openapi.json', import.meta.url),
  `${JSON.stringify(spec, null, 2)}\n`,
);
console.log(`spec/openapi.json updated from ${url} (version ${spec.info?.version})`);
