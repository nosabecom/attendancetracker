import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const DUMMY_SALT = "00000000000000000000000000000000";
const DUMMY_HASH = Buffer.alloc(64);

// Node-only: the old application passed the salt string directly to scrypt.
export function legacyPasswordHash(password, salt) {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 64, {
      N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
    }, (error, key) => error ? reject(error) : resolve(key.toString("hex")));
  });
}

// Unknown and malformed accounts still incur one scrypt operation. Validate
// request types and length before calling this function at the ingress.
export async function verifyLegacyPassword(password, account) {
  const validSalt = typeof account?.salt === "string";
  const validHash = typeof account?.passwordHash === "string" &&
    /^[0-9a-fA-F]{128}$/.test(account.passwordHash);
  const computed = Buffer.from(await legacyPasswordHash(
    password, validSalt && account.salt ? account.salt : DUMMY_SALT,
  ), "hex");
  const expected = validHash ? Buffer.from(account.passwordHash, "hex") : DUMMY_HASH;
  return timingSafeEqual(computed, expected) && validSalt && validHash;
}
