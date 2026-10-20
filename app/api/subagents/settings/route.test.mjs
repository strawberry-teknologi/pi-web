import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti=createJiti(import.meta.url,{alias:{'@':process.cwd()},interopDefault:true,moduleCache:false});
const {GET,PUT}=await jiti.import('./route.ts');
const request=(body,headers={Host:'localhost','Content-Type':'application/json'})=>new Request('http://localhost/api/subagents/settings',{method:'PUT',headers,body:JSON.stringify(body)});
test('extension settings inspect existing tools without starting a session',async t=>{
 const previous=globalThis.__piSessions;globalThis.__piSessions=new Map();t.after(()=>{globalThis.__piSessions=previous;});
 assert.deepEqual(await (await GET(new Request('http://localhost/api/subagents/settings'))).json(),{implementation:'extension',loaded:null});
 for(const loaded of [false,true]){
  globalThis.__piSessions.set('parent',{isAlive:()=>true,inner:{getAllTools:()=>loaded?[{name:'subagent'}]:[]}});
  const response=await GET(new Request('http://localhost/api/subagents/settings?sessionId=parent'));
  assert.deepEqual(await response.json(),{implementation:'extension',loaded});
 }
 assert.equal(globalThis.__piSessions.size,1);
});
test('retired built-in switches/concurrency refuse writes and keep trust checks',async()=>{
 for(const body of [{enabled:true},{maxConcurrent:2}])assert.equal((await PUT(request(body))).status,410);
 assert.equal((await PUT(request({},{Host:'evil.test','Content-Type':'application/json'}))).status,403);
 assert.equal((await PUT(request({},{Host:'localhost','Content-Type':'text/plain'}))).status,415);
});
