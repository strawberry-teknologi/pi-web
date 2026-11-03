import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AgentSessionPanel.tsx", import.meta.url), "utf8");
const selection = source.match(/onSelect=\{\(\) => \{([\s\S]*?)\n              \}\}/)?.[1];
assert.ok(selection, "the family member row has a selection handler");

function select(session) {
  const calls = [];
  // Execute the actual row callback without mounting the stats polling effect.
  new Function("session", "onSelectSession", "onToggleSubagentTab", "sessionTitle", selection)(
    session,
    (session) => calls.push(["main", session.id]),
    (...args) => calls.push(["tab", ...args]),
    (session) => session.name,
  );
  return calls;
}

test("side chat rows open the writable main chat", () => {
  assert.deepEqual(select({ id: "side", name: "Question", relation: { kind: "side", parentSessionId: "parent" } }), [["main", "side"]]);
});

test("native child rows stay in the read-only viewer", () => {
  assert.deepEqual(select({ id: "child", relation: { kind: "subagent", description: "Inspect", profile: "review" } }), [["tab", "child", "Inspect"]]);
});

test("only side tabs mount the writable chat panel", async () => {
  const app = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(app, /activeAgentTab && !activeAgentTab\.side && \(\s*<SubagentViewer/);
  assert.match(app, /activeAgentTab\?\.side && \(\s*<SessionChatPanel/);
});
