import type { ModelsData } from "./models-cache";

export const SUBAGENT_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type SubagentThinkingLevel = typeof SUBAGENT_THINKING_LEVELS[number];
export type SubagentModelTarget = { reference: string; thinking?: SubagentThinkingLevel };
type Catalog = Pick<ModelsData, "modelList" | "thinkingLevels">;

export function parseSubagentModelChain(model?: string): SubagentModelTarget[] {
    return (model ?? "").split(",").map(part => part.trim()).filter(Boolean).map(part => {
        const suffix = part.match(/:(off|minimal|low|medium|high|xhigh|max)$/);
        return suffix ? { reference: part.slice(0, -suffix[0].length), thinking: suffix[1] as SubagentThinkingLevel } : { reference: part };
    });
}

export function serializeSubagentModelChain(targets: readonly SubagentModelTarget[]): string | undefined {
    return targets.map(target => `${target.reference}${target.thinking ? `:${target.thinking}` : ""}`).join(", ") || undefined;
}

export function findSubagentModel(reference: string, catalog: Catalog) {
    const normalized = reference.replace(/^pi\//, "");
    const exact = catalog.modelList.filter(model => `${model.provider}/${model.id}` === normalized);
    if (exact.length === 1) return exact[0];
    if (normalized.includes("/")) return undefined;
    const bare = catalog.modelList.filter(model => model.id === normalized);
    return bare.length === 1 ? bare[0] : undefined;
}

export function getSubagentThinkingLevels(target: SubagentModelTarget, catalog: Catalog): SubagentThinkingLevel[] {
    const model = findSubagentModel(target.reference, catalog);
    const advertised = model ? catalog.thinkingLevels[`${model.provider}:${model.id}`] : undefined;
    const levels = advertised === undefined ? [...SUBAGENT_THINKING_LEVELS] : advertised.filter((level): level is SubagentThinkingLevel => SUBAGENT_THINKING_LEVELS.some(known => known === level));
    return [...new Set([...levels, ...(target.thinking ? [target.thinking] : [])])];
}

export function addSubagentTool(tools: readonly string[], name: string): string[] {
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes(",")) throw new Error("Invalid tool name");
    return tools.includes(trimmed) ? [...tools] : [...tools, trimmed];
}
