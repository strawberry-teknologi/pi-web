import type { SessionEntry } from "./types";
import type { SubagentRunInfo } from "./subagents";
export const NATIVE_SUBAGENT_TYPE = "subagent:run";
export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
export interface NativeSubagentRecord {
    version: 1;
    sessionId: string;
    sessionPath: string;
    runId: string;
    parentSessionId: string;
    parentSessionPath?: string;
    parentToolCallId: string;
    agent: string;
    task: string;
    createdAt: string;
    status: "running" | "completed" | "failed" | "aborted";
    ownerPid?: number;
    completedAt?: string;
    error?: string;
}
export function nativeSubagentRecord(value: unknown): NativeSubagentRecord | null {
    if (!isRecord(value) || value.version !== 1)
        return null;
    for (const key of ["sessionId", "sessionPath", "runId", "parentSessionId", "parentToolCallId", "agent", "createdAt"]) {
        if (typeof value[key] !== "string" || !value[key])
            return null;
    }
    if (value.parentSessionId === value.sessionId || typeof value.task !== "string"
        || !["running", "completed", "failed", "aborted"].includes(String(value.status))
        || !Number.isFinite(Date.parse(value.createdAt as string)))
        return null;
    if (value.ownerPid !== undefined && (typeof value.ownerPid !== "number" || !Number.isSafeInteger(value.ownerPid) || value.ownerPid <= 0))
        return null;
    if (value.error !== undefined && typeof value.error !== "string")
        return null;
    if (value.completedAt !== undefined && (typeof value.completedAt !== "string" || !Number.isFinite(Date.parse(value.completedAt))))
        return null;
    return value as unknown as NativeSubagentRecord;
}
export function readNativeSubagentRecord(entries: readonly SessionEntry[], id: string): NativeSubagentRecord | null {
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry.type !== "custom" || entry.customType !== NATIVE_SUBAGENT_TYPE)
            continue;
        const run = nativeSubagentRecord(entry.data);
        if (run?.sessionId === id)
            return run;
    }
    return null;
}
export interface NativeSubagentTask {
    version: 1;
    sessionId: string;
    runId: string;
    task: string;
    instructions?: string;
}
/** Entries must be from the active branch; never reuse another run's instructions. */
export function readNativeSubagentTask(entries: readonly SessionEntry[], sessionId: string): NativeSubagentTask | null {
    const run = readNativeSubagentRecord(entries, sessionId);
    if (!run)
        return null;
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry.type !== "custom" || entry.customType !== "subagent:task")
            continue;
        const data = entry.data;
        if (!isRecord(data) || data.version !== 1 || data.sessionId !== sessionId || data.runId !== run.runId
            || typeof data.task !== "string" || (data.instructions !== undefined && typeof data.instructions !== "string"))
            continue;
        return {
            version: 1, sessionId, runId: run.runId, task: data.task,
            ...(typeof data.instructions === "string" ? { instructions: data.instructions } : {}),
        };
    }
    return null;
}
export function readNativeSubagentRun(entries: readonly SessionEntry[], id: string, path: string): SubagentRunInfo | null {
    const run = readNativeSubagentRecord(entries, id);
    return run ? nativeSubagentRun(run, path) : null;
}
export function nativeSubagentRun(run: NativeSubagentRecord, path: string): SubagentRunInfo {
    return {
        sessionId: run.sessionId, sessionPath: path, parentSessionId: run.parentSessionId, parentToolCallId: run.parentToolCallId,
        profile: run.agent, description: run.task.replace(/\s+/g, " ").slice(0, 120), task: run.task,
        runInBackground: false, status: run.status, createdAt: run.createdAt,
        ...(run.completedAt ? { completedAt: run.completedAt } : {}), ...(run.error ? { error: run.error } : {}),
    };
}
export interface SubagentReference {
    sessionId: string;
    profile: string;
    description: string;
    status: "completed" | "failed" | "aborted" | "interrupted";
    parentToolCallId: string;
    createdAt: string;
}
export function subagentResultReferences(message: unknown, timestamp: string): SubagentReference[] {
    if (!isRecord(message) || message.role !== "toolResult" || message.toolName !== "subagent"
        || !isRecord(message.details) || !Array.isArray(message.details.results))
        return [];
    const references: SubagentReference[] = [];
    for (const result of message.details.results) {
        const link = nativeSubagentLinks({ results: [result] })[0];
        if (!link || !isRecord(result))
            continue;
        references.push({ sessionId: link.sessionId, profile: link.label,
            description: typeof result.task === "string" ? result.task.replace(/\s+/g, " ").slice(0, 120) : link.label,
            status: result.stopReason === "aborted" ? "aborted" : result.exitCode === -1 ? "interrupted" : result.exitCode !== 0 || result.stopReason === "error" ? "failed" : "completed",
            parentToolCallId: typeof message.toolCallId === "string" ? message.toolCallId : "", createdAt: timestamp, });
    }
    return references;
}
export function nativeSubagentLinks(details: unknown): Array<{
    sessionId: string;
    label: string;
}> {
    if (!isRecord(details) || !Array.isArray(details.results))
        return [];
    const links = new Map<string, {
        sessionId: string;
        label: string;
    }>();
    for (const result of details.results) {
        if (!isRecord(result) || typeof result.sessionId !== "string")
            continue;
        const match = /^pi:([A-Za-z0-9][A-Za-z0-9._-]*)(?:#\d+)?$/.exec(result.sessionId);
        if (!match)
            continue;
        const sessionId = match[1];
        links.set(sessionId, { sessionId, label: typeof result.agent === "string" ? result.agent : "Subagent" });
    }
    return [...links.values()];
}
