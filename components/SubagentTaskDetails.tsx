"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SubagentTaskView } from "./subagent-viewer-state";

export function SubagentTaskDetails({ view }: { view: SubagentTaskView }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const summaryStyle = { fontSize: 12, minHeight: 36, padding: "8px 0", cursor: "pointer" } as const;
  const textStyle = { fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.65, margin: "4px 0 12px" } as const;
  return (
    <div style={{ padding: "6px 16px", borderBottom: "1px solid var(--border)" }}>
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary style={summaryStyle}>{t("subagent.task.title")}</summary>
        <div style={{ color: "var(--text-dim)", fontSize: 11 }}>{t(view.separated ? "subagent.task.original" : "subagent.task.recorded")}</div>
        <p style={textStyle}>{view.task ?? t("subagent.task.unavailable")}</p>
        {view.instructions ? (
          <details style={{ marginBottom: 10, borderTop: "1px solid var(--border)" }}>
            <summary style={{ ...summaryStyle, color: "var(--text-muted)" }}>{t("subagent.task.instructions")}</summary>
            <p style={{ ...textStyle, color: "var(--text-muted)", paddingLeft: 14 }}>{view.instructions}</p>
          </details>
        ) : !view.separated && (
          <p style={{ color: "var(--text-dim)", fontSize: 11, margin: "4px 0 12px" }}>{t("subagent.task.notSeparated")}</p>
        )}
      </details>
      {!open && <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{view.task ?? t("subagent.task.unavailable")}</p>}
    </div>
  );
}
