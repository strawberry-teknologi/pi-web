import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices, createAgentSessionServices, createEventBus,
  ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  AgentSessionWrapper, getRpcSession, subagentDisplayStatus, withSubagentDisplayStatus,
} = await jiti.import("./rpc-manager.ts");
const {
  createNativeSubagentBridge, hasRunningNativeSubagent, rememberNativeSubagent,
} = await jiti.import("./native-subagents.ts");
const answer = (text) => fauxAssistantMessage([fauxText(text)]);
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function until(check) {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for fixture phase");
    await tick();
  }
}

function nativeRun(parentSessionId, sessionId, sessionPath) {
  return {
    version: 1, sessionId, sessionPath, runId: "fixture-run", parentSessionId,
    parentToolCallId: "fixture-call", agent: "fixture", task: "Return a report.",
    createdAt: new Date().toISOString(), status: "running", ownerPid: process.pid,
  };
}

test("real SDK: native child activity suppresses parent completion without a built-in runtime", { timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-native-completion-"));
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  let root;
  t.after(async () => {
    await root?.shutdown();
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    await rm(dir, { recursive: true, force: true });
  });
  const faux = fauxProvider({ models: [{ id: "native-family-fixture" }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const services = await createAgentSessionServices({
    cwd: dir, agentDir: dir, modelRuntime, settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
  });
  const { session: parent } = await createAgentSessionFromServices({
    services, sessionManager: SessionManager.create(dir, join(dir, "sessions")), model: faux.getModel("native-family-fixture"),
  });
  const bus = createEventBus();
  const bridge = createNativeSubagentBridge(bus, () => parent.sessionId, () => {});
  const pushed = [];
  root = new AgentSessionWrapper(parent, { nativeBridge: bridge, onAgentRunComplete: (id) => pushed.push(id) });
  root.start();
  const ends = [];
  root.onEvent((event) => { if (event.type === "agent_settled" || event.type === "prompt_done") ends.push(event); });
  const run = nativeRun(parent.sessionId, "native-completion-child", join(dir, "child.jsonl"));
  const firstReply = Promise.withResolvers();
  t.after(() => firstReply.resolve());
  faux.setResponses([
    async () => { bus.emit("subagent:run", run); await firstReply.promise; return answer("Child is still working."); },
    answer("Final synthesis."),
  ]);
  await root.send({ type: "prompt", message: "Delegate a task." });
  await until(() => hasRunningNativeSubagent(root.sessionId));
  firstReply.resolve();
  await until(() => ends.some((event) => event.type === "prompt_done"));
  assert.equal(root.isRunning(), false);
  assert.deepEqual(pushed, []);
  assert.deepEqual(ends.map((event) => [event.type, event.subagentsActive]), [
    ["agent_settled", true], ["prompt_done", true],
  ]);
  assert.equal(getRpcSession(run.sessionId), undefined, "the extension owns the child, not an RPC wrapper");
  const row = { id: run.sessionId, relation: { kind: "subagent", status: "running" } };
  assert.equal(withSubagentDisplayStatus([row])[0], row, "a live native child is not an orphaned legacy run");

  bus.emit("subagent:run", { ...run, status: "completed" });
  assert.equal(hasRunningNativeSubagent(root.sessionId), false);
  assert.equal(subagentDisplayStatus(run.sessionId, "completed"), "completed");
  ends.length = 0;
  // The native extension owns continuation; the wrapper only observes the next parent run.
  await root.send({ type: "prompt", message: "Synthesize the child report." });
  await until(() => ends.some((event) => event.type === "prompt_done"));
  assert.deepEqual(pushed, [parent.sessionId]);
  assert.ok(ends.every((event) => event.subagentsActive !== true));
});

test("native CLI-owned children keep verified liveness; historical queued runs do not", () => {
  const run = { ...nativeRun("external-parent", "external-cli-child", "/missing-native-fixture.jsonl"), ownerPid: process.ppid };
  rememberNativeSubagent(run, run.sessionPath);
  try {
    assert.equal(subagentDisplayStatus(run.sessionId, "running"), "running");
    assert.equal(subagentDisplayStatus("retired-queued-child", "queued"), "interrupted");
    assert.equal(subagentDisplayStatus("retired-running-child", "running"), "interrupted");
  } finally {
    rememberNativeSubagent({ ...run, status: "completed" }, run.sessionPath);
  }
});
