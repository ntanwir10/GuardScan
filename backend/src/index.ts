import { Router } from "./router";
import { handleTelemetry } from "./handlers/telemetry";
import { handleHealth } from "./handlers/health";
import { handleMonitoring, handleMonitoringStats } from "./handlers/monitoring";
import { rateLimiters } from "./utils/rate-limiter";
import { REQUEST_LIMITS } from "./constants";

/**
 * Get CORS headers with proper origin validation
 */
function getCorsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get("Origin");
  const headers = new Headers();

  // Parse allowed origins from env (comma-separated)
  let allowedOrigins: string[] = [];
  if (env.ALLOWED_ORIGINS) {
    allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  }

  // In development, always allow localhost origins
  if (env.ENVIRONMENT === "development") {
    allowedOrigins.push(
      "http://localhost:3000",
      "http://localhost:8787",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:8787"
    );
  }

  // Check if origin is allowed
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  // Set other CORS headers
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400"); // 24 hours

  return headers;
}

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
  RATE_LIMIT_KV?: KVNamespace;
  ENVIRONMENT?: string;
  API_VERSION?: string;
  ALLOWED_ORIGINS?: string;
}

export default {
  /**
   * Scheduled handler - runs on cron schedule
   * Used for cleanup tasks like expired rate limit records
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log("Running scheduled cleanup...");

    // Clean up expired rate limit records to prevent memory leaks
    try {
      rateLimiters.telemetry.cleanup();
      rateLimiters.monitoring.cleanup();
      rateLimiters.monitoringStats.cleanup();

      const stats = {
        telemetry: rateLimiters.telemetry.getStats(),
        monitoring: rateLimiters.monitoring.getStats(),
        monitoringStats: rateLimiters.monitoringStats.getStats(),
      };

      console.log("Cleanup complete. Active keys:", {
        telemetry: stats.telemetry.totalKeys,
        monitoring: stats.monitoring.totalKeys,
        monitoringStats: stats.monitoringStats.totalKeys,
      });
    } catch (error) {
      console.error("Error during scheduled cleanup:", error);
    }
  },

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const router = new Router();

    // Root endpoint - API info
    router.get("/", () => {
      return new Response(
        JSON.stringify(
          {
            name: "GuardScan Backend",
            version: env.API_VERSION || "v1",
            environment: env.ENVIRONMENT || "development",
            endpoints: {
              health: "/health",
              telemetry: "POST /api/telemetry",
              monitoring: "POST /api/monitoring",
              stats: "GET /api/monitoring/stats",
            },
            status: "operational",
          },
          null,
          2
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    // Health check (always available)
    router.get("/health", () => handleHealth(env));
    router.get("/api/health", () => handleHealth(env));

    // Optional telemetry (can be disabled with --no-telemetry)
    // PRIVACY: No source code sent, only anonymized metadata
    router.post("/api/telemetry", (req) => handleTelemetry(req, env));

    // Optional monitoring (errors, metrics, usage analytics)
    // For debugging and product improvements
    if (env.SUPABASE_URL && env.SUPABASE_KEY) {
      router.post("/api/monitoring", (req) => handleMonitoring(req, env));
      router.get("/api/monitoring/stats", (req) =>
        handleMonitoringStats(req, env)
      );
    }

    // CORS handling with origin validation
    const corsHeaders = getCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      const response = await router.handle(request);

      // Add CORS headers to response
      const headers = new Headers(response.headers);
      corsHeaders.forEach((value, key) => {
        headers.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.error("Error handling request:", error);

      const errorHeaders = new Headers({
        "Content-Type": "application/json",
      });
      corsHeaders.forEach((value, key) => {
        errorHeaders.set(key, value);
      });

      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: errorHeaders,
      });
    }
  },
};
