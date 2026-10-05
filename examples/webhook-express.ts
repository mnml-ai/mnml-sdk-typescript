// Receive job events with Express. The body must stay raw for the signature check.
//   MNML_WEBHOOK_SECRET=whsec_… npx tsx examples/webhook-express.ts
import express from 'express';
import { verifyWebhook, WebhookVerificationError } from '@mnml-ai/sdk/webhooks';

const app = express();

app.post('/webhooks/mnml', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = verifyWebhook(req.body as Buffer, req.headers, process.env.MNML_WEBHOOK_SECRET!);
    if (event.type === 'job.succeeded') {
      // event.data is the job, as jobs.get returns it.
    }
    res.sendStatus(204);
  } catch (err) {
    if (err instanceof WebhookVerificationError) return res.sendStatus(400);
    throw err;
  }
});

app.listen(3000);
