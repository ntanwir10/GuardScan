import axios, { AxiosInstance } from "axios";
import { API_CONSTANTS } from "../constants/api-constants";

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
    // Default backend for project-wide telemetry (optional, privacy-preserving)
    // Users can opt-out with --no-telemetry flag
    // Or override with GUARDSCAN_API_URL env var (for testing/self-hosting)
    this.baseUrl =
      baseUrl ||
      process.env.GUARDSCAN_API_URL ||
      API_CONSTANTS.DEFAULT_API_BASE_URL;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: API_CONSTANTS.API_CLIENT_TIMEOUT,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * Send telemetry batch (optional, privacy-preserving)
   * Fails silently - telemetry errors never break the CLI
   */
  async sendTelemetry(request: TelemetryRequest): Promise<void> {
    try {
      await this.client.post("/api/telemetry", request);
    } catch (error) {
      // Silently fail - telemetry is optional and should never break the CLI
      // Users can disable with --no-telemetry flag
      // No logging in production to avoid noise
    }
  }

  /**
   * Check if API is reachable
   */
  async ping(): Promise<boolean> {
    try {
      await this.client.get("/health", { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get backend URL (for display purposes)
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export const apiClient = new APIClient();
