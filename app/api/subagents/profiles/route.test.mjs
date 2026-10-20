import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti=createJiti(import.meta.url,{alias:{'@':process.cwd()},interopDefault:true,moduleCache:false});
const {GET,PUT,PATCH,DELETE}=await jiti.import('./route.ts');
const {allowFileRoot}=await jiti.import('../../../../lib/file-access.ts');
const request=(method,body,headers={Host:'localhost','Content-Type':'application/json'})=>new Request('http://localhost/api/subagents/profiles',{method,headers,body:JSON.stringify(body)});
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'native-profile-route-'));const previous=process.env.PI_CODING_AGENT_DIR;
 process.env.PI_CODING_AGENT_DIR=join(root,'agent');await mkdir(join(root,'agent'),{recursive:true});
 const cwd=join(root,'project');await mkdir(cwd);allowFileRoot(cwd);
 t.after(async()=>{if(previous===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous;await rm(root,{recursive:true,force:true});});
 return {root,cwd};
}
const profile={name:'quick',description:'Fast',tools:['read','custom_tool'],systemPrompt:'Work',model:'first/a:high, second/b:max'};
test('native profile routes expose no built-ins and preserve foreign frontmatter on saves',async t=>{
 const {cwd}=await fixture(t);
 let response=await GET(new Request(`http://localhost/api/subagents/profiles?cwd=${encodeURIComponent(cwd)}`));
 assert.deepEqual((await response.json()).profiles,[]);
 response=await PUT(request('PUT',{cwd,scope:'project',profile}));assert.equal(response.status,200);
 const saved=(await response.json()).profile;assert.equal(saved.model,profile.model);
 const file=saved.filePath;
 await writeFile(file,(await readFile(file,'utf8')).replace('name: quick','foreign: keep\nload_extensions: true\nname: quick'));
 response=await PUT(request('PUT',{cwd,scope:'project',profile:{...profile,description:'Updated',loadExtensions:false}}));assert.equal(response.status,200);
 const text=await readFile(file,'utf8');assert.match(text,/foreign: keep/);assert.match(text,/load_extensions: true/);assert.match(text,/first\/a:high, second\/b:max/);
 assert.equal((await PATCH(request('PATCH',{cwd,scope:'project',name:'quick',enabled:false}))).status,410);
 response=await DELETE(request('DELETE',{cwd,scope:'project',name:'quick'}));assert.equal(response.status,200);assert.equal(existsSync(file),false);
});
test('native routes enforce scopes, names, tools, cwd access and request trust',async t=>{
 const {cwd,root}=await fixture(t);
 for(const body of [
  {cwd,scope:'builtin',profile},
  {cwd,scope:'project',profile:{...profile,name:'../escape'}},
  {cwd,scope:'project',profile:{...profile,tools:[42]}},
  {cwd:root,scope:'project',profile},
 ])assert.ok([400,403].includes((await PUT(request('PUT',body))).status));
 assert.equal((await PUT(request('PUT',{cwd,scope:'project',profile},{Host:'evil.test','Content-Type':'application/json'}))).status,403);
 assert.equal((await PUT(request('PUT',{cwd,scope:'project',profile},{Host:'localhost','Content-Type':'text/plain'}))).status,415);
 const dir=join(cwd,'.pi','agents');await mkdir(dir,{recursive:true});
 await symlink(join(root,'escape.md'),join(dir,'quick.md'));
 const response=await PUT(request('PUT',{cwd,scope:'project',profile}));assert.equal(response.status,400);assert.equal(existsSync(join(root,'escape.md')),false);
});
