import test from "node:test";
import assert from "node:assert/strict";
import { legacyPasswordHash, verifyLegacyPassword } from "../lib/legacy-password.mjs";

const fixtures = [
  ["correct horse battery", "a1b2c3d4", "ce3835a37982ebb653c1a32f6988df18813a32bbdacd2a4c74163e0b2ede6315d54dfa679d6bc9ac5d96ca9265b279fc8aaf1f17a1b629be83d011a327984084"],
  ["päss🔑word e\u0301", "salt:☃", "1f0e3a4e9400a0f4a6291d088816b68a9b8652e566105efa2fde1a28f2e1a4d965bb60716b19d7044875040dd03a2c510007efd140e4e4f3ae95c838bd8a58c8"],
  ["  spaced password  ", "not hex / salt", "0483fb260cd157a000fa0db574201980e6ce62bbec69fd3279cc87b6f2b684e9d4cef79812e6f00cf3e9f0d0080d13f2b4760302abaa1782ad1e060248cf0690"],
];

test("matches legacy scrypt fixtures and verifies exact inputs", async () => {
  for (const [password, salt, passwordHash] of fixtures) {
    assert.equal(await legacyPasswordHash(password, salt), passwordHash);
    assert.equal(await verifyLegacyPassword(password, { salt, passwordHash }), true);
    assert.equal(await verifyLegacyPassword(password + "!", { salt, passwordHash }), false);
  }
  const [password, salt, passwordHash] = fixtures[2];
  assert.equal(await verifyLegacyPassword(password.trim(), { salt, passwordHash }), false);
  assert.equal(await verifyLegacyPassword(fixtures[1][0].normalize("NFC"), {
    salt: fixtures[1][1], passwordHash: fixtures[1][2],
  }), false);
});

test("unknown users and malformed stored credentials fail closed", async () => {
  for (const account of [null, {}, { salt: "salt", passwordHash: "0" },
    { salt: "salt", passwordHash: "z".repeat(128) },
    { salt: "salt", passwordHash: "0".repeat(129) },
    { salt: 42, passwordHash: "0".repeat(128) },
    { salt: "", passwordHash: "0".repeat(128) }]) {
    assert.equal(await verifyLegacyPassword("correct horse battery", account), false);
  }
  const [password, salt, passwordHash] = fixtures[0];
  assert.equal(await verifyLegacyPassword(password, { salt, passwordHash: passwordHash.toUpperCase() }), true);
  const fallbackHash = await legacyPasswordHash(password, "00000000000000000000000000000000");
  assert.equal(await verifyLegacyPassword(password, { salt: "", passwordHash: fallbackHash }), true);
});
