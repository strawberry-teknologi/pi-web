import { NextResponse } from "next/server";
import { statSync } from "node:fs";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { listNativeSubagentProfiles, saveNativeSubagentProfile, deleteNativeSubagentProfile } from "@/lib/native-subagent-profiles";
import type { SubagentProfile, SubagentWritableScope } from "@/lib/subagents";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
export const dynamic = "force-dynamic";
async function context(cwd: unknown) {
    if (typeof cwd !== "string" || !cwd || !statSync(cwd, { throwIfNoEntry: false })?.isDirectory())
        throw new Error("Valid cwd required");
    const roots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, roots))
        throw new Error("Access denied");
    return { cwd, roots };
}
function scope(value: unknown): SubagentWritableScope {
    if (value !== "global" && value !== "project")
        throw new Error("scope must be global or project");
    return value;
}
function failure(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
}
function guard(req: Request) {
    if (!isApiRequestAllowed(req))
        return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
    if (!hasJsonContentType(req))
        return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    return null;
}
export async function GET(req: Request) {
    try {
        const { cwd, roots } = await context(new URL(req.url).searchParams.get("cwd"));
        return NextResponse.json({ profiles: listNativeSubagentProfiles(cwd, roots) });
    }
    catch (error) {
        return failure(error);
    }
}
export async function PUT(req: Request) {
    const denied = guard(req);
    if (denied)
        return denied;
    try {
        const body = await req.json() as {
            cwd?: unknown;
            scope?: unknown;
            profile?: SubagentProfile;
        };
        const { cwd, roots } = await context(body.cwd);
        if (!body.profile || typeof body.profile.name !== "string")
            throw new Error("profile required");
        return NextResponse.json({ profile: saveNativeSubagentProfile(cwd, scope(body.scope), body.profile, roots) });
    }
    catch (error) {
        return failure(error);
    }
}
export async function PATCH(req: Request) {
    const denied = guard(req);
    if (denied)
        return denied;
    return NextResponse.json({ error: "Profile activation is not supported by the subagent extension. Remove a profile to stop offering it." }, { status: 410 });
}
export async function DELETE(req: Request) {
    const denied = guard(req);
    if (denied)
        return denied;
    try {
        const body = await req.json() as {
            cwd?: unknown;
            scope?: unknown;
            name?: unknown;
        };
        const { cwd, roots } = await context(body.cwd);
        if (typeof body.name !== "string")
            throw new Error("name required");
        deleteNativeSubagentProfile(cwd, scope(body.scope), body.name, roots);
        return NextResponse.json({ ok: true });
    }
    catch (error) {
        return failure(error);
    }
}
