import { getSupabaseAdminClient, isSupabaseConfigured } from "@/lib/database/supabase";
import type { ApprovalRequest, CollaborativeTask, Conversation } from "@/types/relay";

export interface CloudSyncResult {
  mode: "cloud_supabase" | "local_demo";
  synced: boolean;
  reason?: string;
}

/**
 * Verifies a Supabase user JWT from the Authorization header on the server.
 * Never trusts a client-supplied userId without token verification.
 */
export async function verifySupabaseBearerUser(
  authHeader: string | null
): Promise<{ userId: string; email?: string } | null> {
  if (!isSupabaseConfigured() || !authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const admin = getSupabaseAdminClient();
  if (!admin) return null;

  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return { userId: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}

export async function syncWorkspaceSnapshotToSupabase(params: {
  userId: string;
  conversation?: Conversation;
  task?: CollaborativeTask;
  approval?: ApprovalRequest;
}): Promise<CloudSyncResult> {
  const admin = getSupabaseAdminClient();
  if (!admin) {
    return {
      mode: "local_demo",
      synced: false,
      reason: "Supabase service credentials not configured.",
    };
  }

  try {
    if (params.conversation) {
      await admin.from("conversations").upsert({
        id: params.conversation.id,
        user_id: params.userId,
        title: params.conversation.title,
        objective: params.conversation.objective,
        mode: params.conversation.mode,
        is_demo_simulated: params.conversation.isSimulated,
        status: params.conversation.status,
      });
    }

    if (params.task) {
      await admin.from("tasks").upsert({
        id: params.task.id,
        user_id: params.userId,
        conversation_id: params.task.conversationId,
        title: params.task.title,
        objective: params.task.objective,
        status: params.task.status,
        feedback_stage: params.task.feedbackStage,
        plan_approved: params.task.planApproved,
        progress: params.task.progress,
        confidence_score: params.task.confidenceScore,
        reasoning_summary: params.task.reasoningSummary,
        final_output: params.task.finalOutput ?? null,
        checkpoints: params.task.checkpoints,
        is_demo_simulated: params.task.isSimulated,
      });
    }

    if (params.approval) {
      await admin.from("approvals").upsert({
        id: params.approval.id,
        user_id: params.userId,
        task_id: params.approval.taskId,
        step_id: params.approval.stepId,
        agent_slug: params.approval.agentSlug,
        action_title: params.approval.actionTitle,
        action_description: params.approval.actionDescription,
        recommendation_reason: params.approval.recommendationReason,
        expected_result: params.approval.expectedResult,
        supporting_evidence: params.approval.supportingEvidence,
        potential_risks: params.approval.potentialRisks,
        alternative_actions: params.approval.alternativeActions,
        confidence: params.approval.confidence,
        status: params.approval.status,
        human_feedback: params.approval.humanFeedback ?? null,
        selected_alternative: params.approval.selectedAlternative ?? null,
        decided_at: params.approval.decidedAt ?? null,
      });
    }

    return { mode: "cloud_supabase", synced: true };
  } catch (err) {
    return {
      mode: "cloud_supabase",
      synced: false,
      reason: err instanceof Error ? err.message : "Database persistence error",
    };
  }
}
