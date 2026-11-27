# Steerable vs. Baseline AI Study Platform

A Streamlit multipage application for a within-subjects Human–Agent Interaction study comparing a **Steerable Agent** (`pages/1_Steerable.py`) against a **Baseline Chat** (`pages/2_Baseline.py`).

## Setup

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

### Configuration
- **Live Gemini API**:
  ```powershell
  $env:GEMINI_API_KEY="your-api-key"
  ```
- **Offline Demo Mode** (canned responses, no API key needed):
  ```powershell
  $env:DEMO_MODE="1"
  ```

## Run the App

```powershell
.venv\Scripts\streamlit run app.py
```

## Study Procedure

1. **Recruitment**: Recruit **8–10 participants** (within-subjects design, ~15 minutes per participant).
2. **Counterbalancing**: On the Facilitator Home (`app.py`), enter the Participant ID and Task Variant (`A`–`D` from `tasks.json`). Odd IDs run **Steerable → Baseline**; even IDs run **Baseline → Steerable**. Toggle planted errors on the facilitator page only.
3. **Session Flow**:
   - Complete Condition 1, click **Finish task**, and submit the post-task questionnaire (`logs/questionnaire.csv`).
   - Return to Home (`app.py`), select the second task variant, and complete Condition 2 + its questionnaire.
   - All telemetry appends to `logs/events.csv`.
4. **Blind Rating & Analysis**:
   - Two blind raters score final outputs using `rubric.md` into `logs/ratings.csv` (`participant_id,condition,rater,quality_score`).
   - Run the statistical pipeline (writes `results.csv` and `results_chart.png`):
     ```powershell
     .venv\Scripts\python analysis.py
     ```
   - To test the pipeline with 10 synthetic participants:
     ```powershell
     .venv\Scripts\python analysis.py --fake
     ```
