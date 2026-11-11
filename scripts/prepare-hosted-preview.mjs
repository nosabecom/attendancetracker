// Setup for one explicitly authorized disposable preview. Resume never retries a claim.
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { readQuotaReview, publicationEnvironment } from './hosted-validation-policy.mjs';
import { checkPublicationSelection } from './check-convex-publication-selection.mjs';

const team = 'nomokaro625-9385-s-projects';
const project = 'convex-cyan-garden';
let expectedCommit = process.env.ATTENDANCE_VALIDATION_SOURCE_COMMIT;
const dir = '.convex/hosted-validation';
const manifestPath = `${dir}/preview-setup-manifest.json`;
const evidencePath = 'docs/measurements/hosted-preview-setup.json';
const credentialPath = process.env.ATTENDANCE_PREVIEW_KEY_FILE;
const args = process.argv.slice(2);
const resume = args.includes('--resume');
const inspectOnly = args.includes('--inspect');
let manifest, currentQuotaReview = null, calls = 0, phase = 'preflight';
function save() { writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 }); }
function evidence(status) {
  const identity = manifest?.managementIdentity;
  const safeIdentity = identity && Object.fromEntries(['kind', 'id', 'name', 'deploymentType', 'projectId', 'reference', 'isDefault', 'deploymentUrl', 'expiresAt'].filter(name => Object.hasOwn(identity, name)).map(name => [name, identity[name]]));
  const quota = currentQuotaReview;
  const quotaSummary = quota ? { source: quota.source, observedAt: quota.observedAt,
    sufficientReviewedHeadroom: true, plannedHeadroom: quota.plannedHeadroom } : null;
  writeFileSync(evidencePath, JSON.stringify({ status, phase, explicitControlPlaneCalls: calls, cliPublicationRequests: manifest?.publication === 'not started' ? 0 : 'unknown', teamQuotaReview: quotaSummary, expectedCommit, workloadsRun: false, ...(manifest?.deploymentName && { deploymentName: manifest.deploymentName, identifier: manifest.identifier }), ...(safeIdentity && { managementIdentity: safeIdentity }), adminCapabilityVerified: manifest?.adminCapabilityVerified === true, usageSeedStatus: manifest?.baselineUsage?.seedStatus ?? 'unknown', ...(manifest?.limitVerified && { dailyFunctionCallsDisableLimit: 1000 }), publication: manifest?.publication ?? 'not started' }, null, 2) + '\n');
}
async function request(url, auth, method = 'GET', body) {
  if (calls >= 20) throw Error('control budget exceeded');
  calls++;
  manifest.explicitControlPlaneCalls = calls; save();
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw Error(`request failed (${response.status})`);
  if (!response.body) return null;
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw Error('control response limit exceeded');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length ? JSON.parse(text) : null;
}
try {
  if (args.some(arg => !['--resume', '--inspect'].includes(arg)) || new Set(args).size !== args.length || (inspectOnly && !resume)) throw Error('invalid setup mode');
  if (resume) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    calls = manifest.explicitControlPlaneCalls;
    expectedCommit ??= manifest.expectedCommit;
    if (manifest.team !== team || manifest.project !== project || !/^[a-f0-9]{40}$/.test(manifest.expectedCommit ?? '') ||
        manifest.claimOutcome !== 'response received' || manifest.isNewDeployment !== true ||
        !/^attendance-validation-[a-f0-9]{32}$/.test(manifest.identifier) ||
        !Number.isSafeInteger(calls) || calls < 1 || calls > 20 ||
        (!inspectOnly && manifest.publication !== 'not started')) throw Error('resume ownership gate failed');
  }
  if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? '') || !credentialPath) throw Error('explicit source commit and private credential file required');
  if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== expectedCommit) throw Error('unexpected source commit');
  const corePaths = ['app', 'convex', 'lib', 'patches', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'convex.json'];
  if (resume) execFileSync('git', ['diff', '--exit-code', manifest.expectedCommit, expectedCommit, '--', ...corePaths], { stdio: 'ignore' });
  execFileSync('git', ['diff', '--exit-code', expectedCommit, '--', ...corePaths], { stdio: 'ignore' });
  if (execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...corePaths], { encoding: 'utf8' }).trim()) throw Error('unreviewed core files');
  const key = readFileSync(credentialPath, 'utf8').trim();
  if (!key.startsWith(`preview:${team}:${project}|`) || key.split('|').length !== 2) throw Error('credential scope mismatch');
  phase = 'offline publication selection';
  const selectorCheck = checkPublicationSelection();
  phase = 'team quota review';
  const quotaReview = currentQuotaReview = inspectOnly ? null : await readQuotaReview();
  if (manifest) { manifest.selectorCheck = selectorCheck; manifest.quotaReview = quotaReview; save(); }
  let claim;
  if (!resume) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fd = openSync(manifestPath, 'wx', 0o600); closeSync(fd);
  const identifier = `attendance-validation-${randomBytes(16).toString('hex')}`;
  manifest = { team, project, identifier, expectedCommit, selectorCheck, quotaReview, createdAt: new Date().toISOString(), publication: 'not started', claimOutcome: 'pending', deletionOwnershipProof: 'pending', explicitControlPlaneCalls: 0 };
  save();
  phase = 'claim';
  // Mark the request as uncertain before sending: never reuse or automatically retry.
  manifest.claimOutcome = 'request submitted or uncertain'; save();
  claim = await request('https://api.convex.dev/api/claim_preview_deployment', `Bearer ${key}`, 'POST', { projectSelection: { kind: 'teamAndProjectSlugs', teamSlug: team, projectSlug: project }, identifier, reuse: true });
  Object.assign(manifest, { claimOutcome: 'response received', isNewDeployment: claim.isNewDeployment, deploymentName: claim.deploymentName, cloudUrl: claim.instanceUrl, reference: claim.reference, adminKey: claim.adminKey }); save();
  } else {
    claim = { isNewDeployment: manifest.isNewDeployment, deploymentName: manifest.deploymentName, instanceUrl: manifest.cloudUrl, reference: manifest.reference, adminKey: manifest.adminKey };
  }
  const identifier = manifest.identifier;
  manifest.reviewedSourceCommit = expectedCommit; save();
  if (claim.isNewDeployment !== true || typeof claim.adminKey !== 'string' || !/^[a-z0-9-]+$/.test(claim.deploymentName ?? '') || typeof claim.instanceUrl !== 'string') throw Error('claim did not prove a new deployment');
  const cloud = new URL(claim.instanceUrl);
  if (cloud.protocol !== 'https:' || cloud.username || cloud.password || cloud.port || cloud.pathname !== '/' || cloud.search || cloud.hash || !(cloud.hostname === `${claim.deploymentName}.convex.cloud` || cloud.hostname.startsWith(`${claim.deploymentName}.`) && cloud.hostname.endsWith('.convex.cloud'))) throw Error('deployment URL mismatch');
  if (!claim.adminKey.length || claim.adminKey.length > 16384 || /[\r\n]/.test(claim.adminKey)) throw Error('invalid deployment capability');
  phase = 'identity';
  const detail = await request(`https://api.convex.dev/v1/deployments/${encodeURIComponent(claim.deploymentName)}`, `Bearer ${key}`);
  if (detail.kind !== 'cloud' || detail.name !== claim.deploymentName || detail.deploymentType !== 'preview' ||
      (detail.previewIdentifier !== null && detail.previewIdentifier !== identifier) ||
      detail.reference !== `preview/${identifier}` || detail.reference !== claim.reference ||
      detail.deploymentUrl.replace(/\/$/, '') !== claim.instanceUrl.replace(/\/$/, '') || detail.isDefault !== false ||
      (manifest.managementIdentity && (manifest.managementIdentity.id !== detail.id || manifest.managementIdentity.projectId !== detail.projectId))) throw Error('management identity mismatch');
  manifest.managementIdentity = detail; save();
  manifest.deploymentType = 'preview'; manifest.deletionOwnershipProof = 'new claim plus matching management identity and project-scoped preview key'; save();
  phase = 'admin capability';
  const auth = `Convex ${claim.adminKey}`;
  const urls = await request(`${claim.instanceUrl}/api/v1/get_canonical_urls`, auth);
  if (urls.convexCloudUrl.replace(/\/$/, '') !== claim.instanceUrl.replace(/\/$/, '') ||
      urls.convexSiteUrl !== `${cloud.origin.replace(/\.convex\.cloud$/, '.convex.site')}`) throw Error('canonical URL mismatch');
  manifest.siteUrl = urls.convexSiteUrl; manifest.adminCapabilityVerified = true; save();
  phase = 'private publication selector';
  const targetEnv = `${dir}/publication-target.env`;
  const targetBody = publicationEnvironment(claim.instanceUrl, claim.adminKey);
  if (!inspectOnly) {
    try { writeFileSync(targetEnv, targetBody, { mode: 0o600, flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const fd = openSync(targetEnv, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || (stat.mode & 0o077) || stat.uid !== process.getuid() || readFileSync(fd, 'utf8') !== targetBody)
          throw Error('private publication selector mismatch');
      } finally { closeSync(fd); }
    }
  }
  phase = 'baseline usage';
  const usage = await request(`${claim.instanceUrl}/api/v1/get_current_usage`, auth);
  const limits = await request(`${claim.instanceUrl}/api/v1/list_usage_limits`, auth);
  if (!usage || typeof usage.metrics !== 'object' || !Array.isArray(limits.usageLimits)) throw Error('usage response unsupported');
  manifest.baselineUsage = usage; manifest.baselineLimits = limits.usageLimits; save();
  if (inspectOnly) {
    phase = 'verified; configuration pending'; evidence('verified');
    console.log('Preview identity and read capability verified. Configuration and publication remain pending.');
  } else {
  const existing = limits.usageLimits.filter(x => x.metric === 'functionCalls' && x.window === 'day' && x.limitType === 'disable');
  if (existing.length > 1 || (existing.length === 1 && (existing[0].limit !== 1000 || existing[0].enabled !== true))) throw Error('unexpected existing daily limit');
  phase = 'usage limit';
  if (!existing.length) await request(`${claim.instanceUrl}/api/v1/create_usage_limit`, auth, 'POST', { metric: 'functionCalls', window: 'day', limitType: 'disable', limit: 1000, enabled: true });
  const after = await request(`${claim.instanceUrl}/api/v1/list_usage_limits`, auth);
  if (!Array.isArray(after.usageLimits) || after.usageLimits.filter(x => x.metric === 'functionCalls' && x.window === 'day' && x.limitType === 'disable' && x.limit === 1000 && x.enabled === true).length !== 1) throw Error('usage limit readback mismatch');
  manifest.limitVerified = true; save();
  phase = 'preview environment';
  if (!manifest.config) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString().trimEnd().replace(/\n/g, ' ');
  const jwks = JSON.stringify({ keys: [{ use: 'sig', ...publicKey.export({ format: 'jwk' }) }] });
  const config = { JWT_PRIVATE_KEY: jwt, JWKS: jwks, ATTENDANCE_GATEWAY_KEY: randomBytes(32).toString('hex'), ATTENDANCE_GATEWAY_AUDIENCE: `attendance-preview-${randomBytes(16).toString('hex')}` };
  manifest.config = config; save();
  }
  await request(`${claim.instanceUrl}/api/update_environment_variables`, auth, 'POST', { changes: Object.entries(manifest.config).map(([name, value]) => ({ name, value })) });
  manifest.environmentConfigured = true; save();
  phase = 'publication';
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'C.UTF-8', CI: '1', CONVEX_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' };
  manifest.publication = 'started; outcome uncertain'; save();
  const result = spawnSync('pnpm', ['exec', 'convex', 'deploy', '--typecheck', 'enable', '--codegen', 'disable', '--env-file', targetEnv], { env, stdio: 'ignore', timeout: 180000 });
  if (result.status !== 0) { manifest.publication = 'failed or timed out; inspect target before any action'; save(); throw Error('publication failed or timed out'); }
  manifest.publication = 'succeeded'; save(); phase = 'complete'; evidence('complete');
  console.log('Preview setup completed. No hosted workload was run.');
  }
} catch (error) {
  // Do not emit provider errors, which can contain sensitive response details.
  const safeError = error.message === 'deployment admin key mismatch' ? error.message : 'setup guard or request failed';
  if (manifest) { manifest.stoppedAt = phase; manifest.safeError = safeError; save(); evidence('stopped'); }
  console.error(`Setup stopped at ${phase}: ${safeError}`); process.exitCode = 1;
}
