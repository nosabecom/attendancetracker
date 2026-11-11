import { EXPECTED, providerJson } from './prepare-hosted-next.mjs';
import { AUTOMATION_PATH,newAutomationSecret,automationGenerateBody,automationRevokeBody,verifyAutomationGenerated,verifyAutomationRevoked } from './vercel-automation-access.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
export const LEGACY_TARGETS=Object.freeze(['dpl_CehR9Pm1ryBqR6XDVdayyqAWBnb7','dpl_8HjQXo7PCafdiLPzxJtv2GHhax9d','dpl_CGr5aysuABQnQkqt4La5qHrmJzC4']);
const check=v=>{if(!v)throw Error('Automation probe failed.');};
// One diagnostic on an existing audited deployment. Creates no deployment.
export async function probeVercelAutomation({token,reserve,capture,signal},deps={}){
  const report={version:1,protocol:'project-automation-v1',projectId:EXPECTED.projectId,teamId:EXPECTED.teamId,
    passed:false,cancelled:false,controls:0,hosting:0,noResourceCreation:true,baselineProtected:false,headerAccepted:false,
    revocationConfirmed:false,preservedUnrelated:false};
  const secret=newAutomationSecret(),started=Date.now();let before,issued=false,cleaning=false,phase='identity';
  const remaining=()=>{const left=(cleaning?180000:120000)-(Date.now()-started);check(left>0&&(cleaning||!signal?.aborted));return Math.min(left,15000);};
  async function request(path,opts={}){
    remaining();check(++report.controls<=(cleaning?7:5));
    try{await reserve('control',report.controls,cleaning);}catch(e){report.persistenceFailed=true;if(!cleaning)throw e;}
    const url=new URL(path,'https://api.vercel.com');url.searchParams.set('teamId',EXPECTED.teamId);
    return (deps.providerJson??providerJson)(url.href,{...opts,headers:{...opts.headers,Authorization:`Bearer ${token}`},timeoutMs:remaining()});
  }
  async function page(url,headers={},body=false){
    remaining();check(++report.hosting<=2);await reserve('hosting',report.hosting,false);
    const r=await(deps.fetch??fetch)(url,{headers,redirect:'manual',signal:AbortSignal.timeout(remaining())});
    if(!body){await r.body?.cancel();return r.status;}
    const chunks=[];let n=0;
    try{check(r.status===200&&r.headers.get('content-type')?.includes('text/html'));if(r.body)for await(const p of r.body){n+=p.byteLength;check(n<=262144);chunks.push(Buffer.from(p));}}
    finally{await r.body?.cancel().catch(()=>{});}
    check(/<title>Rollcall(?:\s|\s*·|&)/i.test(Buffer.concat(chunks).toString('utf8')));return r.status;
  }
  try{
    const project=(await request(`/v9/projects/${EXPECTED.projectId}`)).body;
    check(project.id===EXPECTED.projectId&&(project.accountId??project.teamId)===EXPECTED.teamId&&!project.link);
    before=project.protectionBypass??{};check(before&&typeof before==='object'&&!Array.isArray(before)&&!Object.hasOwn(before,secret));
    let selected;
    for(const id of LEGACY_TARGETS){const d=(await request(`/v13/deployments/${id}`)).body;
      check(d.id===id&&(d.ownerId??d.teamId??d.team?.id)===EXPECTED.teamId&&(d.projectId??d.project?.id)===EXPECTED.projectId);
      if(d.readyState==='READY'){check(/^[a-z0-9-]+\.vercel\.app$/.test(d.url));selected={id,url:`https://${d.url}`};break;}}
    check(selected);report.deploymentId=selected.id;phase='baseline';
    check([302,303,307,308,401,403].includes(await page(selected.url)));report.baselineProtected=true;
    phase='generate';await capture({secret,before,projectId:EXPECTED.projectId});issued=true;
    verifyAutomationGenerated((await request(AUTOMATION_PATH,{method:'PATCH',body:automationGenerateBody(secret)})).body,secret,before);
    // The installed CLI waits one second after generation for edge propagation.
    await (deps.wait??sleep)(1000);
    phase='header';check(await page(selected.url,{'x-vercel-protection-bypass':secret},true)===200);report.headerAccepted=true;
  }catch{report.failedPhase=phase;}
  finally{
    cleaning=true;
    if(issued){try{await request(AUTOMATION_PATH,{method:'PATCH',body:automationRevokeBody(secret)});
      const after=(await request(`/v9/projects/${EXPECTED.projectId}`)).body;
      verifyAutomationRevoked(after,secret,before);report.revocationConfirmed=true;report.preservedUnrelated=true;
    }catch{report.cleanupUncertain=true;}}
    report.cancelled=!!signal?.aborted;report.passed=!report.failedPhase&&!report.cancelled&&!report.persistenceFailed&&report.headerAccepted&&report.revocationConfirmed;
    report.finishedAt=new Date().toISOString();
  }
  return report;
}
