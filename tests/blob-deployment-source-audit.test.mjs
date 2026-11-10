import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readFile, readdir, rm, stat, symlink, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditDeploymentSources, validateSourceAuditManifest, selectDeploymentSources, checkSourceClosure,
  SOURCE_AUDIT_TARGET, SOURCE_AUDIT_LIMITS, runSourceAuditCli } from '../scripts/audit-blob-deployment-sources.mjs';

const now = Date.parse('2026-11-11T12:00:00Z');
const token = 'SYNTHETIC_TOKEN_SENTINEL_000000';
function manifest() { return { formatVersion: 1, allocation: 'CLISOURCE1', observedAt: new Date(now).toISOString(), ...SOURCE_AUDIT_TARGET,
  deployments: [1, 2, 3].map(n => ({ id: `dpl_TESTDEPLOYMENT${n}`, ownerId: SOURCE_AUDIT_TARGET.teamId,
    projectId: SOURCE_AUDIT_TARGET.projectId, readyState: 'READY', source: 'cli', gitDirty: true })) }; }
const baseFiles = () => ({
  'package.json': JSON.stringify({ name: 'source-fixture', scripts: { build: 'next build' }, dependencies: { next: '16.4.4', react: '19.3.1', '@vercel/blob': '2.8.1' } }),
  'package-lock.json': '{"lockfileVersion":3,"packages":{}}',
  'app/page.tsx': "import './globals.css'; export default function Page(){return <div>Fixture</div>}",
  'app/api/attendance/route.ts': "import {read} from '../../../lib/storage'; export async function GET(){return read('fixture')} // SOURCE_SECRET_SENTINEL",
  'lib/storage.ts': "import {get} from '@vercel/blob'; export async function read(path:string){return get(path,{access:'private'})}",
});
function treeFrom(files) {
  const root = [];
  for (const [path, value] of Object.entries(files)) {
    const parts = path.split('/'); let children = root;
    for (const part of parts.slice(0, -1)) {
      let dir = children.find(x => x.name === part);
      if (!dir) { dir = { name: part, type: 'directory', mode: 0o40755, children: [] }; children.push(dir); }
      children = dir.children;
    }
    children.push({ name: parts.at(-1), type: 'file', mode: 0o100644, uid: `file_${Buffer.from(path).toString('hex')}` });
  }
  return root;
}
const response = (value, status = 200, headers = {}) => ({ status, headers, body: new Blob([JSON.stringify(value)]).stream() });
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'source-audit-')); await chmod(dir, 0o700); return dir; }
const options = (dir, transport, extra = {}) => ({ manifest: manifest(), token, outputDirectory: dir, attemptPath: join(dir, 'attempt.json'), transport, now: () => now, ...extra });
const attempt = async dir => JSON.parse(await readFile(join(dir, 'attempt.json'), 'utf8'));
function fixture(dir, { files = baseFiles(), tree, modify, gate } = {}) {
  const state = { calls: [], active: 0, maximum: 0, stoppedSends: 0 };
  const byId = new Map(Object.entries(files).map(([path, content]) => [`file_${Buffer.from(path).toString('hex')}`, content]));
  const transport = async (url, init) => {
    state.calls.push(url.pathname); state.active++; state.maximum = Math.max(state.maximum, state.active);
    assert.equal(url.origin, 'https://api.vercel.com'); assert.equal(url.searchParams.get('teamId'), SOURCE_AUDIT_TARGET.teamId);
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.authorization, `Bearer ${token}`);
    assert.equal(init.headers['accept-encoding'], 'identity'); assert.equal(init.signal.aborted, false);
    const saved = await attempt(dir);
    assert.equal(saved.status, 'running'); assert.ok(saved.treeRequests + saved.contentRequests >= state.calls.length);
    if (gate) await gate(url, init);
    const content = /\/v8\//.test(url.pathname), uid = url.pathname.split('/').at(-1);
    if (content) assert.ok(byId.has(uid), 'Only inventoried file identifiers may be requested');
    let result = content ? response({ data: Buffer.from(byId.get(uid)).toString('base64'), encoding: 'base64' }) : response(tree ?? treeFrom(files));
    if (modify) result = await modify(url, init, result);
    state.active--; return result;
  };
  return { state, transport };
}
function safe(result) {
  const text = JSON.stringify(result);
  for (const word of [token, 'SOURCE_SECRET_SENTINEL', 'PROVIDER_SECRET_SENTINEL', 'dpl_TEST', 'lib/storage', SOURCE_AUDIT_TARGET.teamId, SOURCE_AUDIT_TARGET.projectId]) assert.ok(!text.includes(word));
}

test('captures all three actual uploaded source closures privately after durable one-shot reservations', async () => {
  const dir = await directory();
  try {
    const { state, transport } = fixture(dir);
    const result = await auditDeploymentSources(options(dir, transport));
    assert.equal(result.status, 'captured'); assert.equal(result.completeSourceClosure, true); assert.equal(result.completeDeployments, 3);
    assert.equal(result.treeRequests, 3); assert.equal(result.contentRequests, 15); assert.equal(result.sourceFiles, 15);
    assert.ok(state.maximum <= 3); assert.equal(state.calls.length, 18); safe(result);
    const stored = await attempt(dir); assert.equal(stored.status, 'captured'); assert.equal(stored.completeSourceClosure, true);
    const names = await readdir(dir); assert.equal(names.length, 19);
    for (const name of names) assert.equal((await stat(join(dir, name))).mode & 0o777, 0o600);
    const content = names.filter(n => n.startsWith('source-file-'));
    assert.ok((await Promise.all(content.map(n => readFile(join(dir, n), 'utf8')))).some(s => s.includes('SOURCE_SECRET_SENTINEL')));
    const previousCalls = state.calls.length;
    await assert.rejects(auditDeploymentSources(options(dir, transport)), e => e.code === 'occupied_path');
    assert.equal(state.calls.length, previousCalls);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a failed reservation write stops queued dispatch before its rejection propagates', async () => {
  const dir = await directory();
  const probe = await open(join(dir, 'prototype-probe'), 'wx', 0o600);
  const prototype = Object.getPrototypeOf(probe), originalWrite = prototype.write;
  await probe.close(); await rm(join(dir, 'prototype-probe'));
  let writes = 0;
  prototype.write = async function (...args) {
    if (++writes === 3) throw Error('PERSISTENCE_SECRET_SENTINEL');
    return Reflect.apply(originalWrite, this, args);
  };
  try {
    const { state, transport } = fixture(dir);
    const result = await auditDeploymentSources(options(dir, transport));
    assert.equal(result.status, 'failed');
    assert.equal(result.code, 'persistence_failed');
    assert.equal(result.treeRequests, 2);
    assert.equal(result.contentRequests, 0);
    assert.equal(state.calls.length, 1);
    assert.equal((await attempt(dir)).code, 'persistence_failed');
    assert.ok(!JSON.stringify(result).includes('PERSISTENCE_SECRET_SENTINEL'));
  } finally {
    prototype.write = originalWrite;
    await rm(dir, { recursive: true, force: true });
  }
});

test('uncaptured Babel/SWC configuration and package hooks cannot satisfy source closure', () => {
  for (const name of ['.babelrc', '.babelrc.json', 'babel.config.js', 'babel.config.cjs', '.swcrc']) {
    const selection = selectDeploymentSources([{name, type:'file', uid:'unread_configuration'}]);
    assert.equal(selection.files.length, 0);
    assert.ok(selection.concerns.includes('unread_execution_configuration'));
  }
  for (const patch of [{babel:{plugins:['./unseen-loader.js']}},{workspaces:['packages/*']},
    {pnpm:{patchedDependencies:{'@vercel/blob@2.8.1':'patches/blob.patch'}}},{pnpm:{hooks:{}}}]) {
    const files=baseFiles();
    files['package.json']=JSON.stringify({...JSON.parse(files['package.json']),...patch});
    assert.ok(checkSourceClosure(Object.entries(files).map(([path,content])=>({path,content}))).includes('config_resolution'));
  }
});

test('60 total source files succeed; 61-plus never dispatches content reads or silently truncates', async t => {
  for (const extra of [15, 16]) await t.test(String(extra), async () => {
    const dir = await directory();
    try {
      const files = baseFiles(); for (let i = 0; i < extra; i++) files[`lib/helper${i}.ts`] = `export const value${i}=1;`;
      const { state, transport } = fixture(dir, { files });
      const result = await auditDeploymentSources(options(dir, transport));
      if (extra === 15) { assert.equal(result.status, 'captured'); assert.equal(result.contentRequests, 60); }
      else { assert.equal(result.code, 'file_limit'); assert.equal(result.contentRequests, 0); assert.equal(state.calls.length, 3); assert.equal((await readdir(dir)).length, 4); }
      assert.ok(state.maximum <= 3);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('invalid target, duplicate IDs and stale manifests reject locally without spending requests', async t => {
  for (const change of [m => { m.teamId = 'foreign'; }, m => { m.deployments[1].id = m.deployments[0].id; }, m => { m.observedAt = new Date(now - SOURCE_AUDIT_LIMITS.manifestAgeMs - 1).toISOString(); }, m => { m.deployments[0].source = 'git'; }]) await t.test('invalid binding', async () => {
    const dir = await directory(); let calls = 0;
    try { const supplied = manifest(); change(supplied); await assert.rejects(auditDeploymentSources(options(dir, async () => { calls++; }, { manifest: supplied })), e => e.code === 'invalid_manifest'); assert.equal(calls, 0); assert.deepEqual(await readdir(dir), []); }
    finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('secrets/assets/outputs are never requested; presence of runtime dotenv prevents a complete claim', async () => {
  const dir = await directory();
  try {
    const files = { ...baseFiles(), '.env.local': 'PRIVATE_FILE_SENTINEL', '.env.example': 'EXAMPLE', 'public/image.png': 'ASSET', 'app/globals.css': 'body{}' };
    const { state, transport } = fixture(dir, { files }); const result = await auditDeploymentSources(options(dir, transport));
    assert.equal(result.status, 'partial'); assert.equal(result.completeSourceClosure, false); assert.equal(result.contentRequests, 15);
    assert.ok(result.closureConcerns.includes('unread_execution_configuration'));
    for (const path of state.calls) assert.ok(!path.includes(Buffer.from('.env.local').toString('hex')));
    safe(result);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('missing relative imports, dynamic loading and custom build hooks retain source but report partial', async t => {
  for (const variant of ['missing', 'dynamic', 'prepare', 'routes']) await t.test(variant, async () => {
    const dir = await directory();
    try {
      const files = baseFiles();
      if (variant === 'missing') files['lib/storage.ts'] = "import './missing'; export const read=()=>{}";
      if (variant === 'dynamic') files['lib/storage.ts'] = "export const read=(path:string)=>import(path)";
      if (variant === 'prepare') { const p = JSON.parse(files['package.json']); p.scripts.prepare = 'node private-loader.js'; files['package.json'] = JSON.stringify(p); }
      if (variant === 'routes') files['vercel.json'] = '{"builds":[{"src":"private-loader.js","use":"@vercel/node"}]}';
      const { transport } = fixture(dir, { files }); const result = await auditDeploymentSources(options(dir, transport));
      assert.equal(result.status, 'partial'); assert.equal(result.completeSourceClosure, false); assert.ok(result.sourceFiles > 0);
      assert.ok((await readdir(dir)).some(n => n.startsWith('source-file-'))); safe(result);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('redirects and denied/error statuses stop, cancel peers and never follow or retry', async t => {
  for (const code of [302, 401, 403, 410, 503]) await t.test(String(code), async () => {
    const dir = await directory();
    try {
      const { state, transport } = fixture(dir, { modify: () => response({ error: 'PROVIDER_SECRET_SENTINEL' }, code) });
      const result = await auditDeploymentSources(options(dir, transport)); assert.equal(result.status, 'failed'); assert.equal(result.code, 'http_status');
      assert.ok(state.calls.length <= 3); assert.equal(result.contentRequests, 0); safe(result);
      assert.equal((await attempt(dir)).code, 'http_status');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('stalled headers and bodies abort within their deadlines and retain spent reservations', async t => {
  for (const phase of ['headers', 'body', 'global']) await t.test(phase, async () => {
    const dir = await directory(); let calls = 0, cancelled = false;
    try {
      const transport = async (_url, init) => {
        calls++;
        if (phase === 'headers' || phase === 'global') return new Promise((_yes, no) => init.signal.addEventListener('abort', () => no(init.signal.reason), { once: true }));
        return { status: 200, body: new ReadableStream({ cancel() { cancelled = true; } }) };
      };
      const result = await auditDeploymentSources(options(dir, transport, { headersMs: phase === 'headers' ? 20 : 1000, bodyMs: 20, globalMs: phase === 'global' ? 20 : 1000 }));
      assert.equal(result.code, `${phase}_timeout`); assert.equal(result.status, 'failed'); assert.ok(calls <= 3);
      assert.equal((await attempt(dir)).code, result.code); if (phase === 'body') assert.equal(cancelled, true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('response limits, malformed base64 and invalid source UTF-8 stop without exposing provider/source values', async t => {
  for (const variant of ['oversize', 'bad-base64', 'bad-utf8']) await t.test(variant, async () => {
    const dir = await directory();
    try {
      const { transport } = fixture(dir, { modify: (url, _init, original) => {
        if (variant === 'oversize') return { status: 200, body: new Blob(['x'.repeat(SOURCE_AUDIT_LIMITS.responseBytes + 1)]).stream() };
        if (url.pathname.startsWith('/v8/')) return response({ data: variant === 'bad-base64' ? 'PROVIDER_SECRET_SENTINEL%' : '/w==' });
        return original;
      } });
      const result = await auditDeploymentSources(options(dir, transport)); assert.equal(result.status, 'failed');
      assert.equal(result.code, variant === 'oversize' ? 'response_limit' : 'invalid_content'); safe(result);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('cancellation sends no later source requests and cannot leave a successful attempt', async () => {
  const dir = await directory(), controller = new AbortController(); let dispatched = 0, postStopDispatches = 0;
  try {
    const { transport } = fixture(dir, { modify: (url, _init, original) => { if (url.pathname.startsWith('/v8/')) { dispatched++; controller.abort(); } return original; } });
    const guarded = (url, init) => { if (controller.signal.aborted) postStopDispatches++; return transport(url, init); };
    const result = await auditDeploymentSources(options(dir, guarded, { signal: controller.signal }));
    assert.equal(result.status, 'failed'); assert.equal(result.code, 'cancelled'); assert.equal(result.cancelled, true); assert.ok(dispatched <= 3); assert.equal(postStopDispatches, 0);
    const stored = await attempt(dir); assert.equal(stored.status, 'failed'); assert.equal(stored.completeSourceClosure, false); assert.equal(stored.cancelled, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unsafe or occupied local paths reject before requests; CLI is disabled without explicit inputs', async () => {
  const dir = await directory(); let calls = 0;
  try {
    await chmod(dir, 0o755); await assert.rejects(auditDeploymentSources(options(dir, async () => { calls++; })), e => e.code === 'private_path');
    await chmod(dir, 0o700); await writeFile(join(dir, 'existing.json'), 'keep', { mode: 0o600 }); await symlink(join(dir, 'existing.json'), join(dir, 'attempt.json'));
    await assert.rejects(auditDeploymentSources(options(dir, async () => { calls++; })), e => e.code === 'occupied_path'); assert.equal(calls, 0);
    assert.equal(await readFile(join(dir, 'existing.json'), 'utf8'), 'keep');
    let called = false, output = ''; const status = await runSourceAuditCli([], { run: async () => { called = true; }, stderr: { write: text => { output += text; } } });
    assert.equal(status, 1); assert.equal(called, false); assert.match(output, /disabled/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('tree traversal/duplicates/symlinks and missing locks cannot silently become complete', () => {
  for (const value of [[{ name: '../escape', type: 'file', uid: 'file1' }], [{ name: 'same', type: 'file', uid: 'one' }, { name: 'same', type: 'file', uid: 'two' }]]) assert.throws(() => selectDeploymentSources(value), e => e.code === 'invalid_tree');
  const selection = selectDeploymentSources([{ name: 'lib', type: 'directory', children: [{ name: 'hidden.ts', type: 'symlink' }] }]);
  assert.ok(selection.concerns.includes('unsupported_source_entry'));
  assert.ok(checkSourceClosure([{ path: 'package.json', content: '{"scripts":{"build":"next build"}}' }]).includes('lock_missing'));
  assert.throws(() => validateSourceAuditManifest({}), e => e.code === 'invalid_manifest');
});
