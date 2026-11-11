// Offline only: no deployment, credentials, working-tree reads, or persistent output.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { gzipSync } from 'node:zlib';

export const SOURCE_ARCHIVE_LIMITS = Object.freeze({
  maxFiles: 512, maxSourceBytes: 8 * 1024 * 1024, maxArchiveBytes: 4 * 1024 * 1024,
});
const manifestPath = '.vercel/source.tgz.part1';
const check = (condition, code) => { if (!condition) throw Error(`source_archive_${code}`); };
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const environment = () => ({ PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ATTR_NOSYSTEM: '1',
  GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0' });

function run(command, args, cwd, maxBuffer, input) {
  try {
    return execFileSync(command, args, { cwd, env: environment(), maxBuffer,
      timeout: 30000, input, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (error) {
    throw Error(`source_archive_${command}_${error.code === 'ENOBUFS' ? 'size' : 'failed'}`);
  }
}
function publicPath(path) {
  check(typeof path === 'string' && path.length > 0 && Buffer.byteLength(path) <= 1024 &&
    !/[\u0000-\u001f\u007f-\u009f\\:]/u.test(path) && !isAbsolute(path), 'path');
  const segments = path.split('/');
  check(segments.every(part => part && part !== '.' && part !== '..'), 'path');
  check(segments.every(part => !['.git', 'node_modules', '.convex', '.migration-backups', '.vercel',
    '.ssh', '.aws', '.npmrc', '.netrc', '.git-credentials', 'credentials.json', 'id_rsa', 'id_ed25519']
    .includes(part.toLowerCase()) && !/\.(?:pem|key|p12|pfx)$/i.test(part) &&
    (!part.toLowerCase().startsWith('.env') || part === '.env.example')), 'private_path');
}
function boundedLimits(requested) {
  check(requested && typeof requested === 'object' && !Array.isArray(requested), 'limits');
  check(Object.keys(requested).every(key => Object.hasOwn(SOURCE_ARCHIVE_LIMITS, key)), 'limits');
  return Object.fromEntries(Object.entries(SOURCE_ARCHIVE_LIMITS).map(([key, cap]) => {
    const value = requested[key] ?? cap;
    check(Number.isSafeInteger(value) && value > 0 && value <= cap, 'limits');
    return [key, value];
  }));
}

/** All tracked entries must be public regular files; nothing is silently filtered.
 * Git archive's committed attributes are deliberately honored, then checked against
 * Git blobs. export-ignore/export-subst and local attribute overrides fail closed.
 * GNU tar handles Git's PAX records; no custom tar parser or extraction to disk.
 */
export function archiveHostedNextSource({ repoRoot, commit, limits = {} } = {}) {
  check(typeof repoRoot === 'string' && isAbsolute(repoRoot), 'repo_root');
  check(typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit), 'commit');
  const caps = boundedLimits(limits);
  const git = (args, bound = 1024 * 1024) => run('git', ['-c', 'core.fsmonitor=false',
    '-c', 'core.attributesFile=/dev/null', '-c', 'protocol.allow=never',
    '-c', 'tar.umask=0022', ...args], repoRoot, bound);
  check(git(['cat-file', '-t', commit], 64).toString() === 'commit\n', 'commit_type');
  const tree = git(['rev-parse', '--verify', `${commit}^{tree}`], 64).toString().trim();
  check(/^[a-f0-9]{40}$/.test(tree), 'tree');
  const listing = git(['ls-tree', '-r', '--full-tree', '--long', '-z', commit]);
  check(Buffer.from(listing.toString('utf8')).equals(listing), 'path_encoding');
  const records = listing.toString('utf8').split('\0');
  check(records.pop() === '', 'tree_listing');
  check(records.length > 0 && records.length <= caps.maxFiles, 'file_count');
  const paths = new Set(), directories = new Set();
  let sourceBytes = 0;
  const files = records.map(record => {
    const match = /^(\d{6}) (\w+) ([a-f0-9]{40}) +(-|\d+)\t([\s\S]*)$/.exec(record);
    check(match, 'tree_listing');
    const [, mode, type, object, sizeText, path] = match;
    publicPath(path);
    check(!paths.has(path), 'duplicate'); paths.add(path);
    check(type === 'blob' && ['100644', '100755'].includes(mode), 'nonregular');
    const size = Number(sizeText);
    check(Number.isSafeInteger(size) && size >= 0 && size <= caps.maxSourceBytes - sourceBytes, 'source_size');
    sourceBytes += size;
    let parent = path;
    while (parent.includes('/')) { parent = parent.slice(0, parent.lastIndexOf('/')); directories.add(parent); }
    check(directories.size <= 1024, 'directory_count');
    return { path, mode, object, size };
  });
  // These bounds apply while child output is collected, before it becomes a Buffer.
  const tarLimit = caps.maxSourceBytes + (files.length + directories.size + 4) * 4096 + 10240;
  const tar = git(['archive', '--format=tar', commit], tarLimit);
  const tarArgs = ['--list', '--verbose', '--full-time', '--numeric-owner', '--quoting-style=literal', '--file=-'];
  const archiveListing = run('tar', tarArgs, repoRoot, 2 * 1024 * 1024, tar).toString('utf8');
  const archived = new Map();
  for (const line of archiveListing.trimEnd().split('\n')) {
    const match = /^([-d][rwxstST-]{9}) +\d+\/\d+ +(\d+) +\d{4}-\d\d-\d\d +\d\d:\d\d:\d\d (.*)$/.exec(line);
    check(match, 'tar_entry');
    const [, permissions, sizeText, name] = match;
    const directory = permissions.startsWith('d');
    check(!directory || name.endsWith('/'), 'tar_entry');
    const path = directory ? name.slice(0, -1) : name;
    publicPath(path);
    check(!archived.has(path), 'duplicate');
    check(directory ? directories.has(path) : paths.has(path), 'unexpected_entry');
    archived.set(path, { permissions, size: Number(sizeText), directory });
  }
  check(archived.size === files.length + directories.size, 'omission');
  const contentManifest = files.map(({ path, mode, object, size }) => {
    const entry = archived.get(path);
    check(entry && !entry.directory && entry.size === size &&
      entry.permissions === (mode === '100755' ? '-rwxr-xr-x' : '-rw-r--r--'), 'file_metadata');
    const blob = git(['cat-file', 'blob', object], Math.max(1, size));
    check(blob.length === size, 'blob_size');
    // The complete listing above already rejects duplicate names. Consume the
    // whole archive: --occurrence=1 exits early and produces EPIPE when Node is
    // still writing a repository-sized archive into the child's stdin.
    const extracted = run('tar', ['--extract', '--to-stdout', '--no-wildcards',
      '--file=-', '--', path], repoRoot, Math.max(1, size), tar);
    check(extracted.length === size && digest('sha256', extracted) === digest('sha256', blob), 'content_mismatch');
    return { path, mode, size, sha256: digest('sha256', blob) };
  });
  let archiveBytes;
  try { archiveBytes = gzipSync(tar, { level: 9, mtime: 0, maxOutputLength: caps.maxArchiveBytes }); }
  catch { throw Error('source_archive_compressed_size'); }
  check(archiveBytes.length <= caps.maxArchiveBytes, 'compressed_size');
  const sha1 = digest('sha1', archiveBytes), sha256 = digest('sha256', archiveBytes);
  return { archiveBytes, sha1, sha256,
    files: [{ file: manifestPath, size: archiveBytes.length, mode: 438, sha: sha1 }],
    contentManifest,
    metadata: { version: 1, sourceCommit: commit, sourceTree: tree, fileCount: files.length,
      sourceBytes, tarBytes: tar.length, archiveBytes: archiveBytes.length, format: 'tar+gzip',
      contentManifestSha256: digest('sha256', JSON.stringify(contentManifest)), limits: caps } };
}

// First-party CLI 62.1.0 / @vercel/client 18.5.0 createTgzFiles uses this
// synthetic archive path, mode 438 and SHA-1 provider address. SHA-256 binds
// source evidence independently. This describes an upload; it never sends one.
export function sourceArchiveUploadDescriptor(archive) {
  check(Buffer.isBuffer(archive?.archiveBytes) && archive.archiveBytes.length > 0 &&
    archive.archiveBytes.length <= SOURCE_ARCHIVE_LIMITS.maxArchiveBytes, 'upload_bytes');
  const body = Buffer.from(archive.archiveBytes);
  check(digest('sha1', body) === archive.sha1 && digest('sha256', body) === archive.sha256, 'upload_digest');
  check(archive.metadata?.archiveBytes === body.length && archive.metadata.format === 'tar+gzip' &&
    /^[a-f0-9]{40}$/.test(archive.metadata.sourceCommit ?? '') && /^[a-f0-9]{40}$/.test(archive.metadata.sourceTree ?? '') &&
    Array.isArray(archive.contentManifest) && archive.contentManifest.length > 0 &&
    archive.contentManifest.length <= SOURCE_ARCHIVE_LIMITS.maxFiles && archive.contentManifest.length === archive.metadata.fileCount &&
    digest('sha256', JSON.stringify(archive.contentManifest)) === archive.metadata.contentManifestSha256, 'upload_source_manifest');
  const expected = { file: manifestPath, size: body.length, mode: 438, sha: archive.sha1 };
  check(JSON.stringify(archive.files) === JSON.stringify([expected]), 'upload_manifest');
  return { method: 'POST', path: '/v2/files', headers: {
    'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length),
    'x-now-digest': archive.sha1, 'x-now-size': String(body.length),
  }, body };
}
