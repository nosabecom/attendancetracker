// Offline proof of name-only deployment env flags in the pinned installed CLI.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { createHash } from 'node:crypto';

export async function checkVercelPrivateEnv(packageDirectory) {
  const directory = resolve(packageDirectory);
  const version = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')).version;
  if (version !== '62.1.0') throw Error('Review changed Vercel CLI before deployment.');
  const parserFile = 'dist/chunks/chunk-7RT22KMX.js';
  const deployFile = 'dist/commands/deploy/index.js';
  const parserText = readFileSync(resolve(directory, parserFile), 'utf8');
  const deployText = readFileSync(resolve(directory, deployFile), 'utf8');
  const expression = (text, start, end) => {
    const first = text.indexOf(start), last = text.indexOf(end, first);
    if (first < 0 || last < 0) throw Error('Installed CLI shape changed.');
    return text.slice(first + start.length, last);
  };
  const parser = expression(parserText, 'var parseEnv=', ';async function ensureLink');
  const resolver = expression(deployText, 'var addProcessEnv=', ';async function handleContinueDeployment');
  const value = 'synthetic-server-value#with-literal$characters';
  const logs = [];
  const context = createContext({
    process: { env: { ATTENDANCE_GATEWAY_KEY: value } },
    import_chalk: { default: { bold: text => text } }, param: text => text,
  });
  const parse = runInContext('(' + parser + ')', context);
  const resolveValues = runInContext('(' + resolver + ')', context);
  const flags = ['ATTENDANCE_GATEWAY_KEY'];
  const env = parse(flags);
  if (!Object.hasOwn(env, flags[0]) || env[flags[0]] !== undefined) throw Error('Name-only flag rejected.');
  await resolveValues(message => logs.push(message), env);
  if (env.ATTENDANCE_GATEWAY_KEY !== value || flags.some(flag => flag.includes(value)) ||
      logs.some(message => message.includes(value))) throw Error('Private environment resolution failed.');
  const explicitEmpty = parse(['ATTENDANCE_GATEWAY_KEY=']);
  await resolveValues(() => {}, explicitEmpty);
  if (explicitEmpty.ATTENDANCE_GATEWAY_KEY !== '') throw Error('Empty override was not preserved.');
  let missingRejected = false;
  try { await resolveValues(() => {}, parse(['MISSING_FIXTURE_VALUE'])); } catch { missingRejected = true; }
  if (!missingRejected || !deployText.includes('await addProcessEnv(log,deploymentEnv)') ||
      !deployText.includes('await addProcessEnv(log,deploymentBuildEnv)'))
    throw Error('Installed deployment path did not match.');
  return { version, nameOnlyRuntimeFlag: true, nameOnlyBuildFlagUsesSameResolver: true,
    fixtureValuePreserved: true, valueAbsentFromFlagsAndLogs: true,
    explicitEmptyOverridePreserved: true, missingValueRejected: true,
    sourceHash: createHash('sha256').update(parser + resolver).digest('hex'),
    networkRequests: 0,
    limitation: 'Executes the installed parser/resolver expressions offline; it is not a full CLI deployment or server-side precedence test.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw Error('Expected installed package directory.');
    console.log(JSON.stringify(await checkVercelPrivateEnv(process.argv[2])));
  } catch { console.error('Vercel private environment check failed; fixture details suppressed.'); process.exitCode = 1; }
}
