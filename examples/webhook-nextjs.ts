// A Next.js App Router route (app/api/webhooks/mnml/route.ts).
import { verifyWebhook, WebhookVerificationError } from '@mnml-ai/sdk/webhooks';

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  try {
    const event = verifyWebhook(body, request.headers, process.env.MNML_WEBHOOK_SECRET!);
    if (event.type === 'credits.low') {
      // Time to top up: https://developers.mnml.ai/console/billing
      console.warn(`mnml balance is down to $${event.data.balance_usd}`);
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof WebhookVerificationError) return new Response(null, { status: 400 });
    throw err;
  }
}
