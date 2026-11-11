// Installed CLI 62.1.0 commands-bulk.js uses this project-scoped protocol.
// Secrets are chosen locally, kept private and explicitly revoked. No provider TTL.
import { randomBytes } from 'node:crypto';
export const AUTOMATION_PROJECT='prj_uOMK1a4PLAgsDr1A16InuImM1M3q';
export const AUTOMATION_PATH=`/v1/projects/${AUTOMATION_PROJECT}/protection-bypass`;
const check=(v)=>{if(!v)throw Error('Automation access verification failed.');};
export const newAutomationSecret=()=>randomBytes(16).toString('hex');
function secretValid(secret){check(typeof secret==='string'&&/^[a-f0-9]{32}$/.test(secret));}
function map(value){check(value&&typeof value==='object'&&!Array.isArray(value));return value;}
export function automationGenerateBody(secret){secretValid(secret);return{generate:{secret}};}
export function automationRevokeBody(secret){secretValid(secret);return{revoke:{secret,regenerate:false}};}
export function verifyAutomationGenerated(response,secret,before={}){
  secretValid(secret);const result=map(response?.protectionBypass);map(before);
  check(!Object.hasOwn(before,secret)&&result[secret]?.scope==='automation-bypass');
  check(Object.keys(result).length===Object.keys(before).length+1);
  for(const key of Object.keys(before))check(JSON.stringify(result[key])===JSON.stringify(before[key]));
  return true;
}
export function verifyAutomationRevoked(project,secret,before={}){
  secretValid(secret);const result=map(project?.protectionBypass??{});map(before);
  check(!Object.hasOwn(result,secret)&&Object.keys(result).length===Object.keys(before).length);
  for(const key of Object.keys(before))check(JSON.stringify(result[key])===JSON.stringify(before[key]));
  return true;
}
