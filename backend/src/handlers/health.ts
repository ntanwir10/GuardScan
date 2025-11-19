export interface Env {
  API_VERSION?: string;
  ENVIRONMENT?: string;
}

export function handleHealth(env: Env): Response {
  return new Response(
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
}
