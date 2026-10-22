import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { createEventBus } = await jiti.import('@earendil-works/pi-coding-agent');
const { readNativeSubagentRun, nativeSubagentLinks } = await jiti.import('./native-subagent-records.ts');
const { createNativeSubagentBridge, getRunningNativeSubagentIds, hasRunningNativeSubagent, abortNativeSubagent, nativeSubagentStatus, rememberNativeSubagent } = await jiti.import('./native-subagents.ts');
const record = {version:1,sessionId:'child',runId:'r1',parentSessionId:'parent',parentSessionPath:'/p',parentToolCallId:'call',agent:'quick',task:'hello',createdAt:'2026-10-19T00:00:00.000Z',status:'running',sessionPath:'/child',ownerPid:process.pid};
const entry = data => ({type:'custom',customType:'subagent:run',data});
test('native records validate identity and keep latest resume lifecycle', () => {
 assert.equal(readNativeSubagentRun([entry(record)],'child','/real').parentSessionId,'parent');
 assert.equal(readNativeSubagentRun([entry(record)],'foreign','/real'),null);
 assert.equal(readNativeSubagentRun([entry({...record,parentSessionId:'child'})],'child','/real'),null);
 const run = readNativeSubagentRun([entry(record),entry({...record,runId:'r2',status:'failed',error:'no credentials'})],'child','/real');
 assert.equal(run.status,'failed'); assert.equal(run.error,'no credentials'); assert.equal(run.sessionPath,'/real');
});
test('single/parallel/chain native links only accept exact local handles', () => {
 assert.deepEqual(nativeSubagentLinks({results:[{sessionId:'pi:child',agent:'quick',task:'x'},{sessionId:'pi:child',agent:'quick'},{sessionId:'paseo:remote'},{sessionId:'pi:../bad'}]}),[{sessionId:'child',label:'quick'}]);
 assert.deepEqual(nativeSubagentLinks(null),[]);
});
test('a record naming this server without an owned handle is interrupted, not immortal', () => {
 assert.equal(nativeSubagentStatus({...record,sessionId:'orphan'}),'interrupted');
});

test('native activity follows parent links without counting unrelated or settled runs', () => {
 const bus = createEventBus();
 const nestedBus = createEventBus();
 const bridge = createNativeSubagentBridge(bus, ()=>'parent', ()=>{});
 const nestedBridge = createNativeSubagentBridge(nestedBus, ()=>'child', ()=>{});
 try {
  nestedBus.emit('subagent:run',{...record,sessionId:'grandchild',parentSessionId:'child'});
  bus.emit('subagent:run',record);
  assert.equal(hasRunningNativeSubagent('parent'),true);
  assert.equal(hasRunningNativeSubagent('child'),true);
  assert.equal(hasRunningNativeSubagent('unrelated'),false);
  nestedBus.emit('subagent:run',{...record,sessionId:'grandchild',parentSessionId:'child',status:'completed'});
  assert.equal(hasRunningNativeSubagent('child'),false);
  assert.equal(hasRunningNativeSubagent('parent'),true);
  bus.emit('subagent:run',{...record,status:'completed'});
  assert.equal(hasRunningNativeSubagent('parent'),false);
 } finally {
  bridge.dispose(); nestedBridge.dispose();
 }
});

test('owned bridge registers child, aborts through acknowledgement and forgets settled run', async () => {
 const bus = createEventBus();
 const bridge = createNativeSubagentBridge(bus, ()=>'parent', ()=>{});
 bus.emit('subagent:run',{...record,parentSessionId:'foreign'});
 assert.equal(getRunningNativeSubagentIds().includes('child'),false);
 bus.emit('subagent:run',record);
 assert.equal(getRunningNativeSubagentIds().includes('child'),true);
 rememberNativeSubagent({...record,runId:'old'},'/old-catalog-file');
 assert.equal(getRunningNativeSubagentIds().includes('child'),true);
 assert.equal(nativeSubagentStatus({...record,runId:'old',status:'completed'}),'running');
 bus.emit('subagent:run',{...record,runId:'old',status:'completed'});
 assert.equal(getRunningNativeSubagentIds().includes('child'),true);
 let called = 0;
 const off = bus.on('subagent:abort', request => { called++; bus.emit('subagent:run',{...record,status:'aborted'}); request.acknowledge(); });
 await abortNativeSubagent('child');
 assert.equal(called,1); assert.equal(getRunningNativeSubagentIds().includes('child'),false);
 await assert.rejects(abortNativeSubagent('foreign'),/not running/);
 off(); bridge.dispose();
});
