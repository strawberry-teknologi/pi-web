import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { parseSubagentModelChain: parse, serializeSubagentModelChain: serialize, addSubagentTool, getSubagentThinkingLevels, findSubagentModel } = await jiti.import('./subagent-profile-fields.ts');

test('chains preserve references and only parse known final thinking suffixes', () => {
 assert.deepEqual(parse(), []); assert.deepEqual(parse(''), []); assert.equal(serialize([]), undefined);
 assert.deepEqual(parse(' pi/provider/nested/model:high, other/model:max '), [{reference:'pi/provider/nested/model',thinking:'high'},{reference:'other/model',thinking:'max'}]);
 assert.deepEqual(parse('bare, p/model:custom, p/model:custom:high'), [{reference:'bare'},{reference:'p/model:custom'},{reference:'p/model:custom',thinking:'high'}]);
 for (const level of ['off','minimal','low','medium','high','xhigh','max']) assert.equal(serialize(parse(`p/a:${level}`)), `p/a:${level}`);
});
test('order and duplicate occurrences survive without mutating input', () => {
 const targets = parse('p/a:low, p/a:high'); const snapshot = structuredClone(targets);
 assert.equal(serialize(targets.slice(1)), 'p/a:high');
 assert.equal(serialize([...targets].reverse()), 'p/a:high, p/a:low');
 assert.deepEqual(targets, snapshot);
});
test('missing qualified references never match another provider’s nested ID', () => {
 const catalog = {modelList:[{provider:'relay',id:'vendor/missing'}],thinkingLevels:{'relay:vendor/missing':['low']}};
 assert.equal(findSubagentModel('vendor/missing',catalog),undefined);
 assert.equal(findSubagentModel('pi/vendor/missing',catalog),undefined);
 assert.equal(findSubagentModel('relay/vendor/missing',catalog),catalog.modelList[0]);
 assert.equal(getSubagentThinkingLevels({reference:'vendor/missing'},catalog).length,7);
});
test('custom tools trim additions, reject separators, preserve selection and deduplicate', () => {
 const tools = ['read','other'];
 assert.deepEqual(addSubagentTool(tools,' custom_tool '), ['read','other','custom_tool']);
 assert.deepEqual(addSubagentTool(tools,'read'), tools); assert.deepEqual(tools,['read','other']);
 for (const name of [' ', 'read,bash']) assert.throws(()=>addSubagentTool(tools,name));
});
test('thinking choices use physical model metadata, retain saved levels and respect empty arrays', () => {
 const catalog = { modelList:[{provider:'p',id:'a'},{provider:'q',id:'a'},{provider:'p',id:'b'}], thinkingLevels:{'p:a':['low','high'],'q:a':[]}};
 assert.deepEqual(getSubagentThinkingLevels({reference:'pi/p/a'},catalog), ['low','high']);
 assert.deepEqual(getSubagentThinkingLevels({reference:'q/a',thinking:'max'},catalog), ['max']);
 assert.deepEqual(getSubagentThinkingLevels({reference:'q/a'},catalog), []);
 assert.equal(getSubagentThinkingLevels({reference:'p/b'},catalog).length, 7);
 assert.equal(getSubagentThinkingLevels({reference:'a'},catalog).length, 7, 'ambiguous bare model does not guess a provider');
 assert.deepEqual(getSubagentThinkingLevels({reference:'p/a',thinking:'max'},catalog), ['low','high','max']);
});
