import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { archiveHostedNextSource, sourceArchiveUploadDescriptor, SOURCE_ARCHIVE_LIMITS } from '../scripts/archive-hosted-next-source.mjs';

const hash = (kind, bytes) => createHash(kind).update(bytes).digest('hex');
function repository(t, files = { 'package.json': '{}\n', 'app/page.tsx': 'fictional public source\n' }) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'attendance-source-fixture-'));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], {
    cwd: repoRoot, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: repoRoot,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Fictional Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fictional Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q']);
  const put = (path, content) => { const target = join(repoRoot, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); };
  for (const [path, content] of Object.entries(files)) put(path, content);
  const commit = () => { git(['add', '-f', '.']); git(['commit', '-qm', 'fictional fixture']); return git(['rev-parse', 'HEAD']).trim(); };
  return { repoRoot, put, git, commit };
}
test('repository-sized stdin remains valid while extracting an early small file', t => {
  const r = repository(t, { 'a-small.txt': 'small\n', 'z-large.bin': randomBytes(512 * 1024) });
  const commit = r.commit();
  const result = archiveHostedNextSource({ repoRoot: r.repoRoot, commit });
  assert.equal(result.metadata.fileCount, 2);
  assert.equal(result.contentManifest[0].sha256, hash('sha256', 'small\n'));
  assert.ok(result.metadata.tarBytes > 512 * 1024);
});

test('exact committed blobs produce deterministic gzip, independent manifest and first-party upload descriptor', t => {
  const files = { 'package.json': '{}\n', '.env.example': 'PUBLIC_EXAMPLE=fictional\n',
    'app/unicode é with spaces.ts': 'fictional unicode\n', 'app/empty': '', '-leading': 'dash\n',
    [`app/${'long'.repeat(30)}.tsx`]: 'PAX long filename\n', 'scripts/build.sh': '#!/bin/sh\nexit 0\n' };
  const r = repository(t, files);
  chmodSync(join(r.repoRoot, 'scripts/build.sh'), 0o755);
  const commit = r.commit(), first = archiveHostedNextSource({ repoRoot: r.repoRoot, commit });
  // Working-tree and ignored files must never affect source selection.
  r.put('package.json', 'unreviewed working bytes'); r.put('.env.local', 'synthetic private value');
  const second = archiveHostedNextSource({ repoRoot: r.repoRoot, commit });
  assert.deepEqual(first, second);
  assert.equal(first.metadata.fileCount, Object.keys(files).length);
  for (const item of first.contentManifest) {
    assert.equal(item.sha256, hash('sha256', files[item.path]));
    assert.equal(item.mode, item.path === 'scripts/build.sh' ? '100755' : '100644');
  }
  assert.equal(first.metadata.contentManifestSha256, hash('sha256', JSON.stringify(first.contentManifest)));
  assert.equal(first.sha1, hash('sha1', first.archiveBytes));
  assert.equal(first.sha256, hash('sha256', first.archiveBytes));
  assert.equal(gunzipSync(first.archiveBytes).length, first.metadata.tarBytes);
  const upload = sourceArchiveUploadDescriptor(first);
  assert.deepEqual(first.files, [{ file: '.vercel/source.tgz.part1', size: first.archiveBytes.length, mode: 438, sha: first.sha1 }]);
  assert.deepEqual(upload, { method: 'POST', path: '/v2/files', body: first.archiveBytes, headers: {
    'Content-Type': 'application/octet-stream', 'Content-Length': String(first.archiveBytes.length),
    'x-now-digest': first.sha1, 'x-now-size': String(first.archiveBytes.length) } });
  upload.body[0] ^= 1;
  assert.notDeepEqual(upload.body, first.archiveBytes); // A transport receives its own copy.
});
test('archive caps reject extra files, raw/compressed oversize and attempts to enlarge defaults', t => {
  const r = repository(t, { 'one.txt': randomBytes(4096), 'two.txt': 'two' }), commit = r.commit();
  for (const [limits, code] of [[{maxFiles:1},'file_count'],[{maxSourceBytes:4096},'source_size'],
    [{maxArchiveBytes:32},'compressed_size'],[{maxFiles:513},'limits'],[{maxSourceBytes:0},'limits'],[{unknown:1},'limits']])
    assert.throws(() => archiveHostedNextSource({ repoRoot:r.repoRoot,commit,limits }), new RegExp(code));
  assert.deepEqual(SOURCE_ARCHIVE_LIMITS, {maxFiles:512,maxSourceBytes:8*1024*1024,maxArchiveBytes:4*1024*1024});
  for (const value of ['HEAD', 'a'.repeat(39), '-'.repeat(40)])
    assert.throws(() => archiveHostedNextSource({repoRoot:r.repoRoot,commit:value}), /commit/);
  assert.throws(() => archiveHostedNextSource({repoRoot:r.repoRoot,commit:r.git(['rev-parse','HEAD:one.txt']).trim()}), /commit_type/);
});
for (const path of ['.env', 'nested/.env.production', '.convex/fake.json', '.vercel/source.tgz.part1',
  'node_modules/fake.js', '.migration-backups/fake.json', '.npmrc', '.aws/config', 'synthetic.pem',
  'bad\\path', 'bad:name', 'line\nbreak'])
  test(`rejects tracked private or unsafe path ${JSON.stringify(path)} instead of filtering it`, t => {
    const r = repository(t, { [path]: 'fictional bytes' }), commit = r.commit();
    assert.throws(() => archiveHostedNextSource({ repoRoot:r.repoRoot,commit }), /(?:private_path|path)/);
  });
test('symlinks and submodules are refused before tar creation', t => {
  const r = repository(t); symlinkSync('package.json', join(r.repoRoot, 'link'));
  const linked = r.commit();
  assert.throws(() => archiveHostedNextSource({repoRoot:r.repoRoot,commit:linked}), /nonregular/);
  r.git(['rm','link']); r.git(['update-index','--add','--cacheinfo',`160000,${linked},vendor`]);
  r.git(['commit','-qm','fictional submodule']);
  assert.throws(() => archiveHostedNextSource({repoRoot:r.repoRoot,commit:r.git(['rev-parse','HEAD']).trim()}), /nonregular/);
});
for (const [attributes, content] of [['app/page.tsx export-ignore\n','fictional source'],
  ['app/page.tsx export-subst\n','$Format:%H$']])
  test('committed archive attribute omission/substitution cannot escape Git blob equality', t => {
    const r = repository(t, {'.gitattributes':attributes,'app/page.tsx':content}), commit = r.commit();
    assert.throws(() => archiveHostedNextSource({repoRoot:r.repoRoot,commit}), /(?:omission|file_metadata|content_mismatch)/);
  });
test('local archive attributes cannot silently omit reviewed files', t => {
  const r=repository(t),commit=r.commit();r.put('.git/info/attributes','app/page.tsx export-ignore\n');
  assert.throws(()=>archiveHostedNextSource({repoRoot:r.repoRoot,commit}), /omission/);
});
test('upload rejects altered bytes, digest and submitted archive file entry', t => {
  const r=repository(t),commit=r.commit(),archive=archiveHostedNextSource({repoRoot:r.repoRoot,commit});
  for(const mutate of [x=>{x.archiveBytes[0]^=1;},x=>{x.sha1='a'.repeat(40);},x=>{x.sha256='b'.repeat(64);},
    x=>{x.files[0].size++;},x=>{x.files[0].mode=420;},x=>{x.files[0].file='other.tgz';}]){
    const value={...structuredClone(archive),archiveBytes:Buffer.from(archive.archiveBytes)};mutate(value);
    assert.throws(()=>sourceArchiveUploadDescriptor(value), /upload_(?:digest|manifest)/);
  }
});
