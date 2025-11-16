import { Router } from './router';
import { handleTelemetry } from './handlers/telemetry';
import { handleHealth } from './handlers/health';
import { handleMonitoring, handleMonitoringStats } from './handlers/monitoring';

/**
 * GuardScan Backend Environment
 *
 * 100% Free & Open Source - BYOK (Bring Your Own Key) Model
 * No payments, no credits, no user accounts
 *
 * Optional telemetry for product analytics and debugging
 * Can be completely disabled with --no-telemetry flag
 */
export interface Env {
  // Database (optional - only for telemetry/monitoring)
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;

  // Infrastructure
  CACHE?: KVNamespace;
  ENVIRONMENT?: string;
  API_VERSION?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const router = new Router();

    // Health check (always available)
    router.get('/health', () => handleHealth());
    router.get('/api/health', () => handleHealth());

    // Optional telemetry (can be disabled with --no-telemetry)
    // PRIVACY: No source code sent, only anonymized metadata
    router.post('/api/telemetry', (req) => handleTelemetry(req, env));

    // Optional monitoring (errors, metrics, usage analytics)
    // For debugging and product improvements
    if (env.SUPABASE_URL && env.SUPABASE_KEY) {
      router.post('/api/monitoring', (req) => handleMonitoring(req, env));
      router.get('/api/monitoring/stats', (req) => handleMonitoringStats(req, env));
    }

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
