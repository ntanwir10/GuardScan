import axios, { AxiosInstance } from "axios";
import { API_CONSTANTS } from "../constants/api-constants";

export type TelemetryAction = "review" | "security" | "scan" | "test";
export type TelemetryExecutionMode =
  | "static"
  | "local-ai"
  | "cloud-ai"
  | "unknown";

export interface TelemetryEvent {
  eventId: string;
  action: TelemetryAction;
  loc: number;
  durationMs: number;
  executionMode: TelemetryExecutionMode;
  occurredAt: number;
}

export interface TelemetryRequest {
  schemaVersion: "guardscan.telemetry.v1";
  batchId: string;
  sentAt: number;
  cliVersion: string;
  events: TelemetryEvent[];
}

export interface TelemetryResponse {
  status: "accepted" | "duplicate";
  batchId: string;
  accepted: number;
  acceptedEventIds?: string[];
}

export class TelemetryDeliveryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable: boolean = true
  ) {
    super(message);
    this.name = "TelemetryDeliveryError";
  }
}

export class APIClient {
  private client?: AxiosInstance;
  private baseUrl: string;
  private configurationError?: TelemetryDeliveryError;

  constructor(baseUrl?: string) {
    this.baseUrl = (
      baseUrl ||
      process.env.GUARDSCAN_TELEMETRY_URL ||
      process.env.GUARDSCAN_API_URL ||
      ""
    ).replace(/\/+$/, "");

    if (this.baseUrl) {
      try {
        this.validateBaseUrl(this.baseUrl);
      } catch (error) {
        if (error instanceof TelemetryDeliveryError) {
          this.configurationError = error;
          return;
        }
        throw error;
      }
      this.client = axios.create({
        baseURL: this.baseUrl,
        timeout: API_CONSTANTS.API_CLIENT_TIMEOUT,
        maxBodyLength: 64 * 1024,
        maxContentLength: 64 * 1024,
        maxRedirects: 0,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
  }

  async sendTelemetry(request: TelemetryRequest): Promise<TelemetryResponse> {
    if (this.configurationError) {
      throw this.configurationError;
    }
    if (!this.client) {
      throw new TelemetryDeliveryError(
        "Telemetry endpoint is not configured. Set GUARDSCAN_TELEMETRY_URL.",
        undefined,
        false
      );
    }

    try {
      const response = await this.client.post<TelemetryResponse>(
        "/api/telemetry",
        request
      );
      if (!response.data || response.data.batchId !== request.batchId) {
        throw new TelemetryDeliveryError(
          "Telemetry collector returned an invalid acknowledgement.",
          response.status,
          false
        );
      }
      if (response.data.status !== "accepted" && response.data.status !== "duplicate") {
        throw new TelemetryDeliveryError(
          "Telemetry collector returned an unsupported acknowledgement status.",
          response.status,
          false
        );
      }
      if (
        !Number.isInteger(response.data.accepted) ||
        response.data.accepted < 0 ||
        response.data.accepted > request.events.length
      ) {
        throw new TelemetryDeliveryError(
          "Telemetry collector returned an invalid accepted-event count.",
          response.status,
          false
        );
      }
      if (response.data.acceptedEventIds !== undefined) {
        if (!Array.isArray(response.data.acceptedEventIds)) {
          throw new TelemetryDeliveryError(
            "Telemetry collector acceptedEventIds must be an array.",
            response.status,
            false
          );
        }
        const requested = new Set(request.events.map(event => event.eventId));
        const acknowledged = response.data.acceptedEventIds;
        if (acknowledged.some(eventId => typeof eventId !== "string")) {
          throw new TelemetryDeliveryError(
            "Telemetry collector acceptedEventIds must contain strings.",
            response.status,
            false
          );
        }
        if (acknowledged.length !== new Set(acknowledged).size) {
          throw new TelemetryDeliveryError(
            "Telemetry collector acceptedEventIds must be unique.",
            response.status,
            false
          );
        }
        if (acknowledged.some(eventId => !requested.has(eventId))) {
          throw new TelemetryDeliveryError(
            "Telemetry collector acceptedEventIds must reference requested events.",
            response.status,
            false
          );
        }
        if (acknowledged.length !== response.data.accepted ||
            (response.data.status === "duplicate" && acknowledged.length !== request.events.length)) {
          throw new TelemetryDeliveryError(
            "Telemetry collector acknowledged unknown or inconsistent event IDs.",
            response.status,
            false
          );
        }
      } else if (response.data.accepted !== request.events.length) {
        throw new TelemetryDeliveryError(
          response.data.status === "duplicate"
            ? "A duplicate telemetry acknowledgement must cover the complete batch."
            : "A partial telemetry acknowledgement must include acceptedEventIds.",
          response.status,
          false
        );
      }
      return response.data;
    } catch (error: unknown) {
      if (error instanceof TelemetryDeliveryError) {
        throw error;
      }
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const retryable =
          status === undefined || status === 408 || status === 429 || status >= 500;
        throw new TelemetryDeliveryError(
          status
            ? `Telemetry collector returned HTTP ${status}.`
            : "Telemetry collector could not be reached.",
          status,
          retryable
        );
      }
      throw new TelemetryDeliveryError("Telemetry delivery failed.", undefined, false);
    }
  }

  async ping(): Promise<boolean> {
    if (this.configurationError || !this.client) {
      return false;
    }
    try {
      await this.client.get("/health", { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private validateBaseUrl(value: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new TelemetryDeliveryError(
        "Telemetry endpoint must be a valid URL.",
        undefined,
        false
      );
    }
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      throw new TelemetryDeliveryError(
        "Telemetry endpoint must use HTTPS unless it is a loopback URL.",
        undefined,
        false
      );
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new TelemetryDeliveryError(
        "Telemetry endpoint cannot contain credentials, a query, or a fragment.",
        undefined,
        false
      );
    }
  }
}

/** @deprecated Construct APIClient with the explicit telemetry URL instead. */
export const apiClient = new APIClient();
