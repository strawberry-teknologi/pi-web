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

test("tool output is text, never executable markup", () => {
  const html = render([{ id: "unsafe", toolName: "bash", preview: "echo output", output: "<script>alert(1)</script>", isError: true }]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("a new subagent without activity has an honest empty state", () => {
  const html = render([]);
  assert.match(html, /No activity recorded yet/);
  assert.doesNotMatch(html, /<li /);
});
