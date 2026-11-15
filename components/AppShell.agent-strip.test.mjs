import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("AppShell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "AgentMiniStrip") {
    callback = node.attributes.properties.find((prop) => prop.name?.getText(ast) === "onSelectSession").initializer.expression.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callback);

function select(session) {
  const selected = [];
  const opened = [];
  const handler = vm.runInNewContext(`(${callback})`, {
    handleSelectSession: (value) => selected.push(value.id),
    handleOpenSubagentTab: (...args) => opened.push(args),
  });
  handler(session);
  return { selected, opened };
}

test("the Agents strip opens native children only in the read-only viewer", () => {
  assert.deepEqual(select({ id: "child", relation: { kind: "subagent", description: "Review merge", profile: "deep" } }), {
    selected: [], opened: [["child", "Review merge"]],
  });
  assert.deepEqual(select({ id: "old-child", relation: { kind: "subagent", profile: "scout" } }), {
    selected: [], opened: [["old-child", "scout"]],
  });
});

test("the Agents strip keeps main and side chats writable", () => {
  for (const session of [{ id: "main" }, { id: "side", relation: { kind: "side" } }]) {
    assert.deepEqual(select(session), { selected: [session.id], opened: [] });
  }
});
