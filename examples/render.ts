// Render a massing image, wait for it, and save the result.
//   MNML_API_KEY=mk_live_… npx tsx examples/render.ts
import { writeFile } from 'node:fs/promises';

import { Mnml, MnmlError } from '@mnml-ai/sdk';

const mnml = new Mnml();

try {
  const [job] = await mnml.renders.createAndWait({
    mode: 'exterior',
    engine: 'v4.6-ultra',
    image: 'https://developers.mnml.ai/sdk/input-model.webp', // or await readFile('model.png')
    prompt: 'Timber facade, late afternoon light, olive trees',
  });
  if (job?.status === 'succeeded') {
    // Output links are signed and expire in an hour or two: download what you keep.
    const file = await mnml.files.download(job.outputs[0]!);
    const ext = file.contentType?.split('/')[1] ?? 'jpg';
    await writeFile(`render-${job.id}.${ext}`, file.data);
    console.log(`Saved render-${job.id}.${ext} (${job.credits_charged} credits)`);
  } else {
    console.log(`Job ${job?.status}: ${job?.error?.message ?? ''}`);
  }
} catch (err) {
  if (err instanceof MnmlError) {
    console.error(`${err.code} (${err.status}): ${err.message} [request ${err.requestId}]`);
  } else {
    throw err;
  }
}
