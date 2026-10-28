import assert from "node:assert/strict";
import test from "node:test";
import { updateSubagentTabLabel } from "./subagent-viewer-state.ts";

test("label updates only the existing matching tab, preserving identity for no-ops", () => {
  const tabs = [{ sessionId: "A", label: "old" }, { sessionId: "B", label: "other" }];
  assert.equal(updateSubagentTabLabel(tabs, "A", "old"), tabs);
  assert.equal(updateSubagentTabLabel(tabs, "closed", "late answer"), tabs);
  const changed = updateSubagentTabLabel(tabs, "A", "clean task");
  assert.deepEqual(changed, [{ sessionId: "A", label: "clean task" }, { sessionId: "B", label: "other" }]);
  assert.equal(changed[1], tabs[1]);
  assert.equal(tabs[0].label, "old");
});
