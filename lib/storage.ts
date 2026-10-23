import { get, put, list, del } from "@vercel/blob";
export async function read(path: string) {
  const result = await get(path, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return JSON.parse(await new Response(result.stream).text());
}
export async function readVersioned(path: string) {
  const result = await get(path, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return {
    value: JSON.parse(await new Response(result.stream).text()),
    etag: result.blob.etag,
  };
}
export async function compareAndWrite(path: string, value: unknown, etag?: string) {
  return put(path, JSON.stringify(value), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
  });
}
export async function write(path: string, value: unknown) {
  return put(path, JSON.stringify(value), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    allowOverwrite: false,
  });
}
export async function all(prefix: string) {
  let cursor: string | undefined;
  const blobs = [];
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}
export { del };
