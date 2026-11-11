// Offline check of the installed CLI's real env-file selector. No credentials.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { publicationEnvironment } from './hosted-validation-policy.mjs';

export function checkPublicationSelection() {
  const version = JSON.parse(readFileSync(resolve('node_modules/convex/package.json'), 'utf8')).version;
  if (version !== '1.49.0') throw new Error('Review the changed CLI selector before publication.');
  const directory = mkdtempSync(join(tmpdir(), 'attendance-selector-'));
  const target = 'https://selector-fixture.convex.cloud';
  const capability = 'opaque-fixture#literal' + String.fromCharCode(92) + 'value';
  try {
    const preload = join(directory, 'offline.cjs');
    const log = join(directory, 'attempts.jsonl');
    writeFileSync(preload, [
      "const fs=require('node:fs');",
      "const note=(kind,url,authMatches)=>fs.appendFileSync(process.env.ATTENDANCE_SELECTOR_LOG,JSON.stringify({kind,url,authMatches})+'\\n');",
      "globalThis.fetch=async(input,init)=>{const u=new URL(String(input));note('fetch',u.origin+u.pathname,new Headers(init?.headers).get('Authorization')===process.env.ATTENDANCE_SELECTOR_EXPECTED_AUTH);return new Response(JSON.stringify({code:'OfflineFixture',message:'Blocked offline'}),{status:400,headers:{'Content-Type':'application/json'}});};",
      "for(const name of ['http','https']){const m=require('node:'+name);for(const key of ['request','get'])m[key]=()=>{note('blocked-native',name);throw Error('Offline fixture');};}",
      "for(const [name,keys] of [['net',['connect','createConnection']],['tls',['connect']],['dns',['lookup','resolve']]]){const m=require('node:'+name);for(const key of keys)m[key]=()=>{note('blocked-native',name);throw Error('Offline fixture');};}",
    ].join('\n'), { mode: 0o600 });
    const populated = join(directory, 'target.env'), empty = join(directory, 'empty.env');
    writeFileSync(populated, publicationEnvironment(target, capability), { mode: 0o600 });
    writeFileSync(empty, '', { mode: 0o600 });
    const env = {
      PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', CI: '1',
      CONVEX_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1',
      CONVEX_OVERRIDE_ACCESS_TOKEN: 'offline-fixture-not-a-credential',
      CONVEX_DEPLOY_KEY: 'preview:ignored-fixture:ignored-project|not-a-key',
      CONVEX_DEPLOYMENT: 'local:ignored-fixture', ATTENDANCE_SELECTOR_LOG: log,
      ATTENDANCE_SELECTOR_EXPECTED_AUTH: 'Convex ' + capability,
    };
    const invoke = envFile => spawnSync(process.execPath, ['--require', preload,
      resolve('node_modules/convex/bin/main.js'), 'deploy', '--dry-run', '--typecheck', 'disable',
      '--codegen', 'disable', '--env-file', envFile],
    { env, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    const selected = invoke(populated);
    const selectedText = String(selected.stdout) + String(selected.stderr);
    const rejected = invoke(empty);
    const rejectedText = String(rejected.stdout) + String(rejected.stderr);
    const attempts = (() => { try { return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } })();
    if (!selectedText.includes('Deploying code to deployment:') || !selectedText.includes(target) ||
        selected.error || !rejectedText.includes('did not contain environment variables') || rejected.status === 0 || !attempts.length ||
        attempts.some(attempt => attempt.kind !== 'fetch' || !attempt.url.startsWith(target + '/') || attempt.authMatches !== true))
      throw new Error('Offline publication selector check failed.');
    return { installedCliVersion: version, directTargetSelected: true,
      processSelectorsIgnored: true, emptyFileRejected: true, claimRequests: 0,
      opaqueCapabilityPreserved: true, realNetworkRequests: 0, blockedFetchAttempts: attempts.length };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(checkPublicationSelection())); }
  catch { console.error('Offline publication selector check failed; fixture output suppressed.'); process.exitCode = 1; }
}
