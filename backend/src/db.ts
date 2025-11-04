import { Env } from './index';

export interface Client {
  client_id: string;
  created_at: string;
  total_loc_used: number;
  plan_tier: string;
}

export interface Transaction {
  transaction_id: string;
  client_id: string;
  loc_purchased: number;
  amount_usd: number;
  payment_status: string;
  created_at: string;
}

export interface TelemetryEvent {
  event_id: string;
  client_id: string;
  repo_id: string;
  action_type: string;
  duration_ms: number;
  model?: string;
  loc?: number;
  timestamp: string;
}

export class Database {
  private supabaseUrl: string;
  private supabaseKey: string;

  constructor(env: Env) {
    this.supabaseUrl = env.SUPABASE_URL;
    this.supabaseKey = env.SUPABASE_KEY;
  }

  private async query<T>(table: string, options: any = {}): Promise<T[]> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/${table}`);

    if (options.select) {
      url.searchParams.set('select', options.select);
    }

    if (options.eq) {
      for (const [key, value] of Object.entries(options.eq)) {
        url.searchParams.set(key, `eq.${value}`);
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        'apikey': this.supabaseKey,
        'Authorization': `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Database query failed: ${response.statusText}`);
    }

    return await response.json();
  }

  private async insert<T>(table: string, data: any): Promise<T> {
    const url = `${this.supabaseUrl}/rest/v1/${table}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': this.supabaseKey,
        'Authorization': `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Database insert failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result[0];
  }

  private async update(table: string, filter: any, data: any): Promise<void> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/${table}`);

    for (const [key, value] of Object.entries(filter)) {
      url.searchParams.set(key, `eq.${value}`);
    }

    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        'apikey': this.supabaseKey,
        'Authorization': `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Database update failed: ${response.statusText}`);
    }
  }

  async getClient(clientId: string): Promise<Client | null> {
    const results = await this.query<Client>('clients', {
      eq: { client_id: clientId },
    });

    return results.length > 0 ? results[0] : null;
  }

  async createClient(clientId: string): Promise<Client> {
    return await this.insert<Client>('clients', {
      client_id: clientId,
      created_at: new Date().toISOString(),
      total_loc_used: 0,
      plan_tier: 'free',
    });
  }

  async updateClientLocUsage(clientId: string, locUsed: number): Promise<void> {
    await this.update('clients', { client_id: clientId }, {
      total_loc_used: locUsed,
    });
  }

  async createTransaction(transaction: Omit<Transaction, 'transaction_id' | 'created_at'>): Promise<Transaction> {
    return await this.insert<Transaction>('transactions', {
      ...transaction,
      created_at: new Date().toISOString(),
    });
  }

  async insertTelemetry(events: Omit<TelemetryEvent, 'event_id'>[]): Promise<void> {
    const data = events.map(event => ({
      ...event,
      event_id: crypto.randomUUID(),
    }));

    await this.insert('telemetry', data);
  }

  async getRemainingCredits(clientId: string): Promise<number> {
    // Get total purchased
    const transactions = await this.query<Transaction>('transactions', {
      eq: { client_id: clientId, payment_status: 'paid' },
      select: 'loc_purchased',
    });

    const totalPurchased = transactions.reduce((sum, t) => sum + t.loc_purchased, 0);

    // Get total used
    const client = await this.getClient(clientId);
    const totalUsed = client?.total_loc_used || 0;

    return totalPurchased - totalUsed;
  }
}
