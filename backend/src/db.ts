import { Env } from "./index";

export interface Client {
  client_id: string;
  created_at: string;
  last_seen_at: string | null;
  cli_version: string | null;
  metadata: Record<string, any>;
}

export interface TelemetryEvent {
  event_id: string;
  client_id: string;
  repo_id: string;
  action_type: string;
  duration_ms: number | null;
  model: string | null;
  loc: number | null;
  timestamp: string;
  metadata: Record<string, any>;
}

export class Database {
  private supabaseUrl: string;
  private supabaseKey: string;

  constructor(env: Env) {
    this.supabaseUrl = env.SUPABASE_URL || "";
    this.supabaseKey = env.SUPABASE_KEY || "";
  }

  private async query<T>(table: string, options: any = {}): Promise<T[]> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/${table}`);

    if (options.select) {
      url.searchParams.set("select", options.select);
    }

    if (options.eq) {
      for (const [key, value] of Object.entries(options.eq)) {
        url.searchParams.set(key, `eq.${value}`);
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        "Content-Type": "application/json",
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
      method: "POST",
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Database insert failed: ${response.statusText}`);
    }

    const result = (await response.json()) as any[];
    return result[0] as T;
  }

  private async update(table: string, filter: any, data: any): Promise<void> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/${table}`);

    for (const [key, value] of Object.entries(filter)) {
      url.searchParams.set(key, `eq.${value}`);
    }

    const response = await fetch(url.toString(), {
      method: "PATCH",
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Database update failed: ${response.statusText}`);
    }
  }

  /**
   * Get client by ID
   */
  async getClient(clientId: string): Promise<Client | null> {
    const results = await this.query<Client>("clients", {
      eq: { client_id: clientId },
    });

    return results.length > 0 ? results[0] : null;
  }

  /**
   * Create new client
   */
  async createClient(clientId: string, cliVersion?: string): Promise<Client> {
    return await this.insert<Client>("clients", {
      client_id: clientId,
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      cli_version: cliVersion || null,
      metadata: {},
    });
  }

  /**
   * Update client's last seen timestamp
   */
  async updateClientActivity(
    clientId: string,
    cliVersion?: string
  ): Promise<void> {
    const updateData: any = {
      last_seen_at: new Date().toISOString(),
    };

    if (cliVersion) {
      updateData.cli_version = cliVersion;
    }

    await this.update("clients", { client_id: clientId }, updateData);
  }

  /**
   * Insert telemetry events (batch)
   */
  async insertTelemetry(
    events: Omit<TelemetryEvent, "event_id">[]
  ): Promise<void> {
    const data = events.map((event) => ({
      ...event,
      event_id: crypto.randomUUID(),
      metadata: event.metadata || {},
    }));

    await this.insert("telemetry", data);
  }

  /**
   * Get client statistics (for admin/analytics)
   */
  async getClientStats(clientId: string): Promise<any> {
    const client = await this.getClient(clientId);
    if (!client) {
      return null;
    }

    // Count telemetry events
    const events = await this.query<TelemetryEvent>("telemetry", {
      eq: { client_id: clientId },
    });

    return {
      client,
      total_events: events.length,
      first_seen: client.created_at,
      last_seen: client.last_seen_at,
    };
  }
  /**
   * Insert error events (batch)
   */
  async insertErrors(errors: any[]): Promise<void> {
    const data = errors.map((error) => ({
      ...error,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    }));

    await this.insert("errors", data);
  }

  /**
   * Get errors since timestamp
   */
  async getErrorsSince(since: string): Promise<any[]> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/errors`);
    url.searchParams.set("select", "severity,message,timestamp");
    url.searchParams.set("timestamp", `gte.${since}`);
    url.searchParams.set("order", "timestamp.desc");

    const response = await fetch(url.toString(), {
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get errors: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Insert performance metrics (batch)
   */
  async insertMetrics(metrics: any[]): Promise<void> {
    const data = metrics.map((metric) => ({
      ...metric,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    }));

    await this.insert("metrics", data);
  }

  /**
   * Get metrics since timestamp
   */
  async getMetricsSince(since: string): Promise<any[]> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/metrics`);
    url.searchParams.set("select", "name,value,unit,timestamp");
    url.searchParams.set("timestamp", `gte.${since}`);
    url.searchParams.set("order", "timestamp.desc");

    const response = await fetch(url.toString(), {
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get metrics: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Insert usage events (batch)
   */
  async insertUsageEvents(events: any[]): Promise<void> {
    const data = events.map((event) => ({
      ...event,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    }));

    await this.insert("usage_events", data);
  }

  /**
   * Get usage events since timestamp
   */
  async getUsageEventsSince(since: string): Promise<any[]> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/usage_events`);
    url.searchParams.set("select", "command,success,duration,timestamp");
    url.searchParams.set("timestamp", `gte.${since}`);
    url.searchParams.set("order", "timestamp.desc");

    const response = await fetch(url.toString(), {
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get usage events: ${response.statusText}`);
    }

    return await response.json();
  }
}
