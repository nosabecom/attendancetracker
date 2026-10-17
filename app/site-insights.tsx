"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

// Check-in URLs and older teacher links contain private access tokens.
function withoutAccessTokens<T extends { url: string }>(event: T): T | null {
  try {
    const url = new URL(event.url);
    url.search = "";
    url.hash = "";
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
}

export default function SiteInsights() {
  return (
    <>
      <Analytics beforeSend={withoutAccessTokens} />
      <SpeedInsights beforeSend={withoutAccessTokens} />
    </>
  );
}
