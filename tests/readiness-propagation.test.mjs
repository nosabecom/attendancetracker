import test from 'node:test';
import assert from 'node:assert/strict';
import { providerJson } from '../scripts/prepare-hosted-next.mjs';
import { verifyReadinessWithPropagation } from '../scripts/publish-prebuilt-next.mjs';
import { signReadinessRequest, verifyReleaseReadiness } from '../lib/release-readiness.mjs';
const key='k'.repeat(64),origin='https://synthetic.vercel.app',release='a'.repeat(40),audience='synthetic-audience',cloudUrl='https://synthetic.convex.cloud',siteUrl='https://synthetic.convex.site';
const compiled={backend:'convex',cloudUrl,siteUrl,release};
const env={NEXT_PUBLIC_ATTENDANCE_BACKEND:'convex',NEXT_PUBLIC_CONVEX_URL:cloudUrl,NEXT_PUBLIC_CONVEX_SITE_URL:siteUrl,NEXT_PUBLIC_ATTENDANCE_RELEASE:release,ATTENDANCE_GATEWAY_AUDIENCE:audience,ATTENDANCE_GATEWAY_KEY:key,VERCEL_URL:'synthetic.vercel.app',BLOB_READ_WRITE_TOKEN:'',CONVEX_DEPLOY_KEY:''};
function fixture(statuses){const waits=[],nonces=[];let calls=0;return {waits,nonces,get calls(){return calls;},args:{key,wait:async ms=>waits.push(ms),createRequest:()=>{const nonce=(nonces.length+1).toString(16).padStart(64,'0');nonces.push(nonce);return signReadinessRequest({version:1,release,origin,audience,cloudUrl,siteUrl,issuedAt:Date.now(),nonce},key);},send:request=>providerJson(origin,{fetchImpl:async()=>{const status=statuses[calls++];return new Response(status===200?JSON.stringify(verifyReleaseReadiness(request,{env,compiled,origin})):status===201?'{}':'<html>denied</html>',{status:status===201?200:status});}})}};}
test('only platform 401 is polled, using fresh signed requests after fixed bounded waits',async()=>{const f=fixture([401,401,200]);await verifyReadinessWithPropagation(f.args);assert.equal(f.calls,3);assert.deepEqual(f.waits,[15000,10000,10000]);assert.equal(new Set(f.nonces).size,3);});
test('401 polling stops after three requests and never substitutes a new candidate',async()=>{const f=fixture([401,401,401,200]);await assert.rejects(verifyReadinessWithPropagation(f.args));assert.equal(f.calls,3);});
test('403,500 and invalid proofs fail immediately',async()=>{for(const status of [403,500,201]){const f=fixture([status,200]);await assert.rejects(verifyReadinessWithPropagation(f.args));assert.equal(f.calls,1);assert.deepEqual(f.waits,[15000]);}});
