import axios, { AxiosInstance } from 'axios';

export interface TelemetryEvent {
  action: string;
  loc: number;
  durationMs: number;
  model: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface TelemetryRequest {
  clientId: string;
  repoId: string;
  events: TelemetryEvent[];
  cliVersion?: string;
}

export class APIClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl =
      baseUrl ||
      process.env.API_BASE_URL ||
      "https://guardscan-backend.ntanwir10.workers.dev";
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Send telemetry batch (optional, privacy-preserving)
   */
  async sendTelemetry(request: TelemetryRequest): Promise<void> {
    await this.client.post('/api/telemetry', request);
  }

  /**
   * Check if API is reachable
   */
  async ping(): Promise<boolean> {
    try {
      await this.client.get('/health', { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}

export const apiClient = new APIClient();
