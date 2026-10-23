export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function readJson(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) {
    throw new HttpError('Request too large.', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError('A JSON object is required.');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new HttpError('Request too large.', 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError('A valid JSON object is required.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError('A JSON object is required.');
  }
  return body;
}
