import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
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
  return { parentId, children, timestamp };
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
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    const panel = page.getByRole("listbox", { name: "Agents" });
    const readRow = panel.getByRole("option").filter({ hasText: read.description });
    await readRow.getByText(read.latestUpdate ?? "read · components/SubagentViewer.tsx", { exact: true }).waitFor();
    await panel.getByText("bash · npm test", { exact: true }).waitFor();
    await panel.getByText("1 failed", { exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, `subagent-progress-list-${width}.png`) });

    await readRow.locator("..").getByRole("button", { name: "View sub-agent work in side panel" }).click();
    const timeline = page.getByRole("region", { name: "Latest activity", exact: true });
    await timeline.getByText(read.output, { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("session"), fixture.parentId, "viewing progress leaves the main chat selected");
    const update = `E2E progress updated at ${width}px`;
    appendFileSync(read.path, JSON.stringify({ type: "message", id: `update-${width}`, parentId: read.lastEntryId ?? "settled", timestamp: new Date(Date.parse(fixture.timestamp) + (width === 1280 ? 60_000 : 90_000)).toISOString(), message: { role: "assistant", content: [{ type: "text", text: update }] } }) + "\n");
    read.lastEntryId = `update-${width}`;
    read.latestUpdate = update;
    await timeline.getByText(update, { exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, `subagent-progress-detail-${width}.png`) });
    await page.getByText("Full conversation", { exact: true }).click();
    await page.locator("details[open]").getByText(read.description, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "progress must not overflow on mobile");
    assert.deepEqual(forbidden, [], "viewing and polling progress must never start or contact the child's AgentSession");
    console.log(`PASS: ${width}px subagent activity, failed status, polling, full transcript and read-only viewing`);
  } finally {
    await page.unroute("**/api/agent/running");
    page.off("request", watch);
  }
}
