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

import { Env } from "../index";
import { Database, TelemetryEvent as DbTelemetryEvent } from "../db";
import {
  rateLimiters,
  createRateLimitResponse,
  addRateLimitHeaders,
} from "../utils/rate-limiter";

interface TelemetryEvent {
  action: string;
  loc: number;
  durationMs: number;
  model: string;
  timestamp: number;
  metadata: Record<string, any>;
}

interface TelemetryRequest {
  clientId: string;
  repoId: string;
  events: TelemetryEvent[];
  cliVersion?: string;
}

export async function handleTelemetry(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body: TelemetryRequest = await request.json();
    const { clientId, repoId, events, cliVersion } = body;

    if (!clientId || !repoId || !events || !Array.isArray(events)) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Rate limiting check
    const rateLimitResult = rateLimiters.telemetry.check(clientId);
    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for client: ${clientId}`);
      return createRateLimitResponse(
        rateLimitResult.resetAt,
        rateLimitResult.limit
      );
    }

    // If Supabase not configured, accept but don't store (graceful degradation)
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
      return new Response(
        JSON.stringify({
          status: "ok",
          message: "Telemetry accepted (not stored)",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const db = new Database(env);

    // Track client activity (create if new, update if existing)
    try {
      const existingClient = await db.getClient(clientId);

      if (!existingClient) {
        // New client - create record
        await db.createClient(clientId, cliVersion);
      } else {
        // Existing client - update last seen
        await db.updateClientActivity(clientId, cliVersion);
      }
    } catch (clientError) {
      // Don't fail if client tracking fails - telemetry is more important
      console.error(
        "Client tracking error (non-blocking):",
        (clientError as Error).message ?? "Unknown error"
      );
    }

    // Transform events for database
    const dbEvents = events.map((event) => ({
      client_id: clientId,
      repo_id: repoId,
      action_type: event.action,
      duration_ms: event.durationMs,
      model: event.model,
      loc: event.loc,
      timestamp: new Date(event.timestamp).toISOString(),
      metadata: event.metadata || {},
    }));

    // Insert telemetry
    await db.insertTelemetry(dbEvents as Omit<DbTelemetryEvent, "event_id">[]);

    const response = new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    // Add rate limit headers to response
    return addRateLimitHeaders(response, rateLimitResult);
  } catch (error) {
    console.error(
      "Telemetry error:",
      (error as Error).message ?? "Unknown error"
    );
    // Don't fail hard - telemetry is optional
    return new Response(
      JSON.stringify({
        status: "ok",
        message: "Telemetry error (non-blocking)",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
