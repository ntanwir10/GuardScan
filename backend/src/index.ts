import { Router } from './router';
import { handleTelemetry } from './handlers/telemetry';
import { handleHealth } from './handlers/health';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  CACHE?: KVNamespace;
  ENVIRONMENT?: string;
  API_VERSION?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const router = new Router();

    // Health check
    router.get('/health', () => handleHealth());
    router.get('/api/health', () => handleHealth());

    // Telemetry endpoint (optional, privacy-preserving)
    router.post('/api/telemetry', (req) => handleTelemetry(req, env));

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
