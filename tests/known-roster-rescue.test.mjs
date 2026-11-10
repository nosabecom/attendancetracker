import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rescueKnownRoster, KnownRosterRescueError, KNOWN_ROSTER_STORE, KNOWN_ROSTER_LIMITS } from '../scripts/rescue-known-roster.mjs';

const token = 'vercel_blob_rw_raW6bHbRonffwrRf_SYNTHETICTOKENSENTINEL123456';
const target = Object.freeze({ classId: 'a'.repeat(32), revision: 2 });
const targetUrl = `https://raw6bhbronffwrrf.private.blob.vercel-storage.com/classes/${target.classId}/versions/0000000002.json?cache=0`;
const value = { revision: 2, students: [{ id: 'stable-id', name: 'NAME_SENTINEL Ω', code: 'CODE_SENTINEL' }], teachers: [] };
const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
const temp = () => mkdtemp(join(tmpdir(), 'known-roster-rescue-test-'));
const options = (dir, transport, extras = {}) => ({ token, target, outputPath: join(dir, 'UNFROZEN-PROVISIONAL.json'), provenancePath: join(dir, 'provenance.json'), attemptPath: join(dir, 'attempt.json'), transport, ...extras });
const saved = async dir => JSON.parse(await readFile(join(dir, 'attempt.json'), 'utf8'));
function response(body = bytes, { status = 200, rawHeaders, complete = true } = {}) {
  return { status, rawHeaders: rawHeaders || ['Content-Length', String(body.length), 'Content-Type', 'application/json', 'ETag', '"HEADER_SENTINEL"'],
    body: new Blob([body]).stream(), complete: () => complete };
}
function transport(state, get = () => response()) {
  return (url, input) => {
    state.calls++;
    assert.equal(url.href, targetUrl);
    assert.equal(input.method, 'GET'); assert.equal(input.redirect, 'error');
    assert.deepEqual(input.headers, { authorization: `Bearer ${token}`, 'accept-encoding': 'identity' });
    assert.equal(input.signal.aborted, false);
    assert.equal(state.calls, 1);
    state.signal = input.signal;
    return get(input);
  };
}
async function rejects(work, code) { await assert.rejects(work, error => error instanceof KnownRosterRescueError && error.code === code && !error.message.includes('SENTINEL')); }
async function safeSummary(result) {
  const text = JSON.stringify(result);
  for (const secret of [token, 'NAME_SENTINEL', 'CODE_SENTINEL', 'HEADER_SENTINEL', 'ERROR_SENTINEL', target.classId, targetUrl]) assert.ok(!text.includes(secret));
  assert.equal(result.usableForCutover, false);
}

test('one fixed direct GET is durably reserved and exact UTF-8 bytes are privately rescued with provenance', async () => {
  const dir = await temp();
  try {
    const state = { calls: 0 };
    const result = await rescueKnownRoster(options(dir, transport(state, async () => {
      const attempt = await saved(dir); assert.equal(attempt.objectAttempts, 1); assert.equal(attempt.status, 'running');
      return response();
    })));
    assert.equal(result.status, 'rescued'); assert.equal(result.studentCount, 1); assert.equal(result.receivedBodyBytes, bytes.length);
    assert.equal(result.bodyComplete, true); assert.equal(result.rescueComplete, true); assert.equal(state.calls, 1);
    assert.deepEqual(await readFile(join(dir, 'UNFROZEN-PROVISIONAL.json')), bytes);
    const attempt = await saved(dir), provenance = JSON.parse(await readFile(join(dir, 'provenance.json'), 'utf8'));
    assert.deepEqual(attempt, provenance);
    assert.equal(provenance.target.classId, target.classId); assert.equal(provenance.target.revision, 2);
    assert.equal(provenance.target.storeId, KNOWN_ROSTER_STORE);
    assert.deepEqual(provenance.classification, ['UNFROZEN', 'PROVISIONAL', 'NON-CANONICAL', 'NOT CUTOVER-READY']);
    assert.equal(provenance.snapshotPublished, true); assert.equal(provenance.provenancePublished, true);
    for (const name of await readdir(dir)) assert.equal((await stat(join(dir, name))).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(dir)).sort(), ['UNFROZEN-PROVISIONAL.json', 'attempt.json', 'provenance.json']);
    await safeSummary(result);
    await rm(join(dir, 'UNFROZEN-PROVISIONAL.json')); await rm(join(dir, 'provenance.json'));
    await rejects(rescueKnownRoster(options(dir, transport(state))), 'attempt_exists'); assert.equal(state.calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('malformed credentials, nonprivate directories, occupied/symlink outputs, duplicate paths and signals fail before dispatch', async () => {
  const dir = await temp();
  try {
    const state = { calls: 0 }, send = transport(state);
    for (const bad of [undefined, '', 'a.b.c', token.replace('raW6bHbRonffwrRf', 'foreignstore12345'), `${token}\n`]) await rejects(rescueKnownRoster(options(dir, send, { token: bad })), 'invalid_token');
    for (const bad of [undefined, null, 'class', {}, { classId: target.classId }, { ...target, revision: 1 }, { ...target, revision: '2' },
      { ...target, classId: 'A'.repeat(32) }, { ...target, classId: '../' }, { ...target, classId: 'a'.repeat(31) },
      { ...target, url: 'https://foreign.invalid' }, { ...target, storeId: 'store_foreign123456789' }])
      await rejects(rescueKnownRoster(options(dir, send, { target: bad })), 'invalid_target');
    await rejects(rescueKnownRoster(options(dir, send, { provenancePath: join(dir, 'attempt.json') })), 'invalid_options');
    await rejects(rescueKnownRoster(options(dir, send, { headersMs: 15001 })), 'invalid_options');
    await rejects(rescueKnownRoster(options(dir, send, { signal: {} })), 'invalid_options');
    await chmod(dir, 0o755); await rejects(rescueKnownRoster(options(dir, send)), 'destination_private'); await chmod(dir, 0o700);
    await writeFile(join(dir, 'target'), 'UNCHANGED', { mode: 0o600 });
    await symlink(join(dir, 'target'), join(dir, 'UNFROZEN-PROVISIONAL.json'));
    await rejects(rescueKnownRoster(options(dir, send)), 'output_exists'); assert.equal(await readFile(join(dir, 'target'), 'utf8'), 'UNCHANGED');
    assert.equal(state.calls, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('exclusive publication preserves files created after preflight and never claims a complete rescue', async t => {
  for (const name of ['UNFROZEN-PROVISIONAL.json', 'provenance.json']) await t.test(name, async () => {
    const dir = await temp();
    try {
      const state = { calls: 0 };
      const result = await rescueKnownRoster(options(dir, transport(state, async () => {
        await writeFile(join(dir, name), 'EXTERNAL_SENTINEL', { mode: 0o600 }); return response();
      })));
      assert.equal(result.status, 'failed'); assert.equal(result.code, 'output_write'); assert.equal(result.rescueComplete, false);
      assert.equal(await readFile(join(dir, name), 'utf8'), 'EXTERNAL_SENTINEL');
      const attempt = await saved(dir); assert.equal(attempt.provenancePublished, false);
      assert.equal(attempt.snapshotPublished, name === 'provenance.json');
      assert.ok(!(await readdir(dir)).some(file => file.endsWith('.tmp')));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('non-200, redirect and transport failures retain one reservation without body publication or error leakage', async t => {
  for (const mode of [301, 302, 401, 403, 404, 429, 503, 'throw', 'reject']) await t.test(String(mode), async () => {
    const dir = await temp();
    try {
      const state = { calls: 0 };
      const result = await rescueKnownRoster(options(dir, transport(state, () => {
        if (mode === 'throw') throw Error(`ERROR_SENTINEL ${token}`);
        if (mode === 'reject') return Promise.reject(Error(`ERROR_SENTINEL ${token}`));
        return response(Buffer.from('ERROR_SENTINEL'), { status: mode });
      })));
      assert.equal(state.calls, 1); assert.equal(result.status, 'failed'); assert.equal(result.objectAttempts, 1);
      assert.equal(result.code, typeof mode === 'string' ? 'transport_error' : mode < 400 ? 'redirect_denied' : 'response_status');
      assert.deepEqual(await readdir(dir), ['attempt.json']); assert.equal((await saved(dir)).rescueComplete, false);
      await safeSummary(result);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('body, encoding, header ambiguity, UTF-8, JSON and historical roster validation reject without saving bytes', async t => {
  const validHeaders = ['Content-Type', 'application/json'];
  const cases = [
    ['cap body', Buffer.alloc(65537), validHeaders, true, 'response_too_large'],
    ['cap length', bytes, [...validHeaders, 'Content-Length', '65537'], true, 'response_too_large'],
    ['short body', bytes.subarray(1), [...validHeaders, 'Content-Length', String(bytes.length)], true, 'length_mismatch'],
    ['long body', bytes, [...validHeaders, 'Content-Length', String(bytes.length - 1)], true, 'length_mismatch'],
    ['incomplete parser', bytes, validHeaders, false, 'response_body'],
    ['length syntax', bytes, [...validHeaders, 'Content-Length', '0x10'], true, 'invalid_headers'],
    ['compressed', bytes, [...validHeaders, 'Content-Encoding', 'gzip'], true, 'encoding_unsupported'],
    ['not json type', bytes, ['Content-Type', 'text/html'], true, 'content_type'],
    ['broken charset quote', bytes, ['Content-Type', 'application/json;charset="utf-8'], true, 'content_type'],
    ['utf8', Buffer.from([0xff]), validHeaders, true, 'invalid_json'],
    ['partial json', bytes.subarray(0, 10), validHeaders, true, 'invalid_json'],
    ['extra json', Buffer.concat([bytes, Buffer.from('{}')]), validHeaders, true, 'invalid_json'],
    ['wrong revision', Buffer.from(JSON.stringify({ ...value, revision: 3 })), validHeaders, true, 'invalid_roster'],
    ['empty roster', Buffer.from('{"revision":2,"students":[]}'), validHeaders, true, 'invalid_roster'],
    ['duplicate IDs', Buffer.from(JSON.stringify({ ...value, students: [value.students[0], value.students[0]] })), validHeaders, true, 'invalid_roster'],
    ['long name', Buffer.from(JSON.stringify({ ...value, students: [{ ...value.students[0], name: 'a'.repeat(161) }] })), validHeaders, true, 'invalid_roster'],
    ['slash ID', Buffer.from(JSON.stringify({ ...value, students: [{ ...value.students[0], id: 'a/b' }] })), validHeaders, true, 'invalid_roster'],
    ['unknown field', Buffer.from(JSON.stringify({ ...value, password: 'ERROR_SENTINEL' })), validHeaders, true, 'invalid_roster'],
    ['invalid teachers', Buffer.from(JSON.stringify({ ...value, teachers: [{}] })), validHeaders, true, 'invalid_roster'],
  ];
  for (const field of ['Content-Length', 'Content-Encoding', 'Content-Type', 'ETag']) cases.push([`duplicate ${field}`, bytes, [...validHeaders, ...(field === 'Content-Type' ? [] : [field, field === 'Content-Length' ? String(bytes.length) : field === 'Content-Encoding' ? 'identity' : '"a"']), field.toLowerCase(), field === 'Content-Type' ? 'application/json' : field === 'Content-Length' ? String(bytes.length) : field === 'Content-Encoding' ? 'identity' : '"b"'], true, 'invalid_headers']);
  for (const [label, body, rawHeaders, complete, code] of cases) await t.test(label, async () => {
    const dir = await temp();
    try {
      const state = { calls: 0 }, result = await rescueKnownRoster(options(dir, transport(state, () => response(body, { rawHeaders, complete }))));
      assert.equal(state.calls, 1); assert.equal(result.code, code); assert.equal(result.rescueComplete, false); assert.equal(result.bodyComplete, false);
      assert.deepEqual(await readdir(dir), ['attempt.json']); await safeSummary(result);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('header/body/global deadlines and cancellation stop the one request and retain failures', async t => {
  for (const mode of ['headers', 'body', 'global', 'cancel', 'pre-cancel']) await t.test(mode, async () => {
    const dir = await temp();
    try {
      const control = new AbortController(), state = { calls: 0 }; let cancelled = false, cancelTimer;
      if (mode === 'pre-cancel') control.abort();
      const send = transport(state, input => {
        if (mode === 'headers') return new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => { cancelled = true; reject(Error('ERROR_SENTINEL')); }, { once: true }));
        if (mode === 'cancel') cancelTimer = setTimeout(() => control.abort(), 15);
        return { status: 200, rawHeaders: ['Content-Type', 'application/json'], complete: () => true, body: new ReadableStream({ cancel() { cancelled = true; } }) };
      });
      const extras = mode === 'headers' ? { headersMs: 20 } : mode === 'body' ? { bodyMs: 20 } : mode === 'global' ? { globalMs: 20 } : {};
      const result = await rescueKnownRoster(options(dir, send, { signal: control.signal, ...extras })); clearTimeout(cancelTimer);
      assert.equal(result.code, mode.endsWith('cancel') ? 'canceled' : `${mode}_timeout`);
      assert.equal(result.objectAttempts, mode === 'pre-cancel' ? 0 : 1); assert.equal(state.calls, mode === 'pre-cancel' ? 0 : 1);
      assert.equal(cancelled, mode !== 'pre-cancel'); assert.equal((await saved(dir)).rescueComplete, false);
      await safeSummary(result);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

const execute = promisify(execFile);
const parserChild = `
import {mock} from 'node:test';import {request as realRequest,Agent} from 'node:https';import {Duplex} from 'node:stream';import {join} from 'node:path';
const [dir,mode]=process.argv.slice(1);let sockets=0,count,etagCount,headerLimit;
Agent.prototype.createConnection=function(){sockets++;let sent=false,input='';return new Duplex({read(){},write(chunk,encoding,done){input+=chunk.toString();if(!sent&&input.includes('\\r\\n\\r\\n')){sent=true;const bytes=Buffer.from(${JSON.stringify(bytes.toString())});let fields='Content-Type: application/json\\r\\nContent-Length: '+bytes.length+'\\r\\nConnection: close\\r\\nETag: "a"\\r\\n';fields+=mode==='oversized'?'X: '+'b'.repeat(17000)+'\\r\\n':'X: b\\r\\n'.repeat(2100);if(mode==='duplicate')fields+='eTaG: "different"\\r\\n';queueMicrotask(()=>{this.push(Buffer.concat([Buffer.from('HTTP/1.1 200 OK\\r\\n'+fields+'\\r\\n'),bytes]));this.push(null);});}done();}});};
mock.module('node:https',{namedExports:{request:(...args)=>{headerLimit=args[1].maxHeaderSize;const req=realRequest(...args);req.on('response',res=>{count=res.rawHeaders.length/2;etagCount=res.headersDistinct.etag?.length;});return req;}}});
const {rescueKnownRoster}=await import(${JSON.stringify(new URL('../scripts/rescue-known-roster.mjs', import.meta.url).href)});
const result=await rescueKnownRoster({token:${JSON.stringify(token)},target:${JSON.stringify(target)},outputPath:join(dir,'UNFROZEN-PROVISIONAL.json'),provenancePath:join(dir,'provenance.json'),attemptPath:join(dir,'attempt.json')});
console.log(JSON.stringify({result,sockets,count,etagCount,headerLimit}));
`;
for (const mode of ['valid', 'duplicate', 'oversized']) test(`real Node parser keeps bounded ${mode} long response fields without network`, async () => {
  const dir = await temp();
  try {
    const { stdout } = await execute(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', parserChild, dir, mode], { timeout: 10000 });
    const evidence = JSON.parse(stdout); assert.equal(evidence.sockets, 1); assert.equal(evidence.headerLimit, KNOWN_ROSTER_LIMITS.headerBytes);
    if (mode !== 'oversized') assert.ok(evidence.count > 2100);
    assert.equal(evidence.result.status, mode === 'valid' ? 'rescued' : 'failed');
    if (mode === 'duplicate') { assert.equal(evidence.etagCount, 2); assert.equal(evidence.result.code, 'invalid_headers'); }
    if (mode === 'oversized') assert.equal(evidence.result.code, 'transport_error');
    await safeSummary(evidence.result);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const finalizationChild = `
import {mock} from 'node:test';import * as fs from 'node:fs/promises';import {join} from 'node:path';
const [dir,mode]=process.argv.slice(1),control=new AbortController();let sends=0,attemptWrites=0,triggered=false;
mock.module('node:fs/promises',{namedExports:{lstat:fs.lstat,realpath:fs.realpath,
link:async(from,to)=>{const result=await fs.link(from,to);if(mode==='cancel-provenance'&&to.endsWith('provenance.json'))control.abort();return result;},
unlink:async path=>{if(mode==='cancel-cleanup'&&!triggered){triggered=true;control.abort();}if(mode==='cleanup-fail'&&!triggered){triggered=true;throw Error('ERROR_SENTINEL');}return fs.unlink(path);},
open:async(path,...args)=>{const file=await fs.open(path,...args);if(!path.endsWith('attempt.json'))return file;return new Proxy(file,{get(target,key){if(key==='sync')return async()=>{attemptWrites++;if(attemptWrites===3){if(mode==='cancel-success')control.abort();if(mode==='persist-fail')throw Error('ERROR_SENTINEL');}return target.sync();};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}}});
const {rescueKnownRoster}=await import(${JSON.stringify(new URL('../scripts/rescue-known-roster.mjs', import.meta.url).href)});
let result,code;try{result=await rescueKnownRoster({token:${JSON.stringify(token)},target:${JSON.stringify(target)},signal:control.signal,outputPath:join(dir,'UNFROZEN-PROVISIONAL.json'),provenancePath:join(dir,'provenance.json'),attemptPath:join(dir,'attempt.json'),transport:()=>{sends++;return{status:200,rawHeaders:['Content-Type','application/json'],complete:()=>true,body:new Blob([${JSON.stringify(bytes.toString())}]).stream()};}});}catch(error){code=error.code;}
console.log(JSON.stringify({result,code,sends}));
`;
for (const mode of ['cancel-success', 'cancel-provenance', 'cancel-cleanup', 'persist-fail', 'cleanup-fail']) test(`finalization ${mode} never leaves successful private provenance`, async () => {
  const dir = await temp();
  try {
    const { stdout } = await execute(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', finalizationChild, dir, mode], { timeout: 10000 });
    const outcome = JSON.parse(stdout), attempt = await saved(dir), provenance = JSON.parse(await readFile(join(dir, 'provenance.json'), 'utf8'));
    assert.equal(outcome.sends, 1); assert.equal(attempt.status, 'failed'); assert.equal(attempt.rescueComplete, false); assert.equal(attempt.bodyComplete, false);
    assert.deepEqual(provenance, attempt); assert.equal(provenance.usableForCutover, false);
    if (mode === 'persist-fail') assert.equal(attempt.code, 'attempt_write');
    else assert.equal(outcome.result.status, 'failed');
    if (mode === 'cleanup-fail') assert.equal(attempt.code, 'output_write');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
