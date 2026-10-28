import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { SubagentTaskDetails } = await jiti.import("./SubagentTaskDetails.tsx");
const render = (view) => renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(SubagentTaskDetails, { view })));

test("task and nested guidance are closed, verbatim and escaped", () => {
  const html = render({ label: "Inspect viewer", task: "Inspect\n  <script>task</script>", instructions: "Keep\n  <img src=x>safe", separated: true, runId: "A" });
  assert.equal((html.match(/<details[ >]/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<details[^>]*open|<script>|<img/);
  assert.match(html, /Inspect\n  &lt;script&gt;task&lt;\/script&gt;/);
  assert.match(html, /Keep\n  &lt;img src=x&gt;safe/);
  assert.match(html, /white-space:pre-wrap/);
  assert.match(html, /Task &amp; instructions/);
  assert.match(html, /Original task/);
  assert.doesNotMatch(html, /instructions · 2/);
});

test("legacy and unavailable task states are truthful, with no fabricated guidance", () => {
  const html = render({ label: "Legacy", task: "Planning rule + task", instructions: null, separated: false, runId: null });
  assert.equal((html.match(/<details[ >]/g) ?? []).length, 1);
  assert.match(html, /Recorded task/);
  assert.match(html, /Additional instructions were not recorded separately/);
  assert.doesNotMatch(html, /Original task/);
  assert.match(render({ label: "Fallback", task: null, instructions: null, separated: false, runId: null }), /Task metadata unavailable/);
});
