# Evaluation Plan & Results — Topic 3: Human–Agent Interaction

## 1. Definition of Success

We define **SteerPlan** (`pages/1_Steerable.py`) as empirically successful relative to the **Baseline Chat** (`pages/2_Baseline.py`) on constrained multi-step decision tasks if real participant evaluation achieves the following pre-specified criteria:

1. **Primary — Output Quality (Blind Rated):** Statistically significant improvement in blind 2-rater rubric score (`quality_score`, 1–5 scale, `rubric.md`) with paired Wilcoxon $p < 0.05$, positive effect size ($d_z > 0.5$), and acceptable inter-rater reliability ($\kappa \ge 0.70$ or $\text{ICC}(2,1) \ge 0.75$).
2. **Primary — Calibrated Trust / Planted-Error Detection:** Higher rate of detecting and neutralizing planted factual errors (`noticed_error == "Yes"` corroborated by `error_description` and rubric Dimension 5 non-propagation) on planted-error tasks (`A`, `C`) compared to Baseline, without causing participants to distrust accurate recommendations on clean tasks (`B`, `D`).
3. **Secondary — Perceived Control & Understanding:** Statistically significant increase in self-reported **Control** (`control`) and **Understanding** (`understood`) on 1–7 Likert scales ($p < 0.05$).
4. **Secondary — Manageable Cognitive Load:** NASA-TLX short-form dimensions (`mental_demand`, `effort`, `frustration`, 1–7) are lower than or non-inferior to Baseline (steering controls must not create excessive frustration or mental overload).
5. **Acceptable Efficiency Trade-off:** Moderate additional `time_on_task_sec` in SteerPlan (due to reviewing intermediate steps and intervening) is acceptable **only** when accompanied by gains in output quality, error detection, or perceived control.

---

## 2. Experimental Design (Within-Subjects, Counterbalanced)

- **Design:** Within-subjects two-condition study comparing **Steerable** (`pages/1_Steerable.py`) vs. **Baseline** (`pages/2_Baseline.py`). Every participant experiences both interfaces (~15 minutes total per participant).
- **Target Sample Size:** $N = 8\text{–}10$ participants (recruited from university/engineering students matching the domain of `tasks.json`).
- **Order Counterbalancing:** Automated by Participant ID parity in `app.py` (`_suggest_order`):
  - **Odd Participant IDs (`P01`, `P03`, ...):** Condition 1 = **Steerable** → Condition 2 = **Baseline** (`steerable_first`).
  - **Even Participant IDs (`P02`, `P04`, ...):** Condition 1 = **Baseline** → Condition 2 = **Steerable** (`baseline_first`).
- **Task Pairing (No Task Repetition):** Four structurally parallel Indian-context student research tasks (`tasks.json`), each with 4 explicit constraints and a 3-contender trade-off requirement:
  - **Task A** (*Coding & Study Laptop, $\le$ INR 65,000*) — `planted_error` present.
  - **Task B** (*5G Smartphone, $\le$ INR 25,000*) — `planted_error: null`.
  - **Task C** (*Online Data Science Track, $\le$ INR 12,000*) — `planted_error` present.
  - **Task D** (*Note-Taking & PDF Stack, $\le$ INR 3,500*) — `planted_error: null`.
  - Each participant receives two **distinct** tasks across their two conditions (e.g., one planted-error task and one clean task, balanced across Steerable and Baseline across participants so condition and planted-error presence are unconfounded).
- **Facilitator Isolation:** Participant ID, task selection, condition order, and the `planted_errors_enabled` toggle are configured exclusively on `app.py` before handing control to the participant.

---

## 3. Planted-Error Trust Test

To measure **calibrated trust** rather than mere subjective liking, Tasks `A` and `C` embed realistic, verifiable factual errors:

| Task | `step_index` | Planted `wrong_fact_text` (`tasks.json`) |
| :---: | :---: | :--- |
| **A** | `1` (2nd step) | *"Note from spec check: the Lenovo IdeaPad Slim 5 (16 GB / 512 GB) weighs 2.4 kg and includes only a 4-hour battery."* |
| **C** | `1` (2nd step) | *"Pricing check indicates the NPTEL / IIT Madras Data Science certification exam costs INR 28,000 per course."* |
| **B, D** | `null` | No planted error (false-alarm control tasks). |

### Injection & Measurement Protocol
- **Steerable condition (`agent.py` + `pages/1_Steerable.py`):** On the first execution of `step_index == 1`, `agent.advance()` appends `wrong_fact_text` to `step["output"]`, sets `state["planted_injected"] = True` and `state["_planted_done"] = True`, and passes the output to downstream steps via `Previous step outputs:` and `_maybe_finalize()`. `pages/1_Steerable.py` logs `planted_error_injected` exactly once when `state.get("planted_injected") is True`. If the participant catches the error and edits/re-runs the step, `_planted_done` prevents re-injection, enabling clean recovery.
- **Baseline condition (`pages/2_Baseline.py`):** When `planted_errors_enabled` is ON and `task["planted_error"]` is non-null, `wrong_fact_text` is appended to the assistant's response and `planted_error_injected` is logged.
- **Detection Scoring:** Two complementary signals:
  1. **Self-report (`questionnaire.py` → `logs/questionnaire.csv`):** Binary `noticed_error` (`Yes`/`No`) verified against free-text `error_description` (to exclude vague guesses or false alarms on Tasks `B`/`D`).
  2. **Behavioral / Output propagation (`rubric.md` Dimension 5 → `logs/ratings.csv`):** Blind raters check whether the final recommendation blindly repeated/relied on `wrong_fact_text` (capped at Score 1–2) vs. neutralized or explicitly corrected it (Score 3–5).

---

## 4. Metrics Table

| Metric | Operational Definition & Source | Justification | Limitations |
| :--- | :--- | :--- | :--- |
| **Output Quality (2 Blind Raters)** | Holistic 1–5 integer score per session averaged across two independent blind raters (`R1`, `R2`) using 5 rubric dimensions (`rubric.md` → `logs/ratings.csv`). Condition labels and UI logs are stripped prior to rating. | Directly measures task effectiveness (constraint adherence, factual accuracy, trade-off justification, actionability, and non-propagation of planted errors) without participant self-report bias. | Holistic 1–5 scale can mask sub-dimension trade-offs; requires rater calibration and adjudication for $\ge 2$-point discrepancies; susceptible to length bias if Steerable final syntheses are systematically longer. |
| **Time on Task** | Elapsed seconds from `session_start` to `session_end` per `(participant_id, condition)` (`logs/events.csv`, computed in `analysis.py`). | Captures the efficiency cost of plan inspection and interactive steering versus single-shot prompting. | Includes reading/thinking pauses and variable LLM API latency; longer time in Steerable may reflect constructive verification rather than usability friction. |
| **NASA-TLX Short Form** | Three 1–7 slider items (`mental_demand`, `effort`, `frustration`) collected immediately post-task (`questionnaire.py` → `logs/questionnaire.csv`). | Standard HCI workload instrument; tests whether plan supervision and intervention controls reduce frustration without inflating mental effort. | Short form omits physical demand, temporal demand, and self-assessed performance subscales and uses unweighted raw scores on 1–7 rather than 0–100 paired-weighting. |
| **Planted Errors Caught** | Proportion of planted-error sessions where participant reports `noticed_error == "Yes"` with valid `error_description` (`logs/questionnaire.csv`), cross-checked with rubric Dimension 5 (`logs/ratings.csv`). | Objective behavioral probe of over-reliance vs. calibrated skepticism under realistic LLM hallucination. | Current `analysis.py` computes `planted_error_caught` across *all* sessions rather than filtering exclusively to planted-error tasks (`A`, `C`), diluting rates when participants also complete clean tasks (`B`, `D`); self-reported `Yes` must be manually audited against `error_description` to rule out false positives. |
| **Perceived Control (Likert) & Companions** | 1–7 Likert item *"I felt in control of the AI"* (`control`), collected alongside *"I understood why the AI did what it did"* (`understood`) and *"I trust the final recommendation"* (`trust`) (`questionnaire.py` → `logs/questionnaire.csv`). | Directly captures core HAI agency, transparency comprehension, and subjective trust after task completion. | Single-item Likert measures have lower reliability than multi-item validated scales; demand characteristics (participants noticing more buttons in Steerable) may inflate `control` ratings. |
| **Interventions Count** *(process telemetry)* | Count of `edit_step`, `delete_step`, `add_step`, `add_constraint`, and `pause` events per session (`logs/events.csv`, `analysis.py`). | Confirms participants actually engaged with steering primitives rather than passively letting the plan auto-run. | Structurally `0` in Baseline (which has no plan controls), so it serves as an engagement diagnostic rather than a symmetric cross-condition comparison. |

---

## 5. Statistical Analysis Plan

Implemented in `analysis.py`:

1. **Paired Non-Parametric Hypothesis Test:** Two-sided **Wilcoxon signed-rank test** (`scipy.stats.wilcoxon(s_vals, b_vals, zero_method="wilcox")`) on within-subject paired scores `(Steerable - Baseline)` per participant. Chosen because Likert ratings, 1–5 rubric scores, and small-sample durations ($n = 8\text{–}10$) cannot be assumed normally distributed. All-zero difference vectors are handled explicitly ($W = 0.0, p = 1.0$).
2. **Paired Effect Size (Cohen's $d_z$):**
   $$d_z = \frac{\bar{d}}{s_d}, \quad d_i = x_{i,\text{steerable}} - x_{i,\text{baseline}}$$
   where $s_d$ is the sample standard deviation (`ddof=1`) of paired differences.
3. **95% Confidence Interval for $d_z$:**
   $$\text{CI}_{95\%} = d_z \pm t_{0.975,\,n-1} \cdot \sqrt{\frac{1}{n} + \frac{d_z^2}{2n}}$$
   *(Note: This uses the standard large-sample SE approximation in `analysis.py:224–226`; with $n = 8\text{–}10$, CIs are wide and should be interpreted alongside exact noncentral-$t$ or bootstrap CIs for publication.)*
4. **Inter-Rater Agreement (`_cohens_kappa_and_icc`):**
   - **Cohen's $\kappa$:** Unweighted categorical agreement on rounded integer scores across `R1` and `R2`.
   - **$\text{ICC}(2,1)$:** Two-way random-effects, single-measures, absolute-agreement intraclass correlation across all rated `(participant_id, condition)` outputs.
   - **Target Threshold & Adjudication (`rubric.md`):** $\kappa \ge 0.70$ or $\text{ICC}(2,1) \ge 0.75$; any rating pair differing by $\ge 2$ points is discussed and adjudicated after recording initial independent scores.
5. **Multiple Comparisons & Error-Rate Subgroup Note:** Primary confirmatory inference centers on `quality_score` and planted-error detection; secondary subjective metrics are interpreted with Holm–Bonferroni awareness. For real study reporting, planted-error catch rate must additionally be reported **conditional on planted-error sessions (`A`, `C`) only**, alongside the false-alarm rate on clean sessions (`B`, `D`).

---

## 6. Synthetic pipeline-validation results (NOT real evidence)

> **WARNING:** All numbers below were generated synthetically by `analysis.py --fake` (`n = 10` simulated participants, `seed = 42`, stored in `results.csv`, `logs/events.csv`, `logs/questionnaire.csv`, `logs/ratings.csv`, and plotted in `results_chart.png`). They exist **solely to verify that the logging, rating, statistical, and plotting pipeline executes without error** and constitute **ZERO real empirical evidence** about human behavior or SteerPlan effectiveness.

### Synthetic Paired Summary (`results.csv`, $n = 10$ simulated pairs)

| Metric | $n$ | Steerable Mean | Steerable SD | Baseline Mean | Baseline SD | Mean Diff ($S - B$) | Wilcoxon $W$ | $p$-value | Cohen's $d_z$ | 95% CI Low | 95% CI High |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `time_on_task_sec` | 10 | 260.4000 | 23.7964 | 206.5000 | 21.6089 | +53.9000 | 0.0000 | 0.00195 | 1.4160 | 0.4037 | 2.4283 |
| `interventions` | 10 | 3.5000 | 1.0801 | 0.0000 | 0.0000 | +3.5000 | 0.0000 | 0.00195 | 3.2404 | 1.4520 | 5.0288 |
| `mental_demand` | 10 | 2.5000 | 0.8498 | 3.7000 | 1.0593 | -1.2000 | 0.0000 | 0.00781 | -1.5213 | -2.5719 | -0.4706 |
| `effort` | 10 | 2.7000 | 0.6749 | 4.4000 | 1.0750 | -1.7000 | 0.0000 | 0.00391 | -1.6048 | -2.6867 | -0.5228 |
| `frustration` | 10 | 1.6000 | 0.6992 | 3.5000 | 0.8498 | -1.9000 | 0.0000 | 0.00391 | -1.9106 | -3.1131 | -0.7082 |
| `control` | 10 | 5.3000 | 0.8233 | 2.5000 | 0.7071 | +2.8000 | 0.0000 | 0.00195 | 4.4272 | 2.0763 | 6.7781 |
| `understood` | 10 | 5.1000 | 0.9944 | 2.3000 | 0.8233 | +2.8000 | 0.0000 | 0.00195 | 2.4663 | 1.0282 | 3.9044 |
| `trust` | 10 | 5.1000 | 0.5676 | 2.8000 | 0.9189 | +2.3000 | 0.0000 | 0.00195 | 2.1711 | 0.8605 | 3.4818 |
| `planted_error_caught` | 10 | 0.5000 | 0.5270 | 0.2000 | 0.4216 | +0.3000 | 8.0000 | 0.45312 | 0.3644 | -0.3743 | 1.1031 |
| `quality_score` | 10 | 4.3500 | 0.4743 | 3.2000 | 0.9487 | +1.1500 | 3.0000 | 0.01953 | 0.9949 | 0.1203 | 1.8695 |

### Synthetic Inter-Rater Agreement (`logs/ratings.csv`, 20 rated sessions across `R1`, `R2`)

| Metric | Synthetic Value | Pipeline Note |
| :--- | :---: | :--- |
| Rated sessions (`n_rated`) | 20 | 10 participants × 2 conditions |
| Cohen's $\kappa$ | 0.2883 | Low because `analysis.py` injects independent $\pm 1$ RNG noise into `R1` and `R2` |
| $\text{ICC}(2,1)$ | 0.5728 | Below real-study target ($\ge 0.75$) for the same synthetic-noise reason |

*Pipeline validation note:* In the synthetic generator (`analysis.py:57–62`), odd participants receive planted-error Task `A` in Steerable (5/5 caught in synthetic `logs/questionnaire.csv`) and clean Task `D` in Baseline, while even participants receive planted-error Task `C` in Baseline (2/5 caught) and clean Task `B` in Steerable. Because `analysis.py:147–149` averages `planted_error_caught` across all 10 sessions per condition rather than filtering to planted-error tasks, the pooled means appear as `0.50` vs. `0.20` (`p = 0.45312`). This confirms a known aggregation caveat to account for during real data analysis.

---

## 7. Real participant results (PENDING, n=__)

> **Status:** No real human participant sessions have been collected yet. All tables below are intentionally left empty and will be populated only after real sessions, blind ratings, and `analysis.py` runs are completed.

### Real Paired Summary (Steerable vs. Baseline, $n = \_\_$)

| Metric | $n$ | Steerable Mean | Steerable SD | Baseline Mean | Baseline SD | Mean Diff ($S - B$) | Wilcoxon $W$ | $p$-value | Cohen's $d_z$ | 95% CI Low | 95% CI High |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `quality_score` (blind 2-rater) | | | | | | | | | | | |
| `time_on_task_sec` | | | | | | | | | | | |
| `mental_demand` (NASA-TLX) | | | | | | | | | | | |
| `effort` (NASA-TLX) | | | | | | | | | | | |
| `frustration` (NASA-TLX) | | | | | | | | | | | |
| `planted_error_caught` (all / planted-only) | | | | | | | | | | | |
| `control` (Likert 1–7) | | | | | | | | | | | |
| `understood` (Likert 1–7) | | | | | | | | | | | |
| `trust` (Likert 1–7) | | | | | | | | | | | |
| `interventions` | | | | | | | | | | | |

### Real Inter-Rater Agreement (2 Blind Raters)

| Metric | Value | Target | Status |
| :--- | :---: | :---: | :---: |
| Rated sessions (`n_rated`) | | | PENDING |
| Cohen's $\kappa$ | | $\ge 0.70$ | PENDING |
| $\text{ICC}(2,1)$ | | $\ge 0.75$ | PENDING |
| Discrepancies $\ge 2$ points adjudicated | | 100% | PENDING |

### Real Planted-Error Detection Breakdown (Tasks A & C vs. Clean Controls B & D)

| Condition | Planted-Error Sessions ($n$) | Caught (Self-Report + Valid Desc) | Neutralized in Final Output (Rubric Dim 5) | Clean Control Sessions ($n$) | False Alarms on Clean Tasks |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Steerable | | | | | |
| Baseline | | | | | |

---

## 8. Failure Cases & Threats to Validity

### System / Engineering Failure Cases
1. **Unverified Live Gemini Execution:** `GEMINI_API_KEY` is not yet configured in `.env` or the test environment, so live Gemini JSON formatting, latency, rate limits, and real multi-step planted-error propagation remain unverified end-to-end.
2. **Deprecated Gemini SDK (`google.generativeai`):** `llm.py` imports `google.generativeai`, which emits a `FutureWarning` indicating end-of-support in favor of `google.genai`.
3. **Malformed JSON / API Failures:** Outside `DEMO_MODE=1`, `llm.py` retries once and raises `LLMError`. While `agent.py` and `pages/1_Steerable.py` catch `LLMError` gracefully (leaving the step `pending`, logging `agent_error`, and showing a **Retry** button), `pages/2_Baseline.py` currently calls `call_llm()` without `try/except LLMError`, which would display a raw Streamlit traceback on API failure.
4. **Offline Demo Does Not Propagate Planted Errors:** In `DEMO_MODE=1`, `_demo_response()` in `llm.py` ignores `Previous step outputs:` and `Completed step outputs:`, so offline testing cannot demonstrate downstream propagation of `wrong_fact_text` into later steps or `final_answer`.
5. **Planted-Error Index Sensitivity:** `agent.py` injects `planted_error` by 0-based list index (`step_index == idx`). If a participant deletes step `1` before it executes or inserts a step before index `1`, injection either never fires or shifts to a different step.
6. **All-Steps-Deleted Edge Case:** If a participant deletes every step in the plan, `_maybe_finalize()` can synthesize a final answer from empty step outputs.

### Behavioral / Study Failure Cases
1. **Approval Rubber-Stamping (Automation Bias):** Participants may click **Approve** on `needs_approval` steps without reading the step output or `why`, negating the confidence-gating benefit.
2. **Steering Overhead & Fatigue:** Excessive edits or constraint resets re-run downstream steps, increasing `time_on_task_sec` and potentially causing frustration if live API latency is high.
3. **Planted-Error Pooling Artifact in `analysis.py`:** Aggregating `planted_error_caught` over both planted (`A`, `C`) and non-planted (`B`, `D`) tasks compresses the observed catch rate; analysis of real data should separate planted-error detection rate from clean-task false-alarm rate.
4. **Small Sample Statistical Power & Carryover:** With $N = 8\text{–}10$, statistical power is limited to large effects ($|d_z| \gtrsim 1.0$), and exposure to SteerPlan first may sensitize odd-numbered participants to scrutinize facts more carefully in their subsequent Baseline session.

---

## 9. Reproduction Steps

### 1. Environment Setup
```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

### 2. Verify Code Integrity & Offline Tests
```powershell
# Compile check all Python files
.venv\Scripts\python -m py_compile agent.py analysis.py app.py llm.py logger.py mock_agent.py questionnaire.py pages/1_Steerable.py pages/2_Baseline.py

# Headless DEMO_MODE=1 run (plan -> edit -> approve -> finish)
$env:DEMO_MODE="1"
.venv\Scripts\python agent.py
```

### 3. Reproduce Synthetic Pipeline Validation (Not Real Evidence)
```powershell
.venv\Scripts\python analysis.py --fake
```
Generates `logs/events.csv`, `logs/questionnaire.csv`, `logs/ratings.csv`, `results.csv`, and `results_chart.png` for `n = 10` simulated participants (`seed = 42`).

### 4. Run Real Participant Sessions
1. **Clear synthetic logs first** (archive or delete `logs/events.csv`, `logs/questionnaire.csv`, `logs/ratings.csv` generated by `--fake` so synthetic rows never mix with real data).
2. Configure a real Gemini API key and ensure `DEMO_MODE` is unset:
   ```powershell
   $env:DEMO_MODE=""
   $env:GEMINI_API_KEY="your-gemini-api-key"
   .venv\Scripts\streamlit run app.py
   ```
3. On **Facilitator Home (`app.py`)**, enter `participant_id`, select the assigned Task Variant (`A`–`D`), confirm the counterbalanced order and planted-error setting, and launch Condition 1 → participant completes task, clicks **Finish task**, and submits the questionnaire → return to `app.py`, pick the second task variant, and complete Condition 2 + questionnaire.

### 5. Blind Rating & Final Real-Data Analysis
1. Export blinded `(participant_id, blinded_session_id, task_id, final_answer)` from `logs/events.csv` (stripping `condition` and UI interaction rows).
2. Have two independent raters (`R1`, `R2`) score every session on the 1–5 scale per `rubric.md`, unblind condition labels into `logs/ratings.csv` (`participant_id,condition,rater,quality_score`), and adjudicate any $\ge 2$-point discrepancies after recording initial scores.
3. Run the analysis pipeline without `--fake`:
   ```powershell
   .venv\Scripts\python analysis.py
   ```
4. Populate Section 7 (*Real participant results*) from the newly generated `results.csv` and console inter-rater agreement output.
