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
import { CachedDatabase } from "../db-cached";
import { TelemetryEvent as DbTelemetryEvent } from "../db";
import { KVRateLimiter, createRateLimitResponse, addRateLimitHeaders } from "../utils/rate-limiter-kv";

// Fallback to in-memory rate limiter if KV not available
import { rateLimiters as memoryRateLimiters } from "../utils/rate-limiter";

// Constants (works on free plan)
const MAX_REQUEST_SIZE_MB = 10; // 10MB max request size
const MAX_REQUEST_SIZE_BYTES = MAX_REQUEST_SIZE_MB * 1024 * 1024;

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
    // Validate Content-Length to prevent memory exhaustion attacks
    const contentLength = parseInt(request.headers.get('Content-Length') || '0');
    
    if (contentLength > MAX_REQUEST_SIZE_BYTES) {
      return new Response(
        JSON.stringify({
          error: 'Request too large',
          maxSize: `${MAX_REQUEST_SIZE_MB}MB`,
          received: `${(contentLength / 1024 / 1024).toFixed(2)}MB`
        }),
        {
          status: 413,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

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

    // Rate limiting check - use KV-based if available, otherwise fall back to in-memory
    const rateLimiter = env.RATE_LIMIT_KV
      ? new KVRateLimiter(
          { windowMs: 60 * 1000, maxRequests: 100 },
          env.RATE_LIMIT_KV,
          'telemetry'
        )
      : memoryRateLimiters.telemetry;
    
    const rateLimitResult = env.RATE_LIMIT_KV
      ? await rateLimiter.check(clientId)
      : rateLimiter.check(clientId);
    
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

    const db = new CachedDatabase(env);

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
