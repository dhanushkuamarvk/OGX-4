-- ============================================================================
-- RELAY AI — Complete Supabase PostgreSQL Schema
-- Intelligent Human-Agent Collaboration Platform
-- Includes all 11 core tables, relational integrity, constraints, triggers,
-- indexes, and strict Row Level Security (RLS) policies.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Utility trigger for updated_at timestamps
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1. USERS
-- Mirrors auth.users with profile metadata and adaptive autonomy preferences
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL DEFAULT 'Collaborator',
  role TEXT NOT NULL DEFAULT 'researcher' CHECK (role IN ('researcher', 'admin', 'participant', 'demo')),
  avatar_url TEXT,
  autonomy_preference TEXT NOT NULL DEFAULT 'balanced' CHECK (autonomy_preference IN ('supervised', 'balanced', 'high_autonomy')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 2. AGENTS
-- Specialized agents (Research, Planning, Execution) with live status & metrics
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL CHECK (slug IN ('research-agent', 'planning-agent', 'execution-agent')),
  name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'working', 'paused', 'waiting_approval', 'offline')),
  autonomy_level NUMERIC(4, 2) NOT NULL DEFAULT 0.65 CHECK (autonomy_level >= 0 AND autonomy_level <= 1),
  override_rate NUMERIC(4, 2) NOT NULL DEFAULT 0.00 CHECK (override_rate >= 0 AND override_rate <= 1),
  tasks_completed INTEGER NOT NULL DEFAULT 0 CHECK (tasks_completed >= 0),
  avg_confidence NUMERIC(4, 2) NOT NULL DEFAULT 0.85 CHECK (avg_confidence >= 0 AND avg_confidence <= 1),
  current_task_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, slug)
);

CREATE TRIGGER trg_agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 3. CONVERSATIONS
-- Interactive human-agent collaboration sessions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'relay_ai' CHECK (mode IN ('relay_ai', 'baseline')),
  is_demo_simulated BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 4. TASKS
-- Stateful orchestrated tasks with strict state machine transitions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'planning', 'awaiting_plan_approval', 'running', 'waiting_for_approval', 'paused', 'completed', 'failed', 'cancelled')
  ),
  feedback_stage INTEGER NOT NULL DEFAULT 1 CHECK (feedback_stage >= 1 AND feedback_stage <= 11),
  plan_approved BOOLEAN NOT NULL DEFAULT FALSE,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  confidence_score NUMERIC(4, 2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  reasoning_summary TEXT,
  final_output TEXT,
  checkpoints JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_demo_simulated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON public.tasks (user_id, status);
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 5. TASK_STEPS
-- Individual editable, reorderable, lockable steps within a task plan
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL CHECK (step_order >= 0),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assigned_agent TEXT NOT NULL CHECK (assigned_agent IN ('research-agent', 'planning-agent', 'execution-agent')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'planning', 'running', 'waiting_for_approval', 'completed', 'failed', 'skipped')
  ),
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  edited_by_human BOOLEAN NOT NULL DEFAULT FALSE,
  confidence NUMERIC(4, 2) CHECK (confidence >= 0 AND confidence <= 1),
  dependencies TEXT[] NOT NULL DEFAULT '{}',
  output TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_steps_task_order ON public.task_steps (task_id, step_order);
CREATE TRIGGER trg_task_steps_updated_at
  BEFORE UPDATE ON public.task_steps
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 6. MESSAGES
-- Messages and activity cards inside a collaboration conversation
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('human', 'research-agent', 'planning-agent', 'execution-agent', 'system')),
  message_type TEXT NOT NULL DEFAULT 'chat' CHECK (message_type IN ('chat', 'plan_proposal', 'activity_update', 'approval_request', 'artifact', 'baseline_response')),
  content TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages (conversation_id, created_at);

-- ----------------------------------------------------------------------------
-- 7. APPROVALS
-- Human-in-the-loop approval gates with full rationale, risks, & alternatives
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.task_steps(id) ON DELETE SET NULL,
  agent_slug TEXT NOT NULL CHECK (agent_slug IN ('research-agent', 'planning-agent', 'execution-agent')),
  action_title TEXT NOT NULL,
  action_description TEXT NOT NULL,
  recommendation_reason TEXT NOT NULL,
  expected_result TEXT NOT NULL,
  supporting_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  potential_risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  alternative_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC(4, 2) CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'edited_and_approved')),
  human_feedback TEXT,
  selected_alternative TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approvals_user_status ON public.approvals (user_id, status);
CREATE TRIGGER trg_approvals_updated_at
  BEFORE UPDATE ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 8. AGENT_ACTIVITIES
-- Immutable audit log of every human & agent action for Explainability & History
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  agent_slug TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('plan', 'research', 'execution', 'approval', 'human_edit', 'state_change', 'workflow', 'evaluation')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  influencing_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  alternatives JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC(4, 2) CHECK (confidence >= 0 AND confidence <= 1),
  is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_user_created ON public.agent_activities (user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 9. WORKFLOWS
-- React Flow visual workflow definitions connected to the orchestration engine
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_run_status TEXT NOT NULL DEFAULT 'idle' CHECK (last_run_status IN ('idle', 'running', 'waiting_for_approval', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_workflows_updated_at
  BEFORE UPDATE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 10. EVALUATIONS
-- Controlled experiment runs comparing Baseline vs. RELAY AI
-- user_id may be null for anonymous crossover study participants logged via server
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  participant_code TEXT NOT NULL,
  task_template_id TEXT NOT NULL,
  task_title TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('baseline', 'relay_ai')),
  is_sample_data BOOLEAN NOT NULL DEFAULT FALSE,
  completed_successfully BOOLEAN NOT NULL DEFAULT FALSE,
  completion_time_sec NUMERIC(10, 2) NOT NULL CHECK (completion_time_sec >= 0),
  interaction_count INTEGER NOT NULL DEFAULT 0 CHECK (interaction_count >= 0),
  approval_count INTEGER NOT NULL DEFAULT 0 CHECK (approval_count >= 0),
  rejection_count INTEGER NOT NULL DEFAULT 0 CHECK (rejection_count >= 0),
  plan_edit_count INTEGER NOT NULL DEFAULT 0 CHECK (plan_edit_count >= 0),
  interrupt_count INTEGER NOT NULL DEFAULT 0 CHECK (interrupt_count >= 0),
  mid_task_change_handled BOOLEAN NOT NULL DEFAULT FALSE,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  failure_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evaluations_user_condition ON public.evaluations (user_id, condition, is_sample_data);

-- ----------------------------------------------------------------------------
-- 11. EVALUATION_RESPONSES
-- NASA-TLX, Trust, Perceived Control, and Decision Quality questionnaire scores
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evaluation_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id UUID NOT NULL REFERENCES public.evaluations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  user_effort_score NUMERIC(4, 2) NOT NULL CHECK (user_effort_score >= 1 AND user_effort_score <= 7),
  human_control_score NUMERIC(4, 2) NOT NULL CHECK (human_control_score >= 1 AND human_control_score <= 7),
  user_trust_score NUMERIC(4, 2) NOT NULL CHECK (user_trust_score >= 1 AND user_trust_score <= 7),
  decision_quality_score NUMERIC(4, 2) NOT NULL CHECK (decision_quality_score >= 1 AND decision_quality_score <= 7),
  nasa_tlx_mental_demand INTEGER CHECK (nasa_tlx_mental_demand >= 0 AND nasa_tlx_mental_demand <= 100),
  nasa_tlx_frustration INTEGER CHECK (nasa_tlx_frustration >= 0 AND nasa_tlx_frustration <= 100),
  qualitative_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Every user can only access and mutate records they own.
-- ============================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own profile" ON public.users
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "Users manage own agents" ON public.agents
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own conversations" ON public.conversations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own tasks" ON public.tasks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own task_steps" ON public.task_steps
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own messages" ON public.messages
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own approvals" ON public.approvals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own agent_activities" ON public.agent_activities
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own workflows" ON public.workflows
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own evaluations" ON public.evaluations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own evaluation_responses" ON public.evaluation_responses
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
