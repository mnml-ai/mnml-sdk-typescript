// Render a massing image, wait for it, and print the output link.
//   MNML_API_KEY=mk_live_… npx tsx examples/render.ts
import { Mnml, MnmlError } from '@mnml-ai/sdk';

const mnml = new Mnml();

try {
  const started = await mnml.renders.create({
    mode: 'exterior',
    image_url: 'https://developers.mnml.ai/sdk/input-model.webp',
    prompt: 'Timber facade, late afternoon light, olive trees',
  });
  console.log(`Started job ${started.id}, ${started.credits_charged} credits`);

  const job = await mnml.jobs.wait(started.id);
  if (job.status === 'succeeded') {
    // Output links are signed and expire in an hour or two: download what you keep.
    console.log(job.outputs[0]?.url);
  } else {
    console.log(`Job ${job.status}: ${job.error?.message ?? ''}`);
  }
} catch (err) {
  if (err instanceof MnmlError) {
    console.error(`${err.code} (${err.status}): ${err.message} [request ${err.requestId}]`);
  } else {
    throw err;
  }
}
