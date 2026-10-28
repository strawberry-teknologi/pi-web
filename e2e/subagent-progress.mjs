import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function createSubagentProgressFixtures({ sessionDir, project, timestamp, parentId, parentPath }) {
  const children = [
    { id: "e2e-progress-read", description: "Inspect viewer", tool: "read", input: { path: "components/SubagentViewer.tsx" }, output: "Viewer polling verified.", status: "completed" },
    { id: "e2e-progress-failed", description: "Run viewer tests", tool: "bash", input: { command: "npm test" }, output: "Missing test fixture", status: "failed" },
  ];
  for (const child of children) {
    child.path = join(sessionDir, `${child.id}.jsonl`);
    const entries = [
      { type: "session", version: 3, id: child.id, timestamp, cwd: project, parentSession: parentPath },
      { type: "custom", customType: "pi-web:subagent", id: "meta", parentId: null, timestamp, data: { version: 1, parentSessionId: parentId, parentSessionPath: parentPath, profile: "explore", description: child.description, task: child.description } },
      { type: "message", id: "task", parentId: "meta", timestamp, message: { role: "user", content: child.description } },
      { type: "message", id: "call", parentId: "task", timestamp, message: { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: child.tool, arguments: child.input }] } },
      { type: "message", id: "result", parentId: "call", timestamp, message: { role: "toolResult", toolCallId: "tool-1", toolName: child.tool, content: [{ type: "text", text: child.output }], isError: child.status === "failed" } },
      { type: "custom", customType: "pi-web:subagent-result", id: "settled", parentId: "result", timestamp, data: { version: 1, status: child.status, completedAt: timestamp } },
    ];
    writeFileSync(child.path, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
  }
  const native = { id: "e2e-progress-native", description: "Inspect native task separation", path: join(sessionDir, "e2e-progress-native.jsonl"), parentId, parentPath, project, timestamp, sequence: 0 };
  writeFileSync(native.path, JSON.stringify({ type: "session", version: 3, id: native.id, timestamp, cwd: project, parentSession: parentPath }) + "\n");
  appendNativeRun(native, { task: native.description, instructions: "Initial guidance", status: "completed" });
  children.push(native);
  return { parentId, children, native, timestamp };
}

export async function checkSubagentProgress({ page, base, artifacts, width, fixture }) {
  const [read] = fixture.children;
  const forbidden = [];
  const watch = request => {
    if (fixture.children.some(child => new URL(request.url()).pathname.startsWith(`/api/agent/${child.id}`))) forbidden.push(request.url());
  };
  page.on("request", watch);
  // Only the running snapshot is simulated; all progress/context reads use real session files.
  await page.route("**/api/agent/running", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, runningSessionIds: [...data.runningSessionIds, read.id] } });
  });
  try {
    await page.goto(`${base}/?session=${fixture.parentId}`, { waitUntil: "domcontentloaded" });
    const more = page.locator("[data-mobile-toolbar-more]");
    if (width <= 600) {
      await more.waitFor({ state: "visible" });
      if (await more.getAttribute("aria-expanded") !== "true") await more.click();
    }
    await page.getByRole("button", { name: "Agents: 1 running", exact: true }).click();
    const panel = page.getByRole("listbox", { name: "Agents" });
    const readRow = panel.getByRole("option").filter({ hasText: read.description });
    await readRow.getByText(read.latestUpdate ?? "read · components/SubagentViewer.tsx", { exact: true }).waitFor();
    await panel.getByText("bash · npm test", { exact: true }).waitFor();
    await panel.getByRole("option").filter({ hasText: fixture.children[1].description }).getByText("Failed", { exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, `subagent-progress-list-${width}.png`) });

    await readRow.locator("..").getByRole("button", { name: "View sub-agent work in side panel" }).click();
    const timeline = page.getByRole("region", { name: "Latest activity", exact: true });
    await timeline.getByText(read.output, { exact: true }).waitFor({ state: "attached" });
    await timeline.locator("summary").filter({ hasText: "components/SubagentViewer.tsx" }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("session"), fixture.parentId, "viewing progress leaves the main chat selected");
    const update = `E2E progress updated at ${width}px`;
    appendFileSync(read.path, JSON.stringify({ type: "message", id: `update-${width}`, parentId: read.lastEntryId ?? "settled", timestamp: new Date(Date.parse(fixture.timestamp) + (width === 1280 ? 60_000 : 90_000)).toISOString(), message: { role: "assistant", content: [{ type: "text", text: update }] } }) + "\n");
    read.lastEntryId = `update-${width}`;
    read.latestUpdate = update;
    await timeline.locator("summary").getByText(update, { exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, `subagent-progress-detail-${width}.png`) });
    await page.getByText("Full conversation", { exact: true }).click();
    await page.locator("details[open]").getByText(read.description, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "progress must not overflow on mobile");
    assert.deepEqual(forbidden, [], "viewing and polling progress must never start or contact the child's AgentSession");
    console.log(`PASS: ${width}px subagent activity, failed status, polling, full transcript and read-only viewing`);
    await checkNativeTask({ page, base, artifacts, width, fixture });
    assert.deepEqual(forbidden, [], "native task inspection and close must never contact a child's AgentSession");
  } finally {
    await page.unroute("**/api/agent/running");
    page.off("request", watch);
  }
}

function appendNative(native, entry) {
  const id = `native-${++native.sequence}`;
  appendFileSync(native.path, JSON.stringify({ ...entry, id, parentId: native.lastId ?? null, timestamp: native.timestamp }) + "\n");
  native.lastId = id;
}

function appendNativeRun(native, { task, instructions, status = "running", snapshot = true, malformed = false }) {
  const runId = `run-${native.sequence + 1}`;
  appendNative(native, { type: "custom", customType: "subagent:run", data: {
    version: 1, sessionId: native.id, sessionPath: native.path, runId,
    parentSessionId: native.parentId, parentSessionPath: native.parentPath,
    parentToolCallId: "native-call", agent: "native-fixture", task: task.slice(0, 4096),
    createdAt: native.timestamp, ownerPid: process.pid, status,
    ...(status === "failed" ? { error: "Early fixture failure" } : {}),
  } });
  if (snapshot) appendNative(native, { type: "custom", customType: "subagent:task", data: {
    version: 1, sessionId: native.id, runId, task,
    ...(instructions === undefined ? {} : { instructions: malformed ? 42 : instructions }),
  } });
}

async function checkNativeTask({ page, base, artifacts, width, fixture }) {
  const native = fixture.native;
  const read = fixture.children[0];
  const task = "Find why subagent titles show planning instructions instead of the original prompt.\n" + "Preserve exact whitespace 😀 <script>unsafe</script>\n  ".repeat(15);
  const instructions = "Planning document location\n  Save plans under ~/.work-docs.\n<img src=x onerror=alert(1)>\n" + "Long guidance ".repeat(100);
  const label = Array.from(task.replace(/\s+/g, " ").trim()).slice(0, 120).join("");
  let busy = true;
  await page.route("**/api/agent/running", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, runningSessionIds: [...new Set([...data.runningSessionIds.filter(id => id !== native.id), read.id, ...(busy ? [native.id] : [])])] } });
  });
  const openChild = async (description) => {
    const more = page.locator("[data-mobile-toolbar-more]");
    if (width <= 600) {
      await more.waitFor({ state: "visible" });
      if (await more.getAttribute("aria-expanded") !== "true") await more.click();
    }
    if (!(await page.getByRole("listbox", { name: "Agents" }).isVisible())) await page.getByRole("button", { name: /^Agents: / }).click();
    const rows = page.getByRole("listbox", { name: "Agents" }).getByRole("option");
    // Catalog titles can lag a resume; the fixture profile is stable.
    const row = rows.filter({ hasText: description === native.description ? "native-fixture" : description });
    await row.locator("..").getByRole("button", { name: "View sub-agent work in side panel" }).click();
  };
  const close = async () => {
    const tab = page.getByRole("tab", { selected: true }).filter({ has: page.getByRole("button", { name: /^Close / }) });
    await tab.getByRole("button", { name: /^Close / }).click();
  };
  const assertReadOnly = (before) => assert.equal(readFileSync(native.path, "utf8"), before, "viewer reads never mutate the child file");
  const title = page.locator("strong").filter({ hasText: label });
  const taskDetails = () => page.locator("details").filter({ has: page.locator("summary", { hasText: /^Task & instructions$/ }) });
  let infoReads = 0;
  const countInfo = request => { if (new URL(request.url()).pathname === `/api/sessions/${native.id}`) infoReads++; };
  page.on("request", countInfo);
  const timeline = page.getByRole("region", { name: "Latest activity", exact: true });
  const refresh = () => page.getByRole("button", { name: "Refresh", exact: true });
  await close();
  appendNativeRun(native, { task, instructions });
  appendNative(native, { type: "message", message: { role: "user", content: "INJECTED PLANNING RULE: polluted first message" } });
  appendNative(native, { type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "PRIVATE NATIVE THOUGHT" }] } });
  await page.goto(`${base}/?session=${fixture.parentId}`, { waitUntil: "domcontentloaded" });
  await openChild(native.description);
  await title.waitFor();
  await page.getByRole("tab", { name: `Sub-agent ${label}`, exact: true }).waitFor();
  assert.equal(await taskDetails().getAttribute("open"), null);
  assert.equal(await timeline.innerText().then(text => text.includes("PRIVATE NATIVE THOUGHT")), false);
  if (width === 1280) await timeline.getByText("No activity recorded yet", { exact: true }).waitFor();
  const before = readFileSync(native.path, "utf8");
  const outerSummary = taskDetails().locator(":scope > summary");
  await outerSummary.focus();
  await page.keyboard.press("Enter");
  const nested = taskDetails().locator("details");
  assert.equal(await nested.getAttribute("open"), null);
  await nested.locator("summary").focus();
  await page.keyboard.press("Space");
  assert.equal(await nested.locator("p").textContent(), instructions);
  assert.equal(await taskDetails().locator(":scope > p").textContent(), task);
  assert.equal(await taskDetails().locator("script,img").count(), 0);
  assertReadOnly(before);
  // More than one tail page; both paging and the timeline use real context entries.
  for (let i = 0; i < 104; i++) appendNative(native, { type: "message", message: { role: i % 2 ? "assistant" : "user", content: `Native history ${width}-${i}` } });
  appendNative(native, { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: `native-read-${width}`, name: "read", arguments: { path: "subagent/lifecycle.ts" } }] } });
  appendNative(native, { type: "message", message: { role: "toolResult", toolCallId: `native-read-${width}`, toolName: "read", content: [{ type: "text", text: "Recorded native tool output" }], isError: false } });
  await timeline.locator("summary").filter({ hasText: "subagent/lifecycle.ts" }).waitFor();
  assert.equal(await timeline.getByText("Latest update", { exact: true }).count(), 0, "newer tool stays first, without a stale assistant marker");
  const recordedUpdate = `The planning rules are prepended before the task reaches the child. ${width}px update`;
  appendNative(native, { type: "message", message: { role: "assistant", content: recordedUpdate } });
  await timeline.locator("summary").getByText(recordedUpdate, { exact: true }).waitFor();
  await timeline.getByText("Latest update", { exact: false }).waitFor();
  assert.equal(await timeline.locator("li").count(), 8);
  assert.equal(await timeline.locator("details[open]").count(), 0);
  await outerSummary.click();
  await page.getByRole("button", { name: /^Close / }).last().hover();
  // Capture both existing themes without adding theme styles or demo chrome.
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
    await page.screenshot({ path: join(artifacts, `subagent-task-${theme}-${width}.png`), animations: "disabled" });
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByText("Full conversation", { exact: true }).click();
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await page.getByText(`Native history ${width}-0`, { exact: true }).waitFor();
  await page.getByText("Full conversation", { exact: true }).click();
  // Resume in place: expansions reset and no prior-run guidance survives.
  const infoBeforeResume = infoReads;
  appendNativeRun(native, { task: "Resume B current task", instructions: "Run B only instructions" });
  await page.getByRole("tab", { name: "Sub-agent Resume B current task", exact: true }).waitFor();
  assert.equal(await taskDetails().getAttribute("open"), null);
  assert.equal(infoReads, infoBeforeResume, "a changed tab fallback label must not refetch session info");
  await taskDetails().locator(":scope > summary").click();
  assert.equal(await taskDetails().locator("details").getAttribute("open"), null);
  assert.equal((await taskDetails().textContent()).includes(instructions), false);
  appendNativeRun(native, { task: "Resume C without guidance" });
  await page.getByRole("tab", { name: "Sub-agent Resume C without guidance", exact: true }).waitFor();
  assert.equal(await taskDetails().locator("details").count(), 0);
  for (const malformed of [false, true]) {
    appendNativeRun(native, { task: `Recorded fallback ${malformed}`, instructions: "MUST NOT LEAK", snapshot: malformed, malformed });
    await page.getByRole("tab", { name: `Sub-agent Recorded fallback ${malformed}`, exact: true }).waitFor();
    await taskDetails().locator(":scope > summary").click();
    await taskDetails().getByText("Additional instructions were not recorded separately", { exact: true }).waitFor();
    assert.equal(await taskDetails().locator("details").count(), 0);
    assert.equal((await taskDetails().textContent()).includes("MUST NOT LEAK"), false);
  }
  const detailRoute = `**/api/subagents/${native.id}`;
  const contextRoute = `**/api/sessions/${native.id}/context?*`;
  // A valid HTTP response with unreadable metadata exercises the read-error path
  // without adding intentional HTTP errors to the suite's global error collector.
  await page.route(detailRoute, route => route.fulfill({ json: { error: "fixture detail unavailable" } }));
  await refresh().click();
  await page.getByRole("status").filter({ hasText: "Task metadata unavailable" }).waitFor();
  await timeline.getByText("Recorded native tool output", { exact: true }).waitFor({ state: "attached" });
  await page.unroute(detailRoute);
  // Conversely, failed context must not prevent a new task snapshot being read.
  await page.route(contextRoute, route => route.fulfill({ contentType: "application/json", body: "{" }));
  appendNativeRun(native, { task: "Metadata independent of context", instructions: "New readable metadata" });
  await refresh().click();
  await page.getByRole("tab", { name: "Sub-agent Metadata independent of context", exact: true }).waitFor();
  await page.unroute(contextRoute);
  await refresh().click();
  // A stalled context read cannot hold the independently healthy metadata poll.
  let releaseContext;
  const contextGate = new Promise(resolve => { releaseContext = resolve; });
  let contextRequests = 0;
  await page.route(contextRoute, async route => {
    contextRequests++;
    const response = await route.fetch();
    await contextGate;
    await route.fulfill({ response }).catch(() => {});
  });
  appendNativeRun(native, { task: "Metadata before context stall" });
  await refresh().click();
  await page.getByRole("tab", { name: "Sub-agent Metadata before context stall", exact: true }).waitFor();
  assert.equal(contextRequests, 1);
  appendNativeRun(native, { task: "Metadata independent of stalled context", instructions: "Current guidance while context waits" });
  await page.getByRole("tab", { name: "Sub-agent Metadata independent of stalled context", exact: true }).waitFor({ timeout: 6000 });
  assert.equal(contextRequests, 1, "context reads remain serial while metadata polling continues");
  releaseContext();
  await page.unroute(contextRoute);
  // Hold a detail read across multiple poll ticks: no metadata overlap, healthy
  // context still advances, and closing before release cannot recreate a tab.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let detailRequests = 0;
  await page.route(detailRoute, async route => {
    detailRequests++;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  const beforeDetailWaits = `Activity before metadata stall at ${width}px`;
  appendNative(native, { type: "message", message: { role: "assistant", content: beforeDetailWaits } });
  await refresh().click();
  await timeline.locator("summary").getByText(beforeDetailWaits, { exact: true }).waitFor();
  assert.equal(detailRequests, 1);
  const whileDetailWaits = `Activity continues while task metadata waits at ${width}px`;
  appendNative(native, { type: "message", message: { role: "assistant", content: whileDetailWaits } });
  await timeline.locator("summary").getByText(whileDetailWaits, { exact: true }).waitFor({ timeout: 6000 });
  assert.equal(detailRequests, 1, "metadata reads remain serial while context polling continues");
  const stable = readFileSync(native.path, "utf8");
  await close();
  await openChild(read.description);
  release();
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole("tab", { name: "Sub-agent Metadata independent of stalled context", exact: true }).count(), 0);
  assertReadOnly(stable);
  await page.unroute(detailRoute);
  await close();
  // Failed native run retains partial activity and its separate task metadata.
  appendNativeRun(native, { task: "Failed native task", instructions: "Retained failure guidance", status: "failed" });
  busy = false;
  await page.goto(`${base}/?session=${fixture.parentId}`, { waitUntil: "domcontentloaded" });
  await openChild(native.description);
  await page.getByRole("tab", { name: "Sub-agent Failed native task", exact: true }).waitFor();
  await page.getByRole("button", { name: /^Refresh/ }).locator("..").getByText("Failed", { exact: true }).waitFor();
  await timeline.getByText("Recorded native tool output", { exact: true }).waitFor({ state: "attached" });
  const failedBytes = readFileSync(native.path, "utf8");
  await close();
  assert.equal(new URL(page.url()).searchParams.get("session"), fixture.parentId);
  assertReadOnly(failedBytes);
  page.off("request", countInfo);
  console.log(`PASS: ${width}px native task/guidance, resume, missing/malformed metadata, independent errors, nonoverlap, late close/switch, failure, pagination and read-only files`);
}
