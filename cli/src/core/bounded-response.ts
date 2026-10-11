function isLoopbackIpv4(hostname: string): boolean {
  const octets = hostname.split('.');
  return octets.length === 4
    && octets[0] === '127'
    && octets.slice(1).every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

/** Allow HTTPS endpoints and local HTTP services without accepting remote cleartext traffic. */
export function isAllowedNetworkEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') {return false;}
  try {
    const endpoint = new URL(value);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {return false;}
    if (endpoint.protocol === 'https:') {return true;}
    if (endpoint.protocol !== 'http:') {return false;}
    const hostname = endpoint.hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname === '::1'
      || hostname === '[::1]'
      || isLoopbackIpv4(hostname);
  } catch {
    return false;
  }
}

/** Read a Fetch response without allowing a missing Content-Length to bypass memory limits. */
export async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
  responseTooLarge: () => Error
): Promise<string> {
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > maximumBytes) {throw responseTooLarge();}
  if (!response.body) {return '';}

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {break;}
    total += value.byteLength;
    if (total > maximumBytes) {
      try {await reader.cancel();} catch { /* The size error remains authoritative. */ }
      throw responseTooLarge();
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}
