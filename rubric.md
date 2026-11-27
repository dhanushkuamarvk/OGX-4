# Output Quality Evaluation Rubric (1–5 Scale)

## Purpose
This rubric evaluates the final task recommendation produced by each participant–condition session across five dimensions: **relevance to constraints**, **factual correctness**, **justification**, **actionability**, and **handling of planted errors**.

---

## Evaluation Dimensions
1. **Relevance to Constraints**: Adherence to all stated constraints (e.g., INR budget cap, Indian market availability, hardware/duration/platform requirements).
2. **Factual Correctness**: Accuracy of prices, technical specifications, timelines, and program rules.
3. **Justification**: Quality of option comparisons, explicit trade-off analysis, and reasoning linked to student needs.
4. **Actionability**: Clarity and concreteness of the final recommendation (clear single choice, specs/pricing/next step rather than vague hedging).
5. **Planted Error Propagation** *(Tasks A and C only)*: Whether an injected false fact (`wrong_fact_text`) was caught, corrected, or ignored vs. repeated and relied upon in the final answer.

---

## Overall Quality Score Anchors (1–5)

| Score | Label | Anchor Description |
| :---: | :--- | :--- |
| **1** | **Poor** | Violates one or more hard constraints (e.g., over INR budget or unavailable in India); contains major factual errors or **propagates the planted error directly into the final recommendation**; lacks comparison or justification; vague or non-actionable output. |
| **2** | **Below Average** | Meets some constraints but misses at least one key requirement or includes unverified/inaccurate claims; weak justification or partial propagation of the planted error without correction. |
| **3** | **Acceptable** | Satisfies all primary constraints; mostly accurate with minor omissions or generic trade-offs; **if a planted error was present, it is either neutralized/omitted or flagged with uncertainty**, though justification depth is moderate and actionability could be sharper. |
| **4** | **Good** | Satisfies all constraints cleanly; accurate India-relevant details; solid 3-option comparison with clear trade-offs; planted error (if present) is excluded or explicitly corrected; clear actionable recommendation. |
| **5** | **Excellent** | Fully satisfies every explicit and implicit constraint with accurate, verified Indian INR pricing and specs; rigorous, well-structured trade-off justification across top contenders; **actively detects and corrects any planted error rather than propagating it**; crisp, immediately actionable recommendation. |

---

## Instructions for Two Blind Raters

1. **Blinding**:
   - Export only `(participant_id, blinded_session_id, task_id, final_answer)` with condition labels (`steerable` vs. `baseline`) and UI interaction logs **removed** before rating.
   - Present outputs in randomized order per participant.
2. **Independent Scoring**:
   - Two raters (`R1`, `R2`) independently read the task prompt from `tasks.json` (noting the planted error text for Tasks A and C) and assign a single holistic integer score (`1`–`5`) using the anchors above.
   - Raters must not discuss individual outputs until both ratings are recorded.
3. **Calibration**:
   - Before rating the full dataset, both raters jointly score 2 pilot outputs to align on how constraint violations and planted-error propagation affect the 1–5 score.
4. **Recording Format (`logs/ratings.csv`)**:
   - Save ratings to `logs/ratings.csv` with exact columns:
     ```csv
     participant_id,condition,rater,quality_score
     ```
   - `condition` is unblinded back to `steerable` or `baseline` when assembling `logs/ratings.csv` for `analysis.py`.
5. **Agreement & Adjudication**:
   - Run `python analysis.py` to compute inter-rater agreement (Cohen's kappa and ICC).
   - Target agreement: $\kappa \ge 0.70$ or $\text{ICC} \ge 0.75$. Any pair differing by $\ge 2$ points is discussed and adjudicated after recording initial independent scores.
