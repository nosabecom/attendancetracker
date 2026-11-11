import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { PREVIEW_BACKEND_COMMIT } from '../../scripts/hosted-next-third.mjs';

const hash = (kind, bytes) => createHash(kind).update(bytes).digest('hex');
export function fixtureArchive(commit = 'a'.repeat(40)) {
  const archiveBytes = gzipSync('synthetic upload; real tar creation is tested in temporary Git repositories');
  const contentManifest = [{ path: 'package.json', mode: '100644', size: 2, sha256: hash('sha256', '{}') }];
  const sha1 = hash('sha1', archiveBytes), sha256 = hash('sha256', archiveBytes);
  return { archiveBytes, sha1, sha256, contentManifest,
    files: [{ file: '.vercel/source.tgz.part1', size: archiveBytes.length, mode: 438, sha: sha1 }],
    metadata: { version: 1, sourceCommit: commit, sourceTree: 'd'.repeat(40), fileCount: 1,
      archiveBytes: archiveBytes.length, sourceBytes: 2, format: 'tar+gzip',
      contentManifestSha256: hash('sha256', JSON.stringify(contentManifest)) } };
}
export function fixtureArchiveBinding(commit) {
  const { archiveBytes, ...archive } = fixtureArchive(commit);
  return { ...archive, uploadSubmitted: true, uploadAcknowledged: true, creationSubmitted: true,
    creationFiles: structuredClone(archive.files) };
}
export function compatibilityPackage(current) {
  return { scripts: { build: 'node --version && next build' }, dependencies: {
    convex: '1.49.0', '@convex-dev/auth': '0.0.96',
    next: current ? '^16.4.4' : '^16.4.3', 'lucide-react': current ? '^1.66.0' : '^1.61.0' } };
}
export function compatibilityLock(current) {
  const next = current ? '16.4.4' : '16.4.3', lucide = current ? '1.66.0' : '1.61.0';
  return `lockfileVersion: '9.0'
settings:
  autoInstallPeers: true
importers:
  .:
    dependencies:
      convex:
        specifier: 1.49.0
        version: 1.49.0(react@19.3.1)
      next:
        specifier: ^${next}
        version: ${next}(react@19.3.1)
      lucide-react:
        specifier: ^${lucide}
        version: ${lucide}(react@19.3.1)
      '@vercel/analytics':
        specifier: ^2.0.1
        version: 2.0.1(next@${next}(react@19.3.1))
packages:
  convex@1.49.0:
    resolution: {integrity: sha512-backend}
  next@${next}:
    resolution: {integrity: sha512-${current ? 'new' : 'old'}}
  lucide-react@${lucide}:
    resolution: {integrity: sha512-${current ? 'new' : 'old'}}
  '@next/env@${next}':
    resolution: {integrity: sha512-${current ? 'new' : 'old'}}
snapshots:
  convex@1.49.0(react@19.3.1):
    dependencies:
      react: 19.3.1
  next@${next}(react@19.3.1):
    dependencies:
      '@next/env': ${next}
      react: 19.3.1
  lucide-react@${lucide}(react@19.3.1): {}
  '@next/env@${next}': {}
  '@vercel/analytics@2.0.1(next@${next}(react@19.3.1))':
    dependencies:
      next: ${next}(react@19.3.1)
`;
}
export function compatibilityGit(commit, args) {
  if (args[0] === 'rev-parse') return commit;
  if (args[0] !== 'show') return '';
  const current = !args[1].startsWith(PREVIEW_BACKEND_COMMIT + ':');
  if (args[1].endsWith(':package.json')) return JSON.stringify(compatibilityPackage(current));
  if (args[1].endsWith(':pnpm-lock.yaml')) return compatibilityLock(current);
  throw Error('unexpected synthetic Git read');
}
