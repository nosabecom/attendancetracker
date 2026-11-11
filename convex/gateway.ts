import { httpAction } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { verifyGatewayRequest } from "../lib/gateway-proof.mjs";
import { normalize } from "../lib/roster.mjs";
const ref = (name: string) => makeFunctionReference<any>(name) as any;
const messages: Record<number, string> = {
  400: "Invalid request.",
  403: "Unauthorized.",
  404: "Attendance session not found.",
  409: "This attendance session is closed.",
  503: "Attendance is temporarily unavailable.",
};
const validationMessages = new Set([
  "Invalid attendance ID.",
  "Enter your name or student ID.",
  "No unique match found. Use your student ID or ask your teacher to check the roster.",
]);
function publicError(status: number, message: unknown) {
  return status === 400 && typeof message === "string" && validationMessages.has(message)
    ? message
    : messages[status];
}
function action(operation: "checkin" | "public-info") {
  return httpAction(async (ctx, request) => {
    try {
      if (Number(request.headers.get("content-length")) > 4096)
        return Response.json({ error: "Invalid request." }, { status: 400 });
      const reader = request.body?.getReader();
      if (!reader)
        return Response.json({ error: "Invalid request." }, { status: 400 });
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4096)
            return Response.json(
              { error: "Invalid request." },
              { status: 400 },
            );
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      // Parsing failures and malformed envelopes are client errors. Keep them
      // separate from backend failures so OCC never masquerades as HTTP 400.
      let envelope;
      try {
        envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        return Response.json({ error: "Invalid request." }, { status: 400 });
      }
      if (
        !envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
        !Object.hasOwn(envelope, "payload") ||
        Object.keys(envelope).some((key) => key !== "payload" && key !== "proof")
      )
        return Response.json({ error: "Invalid request." }, { status: 400 });
      const { payload, proof } = envelope;
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        typeof payload.legacyId !== "string" ||
        !/^[a-f0-9]{32}$/.test(payload.legacyId) ||
        Object.keys(payload).sort().join(",") !==
          (operation === "checkin" ? "identity,legacyId" : "legacyId") ||
        (operation === "checkin" &&
          (typeof payload.identity !== "string" ||
            !payload.identity.trim() ||
            payload.identity.length > 160))
      )
        return Response.json({ error: "Invalid request." }, { status: 400 });
      if (
        !(await verifyGatewayRequest(operation, payload, proof, {
          secret: process.env.ATTENDANCE_GATEWAY_KEY,
          audience: process.env.ATTENDANCE_GATEWAY_AUDIENCE,
        }))
      )
        return Response.json({ error: "Unauthorized." }, { status: 403 });
      if (operation === "checkin") {
        const identityHash = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(
                payload.legacyId + ":" + normalize(payload.identity),
              ),
            ),
          ),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        if (
          !(await ctx.runMutation(ref("authSupport:reserve"), {
            nonce: proof.nonce,
            issuedAt: proof.issuedAt,
            ipHash: proof.ipHash,
            username: identityHash,
            operation,
            sessionLegacyId: payload.legacyId,
          }))
        )
          return Response.json(
            { error: "Please try again later." },
            { status: 429 },
          );
        return Response.json(
          await ctx.runMutation(ref("attendance:publicCheckin"), payload),
        );
      }
      return Response.json(
        await ctx.runQuery(ref("attendance:publicInfo"), payload),
      );
    } catch (error) {
      const data = (error as { data?: { status?: number; message?: string } })
        ?.data;
      const status =
        typeof data?.status === "number" &&
        [400, 403, 404, 409, 503].includes(data.status)
          ? data.status
          : 503;
      return Response.json(
        {
          // Static domain messages only: unexpected errors must not expose
          // transaction details, identities, or arbitrary exception text.
          error: publicError(status, data?.message),
        },
        { status },
      );
    }
  });
}
export const publicInfo = action("public-info");
export const checkin = action("checkin");
