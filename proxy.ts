import { NextRequest, NextResponse } from "next/server";
import { handleConvexAuth } from "./lib/convex-auth-handler";

export async function proxy(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_ATTENDANCE_BACKEND !== "convex") return NextResponse.next();
  return handleConvexAuth(request);
}

export const config = { matcher: ["/api/convex-auth"] };
