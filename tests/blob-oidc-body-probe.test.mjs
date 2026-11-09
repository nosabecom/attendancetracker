import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BLOB_PROBE_TARGET as target } from '../scripts/probe-blob-credential.mjs';
import { BlobOidcBodyProbeError, probeBlobOidcBody, runBlobOidcBodyProbeCli } from '../scripts/probe-blob-oidc-body.mjs';

const now = Date.parse('2026-11-09T12:00:00Z');
const jwt = extras => [Buffer.from('{"alg":"RS256"}').toString('base64url'), Buffer.from(JSON.stringify({
  project_id: target.projectId, owner_id: target.teamId, environment: 'development', exp: now / 1000 + 3600, ...extras,
})).toString('base64url'), 'SYNTHETICSIGNATURE'].join('.');
const token = jwt({});
const origin = `https://${target.storeId.slice(6).toLowerCase()}.private.blob.vercel-storage.com`;
const body = Buffer.from('BODY_CONTENT_SENTINEL');
const pathname = 'folder/ROW_SENTINEL Ω %25.json';
const url = `${origin}/${pathname.split('/').map(encodeURIComponent).join('/')}`;
const row = { pathname, url, size: body.length, uploadedAt: '2026-11-09T00:00:00Z', etag: '"ETAG_SENTINEL"' };
const page = { blobs: [row], hasMore: true, cursor: 'CURSOR_SENTINEL' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function response(value, { status = 200, headers = {} } = {}) {
  const bytes = typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value);
  return { status, headers, body: new Blob([bytes]).stream() };
}
async function temp() { return mkdtemp(join(tmpdir(), 'blob-oidc-body-test-')); }
const options = (dir, transport, extras = {}) => ({ token, outputPath: join(dir, 'outcome.json'), attemptPath: join(dir, 'attempt.json'), transport, now: () => now, ...extras });
const saved = async dir => JSON.parse(await readFile(join(dir, 'attempt.json'), 'utf8'));
async function identical(dir, result) {
  assert.deepEqual(await saved(dir), result);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'outcome.json'), 'utf8')), result);
  for (const sentinel of [token, pathname, url, 'ROW_SENTINEL', 'ETAG_SENTINEL', 'CURSOR_SENTINEL', 'BODY_CONTENT_SENTINEL', 'ERROR_SENTINEL']) assert.ok(!JSON.stringify(result).includes(sentinel));
  for (const name of ['attempt.json', 'outcome.json']) assert.equal((await stat(join(dir, name))).mode & 0o777, 0o600);
}
async function rejects(work, code) { await assert.rejects(work, error => error instanceof BlobOidcBodyProbeError && error.code === code && !error.message.includes('SENTINEL')); }
function fixture({ listing = page, listResponse, objectResponse } = {}) {
  const state = { list: 0, object: 0, urls: [], signals: [] };
  return { state, transport: async (requestUrl, init) => {
    state.urls.push(requestUrl.href); state.signals.push(init.signal);
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.equal(init.headers.authorization, `Bearer ${token}`); assert.equal(init.headers['accept-encoding'], 'identity');
    assert.equal(init.signal.aborted, false);
    if (requestUrl.origin === 'https://vercel.com') {
      state.list++; assert.equal(state.list, 1); assert.equal(requestUrl.href, 'https://vercel.com/api/blob?limit=1');
      assert.equal(init.headers['x-api-version'], '13'); assert.equal(init.headers['x-vercel-blob-store-id'], target.storeId.slice(6));
      assert.equal(init.headers['x-api-blob-request-attempt'], '0');
      assert.match(init.headers['x-api-blob-request-id'], new RegExp(`^${target.storeId.slice(6)}:[0-9]+:[a-f0-9]{16}$`));
      return listResponse ? listResponse(init) : response(listing);
    }
    state.object++; assert.equal(state.object, 1);
    assert.equal(requestUrl.origin, origin); assert.equal(requestUrl.href, `${url}?cache=0`);
    assert.deepEqual(Object.keys(init.headers).sort(), ['accept-encoding', 'authorization']);
    return objectResponse ? objectResponse(init) : response(body, { headers: { 'content-length': String(body.length), etag: row.etag } });
  } };
}

test('source-parity LIST then exact encoded private GET, explicit OIDC, durable counters, complete transient body', async () => {
  const dir = await temp();
  try {
    const fake = fixture(); let dispatched = 0;
    const result = await probeBlobOidcBody(options(dir, async (url, init) => {
      const budget = await saved(dir);
      assert.equal(budget.status, 'running'); assert.equal(budget.listAttempts, 1); assert.equal(budget.objectAttempts, dispatched === 0 ? 0 : 1);
      dispatched++; return fake.transport(url, init);
    }));
    assert.equal(result.status, 'retrieved'); assert.equal(result.code, 'body_retrieved'); assert.equal(result.bodyComplete, true);
    assert.equal(result.listAttempts, 1); assert.equal(result.objectAttempts, 1); assert.equal(result.objectBodyBytes, body.length);
    assert.equal(result.scope, 'single_body_principal_store_time'); assert.equal(result.signatureVerified, false);
    assert.equal(result.claimsValidation, 'decoded_not_signature_verified');
    assert.equal(fake.state.urls.length, 2); await identical(dir, result);
    await rm(join(dir, 'outcome.json'));
    await rejects(probeBlobOidcBody(options(dir, fake.transport)), 'attempt_exists'); assert.equal(fake.state.urls.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('empty/invalid/oversized/foreign listings stop before GET; never paginate or choose another row', async t => {
  for (const [label, listing, code] of [
    ['empty', { blobs: [], hasMore: false }, 'empty_listing'], ['generic', { ok: true }, 'invalid_page'],
    ['two rows', { blobs: [row, row], hasMore: false }, 'invalid_page'], ['generic row', { blobs: ['x'], hasMore: false }, 'invalid_page'],
    ['oversize', { ...page, blobs: [{ ...row, size: 65_537 }] }, 'object_size'],
    ['foreign host', { ...page, blobs: [{ ...row, url: 'https://foreign.invalid/anything' }] }, 'invalid_page'],
    ['query', { ...page, blobs: [{ ...row, url: `${url}?download=1` }] }, 'invalid_page'],
    ['hash', { ...page, blobs: [{ ...row, url: `${url}#fragment` }] }, 'invalid_page'],
    ['userinfo', { ...page, blobs: [{ ...row, url: url.replace('https://', 'https://user@') }] }, 'invalid_page'],
    ['wrong path', { ...page, blobs: [{ ...row, url: `${origin}/other` }] }, 'invalid_page'],
  ]) await t.test(label, async () => {
    const dir = await temp();
    try {
      const fake = fixture({ listing }); const result = await probeBlobOidcBody(options(dir, fake.transport));
      assert.equal(result.code, code); assert.equal(result.bodyComplete, false); assert.equal(fake.state.list, 1); assert.equal(fake.state.object, 0);
      await identical(dir, result);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('actual bytes must reach EOF and match metadata and any Content-Length; compressed/ambiguous headers stop', async t => {
  for (const [label, bytes, headers, code] of [
    ['short EOF', body.subarray(1), {}, 'length_mismatch'], ['long body', Buffer.concat([body, Buffer.from('x')]), {}, 'length_mismatch'],
    ['header mismatch', body, { 'content-length': String(body.length + 1) }, 'length_mismatch'],
    ['invalid length', body, { 'content-length': '0x10' }, 'invalid_headers'],
    ['gzip', body, { 'content-encoding': 'gzip' }, 'encoding_unsupported'],
    ['ETag changed', body, { etag: '"DIFFERENT"' }, 'etag_mismatch'],
    ['weak ETag', body, { etag: 'W/"ETAG_SENTINEL"' }, 'etag_unsupported'],
    ['unquoted ETag', body, { etag: 'ETAG_SENTINEL' }, 'etag_unsupported'],
  ]) await t.test(label, async () => {
    const dir = await temp();
    try {
      const fake = fixture({ objectResponse: () => response(bytes, { headers }) });
      const result = await probeBlobOidcBody(options(dir, fake.transport));
      assert.equal(result.code, code); assert.equal(result.bodyComplete, false); assert.equal(fake.state.object, 1); await identical(dir, result);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('64 KiB object cap, 16 KiB LIST cap, and broken body fail without extra requests', async t => {
  for (const mode of ['object-cap', 'list-cap', 'invalid-json', 'broken-body']) await t.test(mode, async () => {
    const dir = await temp();
    try {
      const fake = fixture({
        listing: mode === 'object-cap' ? { ...page, blobs: [{ ...row, size: 65_536 }] } : page,
        listResponse: mode === 'list-cap' ? () => response(' '.repeat(16_385)) : mode === 'invalid-json' ? () => response('ERROR_SENTINEL') : undefined,
        objectResponse: mode === 'object-cap' ? () => response(Buffer.alloc(65_537)) : mode === 'broken-body' ? () => ({ status: 200, body: new ReadableStream({ pull(controller) { controller.error(Error('ERROR_SENTINEL')); } }) }) : undefined,
      });
      const result = await probeBlobOidcBody(options(dir, fake.transport));
      assert.equal(result.code, mode.endsWith('cap') ? 'response_too_large' : mode === 'invalid-json' ? 'invalid_json' : 'response_body');
      assert.equal(fake.state.list, 1); assert.equal(fake.state.object, ['list-cap', 'invalid-json'].includes(mode) ? 0 : 1); await identical(dir, result);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('non-200/redirect/network errors never retry, fall back, or fetch alternate objects', async t => {
  for (const phase of ['list', 'object']) for (const status of [302, 401, 403, 404, 503, 'network']) await t.test(`${phase} ${status}`, async () => {
    const dir = await temp();
    try {
      const failed = () => { if (status === 'network') throw Error(`ERROR_SENTINEL ${token}`); return response('ERROR_SENTINEL', { status }); };
      const fake = fixture(phase === 'list' ? { listResponse: failed } : { objectResponse: failed });
      const result = await probeBlobOidcBody(options(dir, fake.transport));
      assert.equal(result.code, status === 'network' ? 'transport_error' : status === 302 ? 'redirect_denied' : [401, 403].includes(status) ? 'auth_denied_inconclusive' : 'http_status_inconclusive');
      assert.equal(fake.state.list, 1); assert.equal(fake.state.object, phase === 'list' ? 0 : 1); assert.equal(result.bodyComplete, false); await identical(dir, result);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('expiry/owned development claims are checked locally and rechecked before GET', async () => {
  const dir = await temp();
  try {
    let sends = 0;
    for (const bad of [jwt({ environment: 'production' }), jwt({ owner_id: 'foreign' }), jwt({ project_id: 'foreign' })]) {
      await rejects(probeBlobOidcBody(options(dir, () => { sends++; }, { token: bad })), 'oidc_claims');
    }
    await rejects(probeBlobOidcBody(options(dir, () => { sends++; }, { token: jwt({ exp: now / 1000 + 29 }) })), 'oidc_expiry');
    assert.equal(sends, 0);
    let clock = now;
    const result = await probeBlobOidcBody(options(dir, () => { sends++; clock += 31_000; return response(page); }, { token: jwt({ exp: now / 1000 + 60 }), now: () => clock }));
    assert.equal(result.code, 'oidc_expiry'); assert.equal(sends, 1);
    assert.equal(result.listAttempts, 1); assert.equal(result.objectAttempts, 1); // conservative durable GET reservation, not a dispatch
    await identical(dir, result);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('deadlines/cancellation stop headers or body, cancel the stream, and retain spent counters', async t => {
  for (const mode of ['headers', 'body', 'global', 'cancel', 'pre-cancel']) await t.test(mode, async () => {
    const dir = await temp();
    try {
      const controller = new AbortController(); let canceled = false, cancelTimer;
      if (mode === 'pre-cancel') controller.abort();
      const fake = fixture({ objectResponse: ({ signal }) => {
        if (mode === 'headers') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { canceled = true; reject(Error('ERROR_SENTINEL')); }, { once: true }));
        if (mode === 'cancel') cancelTimer = setTimeout(() => controller.abort(), 10);
        return { status: 200, body: new ReadableStream({ cancel() { canceled = true; } }) };
      } });
      const extras = mode === 'headers' ? { headersMs: 20 } : mode === 'body' ? { bodyMs: 20 } : mode === 'global' ? { globalMs: 20 } : {};
      const result = await probeBlobOidcBody(options(dir, fake.transport, { ...extras, signal: controller.signal })); clearTimeout(cancelTimer);
      assert.equal(result.code, mode.endsWith('cancel') ? 'canceled' : `${mode}_timeout`);
      assert.equal(result.objectAttempts, mode === 'pre-cancel' ? 0 : 1); assert.equal(canceled, mode !== 'pre-cancel');
      const requests = fake.state.urls.length; await identical(dir, result); await wait(25); assert.equal(fake.state.urls.length, requests);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('private destination guards and CLI prevent secret arguments, paths, content, and error leakage', async () => {
  const dir = await temp();
  try {
    const path = join(dir, 'TOKEN_PATH_SENTINEL.json'); await writeFile(path, JSON.stringify({ token }), { mode: 0o600 });
    let output = '', errors = '', calls = 0;
    const stdout = { write(value) { output += value; } }, stderr = { write(value) { errors += value; } };
    const args = ['--run', '--oidc-json', path, '--output', join(dir, 'outcome.json'), '--attempt', join(dir, 'attempt.json')];
    const run = async input => { calls++; assert.equal(input.token, token); return { status: 'retrieved', code: 'body_retrieved', bodyComplete: true }; };
    assert.equal(await runBlobOidcBodyProbeCli(args, { run, stdout, stderr }), 0);
    assert.equal(await runBlobOidcBodyProbeCli(['--run', '--token', token, ...args.slice(3)], { run, stdout, stderr }), 1);
    assert.equal(await runBlobOidcBodyProbeCli(args, { stdout, stderr, run: async () => { throw Error(`ERROR_SENTINEL ${token}`); } }), 1);
    assert.equal(calls, 1); assert.ok(output.includes('JWT signature not verified'));
    for (const sentinel of [token, path, dir, 'BODY_CONTENT_SENTINEL', 'ERROR_SENTINEL']) assert.ok(!(output + errors).includes(sentinel));
    const fake = fixture(); await writeFile(join(dir, 'outcome.json'), 'keep'); await rejects(probeBlobOidcBody(options(dir, fake.transport)), 'output_exists');
    await rm(join(dir, 'outcome.json')); await symlink(path, join(dir, 'outcome.json')); await rejects(probeBlobOidcBody(options(dir, fake.transport)), 'output_exists');
    await rm(join(dir, 'outcome.json')); await chmod(dir, 0o755); await rejects(probeBlobOidcBody(options(dir, fake.transport)), 'destination_private');
    assert.equal(fake.state.urls.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const execute = promisify(execFile);
const headerBoundaryChild = `
import {mock} from 'node:test'; import {IncomingMessage} from 'node:http';
import {Socket} from 'node:net'; import {EventEmitter} from 'node:events'; import {join} from 'node:path';
const [dir,mode]=process.argv.slice(1);let sends=0,collapsed,rawTagCount;
mock.module('node:https',{namedExports:{request:(url,options,callback)=>{
 const request=new EventEmitter();request.end=()=>queueMicrotask(()=>{
  sends++;const message=new IncomingMessage(new Socket());message.statusCode=200;
  const bytes=Buffer.from(sends===1?${JSON.stringify(JSON.stringify(page))}:${JSON.stringify(body.toString())});
  message.rawHeaders=['Content-Length',String(bytes.length)];
  if(sends===2){
   message.rawHeaders.push('ETag',${JSON.stringify(row.etag)});
   if(mode!=='unique')message.rawHeaders.push('eTaG',mode==='conflicting'? '"CONFLICTING"':${JSON.stringify(row.etag)});
  }
  message._addHeaderLines(message.rawHeaders,message.rawHeaders.length);
  if(sends===2){collapsed=message.headers.etag;rawTagCount=message.headersDistinct.etag.length;}
  callback(message);message.push(bytes);message.push(null);
 });return request;
}}});
const {probeBlobOidcBody}=await import(${JSON.stringify(new URL('../scripts/probe-blob-oidc-body.mjs', import.meta.url).href)});
const result=await probeBlobOidcBody({token:${JSON.stringify(token)},now:()=>${now},outputPath:join(dir,'outcome.json'),attemptPath:join(dir,'attempt.json')});
console.log(JSON.stringify({result,sends,collapsed,rawTagCount}));
`;
for (const mode of ['unique', 'conflicting', 'identical']) test(`production HTTPS boundary preserves ${mode} ETag fields`, async () => {
  const dir = await temp();
  try {
    const { stdout } = await execute(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', headerBoundaryChild, dir, mode], { timeout: 10_000 });
    const { result, sends, collapsed, rawTagCount } = JSON.parse(stdout);
    // Real IncomingMessage hides the second field in .headers, even on conflict.
    assert.equal(collapsed, row.etag); assert.equal(sends, 2);
    assert.equal(rawTagCount, mode === 'unique' ? 1 : 2);
    assert.equal(result.code, mode === 'unique' ? 'body_retrieved' : 'invalid_headers');
    assert.equal(result.bodyComplete, mode === 'unique');
    assert.equal(result.status, mode === 'unique' ? 'retrieved' : 'failed');
    await identical(dir, result);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
const child = `
import {mock} from 'node:test'; import * as fs from 'node:fs/promises'; import {join} from 'node:path';
const [dir,mode]=process.argv.slice(1),control=new AbortController(),attempt=join(dir,'attempt.json');let syncs=0,sends=0;
mock.module('node:fs/promises',{namedExports:{lstat:fs.lstat,readFile:fs.readFile,realpath:fs.realpath,link:fs.link,
 unlink:async path=>{if(mode==='cleanup')control.abort();return fs.unlink(path);},
 open:async(path,...args)=>{const file=await fs.open(path,...args);if(path!==attempt)return file;return new Proxy(file,{get(target,key){
 if(key==='sync')return()=>{syncs++;if(syncs===4&&['cancel','repair-fail'].includes(mode))control.abort();if((syncs===4&&mode==='persist')||(syncs===5&&mode==='repair-fail'))throw Error('ERROR_SENTINEL');return target.sync();};
 const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}}});
const {probeBlobOidcBody}=await import(${JSON.stringify(new URL('../scripts/probe-blob-oidc-body.mjs', import.meta.url).href)});
let result,code='returned';try{result=await probeBlobOidcBody({token:${JSON.stringify(token)},now:()=>${now},signal:control.signal,
 outputPath:join(dir,'outcome.json'),attemptPath:attempt,transport:()=>{sends++;return{status:200,headers:{},body:new Blob([sends===1?${JSON.stringify(JSON.stringify({ ...page, blobs: [{ ...row, size: 0 }] }))}:'' ]).stream()};}});}catch(error){code=error.code;}
console.log(JSON.stringify({code,result,sends}));
`;
for (const mode of ['cancel', 'persist', 'cleanup', 'repair-fail']) test(`final evidence ${mode} never leaves a false successful body claim`, async () => {
  const dir = await temp();
  try {
    const { stdout } = await execute(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', child, dir, mode], { timeout: 10_000 });
    const result = JSON.parse(stdout), evidence = await saved(dir); assert.equal(result.sends, 2);
    assert.equal(evidence.bodyComplete, false); assert.equal(evidence.listAttempts, 1); assert.equal(evidence.objectAttempts, 1);
    assert.equal(evidence.code, mode === 'persist' ? 'attempt_write' : 'canceled');
    if (['persist', 'repair-fail'].includes(mode)) assert.equal(result.code, 'attempt_write'); else assert.equal(result.result.status, 'failed');
    await identical(dir, evidence);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
