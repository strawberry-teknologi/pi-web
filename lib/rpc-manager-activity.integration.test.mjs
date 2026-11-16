import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(join(tmpdir(), "pi-web-activity-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { listAllSessions } = await jiti.import("./session-reader.ts");
const { buildSessionTree } = await jiti.import("./session-tree.ts");
test.after(() => rm(agentDir, { recursive: true, force: true }));

for (const position of [5, 7]) {
  test(`a new message promotes session #${position} to Active #1 before the reply finishes`, async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-activity-cwd-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const managers = Array.from({ length: 7 }, (_, index) => {
      const manager = SessionManager.create(cwd);
      const timestamp = Date.parse("2020-01-10T00:00:00Z") - index * 1000;
      manager.appendMessage({ role: "user", content: `old ${index}`, timestamp });
      manager.appendMessage(fauxAssistantMessage([fauxText("old reply")], { timestamp }));
      return manager;
    });
    const target = managers[position - 1];
    const targetId = target.getSessionId();
    const activeIds = (sessions, running = false) => buildSessionTree({
      sessions: sessions.filter((s) => s.cwd === cwd),
      uiState: { version: 1, revision: 0, sessions: {}, projects: {} },
      runningIds: new Set(running ? [targetId] : []), unreadIds: new Set(),
      selectedSessionId: targetId, currentProject: null, groupExpansion: {}, moreShown: {}, pinnedCollapsed: false,
    }).rows.filter((row) => row.kind === "session" && row.context === "active").map((row) => row.family.root.id);

    const faux = fauxProvider({ models: [{ id: "faux-activity" }] });
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
    modelRuntime.registerNativeProvider(faux.provider);
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
    await resourceLoader.reload();
    const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, model: faux.getModel("faux-activity"), sessionManager: target, settingsManager, resourceLoader });
    const wrapper = new AgentSessionWrapper(session);
    t.after(() => wrapper.destroy());
    wrapper.start();
    wrapper.beginExtensionBinding();
    await wrapper.waitUntilReady();

    const before = await listAllSessions({ force: true });
    assert.deepEqual(activeIds(before), managers.slice(0, 5).map((m) => m.getSessionId()));
    const version = globalThis.__piSessionListGeneration;
    const entered = Promise.withResolvers();
    const finish = Promise.withResolvers();
    faux.setResponses([async () => {
      entered.resolve();
      await finish.promise;
      return fauxAssistantMessage([fauxText("new reply")]);
    }]);
    const prompt = session.prompt("new activity");
    try {
      await entered.promise;
      assert.equal(session.isStreaming, true, "the model has not finished");
      const after = await listAllSessions();
      assert.equal(activeIds(after, true)[0], targetId, "new activity must reorder the cached catalog while running");
      assert.ok(globalThis.__piSessionListGeneration > version, "the running poll must know to reload the catalog");
    } finally {
      finish.resolve();
      await prompt;
    }
  });
}
