import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { nativeSubagentRecord, NATIVE_SUBAGENT_TYPE, type NativeSubagentRecord } from "./native-subagent-records";
import type { SubagentStatus } from "./subagents";
type Tracked = {
    run: NativeSubagentRecord;
    bus?: EventBus;
    file: string;
};
declare global {
    var __piNativeSubagents: Map<string, Tracked> | undefined;
}
function runs() { return globalThis.__piNativeSubagents ??= new Map<string, Tracked>(); }
export function rememberNativeSubagent(run: NativeSubagentRecord, file: string): void {
    const current = runs().get(run.sessionId);
    if (current?.bus)
        return;
    if (run.status === "running")
        runs().set(run.sessionId, { run, file });
    else
        runs().delete(run.sessionId);
}
function refresh(tracked: Tracked): void {
    if (tracked.bus)
        return;
    let fd: number | undefined;
    try {
        fd = openSync(tracked.file, "r");
        const size = fstatSync(fd).size;
        const start = Math.max(0, size - 256 * 1024);
        const bytes = Buffer.alloc(size - start);
        const read = readSync(fd, bytes, 0, bytes.length, start);
        const lines = bytes.subarray(0, read).toString("utf8").split("\n");
        if (start > 0)
            lines.shift();
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const entry = JSON.parse(lines[i]);
                if (entry.type !== "custom" || entry.customType !== NATIVE_SUBAGENT_TYPE)
                    continue;
                const run = nativeSubagentRecord(entry.data);
                if (run?.sessionId === tracked.run.sessionId) {
                    tracked.run = run;
                    break;
                }
            }
            catch { /* a writer may be midway through its last line */ }
        }
    }
    catch { /* missing file never authorizes a new writer */ }
    finally {
        if (fd !== undefined)
            closeSync(fd);
    }
}
export function nativeSubagentStatus(run: NativeSubagentRecord): SubagentStatus {
    const owned = runs().get(run.sessionId);
    if (owned?.bus)
        return owned.run.status;
    if (run.status !== "running")
        return run.status;
    if (run.ownerPid === process.pid)
        return "interrupted";
    if (run.ownerPid) {
        try {
            process.kill(run.ownerPid, 0);
            return "running";
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EPERM")
                return "running";
        }
    }
    return "interrupted";
}
export function getRunningNativeSubagentIds(): string[] {
    const ids: string[] = [];
    for (const [id, tracked] of runs()) {
        refresh(tracked);
        if (nativeSubagentStatus(tracked.run) === "running")
            ids.push(id);
    }
    return ids;
}
export function hasRunningNativeSubagent(sessionId: string): boolean {
    const active = getRunningNativeSubagentIds();
    for (const id of active) {
        const seen = new Set<string>([id]);
        let parent = runs().get(id)?.run.parentSessionId;
        while (parent && !seen.has(parent)) {
            if (parent === sessionId) return true;
            seen.add(parent);
            parent = runs().get(parent)?.run.parentSessionId;
        }
    }
    return false;
}
export function getProtectedNativeSubagentIds(): string[] {
    const ids: string[] = [];
    for (const [id, tracked] of runs()) {
        refresh(tracked);
        if (tracked.run.status !== "running") continue;
        if (tracked.bus || !tracked.run.ownerPid) { ids.push(id); continue; }
        try { process.kill(tracked.run.ownerPid, 0); ids.push(id); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") ids.push(id); }
    }
    return ids;
}
export async function abortNativeSubagent(id: string): Promise<void> {
    const tracked = runs().get(id);
    if (!tracked?.bus || tracked.run.status !== "running")
        throw new Error("Subagent is not running in this server");
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Subagent stop was not acknowledged")), 8000);
        tracked.bus!.emit("subagent:abort", { sessionId: id, parentSessionId: tracked.run.parentSessionId, acknowledge: () => { clearTimeout(timer); resolve(); } });
    });
}
export function createNativeSubagentBridge(bus: EventBus, parentId: () => string, onChange: () => void) {
    const off = bus.on("subagent:run", value => {
        const run = nativeSubagentRecord(value);
        if (!run || run.parentSessionId !== parentId())
            return;
        if (run.status === "running")
            runs().set(run.sessionId, { run, bus, file: run.sessionPath });
        else if (runs().get(run.sessionId)?.bus === bus && runs().get(run.sessionId)?.run.runId === run.runId)
            runs().delete(run.sessionId);
        onChange();
    });
    return { dispose() {
            off();
            for (const tracked of runs().values())
                if (tracked.bus === bus)
                    delete tracked.bus;
        } };
}
