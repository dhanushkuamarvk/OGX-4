# Co-Plan vs. Baseline User Study Protocol

- **Target Sample:** `N = 12` (1 full balanced Latin square in `eval/counterbalancing.csv`; expandable to `N = 24` by duplicating two balanced squares).
- **Duration per Participant:** ~45 minutes total.
- **Pre-Flight Environment Check:** Confirm `.env` uses a **real LLM provider** (NOT `mock`), confirm the red/amber `"MOCK LLM"` banner is **absent** in both UIs, and verify `GET /health` reports identical model/parameters.

---

## 1. Informed Consent Form (Participant Handout)

> **Study Title:** Evaluating Shared-Workspace vs. Chat Interaction with AI Writing Assistants  
> **Purpose:** You are invited to participate in a ~45-minute research session comparing two interfaces for collaborating with an AI assistant on structured professional documents.  
> **Procedures:** You will complete two ~12-minute document drafting tasks—one using **Co-Plan** (a split-pane workspace with a visible step plan, locking, editing, and checkpoints) and one using a **Baseline Chat** interface. During each task, the facilitator will introduce one realistic mid-task requirement update. After each task you will complete a brief survey (`eval/survey/survey.html`).  
> **Data Collected:** Interaction telemetry (timestamps, clicks/edits, token counts, latencies), the final Markdown artifacts you create, and your survey responses—all keyed only by an anonymous participant ID (`P01`–`P12`). No personally identifiable information is stored in logs.  
> **Voluntary Participation:** Participation is completely voluntary. You may pause or withdraw at any time without penalty, and you may request deletion of your session logs by referencing your participant ID.  
> **Consent Signature:** By entering your participant ID and clicking "Start Session" (or signing below), you confirm you are 18+ and consent to participate.  
> Participant ID: `________`  Date: `____________`  Signature: `________________________`

---

## 2. Latin-Square Assignment (`eval/counterbalancing.csv`)
1. Generate or inspect the balanced 12-row schedule via `make counterbalancing` (`scripts/generate_counterbalancing.py`).
2. Assign the next unused `participant_id` (`P01`–`P12`).
3. Entering `participant_id` on the Co-Plan (`:5173`) or Baseline (`:5174`) launch screen queries `GET /assignment/{participant_id}` and automatically displays the participant's assigned Round 1 condition & task (with a one-click link if they should start on the other app), then automatically advances to Round 2 after Round 1 completes.

---

## 3. Session Timing Schedule (~45 Minutes)

| Block | Minutes | Activity |
|---|---|---|
| Welcome & Consent | 0–4 | Review consent form, assign `participant_id`, verify no `"MOCK LLM"` banner |
| Tool 1 Training | 4–9 | 5-minute guided walkthrough of assigned Round 1 tool on a toy prompt |
| **Round 1 Task** | 9–21 | 12-minute task; inject scripted `mid_task_requirement` at ~50% progress (minute ~5 or after step 2 completes / after first full baseline draft) |
| Round 1 Survey | 21–24 | Participant completes `eval/survey/survey.html` & saves JSON |
| Short Break | 24–26 | 2-minute cognitive reset |
| Tool 2 Training | 26–31 | 5-minute guided walkthrough of assigned Round 2 tool |
| **Round 2 Task** | 31–43 | 12-minute task; inject scripted `mid_task_requirement` at ~50% progress |
| Round 2 Survey & Debrief | 43–45 | Participant completes Round 2 survey + brief verbal debrief |

---

## 4. Five-Minute Training Scripts

### A) Co-Plan Training Script (5 Minutes)
1. **Orient to 3 panes (1 min):** Point out the **Shared Plan Tree** (left), **Shared Markdown Artifact** (center), and **Checkpoints / SSE Feed** (right). Explain that confidence is shown with an icon, `High/Medium/Low` label, bar, and numeric tooltip.
2. **Watch & Interrupt (1 min):** Start a toy prompt (`"Outline a 3-point team onboarding guide"`). Have the participant press **Interrupt** (`Alt+P`) mid-stream, observe **"Paused — state kept"**, type a steering note, and click **Resume**.
3. **Lock, Edit & Expand (1 min):** Have the participant **Lock** step 1 (explain locked steps are never overwritten during replanning), **Edit** step 2, and **Expand** step 3 into substeps.
4. **Co-Edit Artifact & Rollback (1 min):** Edit one line in the center Markdown pane and press `Ctrl+S` (**Sync Edits**). Then click **Roll Back Here** on an earlier checkpoint in the right pane and show state restoring cleanly.
5. **Requirement Change & Autonomy (1 min):** Show the **Requirement Change** (`Alt+R`) button and the **Autonomy (`L1`/`L2`/`L3`)** indicator (explaining how Co-Plan adapts automatically based on how often they steer/edit).

### B) Baseline Chat Training Script (5 Minutes)
1. **Orient to Chat UI (1 min):** Point out the task reference bar at top, conversation history in the center, and prompt composer at bottom.
2. **Prompt & Wait (2 min):** Have the participant send a toy prompt (`"Outline a 3-point team onboarding guide"`), observe the waiting spinner, and read the full reply once returned.
3. **Follow-Up Revision (2 min):** Have the participant send a follow-up revision message changing a constraint (e.g., `"Keep point 1 identical, rewrite point 2 for remote hires"`), and show the **Copy** button. Remind them to always specify clearly which sections they want kept vs. changed.

---

## 5. Verbatim Facilitator Script
- **Start of Task:**
  > *"Here is your task brief and source materials. Your goal is to produce the strongest, most accurate deliverable you can within 12 minutes. You are free to steer, edit, or revise as much as you need. Let me know if anything technical breaks, otherwise I won't advise on content. Go ahead whenever you're ready."*
- **At ~50% Progress (Minute ~5, OR right after Step 2 completes in Co-Plan / right after the first complete draft returns in Baseline):**
  > *"Quick stakeholder update—we just received a mandatory requirement change for this deliverable. Please incorporate this exact update into your document:"*  
  *(Read aloud and have the participant click **Use This Prompt** in Co-Plan's Requirement Change modal, or **Insert Requirement Change** in Baseline's top bar, then submit.)*
- **At Minute 10 (2-minute warning):**
  > *"Two minutes remaining—please focus on making sure all required sections and the updated constraint are cleanly reflected in your final document."*
- **At Minute 12:**
  > *"Time is up! Let's save your state and open the short post-task survey."*

---

## 6. Pilot Checklist (Run with 2–3 Pilot Participants Before Main Study)
Before recruiting the main `N = 12` cohort, run 2–3 pilot participants end-to-end and verify EVERY item below:
- [ ] **No Mock Data:** Confirm `.env` uses the real study LLM and zero rows in `eval/raw_logs/*.jsonl` contain `"llm_provider":"mock"`.
- [ ] **File Naming:** Confirm exact files `eval/raw_logs/{participant}_{task}_{condition}.jsonl` exist for every round of every pilot participant.
- [ ] **Monotonic Timestamps & Schema:** Run `python eval/export_csv.py` and verify 0 validation errors and strictly increasing `ts` per session.
- [ ] **Comparable Recovery Events:** Confirm BOTH `coplan` and `baseline` JSONL logs contain both `requirement_change_sent` and `first_useful_response`, and that `time_to_recover_ms` is positive and sensible.
- [ ] **Survey Completeness:** Confirm `survey_{participant}_{task}_{condition}.json` exported cleanly for both rounds with all 6 NASA-TLX, 12 Jian Trust, and 6 Control/Agency scores populated.
- [ ] **Task Timing Calibration:** Check whether pilot participants finished comfortably in 10–13 minutes; confirm the ~50% requirement injection fired naturally without awkward delays.
- [ ] **Blind Rater Dry-Run:** Strip condition labels from the pilot artifacts, have both raters score independently on the 0–10 rubric, and verify rubric wording produces κ `>= 0.70`.
- [ ] **Archive Pilot Logs:** Move pilot logs to `eval/raw_logs_pilot/` before launching the preregistered `N = 12` study.
