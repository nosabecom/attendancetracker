// Shared by Next's Node ingress and Convex actions. The long-lived server key
// never crosses the gateway: proofs bind one short-lived request instead.
const OPERATIONS = new Set(["login", "signup", "logout", "checkin", "public-info"]);
const MAX_AGE = 60_000;
const CLOCK_SKEW = 10_000;
const encoder = new TextEncoder();

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  throw new Error("Invalid gateway payload.");
}

function message(operation, payload, proof) {
  return encoder.encode(JSON.stringify([
    1, proof.audience, operation, canonical(payload), proof.ipHash, proof.nonce, proof.issuedAt,
  ]));
}

async function signingKey(secret) {
  if (typeof secret !== "string" || encoder.encode(secret).length < 32)
    throw new Error("Gateway key is not configured.");
  return crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function hashGatewayIp(ip) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(ip));
  return toHex(new Uint8Array(digest));
}

function toHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function signGatewayRequest(operation, payload, {
  secret, audience, ipHash, nonce = crypto.randomUUID().replaceAll("-", ""), now = Date.now(),
}) {
  if (typeof audience !== "string" || !audience || audience.length > 256 ||
      !OPERATIONS.has(operation) || typeof ipHash !== "string" || !/^[a-f0-9]{64}$/.test(ipHash) ||
      !/^[a-f0-9]{32}$/.test(nonce) || !Number.isSafeInteger(now))
    throw new Error("Invalid gateway request.");
  const proof = { audience, ipHash, nonce, issuedAt: now };
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), message(operation, payload, proof));
  return { ...proof, signature: toHex(new Uint8Array(signature)) };
}

// Verification is only the first step. Mutating operations must atomically
// consume the nonce and reserve their rate allowance before expensive work.
export async function verifyGatewayRequest(operation, payload, proof, { secret, audience, now = Date.now() }) {
  if (!OPERATIONS.has(operation) || !proof ||
      typeof audience !== "string" || !audience || proof.audience !== audience ||
      typeof proof.ipHash !== "string" || !/^[a-f0-9]{64}$/.test(proof.ipHash) ||
      typeof proof.nonce !== "string" || !/^[a-f0-9]{32}$/.test(proof.nonce) ||
      typeof proof.signature !== "string" || !/^[a-f0-9]{64}$/.test(proof.signature) || !Number.isSafeInteger(proof.issuedAt) ||
      !Number.isSafeInteger(now) || proof.issuedAt > now + CLOCK_SKEW ||
      now - proof.issuedAt > MAX_AGE) return false;
  try {
    const signature = Uint8Array.from(proof.signature.match(/../g), byte => parseInt(byte, 16));
    return await crypto.subtle.verify("HMAC", await signingKey(secret), signature, message(operation, payload, proof));
  } catch {
    return false;
  }
}
