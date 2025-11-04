import { Env } from '../index';
import { Database } from '../db';
import Stripe from 'stripe';

export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      return new Response(JSON.stringify({ error: 'No signature' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.text();

    // Initialize Stripe
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-11-20.acacia',
    });

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = new Database(env);

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // Extract metadata
        const clientId = session.metadata?.clientId;
        const locPurchased = parseInt(session.metadata?.locPurchased || '0');
        const amountUsd = (session.amount_total || 0) / 100;

        if (!clientId || !locPurchased) {
          console.error('Missing metadata in checkout session');
          break;
        }

        // Create transaction record
        await db.createTransaction({
          client_id: clientId,
          loc_purchased: locPurchased,
          amount_usd: amountUsd,
          payment_status: 'paid',
        });

        console.log(`Purchase completed: ${locPurchased} LOC for client ${clientId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        console.error('Payment failed for invoice:', invoice.id);
        // Handle failed payment
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
