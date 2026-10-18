import type { AgentMessage } from "./types";

export interface SubagentActivity {
  id: string;
  toolName?: string;
  preview: string;
  output?: string;
  timestamp?: number;
  isError: boolean;
}

function preview(text: string, limit = 180): string {
  return text.trim().replace(/\s+/g, " ").slice(0, limit);
}

/** Recorded activity only: never expose thinking or treat the delegated task as progress. */
export function getSubagentActivities(messages: readonly AgentMessage[], entryIds: readonly string[]): SubagentActivity[] {
  const activities = new Map<string, SubagentActivity>();
  messages.forEach((message, index) => {
    const timestamp = message.timestamp;
    const time = typeof timestamp === "number" && Number.isFinite(new Date(timestamp).getTime()) ? { timestamp } : {};
    if (message.role === "assistant") {
      const endedAt = time.timestamp !== undefined && typeof message.durationMs === "number" && Number.isFinite(message.durationMs)
        ? time.timestamp + Math.max(0, message.durationMs)
        : time.timestamp;
      const end = endedAt !== undefined && Number.isFinite(new Date(endedAt).getTime()) ? { timestamp: endedAt } : time;
      const text = message.errorMessage || message.content.filter((block) => block.type === "text").map((block) => block.text).join(" ");
      if (text.trim()) {
        const id = `${entryIds[index] ?? index}:text`;
        activities.set(id, { id, preview: preview(text), ...end, isError: Boolean(message.errorMessage || message.stopReason === "error") });
      }
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        const value = block.input.command ?? block.input.path ?? block.input.file_path ?? block.input.pattern ?? block.input.query;
        const id = `tool:${block.toolCallId}`;
        activities.set(id, { id, toolName: block.toolName, preview: typeof value === "string" ? preview(value) : "", ...end, isError: false });
      }
    } else if (message.role === "toolResult") {
      const id = `tool:${message.toolCallId}`;
      const call = activities.get(id);
      const output = preview(message.content.filter((block) => block.type === "text").map((block) => block.text).join(" "), 240);
      // A result moves its call to the end, including when parallel tools finish out of order.
      activities.delete(id);
      activities.set(id, {
        id, toolName: message.toolName ?? call?.toolName,
        preview: call?.preview ?? "", output,
        ...(call?.timestamp !== undefined ? { timestamp: call.timestamp } : {}),
        ...time, isError: Boolean(message.isError),
      });
    }
  });
  return [...activities.values()];
}
