"use client";

import { useEffect, useId, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ModelsData } from "@/lib/models-cache";
import { addSubagentTool, findSubagentModel, getSubagentThinkingLevels, parseSubagentModelChain, serializeSubagentModelChain, type SubagentModelTarget, type SubagentThinkingLevel } from "@/lib/subagent-profile-fields";
import { ConfigButton, ConfigField } from "./SettingsUi";

const TOOL_OPTIONS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
type Catalog = Pick<ModelsData, "modelList" | "thinkingLevels">;
const EMPTY_CATALOG: Catalog = { modelList: [], thinkingLevels: {} };

export function SubagentProfileFields({ cwd, model, tools, disabled = false, onModelChange, onToolsChange }: {
    cwd: string;
    model?: string;
    tools: string[];
    disabled?: boolean;
    onModelChange: (model: string | undefined) => void;
    onToolsChange: (tools: string[]) => void;
}) {
    const { t } = useI18n();
    const id = useId();
    const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
    const [loading, setLoading] = useState(true);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [modelFilter, setModelFilter] = useState("");
    const [customModel, setCustomModel] = useState("");
    const [modelError, setModelError] = useState<"invalid" | "virtual" | null>(null);
    const [toolFilter, setToolFilter] = useState("");
    const [customTool, setCustomTool] = useState("");
    const [toolError, setToolError] = useState(false);
    const [toolOptions, setToolOptions] = useState(() => [...new Set([...TOOL_OPTIONS, ...tools])]);
    const targets = parseSubagentModelChain(model);

    useEffect(() => {
        const controller = new AbortController();
        void fetch(`/api/models?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store", signal: controller.signal })
            .then(async response => {
                if (!response.ok) throw new Error("Model catalog unavailable");
                const data = await response.json() as Partial<ModelsData>;
                if (controller.signal.aborted) return;
                setCatalog({ modelList: data.modelList ?? [], thinkingLevels: data.thinkingLevels ?? {} });
                setCatalogError(data.modelError ?? null);
            })
            .catch(() => { if (!controller.signal.aborted) setFailed(true); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [cwd]);

    const changeTargets = (next: SubagentModelTarget[]) => onModelChange(serializeSubagentModelChain(next));
    const move = (index: number, offset: number) => {
        const next = [...targets];
        [next[index], next[index + offset]] = [next[index + offset], next[index]];
        changeTargets(next);
    };
    const addModel = () => {
        const trimmed = customModel.trim();
        const parsed = parseSubagentModelChain(trimmed);
        if (!trimmed || trimmed.includes(",") || parsed.length !== 1 || !parsed[0].reference) { setModelError("invalid"); return; }
        if (findSubagentModel(parsed[0].reference, catalog)?.isVirtual) { setModelError("virtual"); return; }
        changeTargets([...targets, parsed[0]]);
        setCustomModel("");
        setModelError(null);
    };
    const addTool = () => {
        try {
            const next = addSubagentTool(tools, customTool);
            setToolOptions(current => [...new Set([...current, ...next])]);
            onToolsChange(next);
            setCustomTool("");
            setToolError(false);
        } catch { setToolError(true); }
    };
    const modelChoices = catalog.modelList.filter(choice => !choice.isVirtual && `${choice.provider}/${choice.id} ${choice.name}`.toLocaleLowerCase().includes(modelFilter.trim().toLocaleLowerCase()));
    const toolChoices = toolOptions.filter(tool => tool.toLocaleLowerCase().includes(toolFilter.trim().toLocaleLowerCase()));

    return <div className="agents-profile-fields">
        <ConfigField label={t("agents.modelChain")}>
            <p className="agents-field-hint" id={`${id}-models-hint`}>{t("agents.extensionModelHint")}</p>
            {targets.length === 0 && <span className="agents-field-hint">{t("agents.inherit")}</span>}
            <ol className="agents-model-chain" aria-label={t("agents.modelChain")}>
                {targets.map((target, index) => {
                    const resolved = findSubagentModel(target.reference, catalog);
                    return <li className="agents-model-row" key={index}>
                        <span className="agents-model-reference">{target.reference}{!loading && !resolved && <span className="agents-field-hint">{t("agents.referenceUnavailable")}</span>}</span>
                        <div className="agents-model-controls">
                            <select aria-label={t("agents.targetThinking", { index: index + 1 })} disabled={disabled} value={target.thinking ?? ""} onChange={event => changeTargets(targets.map((item, position) => position === index ? { ...item, thinking: (event.target.value || undefined) as SubagentThinkingLevel | undefined } : item))}>
                                <option value="">{t("agents.thinkingInherit")}</option>
                                {getSubagentThinkingLevels(target, catalog).map(level => <option key={level} value={level}>{level}</option>)}
                            </select>
                            <ConfigButton size="small" aria-label={t("agents.moveTargetUp", { index: index + 1 })} disabled={disabled || index === 0} onClick={() => move(index, -1)}>{t("agents.moveUp")}</ConfigButton>
                            <ConfigButton size="small" aria-label={t("agents.moveTargetDown", { index: index + 1 })} disabled={disabled || index === targets.length - 1} onClick={() => move(index, 1)}>{t("agents.moveDown")}</ConfigButton>
                            <ConfigButton size="small" aria-label={t("agents.removeTarget", { index: index + 1 })} disabled={disabled} onClick={() => changeTargets(targets.filter((_, position) => position !== index))}>{t("agents.removeModel")}</ConfigButton>
                        </div>
                    </li>;
                })}
            </ol>
            <details className="agents-model-picker" onKeyDown={event => {
                if (event.key !== "Escape" || !event.currentTarget.open) return;
                event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
            }}>
                <summary>{t("agents.chooseModels")}</summary>
                <input className="agents-field-input" aria-label={t("agents.filterModels")} placeholder={t("agents.filterModels")} value={modelFilter} onChange={event => setModelFilter(event.target.value)}/>
                <div className="agents-choice-list">
                    {modelChoices.map(choice => {
                        const reference = `${choice.provider}/${choice.id}`;
                        const matches = (target: SubagentModelTarget) => findSubagentModel(target.reference, catalog) === choice;
                        return <label className="agents-choice" key={reference}>
                            <input type="checkbox" aria-label={reference} disabled={disabled} checked={targets.some(matches)} onChange={event => changeTargets(event.target.checked ? [...targets, { reference }] : targets.filter(target => !matches(target)))}/>
                            <span>{reference}<span className="agents-choice-name">{choice.name}</span></span>
                        </label>;
                    })}
                    {!loading && modelChoices.length === 0 && <span className="agents-field-hint">{t("agents.noModelMatches")}</span>}
                </div>
            </details>
            {loading && <span role="status" className="agents-field-hint">{t("agents.modelsLoading")}</span>}
            {(failed || catalogError) && <span role="status" className="agents-field-warning">{failed ? t("agents.catalogUnavailable") : catalogError}</span>}
            <div className="agents-field-add">
                <input className="agents-field-input" aria-label={t("agents.customModel")} placeholder={t("agents.customModel")} aria-invalid={modelError ? true : undefined} aria-describedby={modelError ? `${id}-model-error` : `${id}-models-hint`} disabled={disabled} value={customModel} onChange={event => { setCustomModel(event.target.value); setModelError(null); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addModel(); } }}/>
                <ConfigButton size="small" disabled={disabled} onClick={addModel}>{t("agents.addModel")}</ConfigButton>
            </div>
            {modelError && <span id={`${id}-model-error`} role="alert" className="agents-field-error">{t(modelError === "virtual" ? "agents.virtualModelError" : "agents.invalidModel")}</span>}
        </ConfigField>
        <ConfigField label={t("agents.tools")}>
            <input className="agents-field-input" aria-label={t("agents.filterTools")} placeholder={t("agents.filterTools")} value={toolFilter} onChange={event => setToolFilter(event.target.value)}/>
            <div className="agents-tool-choices">
                {toolChoices.map(tool => <label className="agents-choice" key={tool}><input type="checkbox" disabled={disabled} checked={tools.includes(tool)} onChange={event => onToolsChange(event.target.checked ? [...tools, tool] : tools.filter(item => item !== tool))}/><span>{tool}</span></label>)}
                {toolChoices.length === 0 && <span className="agents-field-hint">{t("agents.noToolMatches")}</span>}
            </div>
            <div className="agents-field-add">
                <input className="agents-field-input" aria-label={t("agents.customTool")} placeholder={t("agents.customTool")} aria-invalid={toolError || undefined} aria-describedby={toolError ? `${id}-tool-error` : undefined} disabled={disabled} value={customTool} onChange={event => { setCustomTool(event.target.value); setToolError(false); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addTool(); } }}/>
                <ConfigButton size="small" disabled={disabled} onClick={addTool}>{t("agents.addTool")}</ConfigButton>
            </div>
            {toolError && <span id={`${id}-tool-error`} role="alert" className="agents-field-error">{t("agents.invalidTool")}</span>}
            <p className="agents-field-hint">{t("agents.extensionToolsHint")}</p>
        </ConfigField>
    </div>;
}
