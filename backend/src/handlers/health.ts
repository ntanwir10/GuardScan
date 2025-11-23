import { createDebugLogger } from "../utils/debug-logger";

export interface Env {
  API_VERSION?: string;
  ENVIRONMENT?: string;
}

export function handleHealth(env: Env): Response {
  const logger = createDebugLogger('health', env.ENVIRONMENT);
  const startTime = Date.now();
  logger.debug('Health check started');
  
  const response = new Response(
    JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: env.API_VERSION || "v1",
      environment: env.ENVIRONMENT || "development",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
  
  const duration = Date.now() - startTime;
  logger.performance('health-check', duration);
  logger.debug('Health check completed', { duration });
  
  return response;
}
