import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getRpcSession } from "@/lib/rpc-manager";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
    const id = new URL(req.url).searchParams.get("sessionId");
    const session = id ? getRpcSession(id) : undefined;
    return NextResponse.json({ implementation: "extension", loaded: session?.isAlive() ? session.inner.getAllTools().some(tool => tool.name === "subagent") : null });
}
export async function PUT(req: Request) {
    if (!isApiRequestAllowed(req))
        return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
    if (!hasJsonContentType(req))
        return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    return NextResponse.json({ error: "Built-in agents have been replaced by the subagent extension. Configure the extension through Plugins and agent profile files." }, { status: 410 });
}
