import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
const extensionPath=process.env.PI_WEB_SUBAGENT_EXTENSION_TEST_PATH;
const jiti=createJiti(import.meta.url,{interopDefault:true,moduleCache:false});
const {SessionManager,createEventBus}=await jiti.import('@earendil-works/pi-coding-agent');
const {createNativeSubagentBridge,getRunningNativeSubagentIds}=await jiti.import('./native-subagents.ts');
const {listAllSessions,openSessionManager,buildSessionContext,invalidateSessionListCache}=await jiti.import('./session-reader.ts');
const {listSessionFamilies}=await jiti.import('./session-family.ts');
const {resetSessionScanIndexForTests}=await jiti.import('./session-list-scanner.ts');
const {readNativeSubagentRecord,readNativeSubagentTask}=await jiti.import('./native-subagent-records.ts');

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
const appendIndex=args.indexOf('--append-system-prompt');
const appendPrompt=appendIndex<0?undefined:fs.readFileSync(args[appendIndex+1],'utf8');
const entries=fs.readFileSync(file,'utf8').trim().split('\\n').map(JSON.parse);
fs.appendFileSync(${JSON.stringify(join(root,'calls.jsonl'))},JSON.stringify({args,appendPrompt,entries})+'\\n');
if(args.at(-1).startsWith('Task: fail early')){console.error('Early CLI failure (fixture)');process.exit(7);}
const now=Date.now(), u={type:'message',id:crypto.randomUUID(),parentId:entries.at(-1).id,timestamp:new Date(now).toISOString(),message:{role:'user',content:args.at(-1),timestamp:now}};
const message={role:'assistant',content:[{type:'text',text:'fixture done'}],timestamp:now,stopReason:'stop'};
fs.appendFileSync(file,JSON.stringify(u)+'\\n'+JSON.stringify({type:'message',id:crypto.randomUUID(),parentId:u.id,timestamp:u.timestamp,message})+'\\n');
console.log(JSON.stringify({type:'message_end',message}));
`);
 await chmod(fake,0o755);process.env.PATH=`${join(root,'bin')}:${previous.PATH}`;
 const parent=SessionManager.create(join(root,'work'));
 parent.appendMessage({role:'user',content:'Delegate fixtures',timestamp:Date.now()});
 const bus=createEventBus();const bridge=createNativeSubagentBridge(bus,()=>parent.getSessionId(),invalidateSessionListCache);
 const lifecycleEvents=[];bus.on('subagent:run',record=>lifecycleEvents.push(record));
 const commands=new Map();
 const planMode=await jiti.import(resolve(dirname(extensionPath),'../plan-mode/index.ts'));
 planMode.default({events:bus,on(){},appendEntry(type,data){parent.appendCustomEntry(type,data);},registerCommand(name,command){commands.set(name,command);}});
 const togglePlan=()=>commands.get('plan').handler('',{isIdle:()=>true,hasUI:false,ui:{setStatus(){}}});
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
 async function run(params,call,failed=false){
  const original=structuredClone(params);
  const result=await tool.execute(call,params,undefined,()=>{},context);
  assert.deepEqual(params,original,'public caller input must remain unchanged');
  assert.equal(result.isError===true,failed,JSON.stringify(result.content));
  for(const item of result.details.results){
   assert.ok(!item.task.includes('Planning document location'));
   assert.ok(!item.task.includes('!!! PLAN MODE'));
   assert.equal(item.instructions,undefined);
  }
  parent.appendMessage({role:'toolResult',toolName:'subagent',toolCallId:call,content:result.content,details:result.details,isError:failed,timestamp:Date.now()});
  invalidateSessionListCache();return result;
 }
 const single=await run({agent:'quick',task:'one'},'single');
 const id=single.details.results[0].sessionId.slice(3);
 const firstManager=openSessionManager(lifecycleEvents[0].sessionPath);
 const firstTask=readNativeSubagentTask(firstManager.getBranch(),id);
 assert.equal(firstTask.task,'one');
 assert.match(firstTask.instructions,/Planning document location/);
 assert.ok(!firstTask.instructions.includes('No providers.'));
 await togglePlan();
 await run({agent:'quick',task:'again',resume:`pi:${id}`},'resume');
 const resumed=readNativeSubagentTask(openSessionManager(lifecycleEvents[0].sessionPath).getBranch(),id);
 assert.notEqual(resumed.runId,firstTask.runId);
 assert.equal(resumed.task,'again');
 assert.match(resumed.instructions,/!!! PLAN MODE/);
 await togglePlan();
 await run({tasks:[{agent:'quick',task:'parallel1'},{agent:'quick',task:'parallel2'}]},'parallel');
 await run({chain:[{agent:'quick',task:'first'},{agent:'quick',task:'after {previous}'}]},'chain');
 const largeTask='fail early\n'+ '  line 🧭 <markup>\n'.repeat(6500);
 assert.ok(Buffer.byteLength(largeTask)>100*1024);
 const failure=await run({agent:'quick',task:largeTask},'early-failure',true);
 const failedId=failure.details.results[0].sessionId.slice(3);
 const calls=(await readFile(join(root,'calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(calls.map(call=>call.args.at(-1)).sort(),['one','again','parallel1','parallel2','first','after fixture done',largeTask].map(task=>'Task: '+task).sort());
 for(const call of calls){
  assert.match(call.appendPrompt,/No providers\./);
  assert.match(call.appendPrompt,/Planning document location/);
  assert.equal(call.appendPrompt.includes('!!! PLAN MODE'),call.args.at(-1)==='Task: again');
  const header=call.entries[0];
  const snapshot=readNativeSubagentTask(call.entries.slice(1),header.id);
  assert.equal(snapshot.task,call.args.at(-1).slice(6));
  assert.ok(!snapshot.instructions.includes('No providers.'));
  assert.ok(call.appendPrompt.endsWith(snapshot.instructions));
  assert.equal(call.entries[1].customType,'subagent:run');
  assert.ok(call.entries[1].data.task.length<=4096);
 }
 assert.ok(lifecycleEvents.every(event=>event.task.length<=4096&&!('instructions' in event)&&!('taskInfo' in event)));
 const sessions=await listAllSessions({force:true});
 const families=listSessionFamilies(sessions);
 assert.equal(families.length,1);assert.equal(families[0].root.id,parent.getSessionId());assert.equal(families[0].subagents.length,6);
 assert.ok(families[0].subagents.every(session=>session.relation.status===(session.id===failedId?'failed':'completed')));
 for(const session of families[0].subagents){
  assert.ok(session.relation.description.length<=120);
  assert.ok(!JSON.stringify(session.relation).includes('Planning document location'));
  assert.ok(!JSON.stringify(session.relation).includes('!!! PLAN MODE'));
  assert.equal(session.relation.taskInfo,undefined);
 }
 const failed=sessions.find(session=>session.id===failedId);
 const failedManager=openSessionManager(failed.path);
 const failedSnapshot=readNativeSubagentTask(failedManager.getBranch(),failedId);
 assert.equal(failedSnapshot.task,largeTask);
 assert.match(failedSnapshot.instructions,/Planning document location/);
 assert.equal(readNativeSubagentRecord(failedManager.getBranch(),failedId).status,'failed');
 assert.equal(failedManager.getBranch().filter(entry=>entry.type==='message'&&entry.message.role==='assistant').length,0);
 assert.deepEqual(getRunningNativeSubagentIds(),[]);
 const child=sessions.find(session=>session.id===id);
 const manager=openSessionManager(child.path);
 const contextRead=buildSessionContext(manager.getEntries(),manager.getLeafId());
 assert.equal(contextRead.messages.filter(message=>message.role==='assistant').length,2);
 assert.equal((await readdir(parent.getSessionDir())).filter(file=>file.endsWith('.jsonl')).length,7);
});
