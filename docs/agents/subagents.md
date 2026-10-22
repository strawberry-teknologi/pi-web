# Subagents: native extension execution

## Ownership

- Pi Web no longer registers `Agent`, `get_subagent_result`, or `steer_subagent` and has no integrated spawn controller. Ordinary sessions load the installed `subagent` extension through Pi's normal extension discovery. No fallback backend is installed when that extension is absent. Chat only still loads no extensions.
- The extension owns profile discovery, single/parallel/chain dispatch, model fallback, native `pi:<id>` resume handles, subprocesses and cancellation. Pi Web consumes its generic lifecycle, rather than wrapping its tool or extending `ctx.ui` / the extension request protocol. Native `subagent` stays active across branch navigation/preset changes, as `codemode` and `tool_search` do.
- On this machine the installed extension resolves to the separate `pi-extensions` checkout (`~/.pi/agent/extensions/subagent/`, source `/Users/ndjoe/codes/strawberry.co.id/pi-extensions/subagent`). A Pi Web-only commit/deployment does not include changes to that code. Reload sessions after updating the extension. Coordinate a production rebuild/restart separately and never interrupt active agents without approval.

## Generic local lifecycle contract

- Before launching Pi, the extension creates a child through public `SessionManager` APIs with `parentSession` in its header. Its first custom entry is `subagent:run`: `version: 1`, `sessionId`, `sessionPath`, `runId`, `parentSessionId`, `parentSessionPath`, `parentToolCallId`, `agent`, bounded display `task`, `createdAt`, `ownerPid`, and `status`. The short metadata entry keeps the catalog's bounded prefix probe valid for large tasks. The child's actual prompt is unchanged.
- The file is persisted before any model response, so early CLI/credentials failures remain inspectable. The extension emits the same record on standard `pi.events` channel `subagent:run`; native result `details.results[]` and handles retain their existing shape. Final records add `completedAt` and optional `error`, with `completed`, `failed`, or `aborted`. A resume appends a fresh run ID to the same child and refuses another parent's child or one whose execution owner is still alive.
- Only the extension owns process handles. `subagent:abort` requests identify child and parent and include an in-process acknowledgement callback; there is no client/file PID-kill API. Register cancellation before announcing the child, including the pre-spawn window. Stop, parent abort and shutdown wait for close, remove listeners and clear escalation timers. A child ignoring SIGTERM receives SIGKILL after five seconds; `proc.killed` only means a signal was sent, not that it exited.
- Write final child records only after close, under Pi's file mutation queue, using a freshly opened manager. Never append concurrently through a stale parent-held child manager. Never pass `PI_WEB_PASSWORD` to the local child.
- Paseo retains its existing transport and background semantics; the local-file bridge is not a remote-agent synchronizer.

## Web bridge, catalog and safety

- `lib/native-subagent-records.ts` is client-safe: validates native records, maps them to the existing run model, extracts local links and exact historical tool-result references. It imports only types from legacy structures.
- `lib/native-subagents.ts` consumes generic events on the event bus supplied to the resource loader. It tracks owned children across Next hot reload, acknowledges selective stop and contributes native IDs to the existing running poll. Catalog reads remember CLI-owned pending records; their bounded tails are refreshed while polling. A dead execution owner means interrupted, not forever running. PID existence is conservative liveness only, never permission to send a destructive signal; PID reuse can keep an interrupted CLI run conservatively busy until its record is repaired.
- `lib/session-reader.ts` reads native metadata in the existing bounded prefix/tail relation probe and returns `relation.kind: subagent`. Cached relation records re-check owner liveness even when file bytes did not change. Summary hydration must not flash a known child as an independent sidebar row.
- The incremental scanner keeps exact local child handles from parent `subagent` tool results (index version 2). A read-only catalog overlay associates pre-integration children when one unambiguous parent supplies their exact ID. It does not rewrite transcripts, infer from `Task:` titles, hide arbitrary chats, or discard sessions without enough evidence. References reset on full rewrites/deletion. Cyclic/conflicting inferences are refused.
- The selected-session lease reports native child activity through `hasRunningNativeSubagent()`, following parent links so hidden pages retain their stream while a descendant is running. It never loads the retired integrated spawn controller.
- `startRpcSession()` refuses native children, completed or not: the parent extension's resume owns continuation. Inspecting history/context/stats or opening the read-only viewer never starts a second writer. The agent switcher's child row opens the viewer instead of the main writable chat.
- Even a direct deletion refuses a family with an active native child. Stop through its owner first; a missing wrapper is not proof that a subprocess stopped. Bulk deletion retains its existing running-session protection. No stop error authorizes unlinking a running child file.
- `/api/subagents/[id]` reads native/historical run records and routes abort to a verified live owner's bridge. Retired live steering answers an explicit unsupported conflict; local resume uses the native tool, not a fake steering/background interface.

## Profiles and settings

- `lib/native-subagent-profiles.ts` and the profiles route expose the extension's user directory and nearest ancestor `.pi/agents` directory. No built-in profiles or `.agents/agents` scope are offered. Scope/name comparisons match the extension's exact names; preserve file-access and symlink boundaries.
- The editor owns name, description, system instructions, tools, and the complete model-reference text. Comma-separated fallback chains and thinking suffixes are not normalized into a single model selection. An empty tools selection means CLI defaults, not Chat only. Other tool names and unknown frontmatter in an existing file survive a save. Editing a symlink is refused rather than replacing its target implicitly.
- Built-in feature switches, profile-enable switches, max concurrent/turn controls, resource/MCP policies, inherited context and local-background settings are no longer advertised. Their old settings files are not migrated or silently rewritten. Retired mutations return 410. Settings status inspects an already-open wrapper for `subagent`, or says unknown; it does not load extensions or create a session just to inspect configuration.

## Historical integrated sessions

- `pi-web:subagent`, status/result entries and resource snapshots remain readable. Snapshot validation, isolated prompt restoration, legacy skill/extension scopes and MCP read-only guards must not broaden when opening historical sessions. Historical `Agent` result-card types remain in `lib/subagent-extension.ts`; it registers nothing.
- Legacy profile parsing helpers are not a spawn backend. Current product settings use only the native-profile adapter, and the old built-in settings cannot enable tools.

## Family statistics and viewer

- Existing family grouping, badge counts, batched statistics and bounded activity previews are reused. Reading `/api/sessions/stats` or context does not touch `/api/agent/` or start/reopen a child runtime. The main toolbar's spend stays the main session's; family totals live in the Agents panel.
- Native `subagent` cards render one local child link per result, including parallel/chain results; invalid or Paseo handles are not treated as local sessions. Historical `Agent` cards keep their links. Both open existing `agent:<id>` read-only viewer tabs beside files/terminals. Parallel/chain input previews show the agents' names, never an array coerced to `[object Object]`.
- Each of the viewer's eight latest activities is an independent, initially closed native disclosure. Expanding shows the full recorded tool input/output or assistant text, preserving whitespace and escaping markup; private thinking stays excluded. `getSubagentActivities(..., true)` includes full text only for the viewer; the stats route keeps bounded previews.
- Viewer polling, visibility rules, finished-entry activity view, full-transcript pagination and tab lifetime stay as before: no token-level streaming or invented percent complete. Child row selection is read-only; continue via the parent's native `subagent` call.

## Checks

- Web contract/catalog/ownership tests run in `npm test`. Run the actual installed-extension integration separately with `PI_WEB_SUBAGENT_EXTENSION_TEST_PATH=/path/to/subagent/index.ts node --experimental-strip-types --test lib/native-subagent.integration.test.mjs`; it uses fake child CLI processes, never provider requests.
- Run the extension's own tests and typecheck in its checkout too. They cover native routing/resume, pre-spawn stop, SIGKILL escalation, early failure persistence and ownership validation.
