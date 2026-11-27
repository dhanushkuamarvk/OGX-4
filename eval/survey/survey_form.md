# Post-Task Evaluation Survey & Study Protocol (Resurrect 2026 — Problem 3)

## Study Design
- **Design:** Within-subjects counterbalanced (`AB` vs `BA`). Each participant completes one task in **Co-Plan (treatment)** and one matched task in **Baseline (control)**.
- **Controlled Constants:** Identical LLM provider/model, identical `SHARED_SYSTEM_PROMPT`, identical generation hyperparameters (`temperature`, `max_tokens`, `top_p`), and identical shared tools.
- **Mid-Task Perturbation:** At minute 3–4 (or after 2 steps complete in Co-Plan / after first full draft in Baseline), the experimenter injects the standardized `mid_task_requirement` from `eval/tasks/tasks.json`.

## Part 1 — NASA-TLX Cognitive Load (1 = Very Low, 7 = Very High)
1. **Mental Demand:** How mentally demanding was the task?
2. **Temporal Demand:** How hurried or rushed was the pace of the task?
3. **Performance:** How successful were you in accomplishing what you were asked to do? *(1 = Failure, 7 = Perfect)*
4. **Effort:** How hard did you have to work to achieve your result?
5. **Frustration:** How stressed, irritated, or annoyed did you feel?

## Part 2 — Human-Agent Agency, Steering & Trust (1 = Strongly Disagree, 7 = Strongly Agree)
1. I felt in control of the agent's direction throughout the task.
2. I could easily understand what the agent was planning and doing at every moment.
3. Adapting to the mid-task requirement change felt smooth and predictable.
4. I trusted the system not to break or overwrite sections I had already approved.
5. Recovering from an agent mistake was effortless.
6. The agent asked for my input at the right moments.

## Part 3 — Qualitative Debrief
1. What helped you most when steering the agent after the requirement change?
2. What caused the most friction or confusion?
3. Which interface would you choose for real high-stakes technical work, and why?
