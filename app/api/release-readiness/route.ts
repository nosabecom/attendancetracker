import 'server-only';
import { readReadinessBody, verifyReleaseReadiness } from '../../../lib/release-readiness.mjs';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    // Direct references are deliberately compiled; the alias below stays live.
    const compiled = {
      backend: process.env.NEXT_PUBLIC_ATTENDANCE_BACKEND,
      cloudUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
      siteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
      release: process.env.NEXT_PUBLIC_ATTENDANCE_RELEASE,
    };
    const env = process.env;
    const result = verifyReleaseReadiness(await readReadinessBody(request), {
      env, compiled, origin: new URL(request.url).origin,
    });
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: 'Release verification failed.' }, { status: 403, headers });
  }
}
