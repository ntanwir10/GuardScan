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
