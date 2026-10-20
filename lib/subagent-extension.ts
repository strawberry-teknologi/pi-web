import type { SubagentRunInfo } from "./subagents";
/** Historical Agent result details; retained only for old transcript cards. */
export interface SubagentToolDetails {
    kind: "pi-web-subagent";
    sessionId: string;
    profile: string;
    description: string;
    status: SubagentRunInfo["status"];
    runInBackground: boolean;
    createdAt: string;
    completedAt?: string;
    error?: string;
    worktreePath?: string;
    worktreeBranch?: string;
    worktreeCleanupError?: string;
}
