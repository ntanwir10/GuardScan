/**
 * Telemetry Handler
 *
 * Optional anonymous usage analytics for product improvements
 * Can be disabled with --no-telemetry flag
 *
 * PRIVACY GUARANTEE:
 * - NO source code sent
 * - NO file names or paths sent
 * - Only anonymized metadata (client_id, repo_id hash, LOC counts)
 * - Client ID is local UUID, not tied to user identity
 * - Repo ID is cryptographic hash of git remote URL
 */

import { Env } from '../index';
import { Database } from '../db';

interface TelemetryEvent {
  action: string;
  loc: number;
  durationMs: number;
  model: string;
  timestamp: number;
}

interface TelemetryRequest {
  clientId: string;
  repoId: string;
  events: TelemetryEvent[];
}

export async function handleTelemetry(request: Request, env: Env): Promise<Response> {
  try {
    const body: TelemetryRequest = await request.json();
    const { clientId, repoId, events } = body;

    if (!clientId || !repoId || !events || !Array.isArray(events)) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // If Supabase not configured, accept but don't store (graceful degradation)
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
      return new Response(JSON.stringify({ status: 'ok', message: 'Telemetry accepted (not stored)' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = new Database(env);

    // Transform events for database
    const dbEvents = events.map(event => ({
      client_id: clientId,
      repo_id: repoId,
      action_type: event.action,
      duration_ms: event.durationMs,
      model: event.model,
      loc: event.loc,
      timestamp: new Date(event.timestamp).toISOString(),
    }));

    // Insert telemetry
    await db.insertTelemetry(dbEvents);

    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Telemetry error:', error);
    // Don't fail hard - telemetry is optional
    return new Response(JSON.stringify({ status: 'ok', message: 'Telemetry error (non-blocking)' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
