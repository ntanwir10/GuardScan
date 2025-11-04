import { Env } from '../index';
import { Database } from '../db';

interface CreditsResponse {
  clientId: string;
  remainingLoc: number;
  plan: string;
}

export async function handleCredits(request: Request, env: Env, params: any): Promise<Response> {
  try {
    const { clientId } = params;

    if (!clientId) {
      return new Response(JSON.stringify({ error: 'Client ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = new Database(env);

    // Get client
    const client = await db.getClient(clientId);
    if (!client) {
      return new Response(JSON.stringify({ error: 'Client not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get remaining credits
    const remainingLoc = await db.getRemainingCredits(clientId);

    const response: CreditsResponse = {
      clientId,
      remainingLoc,
      plan: client.plan_tier,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Credits error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
