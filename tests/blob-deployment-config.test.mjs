import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, chmod, stat, symlink, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { captureDeploymentConfigs, DeploymentConfigCaptureError, DEPLOYMENT_CONFIG_PATHS, DEPLOYMENT_CONFIG_LIMITS } from '../scripts/capture-deployment-config.mjs';
import { SOURCE_AUDIT_TARGET } from '../scripts/audit-blob-deployment-sources.mjs';

const token = 'SYNTHETIC_ACCOUNT_TOKEN_SENTINEL_1234';
const content = 'globalThis.DO_NOT_EXECUTE_CONFIG = true; // SOURCE_SECRET_SENTINEL Ω';
const hash = value => createHash('sha256').update(value).digest('hex');
function manifest() {
  const sourceManifest = { formatVersion: 1, allocation: 'CLISOURCE1', ...SOURCE_AUDIT_TARGET, observedAt: '2026-11-11T12:00:00Z',
    deployments: [1, 2, 3].map(n => ({ id: `dpl_SYNTHETICDEPLOY${n}`, ownerId: SOURCE_AUDIT_TARGET.teamId, projectId: SOURCE_AUDIT_TARGET.projectId, source: 'cli', readyState: 'READY', gitDirty: true })) };
  return { formatVersion: 1, allocation: 'CLISOURCECONFIG1', ...SOURCE_AUDIT_TARGET, sourceCommit: 'a'.repeat(40), sourceManifest,
    sourceManifestFingerprint: hash(JSON.stringify(sourceManifest)), previousControlCalls: 26, controlCallCeiling: 66,
    priorContentInventory: Array.from({ length: 20 }, (_, i) => ({ deploymentId: sourceManifest.deployments[i % 3].id, path: `src/lib/helper${i}.ts`, uid: `prior_${i}` })),
    selections: sourceManifest.deployments.flatMap(d => DEPLOYMENT_CONFIG_PATHS.map((path, i) => ({ deploymentId: d.id, uid: `config_${i}`, path }))) };
}
const directory = () => mkdtemp(join(tmpdir(), 'deployment-config-'));
const options = (dir, transport, extras = {}) => ({ manifest: manifest(), token, outputDirectory: dir, transport, ...extras });
const json = (value, { rawHeaders = [], complete = true, status = 200 } = {}) => ({ status, rawHeaders, complete: () => complete, body: new Blob([JSON.stringify(value)]).stream() });
const encoded = (text = content) => ({ data: Buffer.from(text).toString('base64'), encoding: 'base64' });
const result = async dir => JSON.parse(await readFile(join(dir, 'RESULT.json'), 'utf8'));
function safe(value) { const text = JSON.stringify(value); for (const secret of [token, content, 'SOURCE_SECRET_SENTINEL', 'PROVIDER_SECRET_SENTINEL', 'dpl_SYNTHETIC', SOURCE_AUDIT_TARGET.teamId, SOURCE_AUDIT_TARGET.projectId, 'package.json']) assert.ok(!text.includes(secret)); assert.equal(value.writerFreezeProven, false); assert.equal(value.configSafetyReviewed, false); }
function fixture(dir, modify) {
  const state = { calls: [], active: 0, maxActive: 0, postStop: 0 };
  const transport = async (url, init) => {
    state.calls.push(url.href); state.active++; state.maxActive = Math.max(state.maxActive, state.active);
    if (init.signal.aborted) state.postStop++;
    assert.equal(url.origin, 'https://api.vercel.com'); assert.equal(url.search, `?teamId=${SOURCE_AUDIT_TARGET.teamId}`);
    assert.match(url.pathname, /^\/v8\/deployments\/dpl_SYNTHETICDEPLOY[123]\/files\/config_[0-3]$/);
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.deepEqual(init.headers, { authorization: `Bearer ${token}`, 'accept-encoding': 'identity' });
    const saved = JSON.parse(await readFile(join(dir, 'ALLOCATION.json'), 'utf8')); assert.equal(saved.previousControlCalls, 26);
    const receipts = await Promise.all((await readdir(dir)).filter(name => name.startsWith('reservation-')).map(async name => JSON.parse(await readFile(join(dir, name), 'utf8'))));
    const parts = url.pathname.split('/'); assert.ok(receipts.some(row => row.deploymentId === parts[3] && row.uid === parts[5]));
    let response = json(encoded()); if (modify) response = await modify(url, init, response);
    state.active--; return response;
  };
  return { state, transport };
}

test('captures exactly twelve private configs with immutable pre-dispatch allocation and receipts; cumulative26 is retained', async () => {
  const dir = await directory();
  try {
    const f = fixture(dir); let firstAllocation;
    const summary = await captureDeploymentConfigs(options(dir, async (...args) => {
      const bytes = await readFile(join(dir, 'ALLOCATION.json')); if (!firstAllocation) firstAllocation = bytes; else assert.deepEqual(bytes, firstAllocation);
      return f.transport(...args);
    }));
    assert.equal(summary.status, 'captured'); assert.equal(summary.reservedRequests, 12); assert.equal(summary.transportCalls, 12); assert.equal(summary.cumulativeReservedControlCalls, 38);
    assert.equal(summary.capturedFiles, 12); assert.ok(f.state.maxActive <= 2); assert.equal(f.state.calls.length, 12); assert.equal(f.state.postStop, 0); safe(summary);
    assert.deepEqual(await readFile(join(dir, 'ALLOCATION.json')), firstAllocation);
    const names = await readdir(dir); assert.equal(names.length, 26);
    for (const name of names) assert.equal((await stat(join(dir, name))).mode & 0o777, 0o600);
    const receipts = [];
    for (let i = 1; i <= 12; i++) {
      const file = JSON.parse(await readFile(join(dir, `config-${i}.json`), 'utf8'));
      assert.equal(file.content, content); assert.equal(file.bytes, Buffer.byteLength(content)); assert.equal(file.sha256, hash(content));
      receipts.push(JSON.parse(await readFile(join(dir, `reservation-${i}.json`), 'utf8')));
    }
    assert.deepEqual(receipts.map(row => row.cumulativeReservedControlCalls), Array.from({ length: 12 }, (_, i) => 27 + i));
    assert.equal(globalThis.DO_NOT_EXECUTE_CONFIG, undefined); assert.equal((await result(dir)).status, 'captured');
    await assert.rejects(captureDeploymentConfigs(options(dir, f.transport)), e => e.code === 'occupied_path'); assert.equal(f.state.calls.length, 12);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('exact reviewed bindings, remaining budget, paths and previously fetched UID/path pairs reject before all requests', async t => {
  const mutations = [
    m => { m.teamId = 'foreign'; }, m => { m.projectId = 'foreign'; }, m => { m.sourceCommit = 'not-commit'; },
    m => { m.previousControlCalls = 0; }, m => { m.controlCallCeiling = 100; }, m => { m.sourceManifestFingerprint = 'b'.repeat(64); },
    m => { m.sourceManifest.deployments[0].source = 'git'; m.sourceManifestFingerprint = hash(JSON.stringify(m.sourceManifest)); },
    m => { m.sourceManifest.deployments[1].id = m.sourceManifest.deployments[0].id; m.sourceManifestFingerprint = hash(JSON.stringify(m.sourceManifest)); },
    m => { m.selections.push({ ...m.selections[0] }); }, m => { m.selections.pop(); },
    m => { m.selections[1].uid = m.selections[0].uid; }, m => { m.selections[1].path = m.selections[0].path; },
    m => { m.selections[0].uid = m.priorContentInventory[0].uid; },
    m => { m.selections[0].path = 'src/.env.local'; }, m => { m.selections[0].path = 'out/package.json'; },
    m => { m.selections[0].path = 'src/../package.json'; }, m => { m.selections[0].path = 'src/next.config.js'; },
    m => { m.selections[0].uid = '../SECRET'; }, m => { m.priorContentInventory.pop(); }, m => { m.token = token; },
  ];
  for (const [i, mutate] of mutations.entries()) await t.test(String(i), async () => {
    const dir = await directory(); let calls = 0;
    try { const m = manifest(); mutate(m); await assert.rejects(captureDeploymentConfigs(options(dir, async () => { calls++; }, { manifest: m })), e => e instanceof DeploymentConfigCaptureError && e.code === 'invalid_manifest'); assert.equal(calls, 0); assert.deepEqual(await readdir(dir), []); }
    finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('nonprivate/symlink/occupied destinations and invalid tokens cannot dispatch', async () => {
  const dir = await directory(); let calls = 0;
  try {
    for (const bad of ['', undefined, `${token}\n`, 'Bearer secret']) await assert.rejects(captureDeploymentConfigs(options(dir, async () => { calls++; }, { token: bad })), e => e.code === 'invalid_options');
    await chmod(dir, 0o755); await assert.rejects(captureDeploymentConfigs(options(dir, async () => { calls++; })), e => e.code === 'private_path'); await chmod(dir, 0o700);
    await writeFile(join(dir, 'keep'), 'UNCHANGED', { mode: 0o600 }); await symlink(join(dir, 'keep'), join(dir, 'ALLOCATION.json'));
    await assert.rejects(captureDeploymentConfigs(options(dir, async () => { calls++; })), e => e.code === 'occupied_path'); assert.equal(await readFile(join(dir, 'keep'), 'utf8'), 'UNCHANGED'); assert.equal(calls, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('string and exact base64 object forms are data only, including empty UTF8 config content', async () => {
  const dir = await directory();
  try {
    let count = 0;
    const f = fixture(dir, () => json(++count % 2 ? '' : { data: '' }));
    const summary = await captureDeploymentConfigs(options(dir, f.transport));
    assert.equal(summary.status, 'captured'); assert.equal(summary.sourceBytes, 0); safe(summary);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('status/redirect, malformed base64, truncation, invalid UTF8 and byte caps stop without retry or extra discovery', async t => {
  const cases = [
    ['redirect', () => json({ error: 'PROVIDER_SECRET_SENTINEL' }, { status: 302 }), 'http_status'],
    ['denied', () => json({ error: 'PROVIDER_SECRET_SENTINEL' }, { status: 403 }), 'http_status'],
    ['network', () => { throw Error(`PROVIDER_SECRET_SENTINEL ${token}`); }, 'transport_error'],
    ['base64', () => json({ data: 'PROVIDER_SECRET_SENTINEL%' }), 'invalid_content'],
    ['extra wrapper', () => json({ ...encoded(), secret: 'PROVIDER_SECRET_SENTINEL' }), 'invalid_content'],
    ['encoding', () => json({ data: 'QQ==', encoding: 'hex' }), 'invalid_content'],
    ['utf8 source', () => json('/w=='), 'invalid_content'],
    ['file cap', () => json(Buffer.alloc(262145).toString('base64')), 'invalid_content'],
    ['response cap', () => ({ status: 200, rawHeaders: [], complete: () => true, body: new Blob(['x'.repeat(1048577)]).stream() }), 'response_limit'],
    ['response header cap', () => json(encoded(), { rawHeaders: ['Content-Length', '1048577'] }), 'response_limit'],
    ['truncated', () => json(encoded(), { complete: false }), 'invalid_response'],
    ['length mismatch', () => json(encoded(), { rawHeaders: ['Content-Length', '1'] }), 'invalid_response'],
    ['compressed', () => json(encoded(), { rawHeaders: ['Content-Encoding', 'gzip'] }), 'invalid_response'],
    ['duplicate encoding', () => json(encoded(), { rawHeaders: ['Content-Encoding', 'identity', 'content-encoding', 'identity'] }), 'invalid_response'],
  ];
  for (const [name, modify, code] of cases) await t.test(name, async () => {
    const dir = await directory();
    try {
      const f = fixture(dir, modify), summary = await captureDeploymentConfigs(options(dir, f.transport));
      assert.equal(summary.status, 'failed'); assert.equal(summary.code, code); assert.ok(summary.transportCalls <= 2); assert.equal(f.state.postStop, 0); safe(summary);
      assert.ok(summary.cumulativeReservedControlCalls <= 28); assert.equal((await result(dir)).code, code);
      await assert.rejects(captureDeploymentConfigs(options(dir, f.transport)), e => e.code === 'occupied_path'); assert.ok(f.state.calls.length <= 2);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('aggregate response cap retains all immutable reservations and stops before exceeding twelve requests', async () => {
  const dir = await directory();
  try {
    // Ignorable JSON whitespace grows wire bytes without exceeding decoded-file cap.
    const payload = JSON.stringify(encoded('')) + ' '.repeat(800000);
    const summary = await captureDeploymentConfigs(options(dir, async () => ({ status: 200, rawHeaders: [], complete: () => true, body: new Blob([payload]).stream() })));
    assert.equal(summary.status, 'failed'); assert.equal(summary.code, 'response_limit'); assert.ok(summary.transportCalls < 12); assert.ok(summary.cumulativeReservedControlCalls < 38); safe(summary);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cancellation/deadlines settle workers and never dispatch queued work after stop', async t => {
  for (const mode of ['headers', 'body', 'global', 'cancel', 'pre-cancel']) await t.test(mode, async () => {
    const dir = await directory(), control = new AbortController(); let calls = 0, stoppedSends = 0, cancelled = 0;
    try {
      if (mode === 'pre-cancel') control.abort();
      const transport = async (_url, init) => {
        calls++; if (init.signal.aborted) stoppedSends++;
        if (mode === 'cancel') control.abort();
        if (mode === 'headers' || mode === 'global' || mode === 'cancel') return new Promise((_resolve, reject) => { if (init.signal.aborted) reject(init.signal.reason); else init.signal.addEventListener('abort', () => { cancelled++; reject(init.signal.reason); }, { once: true }); });
        return { status: 200, rawHeaders: [], complete: () => true, body: new ReadableStream({ cancel() { cancelled++; } }) };
      };
      const summary = await captureDeploymentConfigs(options(dir, transport, { signal: control.signal, headersMs: mode === 'headers' ? 20 : 1000, bodyMs: 20, globalMs: mode === 'global' ? 20 : 1000 }));
      assert.equal(summary.status, 'failed'); assert.equal(summary.code, mode.endsWith('cancel') ? 'cancelled' : `${mode}_timeout`); assert.equal(stoppedSends, 0); assert.ok(calls <= 2);
      if (mode === 'pre-cancel') assert.equal(calls, 0); if (['headers', 'body', 'global'].includes(mode)) assert.ok(cancelled >= 1);
      assert.equal((await result(dir)).status, 'failed'); safe(summary);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('a failed immutable reservation write aborts queued dispatch and preserves prior receipt bytes', async () => {
  const dir = await directory(), probe = await open(join(dir, 'probe'), 'wx', 0o600), prototype = Object.getPrototypeOf(probe), original = prototype.write;
  await probe.close(); await rm(join(dir, 'probe')); let writes = 0, calls = 0;
  prototype.write = async function (...args) { if (++writes === 3) throw Error('PROVIDER_SECRET_SENTINEL'); return Reflect.apply(original, this, args); };
  try {
    const summary = await captureDeploymentConfigs(options(dir, async (_url, init) => { calls++; return new Promise((_yes, no) => init.signal.addEventListener('abort', () => no(init.signal.reason), { once: true })); }));
    assert.equal(summary.status, 'failed'); assert.equal(summary.code, 'persistence_failed'); assert.ok(calls <= 1); assert.equal(summary.reservedRequests, 2);
    const first = JSON.parse(await readFile(join(dir, 'reservation-1.json'), 'utf8')); assert.equal(first.ordinal, 1); assert.equal(first.cumulativeReservedControlCalls, 27);
    assert.equal((await result(dir)).code, 'persistence_failed'); safe(summary);
  } finally { prototype.write = original; await rm(dir, { recursive: true, force: true }); }
});

test('cancellation while final config durability settles cannot leave a captured result', async () => {
  const dir = await directory(), control = new AbortController(), probe = await open(join(dir, 'probe'), 'wx', 0o600);
  const prototype = Object.getPrototypeOf(probe), original = prototype.sync; await probe.close(); await rm(join(dir, 'probe')); let syncs = 0;
  prototype.sync = async function (...args) { if (++syncs === 50) control.abort(); return Reflect.apply(original, this, args); };
  try {
    const f = fixture(dir), summary = await captureDeploymentConfigs(options(dir, f.transport, { signal: control.signal }));
    assert.equal(syncs, 50); assert.equal(summary.status, 'failed'); assert.equal(summary.code, 'cancelled'); assert.equal(summary.cancelled, true);
    assert.equal(summary.transportCalls, 12); assert.equal(summary.cumulativeReservedControlCalls, 38); assert.equal((await result(dir)).status, 'failed'); safe(summary);
  } finally { prototype.sync = original; await rm(dir, { recursive: true, force: true }); }
});

test('an occupied final report is preserved and persistence failure cannot return successful evidence', async () => {
  const dir = await directory(); let planted = false;
  try {
    const f = fixture(dir, async (_url, _input, response) => { if (!planted) { planted = true; await writeFile(join(dir, 'RESULT.json'), 'EXTERNAL_SENTINEL', { flag: 'wx', mode: 0o600 }); } return response; });
    await assert.rejects(captureDeploymentConfigs(options(dir, f.transport)), error => error instanceof DeploymentConfigCaptureError && error.code === 'persistence_failed');
    assert.equal(await readFile(join(dir, 'RESULT.json'), 'utf8'), 'EXTERNAL_SENTINEL'); assert.equal(f.state.calls.length, 12);
    assert.equal((await readdir(dir)).filter(name => name.startsWith('reservation-')).length, 12);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const execute = promisify(execFile);
const parserChild = `
import {mock} from 'node:test';import {request as realRequest,Agent} from 'node:https';import {Duplex} from 'node:stream';
const [directory,mode]=process.argv.slice(1);let sockets=0,headerCount,encodingCount,byteLimit;
Agent.prototype.createConnection=function(){sockets++;let sent=false,input='';return new Duplex({read(){},write(chunk,encoding,done){input+=chunk.toString();if(!sent&&input.includes('\\r\\n\\r\\n')){sent=true;const body=Buffer.from(${JSON.stringify(JSON.stringify(encoded()))});let fields='Content-Length: '+body.length+'\\r\\nConnection: close\\r\\nContent-Encoding: identity\\r\\n';fields+=mode==='oversized'?'X: '+'a'.repeat(17000)+'\\r\\n':'X: b\\r\\n'.repeat(2100);if(mode==='duplicate')fields+='content-encoding: identity\\r\\n';queueMicrotask(()=>{this.push(Buffer.concat([Buffer.from('HTTP/1.1 200 OK\\r\\n'+fields+'\\r\\n'),body]));this.push(null);});}done();}});};
mock.module('node:https',{namedExports:{request:(...args)=>{byteLimit=args[1].maxHeaderSize;const req=realRequest(...args);req.on('response',res=>{headerCount=res.rawHeaders.length/2;encodingCount=res.headersDistinct['content-encoding']?.length;});return req;}}});
const {captureDeploymentConfigs}=await import(${JSON.stringify(new URL('../scripts/capture-deployment-config.mjs', import.meta.url).href)});
const summary=await captureDeploymentConfigs({manifest:${JSON.stringify(manifest())},token:${JSON.stringify(token)},outputDirectory:directory});console.log(JSON.stringify({summary,sockets,headerCount,encodingCount,byteLimit}));
`;
for (const mode of ['valid', 'duplicate', 'oversized']) test(`production HTTPS parser ${mode} response stays bounded without network`, async () => {
  const dir = await directory();
  try {
    const { stdout } = await execute(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', parserChild, dir, mode], { timeout: 10000 });
    const observed = JSON.parse(stdout); assert.equal(observed.byteLimit, DEPLOYMENT_CONFIG_LIMITS.headerBytes);
    if (mode !== 'oversized') assert.ok(observed.headerCount > 2100);
    assert.equal(observed.summary.status, mode === 'valid' ? 'captured' : 'failed');
    if (mode === 'valid') assert.equal(observed.sockets, 12); else assert.ok(observed.sockets <= 2);
    if (mode === 'duplicate') { assert.equal(observed.encodingCount, 2); assert.equal(observed.summary.code, 'invalid_response'); }
    safe(observed.summary);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
