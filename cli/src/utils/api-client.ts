import axios, { AxiosInstance } from 'axios';

export interface ValidateRequest {
  clientId: string;
  repoId: string;
  locCount: number;
}

export interface ValidateResponse {
  allowed: boolean;
  remainingLoc: number;
}

export interface TelemetryEvent {
  action: string;
  loc: number;
  durationMs: number;
  model: string;
  timestamp: number;
}

export interface TelemetryRequest {
  clientId: string;
  repoId: string;
  events: TelemetryEvent[];
}

export interface CreditsResponse {
  clientId: string;
  remainingLoc: number;
  plan: string;
}

export class APIClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.API_BASE_URL || 'https://api.ai-review.dev';
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Validate LOC credits before review
   */
  async validate(request: ValidateRequest): Promise<ValidateResponse> {
    const response = await this.client.post<ValidateResponse>('/api/validate', request);
    return response.data;
  }

  /**
   * Send telemetry batch
   */
  async sendTelemetry(request: TelemetryRequest): Promise<void> {
    await this.client.post('/api/telemetry', request);
  }

  /**
   * Get remaining credits
   */
  async getCredits(clientId: string): Promise<CreditsResponse> {
    const response = await this.client.get<CreditsResponse>(`/api/credits/${clientId}`);
    return response.data;
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
