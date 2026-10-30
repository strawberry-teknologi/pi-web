import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createEventBus } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
});

// The debug panel polls this every two seconds while it is open: reading must leave the
// session exactly as it was, and an id the server holds nothing for must stay that way.
test("the debug route only reads: no wrapper started, no liveness registered, the idle timer untouched", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-agent-debug-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  let session;
  t.after(async () => {
    await session?.shutdown();
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  const cwd = join(dir, "project");
  await mkdir(cwd);
  await writeFile(join(dir, "settings.json"), "{}");

  const { getRpcSession, startRpcSession } = await jiti.import("../../../lib/rpc-manager.ts");
  const {
    hasActiveSessionLivenessProvider,
    listRegisteredSessionLivenessProviders,
  } = await jiti.import("../../../lib/session-liveness.ts");
  const { GET } = await jiti.import("./debug/route.ts");
  const started = await startRpcSession("__new__agent-debug", "", cwd, {});
  session = started.session;
  const id = started.realSessionId;
  await session.waitUntilReady();

  const read = async (query) => {
    const response = await GET(new Request(`http://localhost/api/agent/debug${query}`));
    return { status: response.status, cacheControl: response.headers.get("Cache-Control"), text: await response.text() };
  };

  // An id the server holds nothing for.
  const unknown = "00000000-0000-4000-8000-000000000000";
  const providersBefore = listRegisteredSessionLivenessProviders();
  const missing = await read(`?session=${unknown}`);
  assert.equal(missing.status, 200);
  assert.equal(missing.cacheControl, "no-store");
  const missingBody = JSON.parse(missing.text);
  assert.equal(missingBody.session.sessionId, unknown);
  assert.equal(missingBody.session.wrapper, null);
  assert.equal(missingBody.session.starting, false);
  assert.equal(getRpcSession(unknown), undefined, "a debug read never starts a wrapper");
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: unknown }), false, "nor registers liveness");
  assert.deepEqual(listRegisteredSessionLivenessProviders(), providersBefore);

  // A live wrapper: its idle timer object, deadline and last command stay as they were.
  const sendCalls = [];
  const send = session.send.bind(session);
  session.send = (command) => {
    sendCalls.push(command.type);
    return send(command);
  };
  const before = session.getDebugSnapshot();
  const timerBefore = session.idleTimer;
  assert.equal(typeof before.idle.nextCheckAt, "number");

  const live = await read(`?session=${encodeURIComponent(id)}`);
  assert.equal(live.status, 200);
  assert.equal(live.cacheControl, "no-store");
  const body = JSON.parse(live.text);
  assert.equal(body.session.wrapper.sessionId, id);
  assert.equal(body.session.wrapper.state, "alive");
  assert.equal(body.session.wrapper.idle.nextCheckAt, before.idle.nextCheckAt);
  assert.ok(body.sessions.some((summary) => summary.sessionId === id && summary.state === "alive"));
  assert.ok(body.server.wrappers.alive >= 1);

  assert.deepEqual(sendCalls, [], "the route never sends a command");
  assert.ok(session.idleTimer === timerBefore, "the idle timer was neither cleared nor re-armed");
  assert.deepEqual(session.getDebugSnapshot().idle, before.idle);
  assert.deepEqual(session.getDebugSnapshot().lastCommand, before.lastCommand);
  assert.equal(session.getDebugSnapshot().eventListeners, before.eventListeners, "no stream was opened");
  assert.deepEqual(listRegisteredSessionLivenessProviders(), providersBefore);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: id }), false);

  // Counts, states and times only: neither the system prompt nor a path.
  const systemPrompt = session.inner.systemPrompt;
  assert.ok(systemPrompt.length > 20, "the session has a prompt to leak");
  assert.ok(!live.text.includes(systemPrompt));
  assert.ok(!live.text.includes(systemPrompt.slice(0, 40)));
  assert.ok(!live.text.includes(dir), "no path of the session's");

  // Without ?session=, or with one no session id is that long: the global layer only.
  assert.equal(JSON.parse((await read("")).text).session, null);
  assert.equal(JSON.parse((await read(`?session=${"x".repeat(513)}`)).text).session, null);
  assert.equal(JSON.parse((await read("?session=")).text).session, null);

  // The events route labels a stream with the page's id (an invalid one with none) and keeps
  // nothing alive for it: the page's lease renewals do that.
  const { GET: openEvents } = await jiti.import("./[id]/events/route.ts");
  const openStream = async (holder) => {
    const abortController = new AbortController();
    t.after(() => abortController.abort());
    const response = await openEvents(
      new Request(`http://localhost/api/agent/${encodeURIComponent(id)}/events?holder=${encodeURIComponent(holder)}`, {
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ id }) },
    );
    const reader = response.body.getReader();
    await reader.read();
    assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"connected"/);
    return abortController;
  };
  const labelled = await openStream("page-debug");
  const unlabelled = await openStream("not a holder!");
  const withStreams = JSON.parse((await read(`?session=${encodeURIComponent(id)}`)).text);
  assert.deepEqual(
    withStreams.session.eventStreams.map((stream) => stream.holder ?? "(none)").sort(),
    ["(none)", "page-debug"],
  );
  assert.ok(withStreams.session.eventStreams.every((stream) => typeof stream.connectedAt === "number"));
  assert.ok(withStreams.server.pages.some((row) => row.holder === "page-debug" && row.agent === 1));
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: id }), false, "a stream registers no liveness");
  assert.deepEqual(listRegisteredSessionLivenessProviders(), providersBefore);
  labelled.abort();
  unlabelled.abort();
  assert.deepEqual(JSON.parse((await read(`?session=${encodeURIComponent(id)}`)).text).session.eventStreams, []);
});

test("native activity agrees between running polls and debug detail without child wrappers or legacy queues", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-native-debug-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousRuns = globalThis.__piNativeSubagents;
  process.env.PI_CODING_AGENT_DIR = dir;
  globalThis.__piNativeSubagents = new Map();
  let bridge;
  let childBridge;
  t.after(async () => {
    bridge?.dispose();
    childBridge?.dispose();
    globalThis.__piNativeSubagents = previousRuns;
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  const { createNativeSubagentBridge } = await jiti.import("../../../lib/native-subagents.ts");
  const { getRpcSession } = await jiti.import("../../../lib/rpc-manager.ts");
  const { GET: running } = await jiti.import("./running/route.ts");
  const { GET: debug } = await jiti.import("./debug/route.ts");
  const bus = createEventBus();
  const childBus = createEventBus();
  bridge = createNativeSubagentBridge(bus, () => "native-parent", () => {});
  childBridge = createNativeSubagentBridge(childBus, () => "native-child", () => {});
  const run = {
    version: 1, sessionId: "native-child", sessionPath: join(dir, "child.jsonl"), runId: "child-run",
    parentSessionId: "native-parent", parentToolCallId: "child-call", agent: "worker",
    task: "PRIVATE CHILD TASK", createdAt: new Date().toISOString(), status: "running", ownerPid: process.pid,
  };
  const sibling = { ...run, sessionId: "native-sibling", sessionPath: join(dir, "sibling.jsonl"), runId: "sibling-run" };
  const grandchild = { ...run, sessionId: "native-grandchild", sessionPath: join(dir, "grandchild.jsonl"), parentSessionId: "native-child", runId: "grandchild-run" };
  bus.emit("subagent:run", run);
  bus.emit("subagent:run", sibling);
  childBus.emit("subagent:run", grandchild);

  const poll = await running();
  assert.equal(poll.headers.get("Cache-Control"), "no-store");
  const active = await poll.json();
  assert.deepEqual(active.runningSessionIds.sort(), ["native-child", "native-grandchild", "native-sibling"]);
  assert.deepEqual(active.subagentsActiveSessionIds.sort(), ["native-child", "native-parent"]);
  assert.equal(getRpcSession("native-child"), undefined);
  assert.equal(getRpcSession("native-parent"), undefined);

  const detail = await debug(new Request("http://localhost/api/agent/debug?session=native-parent"));
  const body = await detail.json();
  assert.equal(body.session.wrapper, null);
  assert.equal(body.session.subagents.active, true);
  assert.deepEqual(body.session.subagents.runs.map(({ sessionId, status }) => [sessionId, status]), [
    ["native-child", "running"], ["native-sibling", "running"],
  ]);
  assert.deepEqual(body.session.subagents.notifications, []);
  assert.ok(!JSON.stringify(body).includes(dir));
  assert.ok(!JSON.stringify(body).includes(run.task));

  childBus.emit("subagent:run", { ...grandchild, status: "completed" });
  bus.emit("subagent:run", { ...run, status: "completed" });
  bus.emit("subagent:run", { ...sibling, status: "completed" });
  const settled = await (await running()).json();
  assert.deepEqual(settled.runningSessionIds, []);
  assert.deepEqual(settled.subagentsActiveSessionIds, []);
  const finished = await (await debug(new Request("http://localhost/api/agent/debug?session=native-parent"))).json();
  assert.deepEqual(finished.session.subagents, { active: false, runs: [], notifications: [] });
});
