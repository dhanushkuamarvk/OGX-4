import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/database/supabase";
import {
  syncWorkspaceSnapshotToSupabase,
  verifySupabaseBearerUser,
} from "@/lib/database/persistence";

const SyncPayloadSchema = z.object({
  conversation: z.any().optional(),
  task: z.any().optional(),
  approval: z.any().optional(),
});

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      mode: "local_demo",
      synced: false,
      reason: "Supabase not configured — state persisted locally in browser storage.",
    });
  }

  const user = await verifySupabaseBearerUser(req.headers.get("authorization"));
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized: valid Supabase session token required for cloud sync." },
      { status: 401 }
    );
  }

  try {
    const body = await req.json();
    const parsed = SyncPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid sync payload" }, { status: 400 });
    }

    const result = await syncWorkspaceSnapshotToSupabase({
      userId: user.userId,
      conversation: parsed.data.conversation,
      task: parsed.data.task,
      approval: parsed.data.approval,
    });

    return NextResponse.json(result, { status: result.synced ? 200 : 502 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Persistence sync failed" },
      { status: 500 }
    );
  }
}
