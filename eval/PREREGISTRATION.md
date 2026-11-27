# Preregistration: Co-Plan vs. Conventional Chat Under Mid-Task Requirement Changes

- **Project:** Co-Plan (Resurrect 2026, Problem 3 — Human-Agent Interaction)
- **Status:** Preregistered protocol prior to human participant data collection (no participant data collected yet)
- **Design:** Within-subjects, two-condition (`coplan` vs. `baseline`), counterbalanced across 3 matched tasks via a 12-row Latin square (`eval/counterbalancing.csv`).
- **Experimental Control Invariant:** Both conditions use the exact same `LLMClient`, provider, model, `temperature`, `max_tokens`, `top_p`, `SHARED_SYSTEM_PROMPT`, and `SHARED_TOOL_REGISTRY`. Only the interaction model differs.

---

## 1. Definition of Success
The Co-Plan shared-workspace interaction model is considered empirically successful if, on real (non-mock) LLM study sessions with `N >= 12` valid participants:
1. **Primary behavioral & experiential gains:** At least **two of H1, H2, H3** achieve statistically significant improvement after Holm-Bonferroni correction (`p_holm < 0.05`) in the predicted direction with at least a small-to-medium effect size (`|dz| >= 0.4` or `|r_rb| >= 0.3`), AND
2. **Quality safety gate (H4):** Deliverable quality in Co-Plan is statistically **non-inferior** to Baseline (lower bound of 95% CI for `Quality_coplan - Quality_baseline` strictly above `-0.75` points on the 0–10 rubric scale), AND
3. **Reliability gate:** Inter-rater agreement between the two blind raters reaches Cohen's weighted kappa `>= 0.70`, and no severe order/carryover confounding invalidates paired comparisons.

---

## 2. Preregistered Hypotheses

| ID | Hypothesis | Operational Metric | Direction / Criterion | Multiplicity Control |
|---|---|---|---|---|
| **H1** | **Lower Cognitive Workload** | Raw NASA-TLX (mean of 6 subscales, 0–100) | `TLX_coplan < TLX_baseline` | Holm-Bonferroni across H1–H4 (`α = 0.05`) |
| **H2** | **Shorter Recovery Time After Requirement Change** | `time_to_recover_ms = ts(first_useful_response) - ts(requirement_change_sent)` | `TTR_coplan < TTR_baseline` | Holm-Bonferroni across H1–H4 (`α = 0.05`) |
| **H3** | **Higher Perceived Control & Agency** | 6-item Control/Agency scale mean (1–7 Likert) | `Control_coplan > Control_baseline` | Holm-Bonferroni across H1–H4 (`α = 0.05`) |
| **H4** | **Non-Inferior Task Quality** | Blind dual-rater rubric score (0–10) | `Quality_coplan - Quality_baseline > -0.75` (non-inferiority margin `Δ = -0.75`) | Holm-Bonferroni across H1–H4 (`α = 0.05`) |

### Justification of H4 Non-Inferiority Margin (`Δ = -0.75` on 0–10 scale)
Each task rubric has 5 criteria scored `0–2` points (`0 = missing`, `1 = partial`, `2 = complete`, total `0–10`). A difference smaller than `0.75` points (`7.5%` of the scale) is strictly less than a single 1-point step on even one rubric criterion, representing a practically negligible quality difference while keeping required sample size feasible (`N = 12–24`) for a controlled HAI evaluation.

---

## 3. Metrics & Justification Table

| Metric | Source | What It Measures | What It Does NOT Measure | Key Limitations |
|---|---|---|---|---|
| **Task Quality (0–10)** | 2 blind human raters on fixed rubric (`eval/tasks/tasks.json`) | Substantive accuracy, constraint adherence, preservation of verified sections, executive structure | Speed, user effort, or aesthetic formatting beyond clarity | Subjective scoring variance (mitigated via blind dual rating + Cohen's κ) |
| **Completion Time (s)** | Raw JSONL logs (`last_ts - session_created`) | End-to-end wall-clock duration from launch to final deliverable | Cognitive effort or quality of output | Sensitive to participant reading/typing speed and upstream LLM latency variance |
| **Turns / Actions** | Raw JSONL logs | Interaction granularity (prompt turns in Baseline; steering/edit/lock/interrupt actions in Co-Plan) | Effort per action (clicking Lock ≠ writing a 150-word prompt) | Not directly comparable 1:1 in unit cost; interpreted alongside TLX and completion time |
| **Time to Recover (ms)** | Raw JSONL logs (`first_useful_response - requirement_change_sent`) | Responsiveness from injecting mid-task change to first actionable revised plan/draft | Whether the final document fully satisfies every detail of the change | Co-Plan's first useful response is a targeted `plan_patch`; Baseline returns a full rewritten draft, so we pair TTR with total completion time & H4 quality |
| **Override Rate** | Raw JSONL logs (Co-Plan rolling `N=8` window & session total) | Fraction of agent actions edited, rolled back, or rejected by human | Whether overrides were caused by agent mistakes vs. user perfectionism | Defined only for Co-Plan's decomposed step workspace (exploratory/descriptive) |
| **Rework Count** | Raw JSONL logs (invalidated steps + rollbacks in Co-Plan; revision turns in Baseline) | Magnitude of discarded or redone work triggered by steering or requirement pivots | Token cost of rework (tracked separately via `tokens_in`/`tokens_out`) | Different structural units across conditions; paired with total token count |
| **Error Rate** | Raw JSONL logs (`step_failed / step_started`) | Technical/LLM failure rate during execution | Semantic hallucinations not caught by schema validation | Dependent on live LLM provider stability |
| **Raw NASA-TLX (0–100)** | Post-task HTML survey (6 subscales, unweighted mean) | Subjective cognitive, temporal, effort, performance, physical, and frustration load | Objective task accuracy | Self-report bias; Raw TLX omits pairwise weighting (validated as equivalent by Hart, 2006) |
| **Trust in Automation (1–7)** | Post-task HTML survey (Jian et al., 2000, 12 items; items 1–5 reverse-scored) | Calibrated trust vs. suspicion in the AI collaborator | Over-trust / automation bias (must be checked against quality & overrides) | Captures post-hoc attitude rather than moment-to-moment reliance |
| **Perceived Control / Agency (1–7)** | Post-task HTML survey (6-item Likert scale) | Perceived steerability, transparency, safety against unwanted overwrites, and recovery ease | Objective steering effectiveness | Novel 6-item HAI scale; report internal consistency (Cronbach's α) alongside results |

---

## 4. Statistical Analysis Plan
1. **Data Integrity & Mock Exclusion Gate:** Load all JSONL logs from `/eval/raw_logs/`. **Abort loudly** if any log row contains `llm_provider == "mock"`. Exclude incomplete sessions (missing `requirement_change_sent` or `first_useful_response`, or network outage > 60s) and document every exclusion transparently.
2. **Normality Check:** For each paired difference vector `d_i = X_{i,coplan} - X_{i,baseline}`, run **Shapiro-Wilk** (`α = 0.05`).
   - If `p_shapiro >= 0.05`: run **paired t-test** and compute **Cohen's `dz = mean(d) / sd(d)`**.
   - If `p_shapiro < 0.05`: run **Wilcoxon signed-rank test** and compute **rank-biserial correlation `r_rb`**.
3. **Uncertainty:** Report **95% percentile bootstrap confidence intervals** (`B = 10,000` resamples, fixed seed) for every paired difference.
4. **Multiplicity Correction:** Apply **Holm-Bonferroni** step-down adjustment across the four primary hypotheses H1–H4.
5. **Order & Carryover Checks:** Compare `AB` (`coplan` first) vs. `BA` (`baseline` first) sequence groups on within-subject sums (`Y_1 + Y_2`, carryover test) and period differences (`Y_1 - Y_2`, period effect test).
6. **Inter-Rater Reliability:** Two raters independently score anonymized outputs (condition labels stripped) using the fixed 0–10 rubric. Report both unweighted and quadratic-weighted **Cohen's κ**. Disagreements `>= 2` points are adjudicated before final H4 analysis (pre-adjudication κ reported).
7. **Visualizations:** Plot full individual distributions (paired slopegraphs and boxplots overlaid with individual participant points) — never bare bar charts of means.
