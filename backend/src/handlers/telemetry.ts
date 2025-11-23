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
import {
  KVRateLimiter,
  createRateLimitResponse,
  addRateLimitHeaders,
} from "../utils/rate-limiter-kv";
import { REQUEST_LIMITS, RATE_LIMITS } from "../constants";
import { logError } from "../utils/error-handler";
import { createDebugLogger } from "../utils/debug-logger";

// Fallback to in-memory rate limiter if KV not available
import { rateLimiters as memoryRateLimiters } from "../utils/rate-limiter";

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
  const logger = createDebugLogger("telemetry", env.ENVIRONMENT);
  const startTime = Date.now();
  logger.debug("Telemetry request received");

  let clientId = "unknown";

  try {
    // Validate Content-Length to prevent memory exhaustion attacks
    const contentLength = parseInt(
      request.headers.get("Content-Length") || "0"
    );
    logger.debug("Request size check", { contentLength });

    if (contentLength > REQUEST_LIMITS.MAX_REQUEST_SIZE_BYTES) {
      logger.warn("Request too large", {
        contentLength,
        maxSize: REQUEST_LIMITS.MAX_REQUEST_SIZE_BYTES,
      });
      return new Response(
        JSON.stringify({
          error: "Request too large",
          maxSize: `${REQUEST_LIMITS.MAX_REQUEST_SIZE_MB}MB`,
          received: `${(contentLength / 1024 / 1024).toFixed(2)}MB`,
        }),
        {
          status: 413,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const body: TelemetryRequest = await request.json();
    const { clientId: bodyClientId, repoId, events, cliVersion } = body;
    clientId = bodyClientId; // Store for error handling

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
          {
            windowMs: RATE_LIMITS.TELEMETRY_WINDOW_MS,
            maxRequests: RATE_LIMITS.TELEMETRY_MAX_REQUESTS,
          },
          env.RATE_LIMIT_KV,
          "telemetry"
        )
      : memoryRateLimiters.telemetry;

    const rateLimitResult = env.RATE_LIMIT_KV
      ? rateLimiter.check(clientId)
      : Promise.resolve(rateLimiter.check(clientId));

    const result = await rateLimitResult;

    if (!result.allowed) {
      logger.warn(`Rate limit exceeded for client: ${clientId}`, {
        remaining: result.remaining,
        resetAt: result.resetAt,
      });
      return createRateLimitResponse(result.resetAt, result.limit);
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
    const clientTrackingStart = Date.now();
    try {
      const existingClient = await db.getClient(clientId);

      if (!existingClient) {
        // New client - create record
        logger.debug("New client detected, creating record");
        await db.createClient(clientId, cliVersion);
      } else {
        // Existing client - update last seen
        logger.debug("Existing client, updating activity");
        await db.updateClientActivity(clientId, cliVersion);
      }
      const clientTrackingDuration = Date.now() - clientTrackingStart;
      logger.performance("db-client-tracking", clientTrackingDuration, {
        clientId,
        isNew: !existingClient,
      });
    } catch (clientError) {
      const clientTrackingDuration = Date.now() - clientTrackingStart;
      logger.performance("db-client-tracking", clientTrackingDuration, {
        success: false,
      });
      logger.error("Client tracking failed", clientError);
      // Don't fail if client tracking fails - telemetry is more important
      logError({ handler: "telemetry", clientId }, clientError);
    }

    // Transform events for database
    logger.debug("Transforming telemetry events for database insertion");
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
    const insertStart = Date.now();
    logger.debug(`Inserting ${dbEvents.length} telemetry events`);
    await db.insertTelemetry(dbEvents as Omit<DbTelemetryEvent, "event_id">[]);
    const insertDuration = Date.now() - insertStart;
    logger.performance("db-insert-telemetry", insertDuration, {
      eventCount: dbEvents.length,
    });

    const totalDuration = Date.now() - startTime;
    logger.performance("telemetry-request-total", totalDuration, {
      eventCount: events.length,
      clientId,
      repoId,
    });
    logger.debug("Telemetry request completed", {
      success: true,
      eventsProcessed: events.length,
      duration: totalDuration,
    });

    const response = new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    // Add rate limit headers to response
    return addRateLimitHeaders(response, result);
  } catch (error: unknown) {
    logError({ handler: "telemetry", clientId }, error);
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
