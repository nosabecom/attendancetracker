// Requires the local private Blob token and a running app. Uses only test-owned records.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {list,get,put,del} from '@vercel/blob';
const base=process.env.TEST_BASE_URL||'http://localhost:3000';
const digest=s=>createHash('sha256').update(s).digest('hex');
const suffix=randomBytes(6).toString('hex'),names=[`qa_a_${suffix}`,`qa_b_${suffix}`],password=randomBytes(24).toString('hex');
const sessionIds=[],owners=[],cookies=[];
const legacyKey=randomBytes(32).toString('hex'),legacyOwner=digest(legacyKey),legacyId=randomBytes(16).toString('hex');
async function jsonBlob(path){const r=await get(path,{access:'private',useCache:false});return r?.statusCode===200?JSON.parse(await new Response(r.stream).text()):null;}
async function request(route,cookie='',body,headers={}){const r=await fetch(base+'/api/'+route,{method:body?'POST':'GET',headers:{'content-type':'application/json','X-Dashboard-Token':digest('integration-tab').slice(0,32),origin:base,cookie,...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};}
async function blobs(prefix){const result=[];let cursor;do{const p=await list({prefix,cursor});result.push(...p.blobs.map(b=>b.url));cursor=p.hasMore?p.cursor:undefined;}while(cursor);return result;}
async function write(path,value){return put(path,JSON.stringify(value),{access:'private',addRandomSuffix:false});}
try{
 assert.equal((await request('attendance')).status,401);
 assert.equal((await request('auth','',{action:'signup',username:names[0],password},{origin:'https://evil.example'})).status,403);
 for(const username of names){const r=await request('auth','',{action:'signup',username,password});assert.equal(r.status,200,JSON.stringify(r.data));assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/SameSite=Lax/);if(base.startsWith('https'))assert.match(r.headers.get('set-cookie'),/Secure/);cookies.push(r.cookie);const user=await jsonBlob(`auth/accounts/${digest(username)}.json`);owners.push(user.owner);assert.notEqual(user.passwordHash,password);assert.equal(user.passwordHash.length,128);}
 assert.equal((await request('auth','',{action:'signup',username:names[0],password})).status,409);
 assert.equal((await request('auth','',{action:'login',username:names[0],password:'incorrect-password'})).status,401);
 const made=await request('attendance',cookies[0],{action:'create',title:'QA class',csv:'name,student_id\nAvery Brooks,DEMO001\nJordan Ellis,DEMO002'});assert.equal(made.status,200,JSON.stringify(made.data));const id=made.data.id;sessionIds.push(id);
 assert.equal((await request('attendance?id='+id,cookies[1])).status,403);
 for(const action of ['close','repeat'])assert.equal((await request('attendance',cookies[1],{action,id})).status,403);
 assert.equal((await request('attendance',cookies[1])).data.sessions.length,0);
 assert.equal((await request('attendance','',{action:'checkin',id,identity:'DEMO001'})).status,200);
 assert.equal((await request('attendance','',{action:'checkin',id,identity:'DEMO001'})).data.already,true);
 const publicData=(await request('attendance?public=1&id='+id)).data;assert.equal(publicData.students,undefined);
 const repeat=await request('attendance',cookies[0],{action:'repeat',id});assert.equal(repeat.status,200);sessionIds.push(repeat.data.id);
 const again=(await request('attendance?id='+repeat.data.id,cookies[0])).data;assert.equal(again.classId,id);assert.equal(again.students.length,2);assert.equal(Object.keys(again.attendance).length,0);
 assert.equal(Object.keys((await request('attendance?id='+id,cookies[0])).data.attendance).length,1);
 await request('attendance',cookies[0],{action:'close',id});assert.equal((await request('attendance','',{action:'checkin',id,identity:'DEMO002'})).status,409);
 const revoked=cookies[0];await request('auth',revoked,{action:'logout'});assert.equal((await request('attendance',revoked)).status,401);
 const login=await request('auth','',{action:'login',username:names[0].toUpperCase(),password});assert.equal(login.status,200);cookies.push(login.cookie);assert.equal((await request('attendance',login.cookie)).data.sessions.length,2);

 const privateClass=await request('attendance',login.cookie,{action:'create',title:'Private QA class',csv:'name\nPrivate Student'});assert.equal(privateClass.status,200);sessionIds.push(privateClass.data.id);
 let details=(await request('classes?id='+id,login.cookie)).data;
 assert.equal((await request('classes?id='+id,cookies[1])).status,403);
 let shared=await request('classes',login.cookie,{action:'share',id,revision:details.revision,username:names[1]});assert.equal(shared.status,200,JSON.stringify(shared.data));
 assert.equal((await request('attendance',cookies[1])).data.sessions.length,2);
 assert.equal((await request('attendance?id='+privateClass.data.id,cookies[1])).status,403);
 assert.equal((await request('attendance?id='+id,cookies[1])).status,200);
 details=(await request('classes?id='+id,cookies[1])).data;assert.equal(details.isOwner,false);
 assert.equal((await request('classes',cookies[1],{action:'share',id,revision:details.revision,username:names[0]})).status,403);
 const roster=[{...details.students[0],name:'Avery Updated',code:'EDIT001'},{id:'',name:'New Student',code:'NEW002'}];
 const edit=await request('classes',cookies[1],{action:'roster',id,revision:details.revision,students:roster});assert.equal(edit.status,200,JSON.stringify(edit.data));
 assert.equal((await request('classes',login.cookie,{action:'roster',id,revision:details.revision,students:roster})).status,409);
 details=(await request('classes?id='+id,login.cookie)).data;
 assert.equal((await request('classes',login.cookie,{action:'roster',id,revision:details.revision,students:[{id:'',name:'Duplicate',code:'SAME'},{id:'',name:'Duplicate2',code:'SAME'}]})).status,400);
 const historical=(await request('attendance?id='+id,login.cookie)).data;assert.equal(historical.students[0].name,'Avery Brooks');assert.equal(Object.keys(historical.attendance).length,1);
 const byTeacher=await request('attendance',cookies[1],{action:'repeat',id});assert.equal(byTeacher.status,200);sessionIds.push(byTeacher.data.id);
 const fresh=(await request('attendance?id='+byTeacher.data.id,login.cookie)).data;assert.equal(fresh.students[0].name,'Avery Updated');assert.equal(fresh.students[1].name,'New Student');assert.equal(fresh.classId,id);
 assert.equal((await request('attendance','',{action:'checkin',id:byTeacher.data.id,identity:'DEMO001'})).status,400);
 assert.equal((await request('attendance','',{action:'checkin',id:byTeacher.data.id,identity:'EDIT001'})).status,200);
 assert.equal((await request('attendance',cookies[1],{action:'close',id:byTeacher.data.id})).status,200);
 const concurrent=await Promise.all([login.cookie,cookies[1]].map(cookie=>request('classes',cookie,{action:'roster',id,revision:details.revision,students:details.students})));assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 details=(await request('classes?id='+id,login.cookie)).data;
 assert.equal((await request('classes',login.cookie,{action:'unshare',id,revision:details.revision,username:names[1]})).status,200);
 for(const target of [id,byTeacher.data.id]){assert.equal((await request('attendance?id='+target,cookies[1])).status,403);assert.equal((await request('attendance',cookies[1],{action:'repeat',id:target})).status,403);}
 assert.equal((await request('classes?id='+id,cookies[1])).status,403);
 assert.equal((await request('attendance',cookies[1])).data.sessions.length,0);
 const legacy={id:legacyId,owner:legacyOwner,title:'QA legacy class',createdAt:new Date().toISOString(),students:[{id:'1',name:'Demo Student',code:'D1'}]};
 await write(`sessions/${legacyId}.json`,legacy);sessionIds.push(legacyId);await write(`owners/${legacyOwner}/${legacyId}.json`,{id:legacyId,title:legacy.title,createdAt:legacy.createdAt,count:1});
 assert.equal((await request('attendance?id='+legacyId,login.cookie)).status,403);
 assert.equal((await request('auth',login.cookie,{action:'migrate',legacyKey})).status,200);
 assert.equal((await request('attendance?id='+legacyId,login.cookie)).status,200);
 assert.equal((await request('auth',cookies[1],{action:'migrate',legacyKey})).status,409);
 assert.equal((await request('attendance?id='+legacyId,cookies[1])).status,403);
 assert.equal((await request('attendance',login.cookie)).data.sessions.length,5);
 assert.equal((await request('attendance','',undefined,{authorization:`Bearer ${legacyKey}`})).status,401);
 console.log('PASS: signup/login/logout, hashed passwords, cookie flags, CSRF, duplicate accounts, account isolation, saved class reuse/history, anonymous student check-in, legacy migration ownership, class sharing/revocation, owner-only access management, roster edits, immutable history, concurrent edit conflict protection.');
}finally{
 const paths=names.map(n=>`auth/accounts/${digest(n)}.json`);
 for(const cookie of cookies)if(cookie)paths.push(`auth/sessions/${digest(cookie.split('=')[1])}.json`);
 for(const id of sessionIds){paths.push(`sessions/${id}.json`,`closed/${id}.json`,`dashboard-leases/${id}.json`);paths.push(...await blobs(`checks/${id}/`),...await blobs(`classes/${id}/`));}
 for(const who of [...owners,legacyOwner]){paths.push(...await blobs(`owners/${who}/`));paths.push(...await blobs(`auth/imports/${who}/`),...await blobs(`shared/${who}/`));}
 paths.push(`auth/claims/${legacyOwner}.json`);await del(paths);
}
