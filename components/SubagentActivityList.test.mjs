import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { SubagentActivityList } = await jiti.import("./SubagentActivityList.tsx");
const render = (activities) => renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(SubagentActivityList, { activities })));

test("the timeline shows the eight newest activities first and keeps error output readable", () => {
  const activities = Array.from({ length: 10 }, (_, index) => ({ id: `tool:${index}`, toolName: "read", preview: `file-${index}.ts`, isError: false }));
  activities[9] = { ...activities[9], timestamp: Date.parse("2026-10-01T12:00:00Z"), output: "Missing file", isError: true };
  const html = render(activities);
  assert.equal((html.match(/<li /g) ?? []).length, 8);
  assert.doesNotMatch(html, /file-0\.ts|file-1\.ts/);
  assert.ok(html.indexOf("file-9.ts") < html.indexOf("file-2.ts"));
  assert.match(html, /Missing file/);
  assert.match(html, /Failed/);
  assert.match(html, /dateTime="2026-10-01T12:00:00.000Z"/);
});

test("each activity has its own initially collapsed disclosure with complete entry text", () => {
  const html = render([
    {
      id: "tool:long", toolName: "bash", preview: "Long command", output: "Short result", isError: false,
      details: { input: '{\n  "command": "echo full input"\n}', output: "First line\n  Indented line\nFull output tail" },
    },
    {
      id: "assistant", preview: "Short update", isError: false,
      details: { output: "Full assistant update\nFinal conclusion" },
    },
  ]);
  assert.equal((html.match(/<details[ >]/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|[ >])/);
  const summaries = [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((match) => match[1]);
  assert.match(summaries[0], /Short update/);
  assert.match(summaries[1], /bash/);
  assert.doesNotMatch(summaries.join(""), /Full output tail|Final conclusion|full input/);
  assert.match(html, /echo full input/);
  assert.match(html, /First line\n  Indented line\nFull output tail/);
  assert.match(html, /Full assistant update\nFinal conclusion/);
  assert.match(html, /white-space:pre-wrap/);
});

test("only the actual first non-error assistant receives the latest marker", () => {
  const assistant = { id: "assistant", preview: "Recorded prose", isError: false };
  const tool = { id: "tool", toolName: "read", preview: "viewer.tsx", isError: false };
  assert.equal((render([tool, assistant]).match(/Latest update/g) ?? []).length, 1);
  assert.doesNotMatch(render([assistant, tool]), /Latest update/);
  assert.doesNotMatch(render([{ ...assistant, isError: true }]), /Latest update/);
});

test("pending calls and empty results do not repeat the preview as output", () => {
  for (const details of [{ input: '{ "path": "README.md" }' }, { input: '{ "path": "README.md" }', output: "" }]) {
    const html = render([{ id: "read", toolName: "read", preview: "README.md", isError: false, details }]);
    assert.equal((html.match(/<pre[ >]/g) ?? []).length, 1);
  }
});

test("tool output is text, never executable markup", () => {
  const html = render([{ id: "unsafe", toolName: "bash", preview: "echo output", isError: true, details: { input: '<img src=x onerror="alert(1)">', output: "<script>alert(1)</script>" } }]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("a new subagent without activity has an honest empty state", () => {
  const html = render([]);
  assert.match(html, /No activity recorded yet/);
  assert.doesNotMatch(html, /<li /);
});
