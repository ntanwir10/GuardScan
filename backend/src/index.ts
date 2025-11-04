import { Router } from './router';
import { handleValidate } from './handlers/validate';
import { handleTelemetry } from './handlers/telemetry';
import { handleCredits } from './handlers/credits';
import { handleStripeWebhook } from './handlers/stripe-webhook';
import { handleHealth } from './handlers/health';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  CACHE: KVNamespace;
  ENVIRONMENT: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const router = new Router();

    // Health check
    router.get('/health', () => handleHealth());

    // API endpoints
    router.post('/api/validate', (req) => handleValidate(req, env));
    router.post('/api/telemetry', (req) => handleTelemetry(req, env));
    router.get('/api/credits/:clientId', (req, params) => handleCredits(req, env, params));

    // Stripe webhook
    router.post('/api/stripe-webhook', (req) => handleStripeWebhook(req, env));

    // CORS headers
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    try {
      const response = await router.handle(request);

      // Add CORS headers to response
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.error('Error handling request:', error);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
