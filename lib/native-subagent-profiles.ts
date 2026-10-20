import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dump } from "js-yaml";
import { parseFrontmatter } from "./frontmatter";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { isExistingPathWithinRoots } from "./path-security";
import type { SubagentProfile, SubagentWritableScope } from "./subagents";
function projectDirectory(cwd: string): string {
    let current = resolve(cwd);
    while (true) {
        const dir = join(current, ".pi", "agents");
        if (existsSync(dir))
            return dir;
        const parent = dirname(current);
        if (parent === current)
            return join(resolve(cwd), ".pi", "agents");
        current = parent;
    }
}
function directory(cwd: string, scope: SubagentWritableScope): string {
    return scope === "global" ? join(getAgentDir(), "agents") : projectDirectory(cwd);
}
function allowed(path: string, scope: SubagentWritableScope, roots: Set<string>): boolean {
    return isExistingPathWithinRoots(path, scope === "global" ? new Set([getAgentDir()]) : roots);
}
function readProfile(file: string, scope: SubagentWritableScope): SubagentProfile | null {
    try {
        const { data, rest } = parseFrontmatter(readFileSync(file, "utf8"));
        if (!data || typeof data.name !== "string" || typeof data.description !== "string")
            return null;
        const rawTools = Array.isArray(data.tools) ? data.tools : typeof data.tools === "string" ? data.tools.split(",") : [];
        return {
            name: data.name, displayName: data.name, description: data.description, systemPrompt: rest.trim(),
            tools: rawTools.filter((tool): tool is string => typeof tool === "string").map(tool => tool.trim()).filter(Boolean),
            ...(typeof data.model === "string" ? { model: data.model } : {}),
            enabled: true, scope, filePath: file, loadSkills: false, loadExtensions: false, promptMode: "append", inheritContext: false, runInBackground: false,
        };
    }
    catch {
        return null;
    }
}
export function listNativeSubagentProfiles(cwd: string, roots: Set<string>): SubagentProfile[] {
    const profiles: SubagentProfile[] = [];
    for (const scope of ["global", "project"] as const) {
        const dir = directory(cwd, scope);
        if (!existsSync(dir) || !allowed(dir, scope, roots))
            continue;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (!entry.name.endsWith(".md") || (!entry.isFile() && !entry.isSymbolicLink()))
                continue;
            const file = join(dir, entry.name);
            if (!allowed(file, scope, roots))
                continue;
            const profile = readProfile(file, scope);
            if (profile)
                profiles.push(profile);
        }
    }
    return profiles.sort((a, b) => a.name.localeCompare(b.name));
}
function target(cwd: string, scope: SubagentWritableScope, name: string, roots: Set<string>): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))
        throw new Error("Invalid agent name");
    const dir = directory(cwd, scope);
    let ancestor = dir;
    while (!existsSync(ancestor))
        ancestor = dirname(ancestor);
    if (!allowed(ancestor, scope, roots))
        throw new Error("Agent directory is outside allowed roots");
    const source = listNativeSubagentProfiles(cwd, roots).find(profile => profile.scope === scope && profile.name === name);
    const file = source?.filePath ?? join(dir, `${name}.md`);
    // Atomic replacement must never replace an escaping or dangling symlink.
    try {
        if (lstatSync(file).isSymbolicLink())
            throw new Error("Agent file is a link; edit its source instead");
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            throw error;
    }
    if (existsSync(file) && !allowed(file, scope, roots))
        throw new Error("Agent file is outside allowed roots");
    return file;
}
export function saveNativeSubagentProfile(cwd: string, scope: SubagentWritableScope, profile: Pick<SubagentProfile, "name" | "description" | "systemPrompt" | "tools" | "model">, roots: Set<string>): SubagentProfile {
    if (typeof profile.description !== "string" || typeof profile.systemPrompt !== "string"
        || !Array.isArray(profile.tools) || profile.tools.some(tool => typeof tool !== "string" || !tool.trim() || tool.includes(","))
        || (profile.model !== undefined && typeof profile.model !== "string"))
        throw new Error("Invalid agent profile");
    const file = target(cwd, scope, profile.name, roots);
    const stored = existsSync(file) ? parseFrontmatter(readFileSync(file, "utf8")).data : {};
    const data: Record<string, unknown> = { ...stored, name: profile.name, description: profile.description, tools: profile.tools };
    if (profile.model?.trim())
        data.model = profile.model.trim();
    else
        delete data.model;
    mkdirSync(dirname(file), { recursive: true });
    writePrivateFileAtomicSync(file, `---\n${dump(data, { lineWidth: -1, noRefs: true })}---\n\n${profile.systemPrompt.trim()}\n`);
    return readProfile(file, scope)!;
}
export function deleteNativeSubagentProfile(cwd: string, scope: SubagentWritableScope, name: string, roots: Set<string>): void {
    const file = target(cwd, scope, name, roots);
    if (!existsSync(file))
        throw new Error("Agent profile not found");
    unlinkSync(file);
}
