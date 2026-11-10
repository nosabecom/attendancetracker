import { constants, openSync, fstatSync, writeSync, ftruncateSync, fsyncSync, closeSync } from 'node:fs';
import { lstat, realpath, open, readFile, link, unlink } from 'node:fs/promises';
import { resolve, dirname, join, posix } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { builtinModules, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Pinned cached first-party OpenAPI: listDeploymentFiles and
// getDeploymentFileContents. Source is captured as data; never evaluated.
export const SOURCE_AUDIT_TARGET = Object.freeze({ teamId: 'team_fmwIPLne9w30y7G5JQrs3fzl', projectId: 'prj_uOMK1a4PLAgsDr1A16InuImM1M3q' });
export const SOURCE_AUDIT_LIMITS = Object.freeze({ trees: 3, contents: 60, concurrency: 3, treeEntries: 1500, treeDepth: 20,
  headersBytes: 16_384, responseBytes: 1_048_576, fileBytes: 262_144, totalBytes: 24 * 1_048_576,
  headersMs: 15_000, bodyMs: 20_000, globalMs: 240_000, manifestAgeMs: 1_800_000 });
const codes = new Set(['invalid_options', 'invalid_manifest', 'private_path', 'occupied_path', 'persistence_failed', 'request_budget',
  'transport_error', 'http_status', 'headers_timeout', 'body_timeout', 'global_timeout', 'cancelled', 'response_limit',
  'invalid_response', 'invalid_tree', 'file_limit', 'invalid_content', 'closure_partial', 'cli_disabled']);
export class DeploymentSourceAuditError extends Error {
  constructor(code) { const safe = codes.has(code) ? code : 'audit_failed'; super(`Deployment source audit stopped (${safe}).`); this.code = safe; }
}
const fail = code => { throw new DeploymentSourceAuditError(code); };
const safeCode = error => error instanceof DeploymentSourceAuditError ? error.code : 'audit_failed';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const utf8 = bytes => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('invalid_content'); } };

export function validateSourceAuditManifest(manifest, now = Date.now()) {
  if (!manifest || manifest.formatVersion !== 1 || manifest.allocation !== 'CLISOURCE1' ||
    manifest.teamId !== SOURCE_AUDIT_TARGET.teamId || manifest.projectId !== SOURCE_AUDIT_TARGET.projectId ||
    !Array.isArray(manifest.deployments) || manifest.deployments.length !== 3) fail('invalid_manifest');
  const timestamp = Date.parse(manifest.observedAt);
  if (!Number.isFinite(timestamp) || now - timestamp > SOURCE_AUDIT_LIMITS.manifestAgeMs || timestamp - now > 30_000) fail('invalid_manifest');
  const ids = new Set();
  for (const item of manifest.deployments) {
    if (!item || !/^dpl_[A-Za-z0-9]{8,64}$/.test(item.id) || ids.has(item.id) ||
      item.ownerId !== manifest.teamId || item.projectId !== manifest.projectId || item.readyState !== 'READY' ||
      item.source !== 'cli' || item.gitDirty !== true) fail('invalid_manifest');
    ids.add(item.id);
  }
  return manifest;
}

async function privateDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700 || await realpath(path) !== path) fail('private_path');
}
async function absent(path) {
  try { await lstat(path); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  fail('occupied_path');
}
async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (result.bytesWritten <= 0) fail('persistence_failed');
    offset += result.bytesWritten;
  }
  await handle.truncate(bytes.length); await handle.sync();
}
async function publishPrivate(directory, name, value) {
  const temporary = join(directory, `.source-${randomBytes(12).toString('hex')}.tmp`), destination = join(directory, name);
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await writeAll(handle, Buffer.from(JSON.stringify(value) + '\n')); await handle.close(); handle = undefined;
    await link(temporary, destination); await unlink(temporary);
    const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await parent.sync(); } finally { await parent.close(); }
  } catch { fail('persistence_failed'); }
  finally { await handle?.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}

function singleRequest(url, { headers, signal }) {
  return new Promise((resolveResponse, reject) => {
    const req = httpsRequest(url, { method: 'GET', headers, signal, agent: false, maxHeaderSize: SOURCE_AUDIT_LIMITS.headersBytes }, response => {
      resolveResponse({ status: response.statusCode, headers: response.headers, rawHeaders: response.rawHeaders, body: Readable.toWeb(response) });
    });
    req.maxHeadersCount = 0; req.once('error', reject); req.end();
  });
}
function header(response, name) {
  if (response.rawHeaders) {
    const matches = [];
    for (let i = 0; i < response.rawHeaders.length; i += 2) if (response.rawHeaders[i].toLowerCase() === name) matches.push(response.rawHeaders[i + 1]);
    if (matches.length > 1) fail('invalid_response');
    return matches[0];
  }
  const result = response.headers?.[name];
  if (result !== undefined && typeof result !== 'string') fail('invalid_response');
  return result;
}
function abortable(work, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((yes, no) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); no(signal.reason); };
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(work).then(value => { signal.removeEventListener('abort', cancel); yes(value); }, error => { signal.removeEventListener('abort', cancel); no(error); });
  });
}

const sourceExtension = /\.(?:[cm]?[jt]sx?|json)$/i;
const assetExtension = /\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|otf)$/i;
const rootSource = /^(?:(?:next|postcss|tailwind)\.config\.[cm]?[jt]s|(?:instrumentation(?:-client)?|middleware|proxy|server)\.[cm]?[jt]sx?|next-env\.d\.ts)$/;
const rootData = /^(?:package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|(?:tsconfig|jsconfig)(?:\.[\w-]+)?\.json|vercel\.jsonc?)$/;
const forbidden = /(?:^|\/)(?:\.env(?:\.[^/]*)?|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|\.npmrc|node_modules|public|\.next|\.vercel|dist|build|outputs?|assets)(?:\/|$)/i;
const sourceRoot = /^(?:app|lib|pages|src\/(?:app|lib|pages))\//;
function eligible(path) { return !forbidden.test(path) && (rootSource.test(path) || rootData.test(path) || (sourceRoot.test(path) && sourceExtension.test(path))); }

export function selectDeploymentSources(tree) {
  if (!Array.isArray(tree)) fail('invalid_tree');
  const paths = new Set(), files = [], concerns = [];
  let count = 0;
  function walk(entries, prefix = '', depth = 0) {
    if (depth > SOURCE_AUDIT_LIMITS.treeDepth || !Array.isArray(entries)) fail('invalid_tree');
    for (const item of entries) {
      if (++count > SOURCE_AUDIT_LIMITS.treeEntries || !item || typeof item.name !== 'string' || !item.name || item.name.length > 255 ||
        /[\\/\u0000-\u001f\u007f]/.test(item.name) || ['.', '..'].includes(item.name)) fail('invalid_tree');
      const path = prefix + item.name;
      if (paths.has(path)) fail('invalid_tree'); paths.add(path);
      if ((!prefix && /^(?:\.env(?:\..*)?|\.npmrc|\.next|\.vercel|node_modules|dist|build|outputs?)$/.test(item.name) && item.name !== '.env.example')) concerns.push('unread_execution_configuration');
      if (item.type === 'directory') walk(item.children ?? [], `${path}/`, depth + 1);
      else if (eligible(path)) {
        if (item.type !== 'file' || !/^[A-Za-z0-9_-]{1,160}$/.test(item.uid)) concerns.push('unsupported_source_entry');
        else files.push({ path, uid: item.uid });
      }
      else if ((sourceRoot.test(path) && !assetExtension.test(path)) || rootSource.test(path) || /^(?:yarn\.lock|\.pnp\.|\.pnpmfile)/.test(path)) concerns.push('unsupported_source_entry');
    }
  }
  walk(tree);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, concerns };
}
function decodeContent(value) {
  // The cached API describes base64 JSON, but supplies no response schema.
  // Accept only these explicit representations, never raw source/error bodies.
  const encoded = typeof value === 'string' ? value : value && typeof value === 'object' && !Array.isArray(value) &&
    (value.encoding === undefined || value.encoding === 'base64') ? value.data : undefined;
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(SOURCE_AUDIT_LIMITS.fileBytes / 3) * 4 ||
    encoded.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail('invalid_content');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > SOURCE_AUDIT_LIMITS.fileBytes || bytes.toString('base64') !== encoded) fail('invalid_content');
  return { content: utf8(bytes), bytes: bytes.length, sha256: hash(bytes) };
}

export function checkSourceClosure(files, treeConcerns = []) {
  const concerns = new Set(treeConcerns), byPath = new Map(files.map(file => [file.path, file.content]));
  let pkg;
  try { pkg = JSON.parse(byPath.get('package.json')); } catch { concerns.add('package_missing'); return [...concerns]; }
  if (!byPath.has('pnpm-lock.yaml') && !byPath.has('package-lock.json')) concerns.add('lock_missing');
  const scripts = pkg.scripts ?? {};
  if (!['next build', 'node --version && next build'].includes(scripts.build) || Object.keys(scripts).some(name => /^(?:(?:pre|post)(?:build|install|start)|install|prepare)$/.test(name))) concerns.add('unsupported_build_hook');
  for (const name of ['vercel.json', 'vercel.jsonc']) if (byPath.has(name)) {
    try {
      const config = JSON.parse(byPath.get(name));
      if (Object.keys(config).some(key => !['$schema', 'framework', 'installCommand', 'buildCommand', 'git', 'headers'].includes(key)) ||
        (config.framework && config.framework !== 'nextjs') || (config.buildCommand && !['pnpm build', 'npm run build', 'next build'].includes(config.buildCommand)) ||
        (config.installCommand && !['pnpm install --frozen-lockfile', 'npm ci', 'npm install'].includes(config.installCommand))) concerns.add('unsupported_build_hook');
    } catch { concerns.add('config_resolution'); }
  }
  const dependencyNames = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})]);
  if ([...Object.values(pkg.dependencies ?? {}), ...Object.values(pkg.devDependencies ?? {}), ...Object.values(pkg.optionalDependencies ?? {})]
    .some(value => typeof value !== 'string' || /^(?:file:|link:|workspace:|\.{1,2}\/|\/)/.test(value))) concerns.add('local_dependency');
  const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);
  let parser;
  try { parser = createRequire(import.meta.url)('next/dist/compiled/babel/parser'); } catch { concerns.add('parser_unavailable'); return [...concerns]; }
  const references = [];
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/i.test(file.path)) continue;
    let ast;
    try { ast = parser.parse(file.content, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx', 'importAttributes'] }); }
    catch { concerns.add('source_parse'); continue; }
    const pending = [ast]; let nodes = 0;
    while (pending.length) {
      const node = pending.pop();
      if (++nodes > 100_000) { concerns.add('source_parse'); break; }
      if (!node || typeof node !== 'object') continue;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) references.push([file.path, node.source.value]);
      if (node.type === 'CallExpression' && (node.callee?.type === 'Import' || node.callee?.name === 'require' ||
        (node.callee?.type === 'MemberExpression' && node.callee.object?.name === 'require' && node.callee.property?.name === 'resolve'))) {
        if (node.arguments.length !== 1 || node.arguments[0].type !== 'StringLiteral') concerns.add('dynamic_import');
        else references.push([file.path, node.arguments[0].value]);
      }
      if (node.type === 'ImportExpression') {
        if (node.source?.type !== 'StringLiteral') concerns.add('dynamic_import'); else references.push([file.path, node.source.value]);
      }
      if ((node.type === 'CallExpression' && node.callee?.name === 'eval') || (node.type === 'NewExpression' && node.callee?.name === 'Function')) concerns.add('dynamic_loader');
      if (node.type === 'TSImportEqualsDeclaration') {
        const expression = node.moduleReference?.expression;
        if (expression?.type === 'StringLiteral') references.push([file.path, expression.value]); else concerns.add('dynamic_import');
      }
      for (const [key, value] of Object.entries(node)) if (!['loc', 'extra', 'comments', 'tokens'].includes(key)) {
        if (Array.isArray(value)) pending.push(...value.filter(x => x && typeof x === 'object'));
        else if (value && typeof value === 'object') pending.push(value);
      }
    }
  }
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json'];
  for (const [from, specifier] of references) {
    if (typeof specifier !== 'string' || !specifier || specifier.includes('\0')) { concerns.add('unresolved_import'); continue; }
    if (specifier.startsWith('.')) {
      const base = posix.normalize(posix.join(posix.dirname(from), specifier));
      if (assetExtension.test(base)) continue;
      const candidates = [...extensions.map(extension => base + extension), ...extensions.slice(1).map(extension => `${base}/index${extension}`)];
      if (!candidates.some(path => eligible(path) && byPath.has(path))) concerns.add('unresolved_import');
    } else {
      if (/^(?:node:)?(?:fs(?:\/|$)|vm$|module$|child_process$|worker_threads$)/.test(specifier)) concerns.add('dynamic_loader');
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      if (!builtins.has(specifier) && !dependencyNames.has(name) && !['server-only', 'client-only'].includes(specifier)) concerns.add('unresolved_import');
    }
  }
  // Alias/config extension semantics require separate review; never infer them.
  for (const file of files) if (/^(?:tsconfig|jsconfig).*\.json$/.test(file.path) && /"(?:extends|paths)"\s*:/.test(file.content)) concerns.add('config_resolution');
  return [...concerns].sort();
}

export async function auditDeploymentSources({ manifest, token, outputDirectory, attemptPath, transport = singleRequest, signal,
  now = Date.now, headersMs = SOURCE_AUDIT_LIMITS.headersMs, bodyMs = SOURCE_AUDIT_LIMITS.bodyMs, globalMs = SOURCE_AUDIT_LIMITS.globalMs } = {}) {
  if (typeof now !== 'function' || typeof transport !== 'function' || typeof outputDirectory !== 'string' || typeof attemptPath !== 'string' ||
    typeof token !== 'string' || !/^[A-Za-z0-9._~+/-]{16,16384}={0,2}$/.test(token) ||
    [headersMs, bodyMs, globalMs].some((n, i) => !Number.isSafeInteger(n) || n <= 0 || n > [SOURCE_AUDIT_LIMITS.headersMs, SOURCE_AUDIT_LIMITS.bodyMs, SOURCE_AUDIT_LIMITS.globalMs][i])) fail('invalid_options');
  validateSourceAuditManifest(manifest, now());
  const directory = resolve(outputDirectory), attempt = resolve(attemptPath);
  if (dirname(attempt) !== directory) fail('private_path');
  await privateDirectory(directory); await absent(attempt);
  for (let i = 1; i <= 3; i++) await absent(join(directory, `source-tree-${i}.json`));
  for (let i = 1; i <= 60; i++) await absent(join(directory, `source-file-${i}.json`));
  const handle = await open(attempt, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const attemptIdentity = await handle.stat();
  const record = { formatVersion: 1, allocation: 'CLISOURCE1', manifestFingerprint: hash(JSON.stringify(manifest)), status: 'running',
    treeRequests: 0, contentRequests: 0, sourceFiles: 0, sourceBytes: 0, responseBytes: 0, completeSourceClosure: false, completeDeployments: 0, cancelled: false };
  const controller = new AbortController();
  const stop = code => { if (!controller.signal.aborted) controller.abort(new DeploymentSourceAuditError(code)); };
  const cancelled = () => { record.cancelled = true; stop('cancelled'); };
  let queue = Promise.resolve(), globalTimer;
  const persist = () => {
    const work = queue.then(() => writeAll(handle, Buffer.from(JSON.stringify(record) + '\n')));
    queue = work.catch(() => {}); return work.catch(() => { stop('persistence_failed'); fail('persistence_failed'); });
  };
  async function reserve(kind) {
    const work = queue.then(async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      const key = kind === 'tree' ? 'treeRequests' : 'contentRequests', cap = kind === 'tree' ? 3 : 60;
      if (record[key] >= cap) fail('request_budget'); record[key]++;
      await writeAll(handle, Buffer.from(JSON.stringify(record) + '\n'));
    });
    queue = work.catch(() => {}); await work;
  }
  async function request(kind, deployment, uid) {
    await reserve(kind);
    if (controller.signal.aborted) throw controller.signal.reason;
    const path = kind === 'tree' ? `/v6/deployments/${encodeURIComponent(deployment.id)}/files` : `/v8/deployments/${encodeURIComponent(deployment.id)}/files/${encodeURIComponent(uid)}`;
    const url = new URL(path, 'https://api.vercel.com'); url.searchParams.set('teamId', manifest.teamId);
    let timer, reader;
    try {
      const pending = Promise.resolve(transport(url, { method: 'GET', headers: { authorization: `Bearer ${token}`, 'accept-encoding': 'identity' }, signal: controller.signal, redirect: 'error' }));
      void pending.then(response => { if (controller.signal.aborted) void response?.body?.cancel().catch(() => {}); }, () => {});
      timer = setTimeout(() => stop('headers_timeout'), headersMs);
      const response = await abortable(pending, controller.signal); clearTimeout(timer);
      if (response?.status !== 200) { void response?.body?.cancel().catch(() => {}); fail('http_status'); }
      const encoding = header(response, 'content-encoding'), length = header(response, 'content-length');
      if ((encoding !== undefined && encoding !== 'identity') || (length !== undefined && !/^(0|[1-9][0-9]{0,9})$/.test(length))) fail('invalid_response');
      if (length !== undefined && Number(length) > SOURCE_AUDIT_LIMITS.responseBytes) fail('response_limit');
      reader = response.body.getReader(); const chunks = []; let bytes = 0;
      timer = setTimeout(() => stop('body_timeout'), bodyMs);
      while (true) {
        const next = await abortable(reader.read(), controller.signal); if (next.done) break;
        if (!(next.value instanceof Uint8Array)) fail('invalid_response');
        bytes += next.value.length; record.responseBytes += next.value.length;
        if (bytes > SOURCE_AUDIT_LIMITS.responseBytes || record.responseBytes > SOURCE_AUDIT_LIMITS.totalBytes) fail('response_limit');
        chunks.push(next.value);
      }
      if (length !== undefined && Number(length) !== bytes) fail('invalid_response');
      try { return JSON.parse(utf8(Buffer.concat(chunks, bytes))); } catch { fail('invalid_response'); }
    } catch (error) { stop(error instanceof DeploymentSourceAuditError ? error.code : 'transport_error'); throw controller.signal.reason; }
    finally { clearTimeout(timer); if (controller.signal.aborted) void reader?.cancel().catch(() => {}); try { reader?.releaseLock(); } catch {} }
  }
  async function workers(items, run) {
    let cursor = 0;
    const results = await Promise.allSettled(Array.from({ length: Math.min(3, items.length) }, async () => {
      while (!controller.signal.aborted) {
        const index = cursor++; if (index >= items.length) return;
        try { await run(items[index], index); } catch (error) { stop(safeCode(error)); throw error; }
      }
    }));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) { stop(safeCode(failed.reason)); throw failed.reason; }
  }
  try {
    await persist();
    const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY); try { await parent.sync(); } finally { await parent.close(); }
    signal?.addEventListener('abort', cancelled, { once: true }); if (signal?.aborted) cancelled();
    globalTimer = setTimeout(() => stop('global_timeout'), globalMs);
    const selected = new Array(3), captured = Array.from({ length: 3 }, () => []);
    await workers(manifest.deployments, async (deployment, index) => {
      const tree = await request('tree', deployment);
      if (!Array.isArray(tree)) fail('invalid_tree');
      await publishPrivate(directory, `source-tree-${index + 1}.json`, { deployment, tree });
      selected[index] = selectDeploymentSources(tree);
    });
    const todo = selected.flatMap((selection, index) => selection.files.map(file => ({ ...file, deploymentIndex: index })));
    if (todo.length > 60) fail('file_limit');
    await workers(todo, async (file, index) => {
      const deployment = manifest.deployments[file.deploymentIndex], content = decodeContent(await request('content', deployment, file.uid));
      if (controller.signal.aborted) throw controller.signal.reason;
      await publishPrivate(directory, `source-file-${index + 1}.json`, { deploymentId: deployment.id, path: file.path, uid: file.uid, ...content });
      captured[file.deploymentIndex].push({ path: file.path, ...content }); record.sourceFiles++; record.sourceBytes += content.bytes;
    });
    const concerns = selected.map((selection, index) => checkSourceClosure(captured[index], selection.concerns));
    record.completeDeployments = concerns.filter(list => list.length === 0).length;
    record.completeSourceClosure = record.completeDeployments === 3;
    record.status = record.completeSourceClosure ? 'captured' : 'partial'; record.code = record.completeSourceClosure ? 'source_captured' : 'closure_partial';
    // Concern labels are a fixed local vocabulary. File names/content stay private.
    record.closureConcerns = [...new Set(concerns.flat())].sort();
  } catch (error) { record.status = 'failed'; record.code = controller.signal.aborted ? safeCode(controller.signal.reason) : safeCode(error); }
  finally {
    clearTimeout(globalTimer); await queue;
    try { await handle.close(); } catch { stop('persistence_failed'); }
    if (controller.signal.aborted) { record.status = 'failed'; record.code = safeCode(controller.signal.reason); record.completeSourceClosure = false; }
    // Final persistence is synchronous: no event-loop gap between the cancellation
    // check, durable outcome and removal of this operation's abort listener.
    let fd;
    const finish = () => {
      fd = openSync(attempt, constants.O_WRONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(fd); if (stat.ino !== attemptIdentity.ino || stat.dev !== attemptIdentity.dev) fail('persistence_failed');
      const bytes = Buffer.from(JSON.stringify(record) + '\n'); let offset = 0;
      while (offset < bytes.length) { const n = writeSync(fd, bytes, offset, bytes.length - offset, offset); if (n <= 0) fail('persistence_failed'); offset += n; }
      ftruncateSync(fd, bytes.length); fsyncSync(fd); closeSync(fd); fd = undefined;
    };
    try { finish(); }
    catch {
      if (fd !== undefined) { try { closeSync(fd); } catch {} fd = undefined; }
      record.status = 'failed'; record.code = 'persistence_failed'; record.completeSourceClosure = false;
      try { finish(); } catch { record.finalizationUncertain = true; }
    } finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
    signal?.removeEventListener('abort', cancelled);
  }
  const { manifestFingerprint: _private, ...summary } = record;
  return summary;
}

async function privateJson(path) {
  const full = resolve(path), stat = await lstat(full);
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.size > 65_536 || await realpath(full) !== full) fail('private_path');
  await privateDirectory(dirname(full));
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const after = await handle.stat(); if (after.ino !== stat.ino || after.dev !== stat.dev) fail('private_path'); return JSON.parse(await handle.readFile('utf8')); }
  catch { fail('private_path'); } finally { await handle.close(); }
}
export async function runSourceAuditCli(args, { stdout = process.stdout, stderr = process.stderr, run = auditDeploymentSources } = {}) {
  const names = ['--manifest', '--credential', '--output-directory', '--attempt'];
  if (args[0] !== '--execute' || args.length !== 9) { stderr.write('Source audit is disabled without every explicit input.\n'); return 1; }
  const values = {};
  for (let i = 1; i < args.length; i += 2) { if (!names.includes(args[i]) || values[args[i]] || !args[i + 1]) { stderr.write('Source audit inputs are invalid.\n'); return 1; } values[args[i]] = args[i + 1]; }
  if (names.some(name => !values[name])) return 1;
  const controller = new AbortController(), cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    const manifest = await privateJson(values['--manifest']), credential = await privateJson(values['--credential']);
    const result = await run({ manifest, token: credential.token, outputDirectory: values['--output-directory'], attemptPath: values['--attempt'], signal: controller.signal });
    stdout.write(JSON.stringify(result) + '\n'); return result.status === 'captured' && !controller.signal.aborted ? 0 : 2;
  } catch (error) { stderr.write(`Source audit stopped (${safeCode(error)}).\n`); return 1; }
  finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await runSourceAuditCli(process.argv.slice(2));
