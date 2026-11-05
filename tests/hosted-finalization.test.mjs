import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execute = promisify(execFile);
const runner = new URL('../scripts/test-hosted-preview.mjs', import.meta.url).href;
const child = `
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { persistHostedReports } from ${JSON.stringify(runner)};
const [directory, target, signal] = process.argv.slice(1);
const attemptPath = join(directory, 'attempt.json'), evidencePath = join(directory, 'evidence.json');
const report = { passed:true, cancelled:false };
let cancelled = false, releaseSignal;
const signalReceived = new Promise(resolve => { releaseSignal = resolve; });
const cancel = () => {
  cancelled = true; report.cancelled = true; report.passed = false;
  process.exitCode = 1; releaseSignal();
};
process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
await persistHostedReports({ attemptPath, evidencePath,
  attemptRecord:{ fixture:'synthetic-finalization' }, report, isCancelled:() => cancelled }, {
  async write(path, serialized, options) {
    if (path === (target === 'private' ? attemptPath : target === 'public' ? evidencePath : null)) {
      // The original passing bytes are already captured. Deliver a real signal
      // before the asynchronous write settles, then persist those stale bytes.
      // Signal watchers alone do not keep Node's event loop alive.
      const keepAlive = setTimeout(() => { throw Error('Signal not delivered'); }, 2000);
      try { process.kill(process.pid, signal); await signalReceived; }
      finally { clearTimeout(keepAlive); }
    }
    return writeFile(path, serialized, options);
  },
});
process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
console.log(JSON.stringify(report));
`;

for (const target of ['private', 'public']) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    test(`${signal} during final ${target} write repairs both persisted reports`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'attendance-finalization-'));
      try {
        let result;
        try { await execute(process.execPath, ['--input-type=module', '-e', child, directory, target, signal], { timeout:10000 }); }
        catch (error) { result = error; }
        assert.equal(result?.code, 1);
        const memory = JSON.parse(result.stdout);
        const evidence = JSON.parse(await readFile(join(directory, 'evidence.json'), 'utf8'));
        const attempt = JSON.parse(await readFile(join(directory, 'attempt.json'), 'utf8'));
        assert.deepEqual(memory, evidence);
        assert.deepEqual(attempt.report, evidence);
        assert.equal(evidence.passed, false);
        assert.equal(evidence.cancelled, true);
        assert.equal(evidence.failedPhase, 'cancelled');
        assert.equal((await stat(join(directory, 'attempt.json'))).mode & 0o777, 0o600);
      } finally { await rm(directory, { recursive:true, force:true }); }
    });
  }
}

test('uncancelled finalization preserves the passing control', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'attendance-finalization-'));
  try {
    const result = await execute(process.execPath, ['--input-type=module', '-e', child, directory, 'none', 'none'], { timeout:10000 });
    const memory = JSON.parse(result.stdout);
    assert.deepEqual(memory, { passed:true, cancelled:false });
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'evidence.json'), 'utf8')), memory);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'attempt.json'), 'utf8')).report, memory);
  } finally { await rm(directory, { recursive:true, force:true }); }
});
