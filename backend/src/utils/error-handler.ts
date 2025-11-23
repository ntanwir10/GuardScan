export interface ErrorContext {
  handler: string;
  clientId?: string;
  requestId?: string;
}

export function logError(context: ErrorContext, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error({
    level: 'error',
    handler: context.handler,
    message: err.message,
    clientId: context.clientId,
    timestamp: new Date().toISOString(),
  });
}

export function createErrorResponse(message: string, status: number = 500): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

