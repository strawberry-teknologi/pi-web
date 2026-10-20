import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url,{alias:{'@':process.cwd()},interopDefault:true,moduleCache:false});
const {GET,POST} = await jiti.import('./[id]/route.ts');
const {createEventBus} = await jiti.import('@earendil-works/pi-coding-agent');
const {createNativeSubagentBridge} = await jiti.import('../../../lib/native-subagents.ts');
const id = 'subagent-route-test';
const context = {params:Promise.resolve({id})};
const request = body => new Request(`http://localhost/api/subagents/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function fixture(t) {
 const root = mkdtempSync(join(tmpdir(),'native-route-'));
 const dir = join(root,'sessions','project'); mkdirSync(dir,{recursive:true});
 const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
 globalThis.__piSessionPathCache = undefined; globalThis.__piPathToSessionIdCache = undefined;
 const bus = createEventBus(); const bridge = createNativeSubagentBridge(bus,()=> 'parent',()=>{});
 const file = join(dir,`${id}.jsonl`);
 let run = {version:1,sessionId:id,sessionPath:file,runId:'r',parentSessionId:'parent',parentToolCallId:'call',agent:'quick',task:'test',createdAt:new Date().toISOString(),status:'running',ownerPid:process.pid};
 const write = ()=>writeFileSync(file,[{type:'session',version:3,id,cwd:root,timestamp:run.createdAt},{type:'custom',customType:'subagent:run',id:'m',parentId:null,timestamp:run.createdAt,data:run}].map(JSON.stringify).join('\n')+'\n');
 write(); bus.emit('subagent:run',run);
 const off = bus.on('subagent:abort',request=>{run={...run,status:'aborted'};write();bus.emit('subagent:run',run);request.acknowledge();});
 t.after(()=>{off();bridge.dispose(); if(previous===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous; globalThis.__piSessionPathCache=undefined;globalThis.__piPathToSessionIdCache=undefined;rmSync(root,{recursive:true,force:true});});
}
test('native route reads and stops extension-owned children; steering is explicitly unsupported', async t=>{
 fixture(t);
 let response = await GET(new Request('http://localhost'),context);
 assert.equal(response.status,200);assert.equal((await response.json()).run.status,'running');
 response = await POST(request({action:'steer',message:'focus'}),context);
 assert.equal(response.status,409);assert.match((await response.json()).error,/not supported/);
 response = await POST(request({action:'abort'}),context);
 assert.equal(response.status,200);assert.equal((await response.json()).run.status,'aborted');
 response = await POST(request({action:'abort'}),context);assert.equal(response.status,409);
});
test('native route validates actions and unknown sessions',async()=>{
 assert.equal((await POST(request({action:'steer',message:'  '}),context)).status,400);
 assert.equal((await POST(request({action:'unknown'}),context)).status,400);
 assert.equal((await GET(new Request('http://localhost'),{params:Promise.resolve({id:'missing-native-test'})})).status,404);
});
