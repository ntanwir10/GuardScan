export const API_CONSTANTS = {
  VERSION_CHECK_TIMEOUT: 3000,
  API_CLIENT_TIMEOUT: 10000,
  // Use npm registry instead of GitHub releases for version checking
  // This ensures we check against what's actually published and available to users
  VERSION_CHECK_URL: "https://registry.npmjs.org/guardscan/latest",
  // Production API URL - always points to production environment
  // Backend must be deployed with: wrangler deploy --env production
  DEFAULT_API_BASE_URL: "https://api.guardscancli.com",
  VERSION_CACHE_HOURS: 24,
} as const;
