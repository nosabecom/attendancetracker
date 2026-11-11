// Local build only. This module does not contact the Vercel deployment API.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { archiveHostedNextSource } from './archive-hosted-next-source.mjs';

const check = (v, name) => { if (!v) throw Error(`prebuilt_${name}`); };
const sha = (algorithm, b) => createHash(algorithm).update(b).digest('hex');
function origin(value, suffix) {
  let u; try { u = new URL(value); } catch { throw Error('prebuilt_url'); }
  check(u.protocol === 'https:' && u.hostname.endsWith(suffix) && u.hostname.length > suffix.length && !u.port && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash, 'url');
  return u.origin;
}
function inventory(output) {
  const root = realpathSync(output), records = [], active = new Set();
  function walk(path, name) {
    const real = realpathSync(path), rel = relative(root, real);
    check(rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel), 'link_outside');
    const stat = statSync(path); check(stat.isDirectory() || stat.isFile(), 'file_type');
    if (stat.isDirectory()) {
      check(!active.has(real), 'link_cycle'); active.add(real);
      for (const part of readdirSync(path).sort()) walk(join(path, part), name ? `${name}/${part}` : part);
      active.delete(real); return;
    }
    check(records.length < 100000 && stat.size <= 100 * 1024 * 1024, 'file_limit');
    const bytes = readFileSync(path); check(bytes.length === stat.size, 'file_changed');
    if (name.endsWith('.vc-config.json')) {
      const config = JSON.parse(bytes.toString('utf8'));
      for (const key of ['environment', 'env']) { const value = config[key]; check(value === undefined || (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0), 'function_environment'); }
    }
    check(name !== 'provision.json', 'provision');
    records.push({ path: name, size: bytes.length, sha256: sha('sha256', bytes), executable: !!(stat.mode & 0o111) });
  }
  walk(root, '');
  check(records.some(x => x.path === 'config.json'), 'missing_config');
  return records;
}
export function buildHostedPrebuilt({ repoRoot, commit, target, cloudUrl, siteUrl, projectId, orgId }) {
  check(isAbsolute(repoRoot) && /^[a-f0-9]{40}$/.test(commit), 'source');
  check(['preview','production'].includes(target), 'target');
  check(/^prj_[A-Za-z0-9]+$/.test(projectId) && /^team_[A-Za-z0-9]+$/.test(orgId), 'project');
  cloudUrl = origin(cloudUrl, '.convex.cloud'); siteUrl = origin(siteUrl, '.convex.site');
  check(new URL(cloudUrl).hostname.split('.')[0] === new URL(siteUrl).hostname.split('.')[0], 'url_pair');
  const archive = archiveHostedNextSource({ repoRoot, commit });
  const dir = mkdtempSync(join(tmpdir(), 'attendance-prebuilt-')); mkdirSync(join(dir, '.vercel'), { mode: 0o700 });
  const baseEnv = { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', CI: '1', NEXT_TELEMETRY_DISABLED: '1', VERCEL_TELEMETRY_DISABLED: '1' };
  execFileSync('tar', ['-xz', '-C', dir], { input: archive.archiveBytes, env: baseEnv, timeout: 30000 });
  // Dependencies are installed in the private checkout using the pinned lockfile.
  execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: dir, env: baseEnv, stdio: 'inherit', timeout: 600000 });
  writeFileSync(join(dir, '.vercel/project.json'), JSON.stringify({ projectId, orgId, settings: { framework: 'nextjs', buildCommand: 'pnpm build', installCommand: 'pnpm install --frozen-lockfile', outputDirectory: null, rootDirectory: null, nodeVersion: '24.x' } }), { mode: 0o600 });
  const publicEnv = { NEXT_PUBLIC_ATTENDANCE_BACKEND: 'convex', NEXT_PUBLIC_CONVEX_URL: cloudUrl, NEXT_PUBLIC_CONVEX_SITE_URL: siteUrl, NEXT_PUBLIC_ATTENDANCE_RELEASE: commit };
  const envFile = Object.entries(publicEnv).map(([k,v]) => `${k}=${v}`).join('\n') + '\n';
  writeFileSync(join(dir, `.vercel/.env.${target}.local`), envFile, { mode: 0o600 });
  execFileSync('vercel', ['build', '--standalone', ...(target === 'production' ? ['--prod'] : []), '--non-interactive'], { cwd: dir, env: { ...baseEnv, ...publicEnv }, stdio: 'inherit', timeout: 600000 });
  const files = inventory(join(dir, '.vercel/output'));
  return { dir, commit, target, cloudUrl, siteUrl, sourceTree: archive.metadata.sourceTree, files, outputSha256: sha('sha256', JSON.stringify(files)) };
}
export function archivePrebuiltOutput(receipt) {
  check(receipt && /^[a-f0-9]{40}$/.test(receipt.commit) && ['preview','production'].includes(receipt.target), 'receipt');
  const files = inventory(join(receipt.dir, '.vercel/output'));
  check(JSON.stringify(files) === JSON.stringify(receipt.files) && sha('sha256', JSON.stringify(files)) === receipt.outputSha256, 'output_changed');
  const bytes = execFileSync('tar', ['--dereference', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', '-', '.vercel/output'], { cwd: receipt.dir, maxBuffer: 512 * 1024 * 1024, timeout: 120000, env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' } });
  const sha1 = sha('sha1', bytes);
  return { bodyBuffer: bytes, files: [{ file: '.vercel/source.tgz.part1', size: bytes.length, mode: 438, sha: sha1 }], sha1, archiveSha256: sha('sha256', bytes), outputSha256: receipt.outputSha256, sourceCommit: receipt.commit, target: receipt.target };
}
