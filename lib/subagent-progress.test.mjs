import assert from "node:assert/strict";
import test from "node:test";
import { getSubagentActivities } from "./subagent-progress.ts";

const call = (id, toolName, input = {}) => ({ type: "toolCall", toolCallId: id, toolName, input });
const assistant = (content, extra = {}) => ({ role: "assistant", content, model: "test", provider: "test", ...extra });
const result = (id, text, extra = {}) => ({ role: "toolResult", toolCallId: id, content: [{ type: "text", text }], ...extra });

test("a finished tool replaces its call, preserving its input and recording its result", () => {
  assert.deepEqual(getSubagentActivities([
    assistant([call("read-1", "read", { path: "components/SubagentViewer.tsx" })], { timestamp: 1000, durationMs: 500 }),
    result("read-1", "Read 288 lines", { timestamp: 2000, toolName: "read" }),
  ], ["a", "b"]), [{
    id: "tool:read-1", toolName: "read", preview: "components/SubagentViewer.tsx", output: "Read 288 lines", timestamp: 2000, isError: false,
  }]);
});

test("viewer details preserve complete tool input and output without enlarging stats previews", () => {
  const command = "printf 'first\\nsecond' " + "x".repeat(200);
  const output = "first\n  second\n" + "y".repeat(300) + "\nlast line\n";
  const messages = [
    assistant([call("long", "bash", { command })]),
    result("long", output),
  ];
  const [activity] = getSubagentActivities(messages, ["a", "r"], true);
  assert.deepEqual(activity.details, { input: JSON.stringify({ command }, null, 2), output });
  assert.equal(activity.preview.length, 180);
  assert.equal(activity.output.length, 240);
  assert.equal(getSubagentActivities(messages, ["a", "r"])[0].details, undefined);
});

test("viewer details keep full assistant updates and orphan results but omit thinking", () => {
  const text = "Update\n\n" + "x".repeat(200) + "\nFinal conclusion";
  const activities = getSubagentActivities([
    assistant([{ type: "thinking", thinking: "Private reasoning" }, { type: "text", text }]),
    result("old", "Full\n  orphan output"),
  ], ["a", "r"], true);
  assert.deepEqual(activities[0].details, { output: text });
  assert.deepEqual(activities[1].details, { output: "Full\n  orphan output" });
  assert.doesNotMatch(JSON.stringify(activities), /Private reasoning/);
});

test("parallel results follow completion order without duplicating calls", () => {
  const activities = getSubagentActivities([
    assistant([call("one", "bash", { command: "npm test" }), call("two", "read", { path: "README.md" })]),
    result("two", "Documentation", { toolName: "read" }),
    result("one", "Tests failed", { toolName: "bash", isError: true }),
  ], ["a", "b", "c"]);
  assert.deepEqual(activities.map(({ id, isError }) => ({ id, isError })), [
    { id: "tool:two", isError: false },
    { id: "tool:one", isError: true },
  ]);
  assert.equal(activities[1].preview, "npm test");
  assert.equal(activities[1].output, "Tests failed");
});

test("activity omits the task, custom messages, images and private thinking", () => {
  assert.deepEqual(getSubagentActivities([
    { role: "user", content: "Delegated task" },
    { role: "custom", customType: "extension", content: "Internal", display: false },
    assistant([{ type: "thinking", thinking: "Private reasoning" }, { type: "image", source: {} }]),
  ], ["u", "c", "a"]), []);
});

test("assistant updates use stable entry ids and the recorded completion time", () => {
  assert.deepEqual(getSubagentActivities([
    assistant([{ type: "text", text: "  Found the viewer.\n\nReusing it. " }], { timestamp: 1000, durationMs: 400 }),
  ], ["answer"]), [{ id: "answer:text", preview: "Found the viewer. Reusing it.", timestamp: 1400, isError: false }]);
});

test("provider errors with no content remain visible", () => {
  const [activity] = getSubagentActivities([
    assistant([], { errorMessage: "Provider refused the request", stopReason: "error" }),
  ], ["error"]);
  assert.equal(activity.preview, "Provider refused the request");
  assert.equal(activity.isError, true);
});

test("an orphan result remains visible when its call is outside the context page", () => {
  const [activity] = getSubagentActivities([result("old", "Missing file", { toolName: "read", isError: true })], ["r"]);
  assert.equal(activity.toolName, "read");
  assert.equal(activity.output, "Missing file");
  assert.equal(activity.isError, true);
});

test("invalid timestamps never reach date formatting", () => {
  for (const timestamp of [NaN, Infinity, 1e30]) {
    const [activity] = getSubagentActivities([assistant([{ type: "text", text: "Update" }], { timestamp })], ["a"]);
    assert.equal(activity.timestamp, undefined);
  }
});

test("previews are bounded and structured input is not dumped into the progress list", () => {
  const activities = getSubagentActivities([
    assistant([call("long", "bash", { command: "x".repeat(1000) }), call("structured", "custom", { config: { token: "secret" } })]),
    result("long", "y".repeat(1000)),
  ], ["a", "r"]);
  assert.equal(activities.find(({ id }) => id === "tool:long").preview.length <= 180, true);
  assert.equal(activities.find(({ id }) => id === "tool:long").output.length <= 240, true);
  assert.equal(activities.find(({ id }) => id === "tool:structured").preview, "");
});
