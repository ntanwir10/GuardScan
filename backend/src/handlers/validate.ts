import { Env } from '../index';
import { Database } from '../db';

interface ValidateRequest {
  clientId: string;
  repoId: string;
  locCount: number;
}

interface ValidateResponse {
  allowed: boolean;
  remainingLoc: number;
}

export async function handleValidate(request: Request, env: Env): Promise<Response> {
  try {
    const body: ValidateRequest = await request.json();
    const { clientId, repoId, locCount } = body;

    if (!clientId || !repoId || !locCount) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = new Database(env);

    // Get or create client
    let client = await db.getClient(clientId);
    if (!client) {
      client = await db.createClient(clientId);
    }

    // Get remaining credits
    const remainingLoc = await db.getRemainingCredits(clientId);

    const response: ValidateResponse = {
      allowed: remainingLoc >= locCount,
      remainingLoc,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Validate error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
