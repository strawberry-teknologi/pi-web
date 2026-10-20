import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
const source=await readFile(new URL('./AgentsConfig.tsx',import.meta.url),'utf8');
test('native profile draft keeps tools and the whole fallback model reference',()=>{
 const declaration=source.slice(source.indexOf('function editableProfile('),source.indexOf('function profileKey('));
 const code=ts.transpileModule(declaration,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const editable=vm.runInNewContext(`${code}; editableProfile`);
 const tools=['read','custom_tool'];
 const draft=editable({name:'quick',description:'fast',systemPrompt:'prompt',tools,model:'first/a:high, second/b:max'});
 assert.equal(draft.model,'first/a:high, second/b:max');
 draft.tools.push('bash');assert.equal(tools.length,2);
 assert.equal('loadExtensions' in draft,false);
});
test('native settings do not offer unsupported built-in policies',()=>{
 for (const obsolete of ['toggleBuiltInSubagents','toggleEnabled','updateMaxConcurrent','ModelSelector','agents.maxTurns','agents.inheritContext','agents.background','agents.mcp','agents.codemode']) assert.equal(source.includes(obsolete),false,obsolete);
 assert.ok(source.includes('agents.extensionDescription'));
 assert.ok(source.includes('agents.extensionMissing'));
});
