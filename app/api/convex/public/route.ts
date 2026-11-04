import { readJson, HttpError } from '../../../../lib/http.mjs';
import { checkOrigin, failure, proofFor } from '../../../../lib/convex-auth-gateway';
export const runtime = 'nodejs';
async function send(req: Request, operation: string, payload: object) {
  const proof = await proofFor(req, operation, payload);
  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!site) throw new HttpError('Gateway unavailable.', 503);
  const response = await fetch(new URL(`/gateway/${operation}`, site), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload, proof }), cache: 'no-store' });
  const data = await response.json();
  return Response.json(data, { status: response.status, headers: { 'Cache-Control': 'no-store' } });
}
function validId(id: unknown): id is string { return typeof id === 'string' && /^[a-f0-9]{32}$/.test(id); }
export async function GET(request: Request) { try {
  checkOrigin(request);
  const params = new URL(request.url).searchParams, id = params.get('id');
  if (!validId(id) || [...params.keys()].length !== 1) throw new HttpError('Invalid request.');
  return await send(request, 'public-info', { legacyId: id });
} catch (e) { return failure(e); } }
export async function POST(request: Request) { try {
  checkOrigin(request);
  const body = await readJson(request, 4096);
  if (Object.keys(body).sort().join(',') !== 'action,id,identity' || body.action !== 'checkin' || !validId(body.id) || typeof body.identity !== 'string' || !body.identity.trim() || body.identity.length > 160) throw new HttpError('Invalid request.');
  return await send(request, 'checkin', { legacyId: body.id, identity: body.identity });
} catch (e) { return failure(e); } }
