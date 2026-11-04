#!/usr/bin/env node
/**
 * Offline administrator tool; requires pinned convex@1.49.0's setAdminAuth.
 * No source export, provisioning, code deployment, or automatic cutover here.
 *
 * pnpm exec node scripts/import-blob.mjs --input /private/raw.json --url https://NAME.convex.cloud
 * Add --apply --stage, then --apply --verify, then --apply --activate separately.
 * Cloud: CONVEX_DEPLOY_KEY (environment only). Local: explicit --local, loopback
 * URL with matching port, then .convex/local/default/config.json's adminKey.
 * Input must be a regular private file (0600/0400), never a canonical plan.
 *
 * Before the final source snapshot, freeze ALL Blob writers, including preview
 * and immutable historical deployment URLs. No dual writes. After Convex takes
 * new writes, returning to the old Blob snapshot loses data: reverse export or
 * a reviewed forward repair is required. This tool offers no automatic rollback.
 *
 * TRUST: the admin reviews this transformer/plan and the expected fingerprint.
 * The server binds operations to the plan, freezes its importer, verifies every
 * actual target field and reference, and gates publication. Do not bypass the
 * freeze using dashboard/direct DB/admin writes during or after verification.
 */
import { open, constants } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { transformBlobSnapshot, BlobMigrationValidationError } from '../lib/blob-migration.mjs';
import { buildMigrationPlan, MigrationPlanError } from '../lib/convex-migration-plan.mjs';

export class ImportError extends Error {
  constructor(code) { super(`Blob import failed (${code}).`); this.code = code; }
}
const fail = code => { throw new ImportError(code); };
export function parseArgs(argv) {
  const result = { apply: false, local: false, phase: undefined, input: undefined, url: undefined };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--input' || flag === '--url') {
      const key = flag.slice(2);
      if (result[key] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--')) fail('invalid_arguments');
      result[key] = argv[++i];
    } else if (flag === '--apply' || flag === '--local') {
      const key = flag.slice(2);
      if (result[key]) fail('invalid_arguments');
      result[key] = true;
    } else if (['--stage', '--verify', '--activate'].includes(flag)) {
      if (result.phase) fail('invalid_arguments');
      result.phase = flag.slice(2);
    } else fail('invalid_arguments');
  }
  if (!result.input || !result.url || (result.apply && !result.phase)) fail('invalid_arguments');
  return result;
}
export function validateTarget(value, local) {
  let url;
  try { url = new URL(value); } catch { fail('invalid_target'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin === 'null') fail('invalid_target');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (local) {
    if (!loopback || !['http:', 'https:'].includes(url.protocol) || !url.port) fail('local_target_required');
  } else if (url.protocol !== 'https:' || url.port || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.convex\.cloud$/.test(url.hostname)) fail('cloud_target_required');
  return url;
}
export async function readPrivateJson(path, { openFile = open } = {}) {
  let file;
  try {
    file = await openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 512 * 1024 * 1024 || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))) fail('input_not_private');
    try { return JSON.parse(await file.readFile('utf8')); } catch { fail('invalid_json'); }
  } catch (error) {
    if (error instanceof ImportError) throw error;
    fail('private_file_unavailable');
  } finally { await file?.close(); }
}

export async function runImport(argv, {
  env = process.env, readJson = readPrivateJson,
  createClient = url => new ConvexHttpClient(url, { logger: false }),
  report = value => process.stdout.write(`${JSON.stringify(value)}\n`),
} = {}) {
  const options = parseArgs(argv);
  // Validate before reading any local config or key. Dry-run reads no keys.
  const url = validateTarget(options.url, options.local);
  const canonical = transformBlobSnapshot(await readJson(options.input));
  const plan = buildMigrationPlan(canonical);
  const safe = { fingerprint: canonical.contentFingerprint, counts: plan.expectedCounts, chunks: plan.chunks.length };
  if (!options.apply) { report({ dryRun: true, ...safe }); return; }
  let key;
  if (options.local) {
    const config = await readJson(resolve('.convex/local/default/config.json'));
    if (!config || Number(url.port) !== config.ports?.cloud || typeof config.adminKey !== 'string' || !config.adminKey) fail('local_config_mismatch');
    key = config.adminKey;
  } else {
    key = env.CONVEX_DEPLOY_KEY;
    if (typeof key !== 'string' || !key.trim()) fail('deploy_key_required');
  }
  let client;
  try {
    client = createClient(url.origin);
    // Pinned offline SDK internal API; never part of the application runtime.
    client.setAdminAuth(key);
  } catch { fail('admin_client_failed'); }
  const call = async (kind, name, args) => {
    try { return await client[kind](makeFunctionReference(`migration:${name}`), args); }
    catch { fail('backend_request_failed'); }
  };
  const match = { fingerprint: canonical.contentFingerprint, manifestDigest: plan.manifestDigest };
  let state;
  if (options.phase === 'stage') {
    await call('mutation', 'initialize', {});
    state = await call('mutation', 'begin', { ...match, exportedAt: canonical.exportedAt,
      chunkCount: plan.chunks.length, tableCounts: plan.tableCounts, expectedCounts: plan.expectedCounts });
    if (state.phase === 'import') {
      for (let ordinal = state.nextChunk; ordinal < plan.chunks.length; ordinal++) {
        await call('mutation', 'stage', { runId: state.runId, ordinal, operations: plan.chunks[ordinal] });
      }
    }
  } else {
    state = await call('query', 'status', match);
    if (options.phase === 'verify' && state.phase !== 'active') {
      state = { ...state, ...await call('mutation', 'freeze', { runId: state.runId }) };
      while (state.phase === 'verify') state = { ...state, ...await call('mutation', 'verifyNext', { runId: state.runId }) };
    } else if (options.phase === 'activate' && state.phase !== 'active') {
      state = { ...state, ...await call('mutation', 'activate', { runId: state.runId }) };
    }
  }
  report({ phase: state.phase === 'import' ? 'staged' : state.phase, ...safe });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await runImport(process.argv.slice(2)); }
  catch (error) {
    // SDK/OS/JSON errors may contain private payloads. Never print or stringify.
    const code = error instanceof ImportError || error instanceof BlobMigrationValidationError || error instanceof MigrationPlanError ? error.code : 'unexpected_failure';
    process.stderr.write(`Blob import failed (${code}).\n`);
    process.exitCode = 1;
  }
}
