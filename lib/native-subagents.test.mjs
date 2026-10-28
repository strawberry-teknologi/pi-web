import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createEventBus, SessionManager } = await jiti.import('@earendil-works/pi-coding-agent');
const { readNativeSubagentRun, readNativeSubagentTask, nativeSubagentLinks } = await jiti.import('./native-subagent-records.ts');
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
const taskInfo = { version: 1, sessionId: 'child', runId: 'r1', task: 'Full task\n  🧭', instructions: 'Extra guidance\n  <text>' };
const taskEntry = data => ({ type: 'custom', customType: 'subagent:task', data });

test('current task snapshot preserves full text and only exposes the agreed fields', () => {
 const full = { ...taskInfo, task: 'line 🧭\n  '.repeat(16000), instructions: 'extra\n🧭 '.repeat(16000) };
 const entries = [entry(record), taskEntry({ ...full, systemPrompt: 'private profile text' }), entry({ ...record, status: 'completed' })];
 assert.deepEqual(readNativeSubagentTask(entries, 'child'), full);
 assert.equal(readNativeSubagentRun(entries, 'child', '/real').taskInfo, undefined);
});

test('task snapshots require a valid matching lifecycle and well-typed fields', () => {
 assert.equal(readNativeSubagentTask([], 'child'), null);
 assert.equal(readNativeSubagentTask([taskEntry(taskInfo)], 'child'), null);
 assert.equal(readNativeSubagentTask([entry(record)], 'child'), null);
 assert.equal(readNativeSubagentTask([entry(record), taskEntry(taskInfo)], 'foreign'), null);
 for (const invalid of [null, [], { ...taskInfo, version: 2 }, { ...taskInfo, sessionId: 'other' }, { ...taskInfo, sessionId: '' }, { ...taskInfo, runId: 'other' }, { ...taskInfo, runId: '' }, { ...taskInfo, task: null }, { ...taskInfo, task: 1 }, { ...taskInfo, instructions: null }, { ...taskInfo, instructions: [] }]) {
  assert.equal(readNativeSubagentTask([entry(record), taskEntry(invalid)], 'child'), null, JSON.stringify(invalid));
 }
 const withoutInstructions = { version: 1, sessionId: 'child', runId: 'r1', task: 'Full task\n  🧭' };
 assert.deepEqual(readNativeSubagentTask([entry(record), taskEntry(withoutInstructions)], 'child'), withoutInstructions);
 assert.deepEqual(readNativeSubagentTask([entry(record), taskEntry({ ...taskInfo, task: '', instructions: '' })], 'child'), { ...taskInfo, task: '', instructions: '' });
});

test('same-child resume never inherits an older run snapshot or instructions', () => {
 const entries = [entry(record), taskEntry(taskInfo), entry({ ...record, runId: 'r2' })];
 assert.equal(readNativeSubagentTask(entries, 'child'), null);
 entries.push(taskEntry({ ...taskInfo, runId: 'r2', instructions: 42 }));
 assert.equal(readNativeSubagentTask(entries, 'child'), null);
 const current = { version: 1, sessionId: 'child', runId: 'r2', task: 'New task' };
 entries.push(taskEntry(current), entry({ ...record, runId: 'r2', status: 'failed' }));
 assert.deepEqual(readNativeSubagentTask(entries, 'child'), current);
});

test('task reader uses supplied active branch, never an abandoned snapshot', () => {
 const manager = SessionManager.inMemory();
 const start = manager.appendCustomEntry('subagent:run', record);
 manager.appendCustomEntry('subagent:task', taskInfo);
 manager.branch(start);
 manager.appendCustomEntry('subagent:run', { ...record, status: 'completed' });
 assert.deepEqual(readNativeSubagentTask(manager.getEntries(), 'child'), taskInfo);
 assert.equal(readNativeSubagentTask(manager.getBranch(), 'child'), null);
});

test('detail GET uses native active branch, stays read-only and compresses full task data', async () => {
 const { cacheSessionPath, invalidateSessionManagerCache } = await jiti.import('./session-reader.ts');
 const { getSubagentRun, getRpcSession } = await jiti.import('./rpc-manager.ts');
 const { GET, POST } = await jiti.import('../app/api/subagents/[id]/route.ts');
 const root = await mkdtemp(join(tmpdir(), 'native-detail-'));
 const manager = SessionManager.create(root, root);
 const id = manager.getSessionId();
 const file = manager.getSessionFile();
 const lifecycle = { ...record, sessionId: id, sessionPath: file, status: 'completed' };
 const full = { ...taskInfo, sessionId: id, task: 'Task\n🧭 '.repeat(16000) };
 const persist = async () => {
  await writeFile(file, [manager.getHeader(), ...manager.getEntries()].map(value => JSON.stringify(value)).join('\n') + '\n');
  manager.setSessionFile(file);
  cacheSessionPath(id, file);
  invalidateSessionManagerCache(file);
 };
 try {
  const first = manager.appendCustomEntry('subagent:run', lifecycle);
  manager.appendCustomEntry('subagent:task', full);
  await persist();
  const before = await readFile(file, 'utf8');
  assert.deepEqual((await getSubagentRun(id)).taskInfo, full);
  const response = await GET(new Request('http://localhost/api/subagents/' + id, { headers: { 'Accept-Encoding': 'gzip' } }), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Encoding'), 'gzip');
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).run.taskInfo, full);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal(getRpcSession(id), undefined);
  manager.branch(first);
  manager.appendCustomEntry('subagent:run', { ...lifecycle, runId: 'current', task: 'Current', status: 'failed' });
  await persist();
  const current = await getSubagentRun(id);
  assert.equal(current.task, 'Current');
  assert.equal(current.status, 'failed');
  assert.equal(current.taskInfo, undefined);
  manager.appendCustomEntry('subagent:task', { ...full, runId: 'current', instructions: 42 });
  await persist();
  assert.equal((await getSubagentRun(id)).taskInfo, undefined);
  manager.branch(first);
  manager.appendCustomEntry('subagent:run', { ...lifecycle, task: 'Original active run' });
  await persist();
  assert.equal((await getSubagentRun(id)).task, 'Original active run');
  assert.equal((await getSubagentRun(id)).taskInfo, undefined);
  // An ordinary branch must not inherit abandoned native metadata.
  manager.resetLeaf();
  manager.appendMessage({ role: 'user', content: 'Ordinary branch', timestamp: Date.now() });
  await persist();
  assert.equal(await getSubagentRun(id), null);
  assert.equal((await GET(new Request('http://localhost'), { params: Promise.resolve({ id }) })).status, 404);
  assert.equal((await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ action: 'steer', message: 'hello' }) }), { params: Promise.resolve({ id }) })).status, 409);
  // Historical integrated records retain their existing all-entry selection.
  const legacy = SessionManager.create(root, root);
  const legacyId = legacy.getSessionId();
  legacy.appendCustomEntry('pi-web:subagent', { version: 1, parentSessionId: 'parent', parentSessionPath: '/parent', parentToolCallId: 'call', profile: 'old', description: 'old', task: 'Unsplit historical task', createdAt: record.createdAt, runInBackground: false });
  legacy.appendCustomEntry('pi-web:subagent-result', { version: 1, status: 'completed' });
  legacy.resetLeaf();
  legacy.appendMessage({ role: 'user', content: 'Later branch', timestamp: Date.now() });
  const legacyFile = legacy.getSessionFile();
  await writeFile(legacyFile, [legacy.getHeader(), ...legacy.getEntries()].map(value => JSON.stringify(value)).join('\n') + '\n');
  cacheSessionPath(legacyId, legacyFile);
  const historical = await getSubagentRun(legacyId);
  assert.equal(historical.task, 'Unsplit historical task');
  assert.equal(historical.status, 'completed');
  assert.equal(historical.taskInfo, undefined);
 } finally {
  invalidateSessionManagerCache();
  await rm(root, { recursive: true, force: true });
 }
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
