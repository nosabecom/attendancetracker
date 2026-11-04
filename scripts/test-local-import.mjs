#!/usr/bin/env node
// Disposable local-only rehearsal. All credentials and data are synthetic.
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { legacyPasswordHash } from '../lib/legacy-password.mjs';
import { signGatewayRequest } from '../lib/gateway-proof.mjs';
import { transformBlobSnapshot } from '../lib/blob-migration.mjs';
import { buildMigrationPlan } from '../lib/convex-migration-plan.mjs';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const wait = ms => new Promise(r => setTimeout(r, ms));
const hash = value => createHash('sha256').update(value).digest('hex');
const port = () => new Promise((resolvePort, reject) => { const server = createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolvePort(p)); }); });
const run = (cmd, args, options = {}) => { const r = spawnSync(cmd, args, { ...options, encoding: 'utf8', timeout: 120000 }); if (r.status !== 0) { throw new Error(`Command failed: ${cmd} ${args[0]}`); } return r.stdout; };
const flags = process.argv.slice(2);
if (flags.length > 1 || (flags.length && !['--maximum-unicode'].includes(flags[0]))) throw new Error('Invalid rehearsal options.');
const maximumUnicode = flags.includes('--maximum-unicode');
let backend, phase = 'setup';
try {
  const originalConfig = JSON.parse(await readFile(join(root, '.convex/local/default/config.json'), 'utf8'));
  const binary = join(homedir(), '.cache/convex/binaries', originalConfig.backendVersion, 'convex-local-backend');
  const sandboxRoot = join(root, '.convex');
  const sandbox = await mkdtemp(join(sandboxRoot, 'import-rehearsal-'));
  for (const name of ['convex', 'lib', 'scripts', 'node_modules', 'package.json', 'convex.json']) await symlink(join(root, name), join(sandbox, name));
  await mkdir(join(sandbox, '.convex/local/default'), { recursive: true });
  const cloud = await port(); let site = await port(); while (site === cloud) site = await port();
  const instance = 'rehearsal', secret = randomBytes(32).toString('hex');
  const adminKey = run(binary, ['keygen', 'admin-key', '--instance-name', instance, '--instance-secret', secret]).trim();
  await writeFile(join(sandbox, '.convex/local/default/config.json'), JSON.stringify({ ports: { cloud, site }, adminKey }), { mode: 0o600 });
  const target = `http://127.0.0.1:${cloud}`;
  backend = spawn(binary, ['--interface', '127.0.0.1', '--port', String(cloud), '--site-proxy-port', String(site), '--instance-name', instance, '--instance-secret', secret, '--disable-beacon', join(sandbox, 'data.sqlite3')], { cwd: sandbox, stdio: 'ignore' });
  phase = 'start-backend';
  let ready = false;
  for (let i = 0; i < 100; i++) { try { await fetch(`${target}/version`); ready = true; break; } catch { await wait(100); } }
  if (!ready || backend.exitCode !== null) throw new Error('Backend unavailable');
  const env = { ...process.env, CONVEX_SELF_HOSTED_URL: target, CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey };
  delete env.CONVEX_DEPLOYMENT; delete env.CONVEX_DEPLOY_KEY;
  phase = 'configure-auth';
  const authEnv = join(root, '.convex/local-auth.env');
  run('pnpm', ['exec', 'convex', 'env', 'set', '--from-file', authEnv], { cwd: sandbox, env });
  phase = 'deploy-code';
  run('pnpm', ['exec', 'convex', 'dev', '--once', '--typecheck', 'disable', '--codegen', 'disable'], { cwd: sandbox, env });
  const backupDir = join(root, '.migration-backups'); await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const inputDir = await mkdtemp(join(backupDir, 'synthetic-import-'));
  const input = join(inputDir, 'raw.json'), alternate = join(inputDir, 'other.json');
  const uploadedAt = '2026-10-02T01:02:03.004Z', id = 'a'.repeat(32), child = 'b'.repeat(32);
  const owner = 'workspace-synthetic', username = 'syntheticowner', password = 'synthetic password for importer';
  const salt = 'a'.repeat(32), students = maximumUnicode
    ? Array.from({length: 1000}, (_, i) => ({ id: `学生-${i}`, name: '界'.repeat(160), code: '生'.repeat(154) + String(i).padStart(6, '0') }))
    : [{ id: 'student-1', name: 'Synthetic Student', code: 'SYN1' }];
  const targetStudent = students.at(-1);
  const blob = (pathname, value) => ({ pathname, value, uploadedAt });
  const raw = { formatVersion: 1, exportedAt: uploadedAt, blobs: [
    blob(`auth/accounts/${hash(username)}.json`, { owner, username, salt, passwordHash: await legacyPasswordHash(password, salt) }),
    blob(`sessions/${id}.json`, { id, owner, title: 'Synthetic Class', createdAt: uploadedAt, students }),
    blob(`sessions/${child}.json`, { id: child, classId: id, owner, title: 'Synthetic Lesson', createdAt: uploadedAt, students }),
    blob(`checks/${child}/${targetStudent.id}.json`, { at: uploadedAt }),
  ] };
  await writeFile(input, JSON.stringify(raw), { mode: 0o600 });
  await writeFile(alternate, JSON.stringify({ ...raw, blobs: [...raw.blobs, blob(`closed/${child}.json`, { at: uploadedAt })] }), { mode: 0o600 });
  const cli = (file, ...flags) => run('node', [join(root, 'scripts/import-blob.mjs'), '--input', file, '--url', target, '--local', ...flags], { cwd: sandbox, env });
  phase = 'dry-run'; if (!JSON.parse(cli(input)).dryRun) throw new Error('Dry run failed');
  phase = 'interrupted-stage';
  const canonical = transformBlobSnapshot(raw), plan = buildMigrationPlan(canonical);
  if (plan.chunks.length < 2) throw new Error('Fixture must require multiple chunks');
  const admin = new ConvexHttpClient(target, { logger: false }); admin.setAdminAuth(adminKey);
  const m = name => makeFunctionReference(`migration:${name}`);
  const beginArgs = { fingerprint: canonical.contentFingerprint, exportedAt: canonical.exportedAt, manifestDigest: plan.manifestDigest, chunkCount: plan.chunks.length, tableCounts: plan.tableCounts, expectedCounts: plan.expectedCounts };
  await admin.mutation(m('initialize'), {});
  const started = await admin.mutation(m('begin'), beginArgs);
  await admin.mutation(m('stage'), { runId: started.runId, ordinal: 0, operations: plan.chunks[0] });
  const resumed = await admin.mutation(m('begin'), beginArgs);
  if (resumed.nextChunk !== 1) throw new Error('Interrupted stage did not persist');
  phase = 'stage'; if (JSON.parse(cli(input, '--apply', '--stage')).phase !== 'staged') throw new Error('Stage failed');
  phase = 'retry-stage'; if (JSON.parse(cli(input, '--apply', '--stage')).phase !== 'staged') throw new Error('Retry failed');
  phase = 'wrong-fingerprint';
  let rejected = false; try { cli(alternate, '--apply', '--stage'); } catch { rejected = true; }
  if (!rejected) throw new Error('Wrong dataset accepted');
  let mismatch = false;
  try { await admin.mutation(m('begin'), { ...beginArgs, fingerprint: '1'.repeat(64) }); }
  catch (error) { mismatch = /dataset_mismatch/.test(String(error?.message)); }
  if (!mismatch) throw new Error('Wrong dataset rejection was not specific');
  phase = 'verify'; if (JSON.parse(cli(input, '--apply', '--verify')).phase !== 'verified') throw new Error('Verify failed');
  phase = 'activate'; if (JSON.parse(cli(input, '--apply', '--activate')).phase !== 'active') throw new Error('Activate failed');
  phase = 'read-imported-data';
  const configEnv = Object.fromEntries((await readFile(authEnv, 'utf8')).split(/\r?\n/).filter(line => line.includes('=')).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, '')]; }));
  const http = new ConvexHttpClient(target, { logger: false });
  const payload = { username, password };
  const proof = await signGatewayRequest('login', payload, { secret: configEnv.ATTENDANCE_GATEWAY_KEY, audience: configEnv.ATTENDANCE_GATEWAY_AUDIENCE, ipHash: 'c'.repeat(64) });
  const ref = name => makeFunctionReference(name);
  const { tokens } = await http.action(ref('auth:signIn'), { provider: 'credentials', params: { operation: 'login', ...payload, proof } });
  http.setAuth(tokens.token);
  const session = await http.query(ref('attendance:session'), { legacyId: child });
  const roster = await http.query(ref('attendance:roster'), { legacyId: child });
  const bucket = await http.query(ref('attendance:bucket'), { legacyId: child, bucket: Math.floor((students.length - 1) / 100) });
  const classes = await http.query(ref('attendance:classes'), { paginationOpts: { numItems: 50, cursor: null } });
  if (session.classId !== id || session.title !== 'Synthetic Lesson' || roster.length !== students.length || roster.at(-1)?.id !== targetStudent.id || roster.at(-1)?.code !== targetStudent.code || bucket[0]?.studentId !== targetStudent.id || bucket[0]?.checkedInAt !== uploadedAt || !classes.page.some(c => c.id === id && c.isOwner)) throw new Error('Imported relationship mismatch');
  phase = 'fresh-export';
  const exported = await http.query(ref('attendance:exportSnapshot'), { legacyId: child });
  if (exported.rows.length !== students.length || exported.rows.at(-1)?.code !== targetStudent.code || exported.rows.at(-1)?.checkedInAt !== uploadedAt)
    throw new Error('Fresh export mismatch');
  console.log(JSON.stringify({ freshExportSnapshot: true, maximumUnicode, students: students.length, dryRun: true, interruptedStageResumed: true, staged: true, repeatedStage: true, wrongFingerprintRejected: true, verified: true, activated: true, authenticatedContentAndRelationships: true }));
} catch {
  console.error(`Local importer rehearsal failed (${phase}); details withheld.`); process.exitCode = 1;
} finally {
  if (backend && backend.exitCode === null) { backend.kill('SIGTERM'); await Promise.race([new Promise(r => backend.once('exit', r)), wait(5000)]); if (backend.exitCode === null) { backend.kill('SIGKILL'); } }
}
