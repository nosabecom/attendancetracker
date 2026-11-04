import test from "node:test";
import assert from "node:assert/strict";
import { hashGatewayIp, signGatewayRequest, verifyGatewayRequest } from "../lib/gateway-proof.mjs";

const secret = "synthetic-gateway-key-for-test-fixtures-only";
const audience = "attendance-tracker:test";
const now = 1_800_000_000_000;
const ipHash = await hashGatewayIp("192.0.2.1");
const nonce = "a".repeat(32);
const payload = { username: "teacher-name", password: "exact password  ", action: "login" };
const create = (operation = "login", value = payload) =>
  signGatewayRequest(operation, value, { secret, audience, ipHash, nonce, now });
const verify = (proof, operation = "login", value = payload, time = now) =>
  verifyGatewayRequest(operation, value, proof, { secret, audience, now: time });

test("gateway proofs bind the operation, entire payload, source IP, nonce and time", async () => {
  const proof = await create();
  assert.equal(await verify(proof), true);
  assert.equal(await verify(proof, "signup"), false);
  assert.equal(await verify(proof, "login", { ...payload, password: payload.password.trim() }), false);
  assert.equal(await verify({ ...proof, ipHash: "b".repeat(64) }), false);
  assert.equal(await verify({ ...proof, nonce: "b".repeat(32) }), false);
  assert.equal(await verify({ ...proof, issuedAt: now + 1 }), false);
  assert.equal(await verifyGatewayRequest("login", payload, proof, { secret: "wrong-but-long-enough-synthetic-server-key", audience, now }), false);
  assert.equal(await verifyGatewayRequest("login", payload, proof, { secret, audience: "another-deployment", now }), false);
  assert.equal(JSON.stringify(proof).includes(secret), false);
  assert.equal(JSON.stringify(proof).includes(payload.password), false);
});

test("payload key order is stable across JSON transport, but added fields invalidate the proof", async () => {
  const proof = await create();
  assert.equal(await verify(proof, "login", { action: "login", password: payload.password, username: payload.username }), true);
  assert.equal(await verify(proof, "login", { ...payload, owner: "someone-else" }), false);
});

test("expired, future, malformed and unconfigured proofs fail closed", async () => {
  const proof = await create();
  assert.equal(await verify(proof, "login", payload, now + 60_001), false);
  assert.equal(await verify(proof, "login", payload, now - 10_001), false);
  for (const bad of [null, {}, { ...proof, signature: "z".repeat(64) }, { ...proof, nonce: "" }, { ...proof, issuedAt: NaN }])
    assert.equal(await verify(bad), false);
  assert.equal(await verifyGatewayRequest("login", payload, proof, { secret: undefined, audience, now }), false);
  await assert.rejects(signGatewayRequest("login", payload, { secret: "short", audience, ipHash, nonce, now }));
  await assert.rejects(create("arbitrary-admin-operation"));
});
