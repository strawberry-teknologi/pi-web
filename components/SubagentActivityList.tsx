"use client";

import { useI18n } from "@/hooks/useI18n";
import type { SubagentActivity } from "@/lib/subagent-progress";

export function SubagentActivityList({ activities }: { activities: readonly SubagentActivity[] }) {
  const { t, locale } = useI18n();
  const recent = activities.slice(-8).reverse();
  return (
    <section aria-label={t("subagent.activity.title")} style={{ padding: "16px 16px 8px" }}>
      <h3 style={{ fontSize: 12, fontWeight: 600, margin: "0 0 16px" }}>{t("subagent.activity.title")}</h3>
      {recent.length === 0 ? (
        <p style={{ color: "var(--text-dim)", fontSize: 12 }}>{t("subagent.activity.empty")}</p>
      ) : (
        <ol style={{ listStyle: "none", padding: 0, margin: "0 0 0 4px" }}>
          {recent.map((activity, index) => {
            const output = activity.details ? activity.details.output : activity.output || activity.preview;
            return (
              <li key={activity.id} style={{ position: "relative", borderLeft: index === recent.length - 1 ? "1px solid transparent" : "1px solid var(--border)", padding: "0 0 18px 16px" }}>
                <span aria-hidden="true" style={{ position: "absolute", left: -4, top: 5, width: 7, height: 7, borderRadius: "50%", background: activity.isError ? "#dc2626" : index === 0 ? "var(--accent)" : "var(--border)" }} />
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 11, minHeight: 36 }}>
                    <span style={{ display: "inline-flex", width: "calc(100% - 18px)", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: "4px 10px" }}>
                      <strong style={{ fontWeight: 600, overflowWrap: "anywhere", minWidth: 0 }}>{activity.toolName || t("subagent.activity.message")}</strong>
                      {activity.isError && <span style={{ color: "#dc2626" }}>{t("agentSwitcher.status.failed")}</span>}
                      {activity.timestamp !== undefined && (
                        <time dateTime={new Date(activity.timestamp).toISOString()} title={new Date(activity.timestamp).toLocaleString(locale)} style={{ color: "var(--text-dim)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", marginLeft: "auto" }}>
                          {new Date(activity.timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </time>
                      )}
                    </span>
                    <span style={{ display: "block", marginTop: 5, color: "var(--text-muted)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: activity.toolName ? "var(--font-mono)" : undefined }}>{activity.preview || activity.output}</span>
                  </summary>
                  {activity.details?.input && (
                    <>
                      <div style={{ marginTop: 8, color: "var(--text-dim)", fontSize: 11 }}>{t("tools.parameters")}</div>
                      <pre style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{activity.details.input}</pre>
                    </>
                  )}
                  {output && (
                    <pre style={{ margin: "8px 0 0", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--tool-bg)", color: "var(--text-muted)", fontSize: 12, fontFamily: activity.toolName ? "var(--font-mono)" : "inherit", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{output}</pre>
                  )}
                </details>
              </li>
            );
          })}
        </ol>
      )}
      <p style={{ margin: "0 0 8px", color: "var(--text-dim)", fontSize: 11 }}>{t("subagent.activity.hint")}</p>
    </section>
  );
}
