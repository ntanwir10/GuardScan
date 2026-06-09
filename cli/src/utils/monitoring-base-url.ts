import { API_CONSTANTS } from "../constants/api-constants";

/**
 * Base URL for the GuardScan-Monitoring Cloudflare Worker (telemetry + monitoring).
 * Same host backs POST /api/telemetry and POST /api/monitoring.
 */
export function getGuardscanMonitoringBaseUrl(): string {
  const raw = process.env.GUARDSCAN_API_URL || API_CONSTANTS.DEFAULT_API_BASE_URL;
  return raw.replace(/\/$/, "");
}
