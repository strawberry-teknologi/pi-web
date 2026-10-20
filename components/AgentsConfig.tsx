"use client";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ProjectTrustStatus, SubagentProfilesResponse } from "@/lib/api-types";
import { sendAgentCommand } from "@/lib/agent-client";
import { displayPathWithin, shortenPath } from "@/lib/display-path";
import type { SubagentProfile, SubagentWritableScope } from "@/lib/subagents";
import { getLastSettingsSelection, setLastSettingsSelection } from "@/lib/settings-navigation";
import { ConfigButton, ConfigDetail, ConfigDetailActions, ConfigDetailHeader, ConfigDetailHeaderInfo, ConfigDetailStack, ConfigEmptyState, ConfigField, ConfigFooter, ConfigListAction, ConfigPanelShell, ConfigSaveTarget, ConfigScopeTag, ConfigSidebar, ConfigSidebarGroupLabel, ConfigSidebarItem, ConfigSidebarList, ConfigSidebarText, ConfigSplitView, } from "./SettingsUi";
type EditableProfile = Pick<SubagentProfile, "name" | "description" | "systemPrompt" | "tools" | "model">;
const EMPTY_PROFILE: EditableProfile = { name: "custom-agent", description: "", systemPrompt: "", tools: [] };
const TOOL_OPTIONS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const inputStyle: CSSProperties = { width: "100%", minWidth: 0, height: 34, padding: "0 9px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontSize: 12 };
function editableProfile(profile: SubagentProfile): EditableProfile {
    return { name: profile.name, description: profile.description, systemPrompt: profile.systemPrompt, tools: [...profile.tools], ...(profile.model ? { model: profile.model } : {}) };
}
function profileKey(profile: Pick<SubagentProfile, "scope" | "name">): string { return `${profile.scope}:${profile.name}`; }
export function AgentsConfig({ cwd, sessionId = null, onClose, onReloaded, embedded = false }: {
    cwd: string;
    sessionId?: string | null;
    onClose: () => void;
    onReloaded?: () => void;
    embedded?: boolean;
    trust?: ProjectTrustStatus | null;
}) {
    const { t } = useI18n();
    const [profiles, setProfiles] = useState<SubagentProfile[]>([]);
    const [selectedKey, setSelectedKey] = useState<string | null>(() => getLastSettingsSelection("agents", cwd));
    const [draft, setDraft] = useState<EditableProfile>(EMPTY_PROFILE);
    const [creating, setCreating] = useState(false);
    const [targetScope, setTargetScope] = useState<SubagentWritableScope>("global");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savedOk, setSavedOk] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loaded, setLoaded] = useState<boolean | null>(null);
    const [reloading, setReloading] = useState(false);
    const selected = useMemo(() => profiles.find(profile => profileKey(profile) === selectedKey) ?? null, [profiles, selectedKey]);
    const loadProfiles = useCallback(async (preferred?: string) => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/subagents/profiles?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
            const data = await response.json() as Partial<SubagentProfilesResponse> & {
                error?: string;
            };
            if (!response.ok || data.error)
                throw new Error(data.error ?? `HTTP ${response.status}`);
            const next = data.profiles ?? [];
            setProfiles(next);
            const key = preferred ?? getLastSettingsSelection("agents", cwd);
            const chosen = next.find(profile => profileKey(profile) === key) ?? next.find(profile => profile.scope === "project") ?? next[0];
            setSelectedKey(chosen ? profileKey(chosen) : null);
            setCreating(false);
            if (chosen) {
                setDraft(editableProfile(chosen));
                setTargetScope(chosen.scope === "project" ? "project" : "global");
            }
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setLoading(false);
        }
    }, [cwd]);
    useEffect(() => { void loadProfiles(); }, [loadProfiles]);
    useEffect(() => { if (selectedKey)
        setLastSettingsSelection("agents", selectedKey, cwd); }, [cwd, selectedKey]);
    useEffect(() => {
        const controller = new AbortController();
        void fetch(`/api/subagents/settings${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`, { cache: "no-store", signal: controller.signal })
            .then(async (response) => { if (response.ok) {
            const data = await response.json();
            if (!controller.signal.aborted)
                setLoaded(typeof data.loaded === "boolean" ? data.loaded : null);
        } })
            .catch(() => { });
        return () => controller.abort();
    }, [sessionId, reloading]);
    const choose = (profile: SubagentProfile) => { setSelectedKey(profileKey(profile)); setDraft(editableProfile(profile)); setCreating(false); setTargetScope(profile.scope === "project" ? "project" : "global"); setError(null); setSavedOk(false); };
    const beginCreate = (source?: SubagentProfile) => {
        const base = source ? `${source.name}-copy` : "custom-agent";
        let name = base;
        let suffix = 2;
        while (profiles.some(profile => profile.name === name))
            name = `${base}-${suffix++}`;
        setDraft({ ...(source ? editableProfile(source) : EMPTY_PROFILE), name });
        setTargetScope(source?.scope === "project" ? "project" : "global");
        setSelectedKey(null);
        setCreating(true);
        setSavedOk(false);
        setError(null);
    };
    const update = <K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) => { setDraft(current => ({ ...current, [key]: value })); setSavedOk(false); };
    const save = async () => {
        setSaving(true);
        setError(null);
        setSavedOk(false);
        try {
            const response = await fetch("/api/subagents/profiles", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, scope: targetScope, profile: draft }) });
            const data = await response.json() as {
                profile?: SubagentProfile;
                error?: string;
            };
            if (!response.ok || data.error || !data.profile)
                throw new Error(data.error ?? `HTTP ${response.status}`);
            await loadProfiles(profileKey(data.profile));
            setSavedOk(true);
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setSaving(false);
        }
    };
    const remove = async () => {
        if (!selected || !window.confirm(t("agents.deleteConfirm", { name: selected.name })))
            return;
        setSaving(true);
        setError(null);
        try {
            const response = await fetch("/api/subagents/profiles", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, scope: selected.scope, name: selected.name }) });
            const data = await response.json() as {
                error?: string;
            };
            if (!response.ok || data.error)
                throw new Error(data.error ?? `HTTP ${response.status}`);
            await loadProfiles();
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setSaving(false);
        }
    };
    const reload = async () => {
        if (!sessionId)
            return;
        setReloading(true);
        setError(null);
        try {
            await sendAgentCommand(sessionId, { type: "reload" });
            onReloaded?.();
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setReloading(false);
        }
    };
    const displayedPath = creating ? (targetScope === "global" ? `~/.pi/agent/agents/${draft.name}.md` : `./.pi/agents/${draft.name}.md`) : selected?.filePath ? (selected.scope === "project" ? displayPathWithin(selected.filePath, cwd) : shortenPath(selected.filePath)) : "";
    return (<ConfigPanelShell embedded={embedded} title={t("common.agents")} subtitle={shortenPath(cwd)} closeLabel={t("agents.close")} onClose={onClose}>
   <div className="agents-feature-setting">
    <div className="agents-feature-copy"><strong>{t("agents.extensionTitle")}</strong><span>{t("agents.extensionDescription")}</span>{loaded === false && <span role="status">{t("agents.extensionMissing")}</span>}</div>
    {sessionId && <ConfigButton size="small" disabled={reloading || saving} onClick={() => void reload()}>{reloading ? t("agents.reloading") : t("agents.reloadSession")}</ConfigButton>}
   </div>
   <ConfigSplitView>
    <ConfigSidebar>
     <ConfigSidebarList>
      {loading ? <div style={{ padding: 10, color: "var(--text-dim)", fontSize: 12 }}>{t("agents.loading")}</div> : (["project", "global"] as const).map(scope => {
            const rows = profiles.filter(profile => profile.scope === scope);
            return rows.length > 0 && <div key={scope} className="config-sidebar-group"><ConfigSidebarGroupLabel>{t(`agents.scope.${scope}`)}</ConfigSidebarGroupLabel>{rows.map(profile => <ConfigSidebarItem key={profileKey(profile)} active={!creating && selectedKey === profileKey(profile)} onClick={() => choose(profile)}><ConfigSidebarText className="is-grow">{profile.name}</ConfigSidebarText></ConfigSidebarItem>)}</div>;
        })}
     </ConfigSidebarList>
     <ConfigListAction active={creating} onClick={() => beginCreate()}>{t("agents.new")}</ConfigListAction>
    </ConfigSidebar>
    <ConfigDetail><ConfigDetailStack className="is-fill">
     {!selected && !creating ? <ConfigEmptyState>{t("agents.empty")}</ConfigEmptyState> : <ConfigDetailStack>
      <ConfigDetailHeader>
       <ConfigDetailHeaderInfo>
        {creating ? <ConfigSaveTarget value={targetScope} label={t("config.saveTo")} options={(["global", "project"] as const).map(scope => ({ value: scope, label: t(`agents.scope.${scope}`), disabled: saving }))} path={displayedPath} onChange={setTargetScope}/> : <><ConfigScopeTag scope={targetScope}>{t(`agents.scope.${targetScope}`)}</ConfigScopeTag><span title={selected?.filePath} className="config-detail-path">{displayedPath}</span></>}
       </ConfigDetailHeaderInfo>
       <ConfigDetailActions>{selected && <><ConfigButton size="small" disabled={saving} onClick={() => beginCreate(selected)}>{t("agents.duplicate")}</ConfigButton><ConfigButton variant="danger" size="small" disabled={saving} onClick={() => void remove()}>{t("agents.delete")}</ConfigButton></>}</ConfigDetailActions>
      </ConfigDetailHeader>
      <ConfigField label={t("agents.name")}><input aria-label={t("agents.name")} style={inputStyle} disabled={saving || !creating} value={draft.name} onChange={event => update("name", event.target.value)}/></ConfigField>
      <ConfigField label={t("agents.description")}><input aria-label={t("agents.description")} style={inputStyle} disabled={saving} value={draft.description} onChange={event => update("description", event.target.value)}/></ConfigField>
      <ConfigField label={t("agents.prompt")}><textarea className="agents-system-prompt" aria-label={t("agents.prompt")} disabled={saving} value={draft.systemPrompt} onChange={event => update("systemPrompt", event.target.value)} style={{ ...inputStyle, height: 195, minHeight: 195, padding: 9, resize: "vertical", lineHeight: 1.5 }}/></ConfigField>
      <ConfigField label={t("agents.tools")}>
       <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px" }}>{TOOL_OPTIONS.map(tool => <label key={tool} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text-muted)" }}><input type="checkbox" disabled={saving} checked={draft.tools.includes(tool)} onChange={event => update("tools", event.target.checked ? [...draft.tools, tool] : draft.tools.filter(item => item !== tool))}/>{tool}</label>)}</div>
       <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{draft.tools.filter(tool => !TOOL_OPTIONS.includes(tool)).join(", ")}</span>
       <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{t("agents.extensionToolsHint")}</span>
      </ConfigField>
      <ConfigField label={t("agents.model")}><input aria-label={t("agents.model")} style={inputStyle} disabled={saving} value={draft.model ?? ""} placeholder={t("agents.inherit")} onChange={event => update("model", event.target.value || undefined)}/><span style={{ color: "var(--text-dim)", fontSize: 11 }}>{t("agents.extensionModelHint")}</span></ConfigField>
     </ConfigDetailStack>}
    </ConfigDetailStack></ConfigDetail>
   </ConfigSplitView>
   <ConfigFooter status={error && <span role="alert" style={{ color: "var(--error, #ef4444)" }}>{error}</span>}>
    {(selected || creating) && <ConfigButton variant="primary" disabled={saving || savedOk || !draft.name.trim()} onClick={() => void save()}>{savedOk ? t("i18n.saved") : saving ? t("agents.saving") : t("agents.save")}</ConfigButton>}
   </ConfigFooter>
  </ConfigPanelShell>);
}
