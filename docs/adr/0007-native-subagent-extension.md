# 0007 — Delegate execution to the native subagent extension

## Status

Accepted. Supersedes the active-runtime decisions in ADRs 0003 and 0005; historical session formats remain supported.

## Decision

Pi Web stops shipping an integrated `Agent` spawn controller. The installed `subagent` extension is the sole delegation backend; its ordinary Pi CLI behavior, single/parallel/chain modes, router fallback and resume handles remain authoritative.

The extension persists generic parent-linked child lifecycle records and emits them over Pi's standard event bus. Pi Web reads that contract into its existing session-family, activity, statistics and read-only viewer surfaces. It neither changes Pi's extension API nor reimplements dispatch. Process cancellation stays with the extension that owns the handle, not a PID supplied by a client or a session file.

Existing `Task:` sidebar rows are associated only through exact child IDs recorded in parent tool results, using a read-only catalog overlay. Titles are never a subagent detector, and ambiguous/unproven sessions are retained. Native children cannot be reopened as in-process writable AgentSessions or deleted while active.

## Consequences

- Current settings edit only the extension's supported profile fields. Built-in activation/profile toggles and unsupported runtime policies disappear; old mutation endpoints refuse rather than perform no-ops.
- Live steering and local background collection are not emulated. Continue a child through the native tool's resume contract.
- Historical integrated transcripts and restrictive resource snapshots stay readable; retained compatibility code never registers the retired delegation tools.
- The external extension and Pi Web must be updated together. No hardcoded local import or second copy of the extension is bundled into Pi Web.

See [subagents.md](../agents/subagents.md) for the lifecycle, ownership and test contract.
