import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function checkSubagentProfiles(page, { base, project, artifacts }) {
  const original = ' p/a:low , p/a:high, offline/nested:model:max, bare ';
  let profile = { name:'editor-fixture', description:'Fixture', systemPrompt:'Do work', tools:['read','custom_tool'], model:original, scope:'global', filePath:'/fixture/editor-fixture.md' };
  let payload;
  let modelError = false;
  let brokenCatalog = false;
  let delayCatalog = false;
  let pendingCatalog;
  let notifyPending;
  const catalogPending = new Promise(resolve => { notifyPending = resolve; });
  const profilesRoute = '**/api/subagents/profiles*';
  const modelRoute = /\/api\/models(?:\?|$)/;
  const models = [{provider:'p',id:'a',name:'Model A'}, {provider:'q',id:'a',name:'Model A'}, {provider:'r',id:'b',name:'Model B'}, {provider:'subagent',id:'router',name:'Router',isVirtual:true}];
  const catalog = () => ({models:{},modelList:models,defaultModel:{provider:'p',modelId:'a'},defaultThinkingLevel:'medium',savedDefaultThinkingLevel:null,thinkingLevels:{'p:a':['low','high'],'q:a':[]},thinkingLevelMaps:{},thinkingLevelPins:{},...(modelError?{modelError:'Fixture catalog warning'}:{})});
  await page.route(profilesRoute, route => {
    if (route.request().method() === 'PUT') { payload = route.request().postDataJSON(); profile = {...profile,...payload.profile}; if (!('model' in payload.profile)) delete profile.model; return route.fulfill({json:{profile}}); }
    return route.fulfill({json:{profiles:[profile]}});
  });
  await page.route('**/api/subagents/settings*', route=>route.fulfill({json:{implementation:'extension',loaded:true}}));
  await page.route(modelRoute, route => {
    if (delayCatalog) { pendingCatalog=route; notifyPending(); return; }
    if (brokenCatalog) return route.fulfill({contentType:'application/json',body:'{'});
    return route.fulfill({json:catalog()});
  });
  const settings = page.getByRole('dialog',{name:'Settings',exact:true});
  const open = async () => {
    await page.locator('.sidebar-container:not(.sidebar-mobile-pending)').waitFor({state:'attached'});
    const sidebar = page.getByRole('button',{name:'Show sidebar',exact:true});
    if(await sidebar.isVisible()) await sidebar.click();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    const section = settings.getByRole('combobox',{name:'Settings',exact:true});
    if(await section.isVisible()) await section.selectOption('agents');
    else await settings.getByRole('button',{name:'Sub-agents',exact:true}).click();
    await settings.getByRole('textbox',{name:'Description',exact:true}).waitFor();
  };
  const rows = settings.locator('.agents-model-row');
  const save = async () => {
    await settings.getByRole('button',{name:'Save',exact:true}).click();
    await settings.getByRole('button',{name:'Saved',exact:true}).waitFor();
  };
  const chooseModels = async () => {
    const summary = settings.locator('.agents-model-picker > summary');
    if (!(await settings.locator('.agents-model-picker').getAttribute('open') !== null)) await summary.click();
    await settings.getByRole('textbox',{name:'Filter models',exact:true}).waitFor();
  };
  try {
    await page.goto(`${base}/?cwd=${encodeURIComponent(project)}`,{waitUntil:'domcontentloaded'});
    await open();
    await settings.getByRole('textbox',{name:'Description',exact:true}).fill('Updated');
    await save(); assert.equal(payload.profile.model,original,'unrelated save preserves raw model text');
    assert.deepEqual(payload.profile.tools,['read','custom_tool']);
    assert.equal(await rows.count(),4);
    assert.equal(await settings.locator('.agents-model-chain').evaluate(list=>getComputedStyle(list).listStyleType),'decimal','fallback priority is visibly numbered');
    assert.deepEqual(await rows.nth(0).locator('select option').allTextContents(),['Inherit','low','high']);
    await rows.nth(0).getByRole('button',{name:'Remove target 1',exact:true}).click();
    assert.equal(await rows.count(),3); assert.equal(await rows.nth(0).locator('select').inputValue(),'high');
    await chooseModels();
    assert.equal(await settings.getByRole('checkbox',{name:'subagent/router',exact:true}).count(),0);
    await settings.getByRole('checkbox',{name:'q/a',exact:true}).check();
    assert.deepEqual(await rows.last().locator('select option').allTextContents(),['Inherit']);
    await settings.getByRole('checkbox',{name:'r/b',exact:true}).check();
    await rows.last().locator('select').selectOption('max');
    await rows.last().getByRole('button',{name:'Move target 5 up',exact:true}).click();
    await settings.getByRole('textbox',{name:'Filter models',exact:true}).press('Escape');
    assert.equal(await settings.locator('.agents-model-picker').getAttribute('open'),null);
    assert.equal(await settings.isVisible(),true);
    await save(); assert.equal(payload.profile.model,'p/a:high, offline/nested:model:max, bare, r/b:max, q/a');
    await settings.getByRole('button',{name:'Close',exact:true}).click(); await open();
    assert.equal(await rows.count(),5);
    const customModel=settings.getByRole('textbox',{name:'Custom model reference',exact:true});
    await customModel.fill('subagent/router'); await settings.getByRole('button',{name:'Add model',exact:true}).click();
    await settings.getByText('Choose a physical model, not a virtual router.',{exact:true}).waitFor();
    await customModel.fill('custom/new:high'); await settings.getByRole('button',{name:'Add model',exact:true}).click();
    assert.equal(await rows.count(),6);
    const toolFilter=settings.getByRole('textbox',{name:'Filter tools',exact:true});
    const customTool=settings.getByRole('textbox',{name:'Custom tool name',exact:true});
    await customTool.fill('bad,name'); await settings.getByRole('button',{name:'Add tool',exact:true}).click();
    await settings.getByText('Enter one non-empty tool name without commas.',{exact:true}).waitFor();
    await customTool.fill(' new_tool '); await settings.getByRole('button',{name:'Add tool',exact:true}).click();
    await toolFilter.fill('new_tool'); await settings.getByRole('checkbox',{name:'new_tool',exact:true}).uncheck();
    assert.equal(await settings.getByRole('checkbox',{name:'new_tool',exact:true}).count(),1,'unchecked custom names remain reselectable');
    await toolFilter.fill(''); await save(); assert.deepEqual(payload.profile.tools,['read','custom_tool']);
    if(artifacts) await page.screenshot({path:join(artifacts,`subagent-profiles-populated-${page.viewportSize().width}.png`)});
    while(await rows.count()) await rows.first().getByRole('button',{name:'Remove target 1',exact:true}).click();
    await settings.getByRole('checkbox',{name:'read',exact:true}).uncheck(); await settings.getByRole('checkbox',{name:'custom_tool',exact:true}).uncheck();
    await save(); assert.equal('model' in payload.profile,false); assert.deepEqual(payload.profile.tools,[]);
    await settings.getByRole('button',{name:'Close',exact:true}).click();
    modelError=true; await open(); await settings.getByText('Fixture catalog warning',{exact:true}).waitFor();
    await customModel.fill('offline/usable'); await settings.getByRole('button',{name:'Add model',exact:true}).click(); await save();
    assert.equal(payload.profile.model,'offline/usable');
    const bounds=await settings.locator('.agents-profile-fields').boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=page.viewportSize().width,'fields stay inside viewport');
    if(artifacts) await page.screenshot({path:join(artifacts,`subagent-profiles-${page.viewportSize().width}.png`)});
    await settings.getByRole('button',{name:'Close',exact:true}).click();
    profile={...profile,model:'q/a:max'}; await open();
    assert.deepEqual(await rows.first().locator('select option').allTextContents(),['Inherit','max'],'saved thinking survives an empty supported array');
    await settings.getByRole('textbox',{name:'Description',exact:true}).fill('Saved suffix'); await save();
    assert.equal(payload.profile.model,'q/a:max');
    await settings.getByRole('button',{name:'Close',exact:true}).click();
    brokenCatalog=true; await open();
    await settings.getByText('Could not load models. Existing selections are kept; you can add a custom reference.',{exact:true}).waitFor();
    await customModel.fill('fallback/manual'); await settings.getByRole('button',{name:'Add model',exact:true}).click(); await save();
    assert.equal(payload.profile.model,'q/a:max, fallback/manual');
    await settings.getByRole('button',{name:'Close',exact:true}).click();
    brokenCatalog=false; delayCatalog=true; await open(); await catalogPending;
    await settings.getByText('Loading models...',{exact:true}).waitFor();
    await settings.getByRole('button',{name:'Close',exact:true}).click();
    delayCatalog=false; modelError=false; await open(); await chooseModels();
    await settings.getByRole('checkbox',{name:'p/a',exact:true}).waitFor();
    await pendingCatalog.fulfill({json:{...catalog(),modelList:[{provider:'old',id:'stale',name:'Stale'}]}}).catch(()=>{});
    assert.equal(await settings.getByRole('checkbox',{name:'old/stale',exact:true}).count(),0,'aborted previous editor request cannot replace the current catalog');
    assert.equal(await settings.getByRole('checkbox',{name:'p/a',exact:true}).count(),1);
    assert.equal(await rows.count(),2,'loading or stale results do not reset the draft');
    await settings.getByRole('button',{name:'Close',exact:true}).click();
    console.log(`PASS: ${page.viewportSize().width}px ordered subagent models, dynamic thinking, custom tools, save/reopen and catalog warnings`);
  } finally {
    await page.unroute(profilesRoute); await page.unroute(modelRoute); await page.unroute('**/api/subagents/settings*');
  }
}
