import LegacyHome from "./legacy-home";
import ConvexStudent from "./convex-student";
import ConvexReset from "./convex-reset";
import ConvexClient from "./convex-client";
import ConvexHome from "./convex-home";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ join?: string | string[]; reset?: string | string[] }>;
}) {
  if (process.env.NEXT_PUBLIC_ATTENDANCE_BACKEND !== "convex")
    return <LegacyHome />;
  const { join, reset } = await searchParams;
  if (reset !== undefined)
    return (
      <ConvexReset
        token={
          typeof reset === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(reset)
            ? reset
            : ""
        }
      />
    );
  if (join !== undefined)
    return (
      <ConvexStudent
        id={typeof join === "string" && /^[a-f0-9]{32}$/.test(join) ? join : ""}
      />
    );
  return (
    <ConvexAuthNextjsServerProvider
      apiRoute="/api/convex-auth"
      storage="inMemory"
      shouldHandleCode={false}
      verbose={false}
    >
      <ConvexClient>
        <ConvexHome />
      </ConvexClient>
    </ConvexAuthNextjsServerProvider>
  );
}
