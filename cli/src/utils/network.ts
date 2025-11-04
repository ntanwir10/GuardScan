import axios from 'axios';

/**
 * Check if we have internet connectivity
 */
export async function isOnline(): Promise<boolean> {
  try {
    await axios.get('https://www.google.com', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if specific API endpoint is reachable
 */
export async function isEndpointReachable(url: string): Promise<boolean> {
  try {
    await axios.get(url, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
