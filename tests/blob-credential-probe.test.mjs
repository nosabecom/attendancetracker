import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BLOB_PROBE_TARGET as target, BLOB_PROBE_LIMITS, BlobCredentialProbeError,
  probeBlobCredential, readBlobProbeCredential, runBlobCredentialProbeCli,
} from '../scripts/probe-blob-credential.mjs';

const token = `vercel_blob_rw_${target.storeId.slice(6)}_SYNTHETICSECRET0000000000`;
const now = Date.parse('2026-11-09T12:00:00Z');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const jwt = extras => [Buffer.from('{"alg":"RS256"}').toString('base64url'), Buffer.from(JSON.stringify({
  project_id: target.projectId, owner_id: target.teamId, environment: 'development', exp: now / 1000 + 3600, ...extras,
})).toString('base64url'), 'SYNTHETICSIGNATURE'].join('.');
const page = { blobs: [{ pathname: 'ROW_SENTINEL_URL_SENTINEL', url: `https://${target.storeId.slice(6).toLowerCase()}.private.blob.vercel-storage.com/ROW_SENTINEL_URL_SENTINEL`, size: 2, uploadedAt: '2026-11-09T00:00:00Z' }], hasMore: true };
function response(body = page, status = 200) { return { status, body: new Blob([typeof body === 'string' ? body : JSON.stringify(body)]).stream() }; }
async function temp() { return mkdtemp(join(tmpdir(), 'blob-credential-test-')); }
function options(dir, transport, extras = {}) { return {
  kind: 'rw', token, outputPath: join(dir, 'outcome.json'), attemptPath: join(dir, 'attempt.json'), transport, now: () => now, ...extras,
}; }
async function saved(dir) { return JSON.parse(await readFile(join(dir, 'attempt.json'), 'utf8')); }
async function identical(dir, result) {
  assert.deepEqual(await saved(dir), result);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'outcome.json'), 'utf8')), result);
  const text = JSON.stringify(result);
  for (const sentinel of [token, 'ROW_SENTINEL', 'URL_SENTINEL', 'ERROR_SENTINEL']) assert.ok(!text.includes(sentinel));
  assert.equal(result.scope, 'single_credential_store_time');
  assert.equal(result.operation, 'list_limit_1_metadata');
  assert.equal((await stat(join(dir, 'attempt.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, 'outcome.json'))).mode & 0o777, 0o600);
}
async function rejects(work, code) { await assert.rejects(work, error => error instanceof BlobCredentialProbeError && error.code === code && !error.message.includes('SENTINEL')); }

test('makes exactly one explicit bearer-bound SDK-parity LIST request after durable reservation', async () => {
  const dir = await temp();
  try {
    let calls = 0;
    const result = await probeBlobCredential(options(dir, async (url, init) => {
      calls++;
      const reservation = await saved(dir);
      assert.equal(reservation.status, 'running');
      assert.equal(reservation.requestAttempts, 1);
      assert.equal(url.href, 'https://vercel.com/api/blob?limit=1');
      assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
      assert.equal(init.headers.authorization, `Bearer ${token}`);
      assert.equal(init.headers['x-api-version'], '13');
      assert.equal(init.headers['x-vercel-blob-store-id'], target.storeId.slice(6));
      assert.equal(init.headers['x-api-blob-request-attempt'], '0');
      assert.match(init.headers['x-api-blob-request-id'], new RegExp(`^${target.storeId.slice(6)}:[0-9]+:[a-f0-9]{16}$`));
      return response();
    }));
    assert.equal(calls, 1); assert.equal(result.status, 'accepted'); assert.equal(result.httpStatus, 200);
    assert.equal(result.metadataRowsObserved, 1); assert.equal(result.requestAttempts, 1);
    await identical(dir, result);
    await rejects(probeBlobCredential(options(dir, async () => { calls++; })), 'output_exists');
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('OIDC decoding checks owned development claims and expiry without claiming signature verification', async t => {
  for (const [label, extra, code] of [
    ['valid', {}, undefined], ['wrong project', { project_id: 'foreign' }, 'oidc_claims'],
    ['wrong team', { owner_id: 'foreign' }, 'oidc_claims'], ['production', { environment: 'production' }, 'oidc_claims'],
    ['expired', { exp: now / 1000 - 1 }, 'oidc_expiry'], ['under 30 seconds', { exp: now / 1000 + 29 }, 'oidc_expiry'],
    ['not active yet', { nbf: now / 1000 + 1 }, 'oidc_expiry'],
  ]) await t.test(label, async () => {
    const dir = await temp(); let calls = 0;
    try {
      const supplied = jwt(extra);
      const work = probeBlobCredential(options(dir, async (_url, init) => {
        calls++; assert.equal(init.headers.authorization, `Bearer ${supplied}`); return response({ blobs: [], hasMore: false });
      }, { kind: 'oidc', token: supplied }));
      if (code) { await rejects(work, code); assert.equal(calls, 0); assert.deepEqual(await readdir(dir), []); }
      else {
        const result = await work;
        assert.equal(result.signatureVerified, false);
        assert.equal(result.claimsValidation, 'decoded_not_signature_verified');
        assert.equal(result.metadataRowsObserved, 0);
        await identical(dir, result);
        assert.ok(!JSON.stringify(result).includes(supplied));
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('rejects mismatched static credentials locally and never falls back to ambient auth', async () => {
  const dir = await temp();
  const previous = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    process.env.BLOB_READ_WRITE_TOKEN = token;
    let calls = 0;
    await rejects(probeBlobCredential(options(dir, async () => { calls++; }, { token: undefined })), 'invalid_token');
    await rejects(probeBlobCredential(options(dir, async () => { calls++; }, { expectedStoreId: 'store_0123456789abcdef' })), 'store_mismatch');
    assert.equal(calls, 0); assert.deepEqual(await readdir(dir), []);
  } finally {
    if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('HTTP denials are scoped and inconclusive; redirects/server errors never resend or read error bodies', async t => {
  for (const status of [401, 403, 302, 429, 503]) await t.test(String(status), async () => {
    const dir = await temp();
    try {
      let calls = 0, read = false, canceled = false;
      const result = await probeBlobCredential(options(dir, async () => {
        calls++;
        return { status, body: new ReadableStream({ pull() { read = true; }, cancel() { canceled = true; } }, { highWaterMark: 0 }) };
      }));
      assert.equal(calls, 1); assert.equal(read, false); assert.equal(canceled, true);
      assert.equal(result.httpStatus, status); assert.equal(result.responseBodyBytes, 0);
      assert.equal(result.code, [401, 403].includes(status) ? 'auth_denied_inconclusive' : status === 302 ? 'redirect_denied' : 'http_status_inconclusive');
      assert.equal(result.status, status === 302 ? 'failed' : 'inconclusive');
      assert.ok(!JSON.stringify(result).includes('revoked'));
      await identical(dir, result);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('200 requires valid bounded list JSON; generic 200 and metadata overflow fail closed', async t => {
  for (const [label, body, code] of [
    ['malformed JSON', 'ERROR_SENTINEL', 'invalid_json'], ['generic success', { ok: true }, 'invalid_page'],
    ['missing flag', { blobs: [] }, 'invalid_page'], ['two rows', { blobs: [{}, {}], hasMore: false }, 'invalid_page'],
    ['generic row', { blobs: ['generic'], hasMore: false }, 'invalid_page'],
    ['foreign origin', { ...page, blobs: [{ ...page.blobs[0], url: 'https://foreign.invalid/private' }] }, 'invalid_page'],
    ['16 KiB overflow', ' '.repeat(BLOB_PROBE_LIMITS.bodyBytes + 1), 'response_too_large'],
  ]) await t.test(label, async () => {
    const dir = await temp();
    try {
      let calls = 0;
      const result = await probeBlobCredential(options(dir, async () => { calls++; return response(body); }));
      assert.equal(calls, 1); assert.equal(result.status, 'failed'); assert.equal(result.code, code);
      await identical(dir, result);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('transport failure is sanitized, spends one request, and cannot replay its attempt', async () => {
  const dir = await temp();
  try {
    let calls = 0;
    const transport = async () => { calls++; throw new TypeError(`fetch failed ERROR_SENTINEL ${token}`); };
    const result = await probeBlobCredential(options(dir, transport));
    assert.equal(result.code, 'transport_error'); assert.equal(calls, 1); await identical(dir, result);
    await rm(join(dir, 'outcome.json'));
    await rejects(probeBlobCredential(options(dir, transport)), 'attempt_exists');
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('headers/body/global deadlines and cancellation abort without later sends', async t => {
  for (const mode of ['headers', 'body', 'global', 'cancel', 'pre-cancel']) await t.test(mode, async () => {
    const dir = await temp();
    try {
      const controller = new AbortController(); let calls = 0, canceled = false, cancelTimer;
      if (mode === 'pre-cancel') controller.abort();
      const transport = (_url, { signal }) => {
        calls++;
        if (mode === 'headers') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { canceled = true; reject(new Error('ERROR_SENTINEL')); }, { once: true }));
        if (mode === 'cancel') cancelTimer = setTimeout(() => controller.abort(), 10);
        return { status: 200, body: new ReadableStream({ cancel() { canceled = true; } }) };
      };
      const extras = mode === 'headers' ? { headersMs: 20 } : mode === 'body' ? { bodyMs: 20 } : mode === 'global' ? { globalMs: 20 } : {};
      const result = await probeBlobCredential(options(dir, transport, { ...extras, signal: controller.signal }));
      clearTimeout(cancelTimer);
      assert.equal(result.code, ['cancel', 'pre-cancel'].includes(mode) ? 'canceled' : `${mode}_timeout`);
      assert.equal(result.requestAttempts, mode === 'pre-cancel' ? 0 : 1);
      assert.equal(canceled, mode !== 'pre-cancel');
      await identical(dir, result); await wait(25); assert.equal(calls, mode === 'pre-cancel' ? 0 : 1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('destination and private credential preflight reject existing paths, symlinks, and loose modes without requests', async t => {
  for (const mode of ['output', 'attempt', 'symlink', 'directory']) await t.test(mode, async () => {
    const dir = await temp(); let calls = 0;
    try {
      if (mode === 'output') await writeFile(join(dir, 'outcome.json'), 'keep');
      if (mode === 'attempt') await writeFile(join(dir, 'attempt.json'), 'keep');
      if (mode === 'symlink') await symlink(join(dir, 'missing'), join(dir, 'outcome.json'));
      if (mode === 'directory') await chmod(dir, 0o755);
      await rejects(probeBlobCredential(options(dir, async () => { calls++; })), mode === 'directory' ? 'destination_private' : mode === 'attempt' ? 'attempt_exists' : 'output_exists');
      assert.equal(calls, 0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('CLI reads credentials only from owner-0600 files; diagnostics contain no paths, JWT, rows, or raw errors', async () => {
  const dir = await temp();
  try {
    const rwPath = join(dir, 'NAME_SENTINEL.env'), oidcPath = join(dir, 'OIDC_SENTINEL.json');
    const oidc = jwt({});
    await writeFile(rwPath, `BLOB_READ_WRITE_TOKEN='${token}'\n`, { mode: 0o600 });
    await writeFile(oidcPath, JSON.stringify({ token: oidc }), { mode: 0o600 });
    assert.equal(await readBlobProbeCredential(rwPath, 'rw'), token);
    assert.equal(await readBlobProbeCredential(oidcPath, 'oidc'), oidc);
    let output = '', errors = '', calls = 0;
    const stdout = { write(text) { output += text; } }, stderr = { write(text) { errors += text; } };
    const base = ['--run', '--output', join(dir, 'outcome.json'), '--attempt', join(dir, 'attempt.json')];
    const run = async input => {
      calls++; assert.equal(input.token, input.kind === 'rw' ? token : oidc);
      return { status: 'accepted', code: 'list_accepted', httpStatus: 200 };
    };
    assert.equal(await runBlobCredentialProbeCli([...base, '--rw-env', rwPath], { run, stdout, stderr }), 0);
    assert.equal(await runBlobCredentialProbeCli([...base, '--oidc-json', oidcPath], { run, stdout, stderr }), 0);
    assert.equal(calls, 2); assert.ok(output.includes('JWT signature was not verified'));
    assert.equal(await runBlobCredentialProbeCli([...base, '--token', token], { run, stdout, stderr }), 1);
    assert.equal(await runBlobCredentialProbeCli([...base, '--rw-env', rwPath], { stdout, stderr, run: async () => { throw Error(`ERROR_SENTINEL ${token}`); } }), 1);
    const forged = new BlobCredentialProbeError('canceled'); forged.code = token;
    assert.equal(await runBlobCredentialProbeCli([...base, '--rw-env', rwPath], { stdout, stderr, run: async () => { throw forged; } }), 1);
    for (const sentinel of [token, oidc, dir, 'NAME_SENTINEL', 'OIDC_SENTINEL', 'ROW_SENTINEL', 'ERROR_SENTINEL']) assert.ok(!(output + errors).includes(sentinel));
    await chmod(rwPath, 0o644); await rejects(readBlobProbeCredential(rwPath, 'rw'), 'credential_private');
    await symlink(oidcPath, join(dir, 'link')); await rejects(readBlobProbeCredential(join(dir, 'link'), 'oidc'), 'credential_private');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const execute = promisify(execFile);
const child = `
import { mock } from 'node:test';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
const [directory, mode] = process.argv.slice(1), controller = new AbortController();
const attempt = join(directory,'attempt.json'); let syncs=0, sends=0, shortWrites=0;
mock.module('node:fs/promises',{namedExports:{lstat:fs.lstat,readFile:fs.readFile,realpath:fs.realpath,link:fs.link,unlink:fs.unlink,
  async open(path,...args){ const handle=await fs.open(path,...args); if(path!==attempt)return handle;
    return new Proxy(handle,{get(target,key){
      if(key==='write'&&mode==='short')return(buffer,offset,length,position)=>{shortWrites++;return target.write(buffer,offset,Math.min(7,length),position);};
      if(key==='sync')return()=>{syncs++;if(syncs===3&&['cancel','repair-fail'].includes(mode))controller.abort();if((syncs===3&&mode==='persist')||(syncs===4&&mode==='repair-fail'))throw Error('ERROR_SENTINEL');return target.sync();};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
  }
}});
const {probeBlobCredential,BLOB_PROBE_TARGET}=await import(${JSON.stringify(new URL('../scripts/probe-blob-credential.mjs', import.meta.url).href)});
let code='returned',result;
try{result=await probeBlobCredential({kind:'rw',token:'vercel_blob_rw_'+BLOB_PROBE_TARGET.storeId.slice(6)+'_SYNTHETICSECRET0000000000',
 outputPath:join(directory,'outcome.json'),attemptPath:attempt,signal:controller.signal,
 transport:()=>{sends++;return{status:200,body:new Blob(['{"blobs":[],"hasMore":false}']).stream()};}});}catch(error){code=error.code;}
console.log(JSON.stringify({code,result,sends,shortWrites}));
`;
for (const mode of ['cancel', 'persist', 'short', 'repair-fail']) test(`final persistence ${mode} keeps one-attempt evidence consistent`, async () => {
  const dir = await temp();
  try {
    const { stdout } = await execute(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', child, dir, mode], { timeout: 10_000 });
    const result = JSON.parse(stdout), evidence = await saved(dir);
    assert.equal(result.sends, 1); assert.equal(evidence.requestAttempts, 1);
    if (mode === 'persist') { assert.equal(result.code, 'attempt_write'); assert.equal(evidence.code, 'attempt_write'); }
    else if (mode === 'repair-fail') { assert.equal(result.code, 'attempt_write'); assert.equal(evidence.code, 'canceled'); assert.equal(evidence.status, 'failed'); }
    else if (mode === 'cancel') { assert.equal(result.result.code, 'canceled'); assert.equal(evidence.status, 'failed'); }
    else { assert.equal(evidence.status, 'accepted'); assert.ok(result.shortWrites > 50); }
    await identical(dir, evidence);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
