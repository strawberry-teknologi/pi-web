import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
const extensionPath=process.env.PI_WEB_SUBAGENT_EXTENSION_TEST_PATH;
const jiti=createJiti(import.meta.url,{interopDefault:true,moduleCache:false});
const {SessionManager,createEventBus}=await jiti.import('@earendil-works/pi-coding-agent');
const {createNativeSubagentBridge,getRunningNativeSubagentIds}=await jiti.import('./native-subagents.ts');
const {listAllSessions,openSessionManager,buildSessionContext,invalidateSessionListCache}=await jiti.import('./session-reader.ts');
const {listSessionFamilies}=await jiti.import('./session-family.ts');
const {resetSessionScanIndexForTests}=await jiti.import('./session-list-scanner.ts');

test('installed extension → child process → catalog family → transcript → resume, without provider calls', {skip:!extensionPath},async t=>{
 const root=await mkdtemp(join(tmpdir(),'native-subagent-e2e-'));
 const previous=Object.fromEntries(['PI_CODING_AGENT_DIR','PATH','PASEO_AGENT_ID','PI_SUBAGENT_DEPTH','PI_WEB_PASSWORD'].map(key=>[key,process.env[key]]));
 process.env.PI_CODING_AGENT_DIR=root;
 delete process.env.PASEO_AGENT_ID;delete process.env.PI_SUBAGENT_DEPTH;
 process.env.PI_WEB_PASSWORD='fixture-secret-not-for-child';
 await mkdir(join(root,'agents'));await mkdir(join(root,'bin'));await mkdir(join(root,'work'));
 await writeFile(join(root,'agents','quick.md'),'---\nname: quick\ndescription: Fixture worker\n---\nNo providers.');
 const fake=join(root,'bin','pi');
 await writeFile(fake,`#!${process.execPath}
const fs=require('node:fs'), crypto=require('node:crypto');
const args=process.argv.slice(2), file=args[args.indexOf('--session')+1];
if(process.env.PI_WEB_PASSWORD)process.exit(23);
const entries=fs.readFileSync(file,'utf8').trim().split('\\n').map(JSON.parse);
const now=Date.now(), u={type:'message',id:crypto.randomUUID(),parentId:entries.at(-1).id,timestamp:new Date(now).toISOString(),message:{role:'user',content:args.at(-1),timestamp:now}};
const message={role:'assistant',content:[{type:'text',text:'fixture done'}],timestamp:now,stopReason:'stop'};
fs.appendFileSync(file,JSON.stringify(u)+'\\n'+JSON.stringify({type:'message',id:crypto.randomUUID(),parentId:u.id,timestamp:u.timestamp,message})+'\\n');
console.log(JSON.stringify({type:'message_end',message}));
`);
 await chmod(fake,0o755);process.env.PATH=`${join(root,'bin')}:${previous.PATH}`;
 const parent=SessionManager.create(join(root,'work'));
 parent.appendMessage({role:'user',content:'Delegate fixtures',timestamp:Date.now()});
 const bus=createEventBus();const bridge=createNativeSubagentBridge(bus,()=>parent.getSessionId(),invalidateSessionListCache);
 let tool;const shutdown=[];
 const extension=await jiti.import(extensionPath);
 extension.default({events:bus,registerTool:value=>{tool=value;},registerVirtualModel(){},on:(name,handler)=>{if(name==='session_shutdown')shutdown.push(handler);return()=>{};}});
 t.after(async()=>{
  for(const stop of shutdown)await stop();bridge.dispose();resetSessionScanIndexForTests();invalidateSessionListCache();
  globalThis.__piSmCache=undefined;globalThis.__piSessionPathCache=undefined;globalThis.__piPathToSessionIdCache=undefined;
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await rm(root,{recursive:true,force:true});
 });
 const context={cwd:join(root,'work'),sessionManager:parent,hasUI:false,isProjectTrusted:()=>true,thinkingLevel:'off'};
 async function run(params,call){
  const result=await tool.execute(call,params,undefined,()=>{},context);
  assert.notEqual(result.isError,true,JSON.stringify(result.content));
  parent.appendMessage({role:'toolResult',toolName:'subagent',toolCallId:call,content:result.content,details:result.details,isError:false,timestamp:Date.now()});
  invalidateSessionListCache();return result;
 }
 const single=await run({agent:'quick',task:'one'},'single');
 const id=single.details.results[0].sessionId.slice(3);
 await run({agent:'quick',task:'again',resume:`pi:${id}`},'resume');
 await run({tasks:[{agent:'quick',task:'parallel1'},{agent:'quick',task:'parallel2'}]},'parallel');
 await run({chain:[{agent:'quick',task:'first'},{agent:'quick',task:'after {previous}'}]},'chain');
 const sessions=await listAllSessions({force:true});
 const families=listSessionFamilies(sessions);
 assert.equal(families.length,1);assert.equal(families[0].root.id,parent.getSessionId());assert.equal(families[0].subagents.length,5);
 assert.ok(families[0].subagents.every(session=>session.relation.status==='completed'));
 assert.deepEqual(getRunningNativeSubagentIds(),[]);
 const child=sessions.find(session=>session.id===id);
 const manager=openSessionManager(child.path);
 const contextRead=buildSessionContext(manager.getEntries(),manager.getLeafId());
 assert.equal(contextRead.messages.filter(message=>message.role==='assistant').length,2);
 assert.equal((await readdir(parent.getSessionDir())).filter(file=>file.endsWith('.jsonl')).length,6);
});
