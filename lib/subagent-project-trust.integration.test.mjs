import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const { startRpcSession } = await createJiti(import.meta.url).import("./rpc-manager.ts");

// A session is created with its folder's trust decision, as `syncProjectTrust()` reads it: a
// folder never trusted keeps its `.pi/settings.json` unread, even for a session that loads no
// resources of its own (a historical subagent snapshot, Chat only).
async function openSession(t, trusted) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-web-project-trust-")));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ shellCommandPrefix: "echo project-prefix;" }));
  if (trusted) new ProjectTrustStore(agentDir).set(cwd, true);

  const wrapper = (await startRpcSession(`trust-${trusted}`, "", cwd)).session;
  t.after(() => wrapper.shutdown());
  await wrapper.waitUntilReady();
  return wrapper.inner.settingsManager;
}

test("a session in a folder never trusted reads no project settings", async (t) => {
  const settings = await openSession(t, false);
  assert.equal(settings.isProjectTrusted(), false);
  assert.equal(settings.getShellCommandPrefix(), undefined);
});

test("a session in a trusted folder reads its project settings", async (t) => {
  const settings = await openSession(t, true);
  assert.equal(settings.isProjectTrusted(), true);
  assert.equal(settings.getShellCommandPrefix(), "echo project-prefix;");
});
