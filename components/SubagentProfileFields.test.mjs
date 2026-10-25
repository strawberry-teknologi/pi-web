import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { tsconfigPaths:true, jsx:{runtime:'automatic'} });
const { SubagentProfileFields } = await jiti.import('./SubagentProfileFields.tsx');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
function render(model, tools=[]) { return renderToStaticMarkup(createElement(I18nProvider,null,createElement(SubagentProfileFields,{cwd:'/fixture',model,tools,onModelChange(){},onToolsChange(){}}))); }
test('fallback rows preserve duplicate occurrences and expose labelled controls',()=>{
 const html = render('p/a:low, p/a:high', ['read','custom_tool']);
 assert.equal((html.match(/class="agents-model-row"/g)??[]).length,2);
 assert.match(html,/Thinking for target 1/); assert.match(html,/Thinking for target 2/);
 assert.match(html,/Move target 1 up/); assert.match(html,/Remove target 2/);
 assert.match(html,/custom_tool/); assert.match(html,/Filter tools/);
 assert.match(html,/Custom model reference/); assert.match(html,/Filter models/);
});
test('empty selections explain parent inheritance and CLI default tools',()=>{
 const html = render(undefined);
 assert.match(html,/Parent default/); assert.match(html,/Pi’s default tools/);
 assert.doesNotMatch(html,/Max turns|Inherit parent context|Run in background/);
});
