"use client";
import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
let client: ConvexReactClient | undefined;
const createClient = () =>
  new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
    // Reuse a server-confirmed valid JWT on page resume. The SDK still refreshes
    // expired/rejected tokens and schedules normal rotation before expiration.
    initialAuthTokenReuse: true,
  });
export default function ConvexClient({ children }: { children: ReactNode }) {
  const current =
    typeof window === "undefined"
      ? createClient()
      : (client ??= createClient());
  return (
    <ConvexAuthNextjsProvider client={current}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
