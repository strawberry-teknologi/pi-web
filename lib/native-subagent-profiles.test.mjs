import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const {listNativeSubagentProfiles,saveNativeSubagentProfile,deleteNativeSubagentProfile} = await jiti.import('./native-subagent-profiles.ts');
test('native profile discovery has no built-ins and saves only supported fields losslessly',()=>{
 const root = mkdtempSync(join(tmpdir(),'native-profiles-')); const previous = process.env.PI_CODING_AGENT_DIR;
 process.env.PI_CODING_AGENT_DIR=join(root,'agent');
 try {
  const dir=join(root,'agent','agents');mkdirSync(dir,{recursive:true});
  const file=join(dir,'different-filename.md');
  writeFileSync(file,'---\nname: quick\ndescription: Fast\nmodel: provider/a:high, provider/b:max\ntools: [read, custom_tool]\nskills: [review]\nload_extensions: true\nunknown: keep\nenabled: false\n---\nPrompt');
  const profiles=listNativeSubagentProfiles(root,new Set([root]));
  assert.deepEqual(profiles.map(p=>p.name),['quick']);
  assert.equal(profiles[0].enabled,true);
  saveNativeSubagentProfile(root,'global',{...profiles[0],description:'Updated',loadExtensions:false},new Set([root]));
  const content=readFileSync(file,'utf8');
  assert.match(content,/provider\/a:high, provider\/b:max/);assert.match(content,/unknown: keep/);
  assert.match(content,/load_extensions: true/);assert.match(content,/enabled: false/);assert.match(content,/custom_tool/);
  deleteNativeSubagentProfile(root,'global','quick',new Set([root]));
  assert.deepEqual(listNativeSubagentProfiles(root,new Set([root])),[]);
 } finally {if(previous===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous;rmSync(root,{recursive:true,force:true});}
});
test('nearest project directory is read safely and rejects escaping links on write',()=>{
 const root=mkdtempSync(join(tmpdir(),'native-project-'));const outside=mkdtempSync(join(tmpdir(),'native-out-'));
 try {
  const dir=join(root,'.pi','agents');mkdirSync(dir,{recursive:true});mkdirSync(join(root,'src'));
  writeFileSync(join(dir,'plan.md'),'---\nname: plan\ndescription: Project plan\n---\nPlan');
  assert.equal(listNativeSubagentProfiles(join(root,'src'),new Set([root])).filter(p=>p.scope==='project')[0].name,'plan');
  symlinkSync(join(outside,'escape.md'),join(dir,'escape.md'));
  assert.throws(()=>saveNativeSubagentProfile(root,'project',{name:'escape',description:'no',systemPrompt:'no',tools:[]},new Set([root])),/outside|denied|link/i);
  assert.throws(()=>saveNativeSubagentProfile(root,'project',{name:'../escape',description:'no',systemPrompt:'no',tools:[]},new Set([root])),/name/i);
 } finally {rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
