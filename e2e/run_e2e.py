"""Single-command Playwright E2E smoke test (`make e2e`) on the unified single-link host."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent


def _wait_http(url: str, timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = httpx.get(url, timeout=1.5)
            if r.status_code < 500:
                return
        except Exception:
            pass
        time.sleep(0.4)
    raise RuntimeError(f"Timed out waiting for {url}")


def main() -> int:
    npm_exe = shutil.which("npm")
    coplan_dir = ROOT / "frontend" / "coplan"
    index_html = coplan_dir / "dist" / "index.html"
    if not index_html.is_file():
        if not npm_exe:
            print("[ERROR] Node.js / npm is required to build the unified frontend.")
            return 2
        subprocess.run([npm_exe, "run", "build"], cwd=str(coplan_dir), check=True)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[ERROR] Python `playwright` package is not installed.")
        print("Run: uv pip install --python .venv playwright && .venv/Scripts/playwright install chromium")
        return 2

    tmp_dir = Path(tempfile.mkdtemp(prefix="coplan_e2e_"))
    db_path = tmp_dir / "e2e.db"
    logs_dir = tmp_dir / "raw_logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    env = {
        **os.environ,
        "LLM_PROVIDER": "mock",
        "LLM_MODEL": "mock-coplan-v1",
        "COPLAN_STEP_DELAY_MS": "25",
        "DB_PATH": str(db_path),
        "TELEMETRY_DIR": str(logs_dir),
    }

    procs: list[subprocess.Popen[bytes]] = []
    try:
        procs.append(
            subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "backend.api.main:app", "--host", "127.0.0.1", "--port", "8000"],
                cwd=str(ROOT),
                env=env,
            )
        )

        _wait_http("http://127.0.0.1:8000/health")
        _wait_http("http://127.0.0.1:8000/")

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()

            # --- 1. Shared-Workspace Happy Path + Requirement Change on single link ---
            page.goto("http://127.0.0.1:8000/", wait_until="networkidle")
            assert page.get_by_text("MOCK LLM").is_visible()
            page.get_by_label("Participant ID").fill("P01")
            page.get_by_role("button", name="Start Co-Plan Session").click()
            page.get_by_text("Shared Plan Tree").wait_for(timeout=15000)

            page.get_by_role("button", name="Lock").first.wait_for(timeout=15000)
            page.get_by_role("button", name="Lock").first.click()
            page.get_by_role("button", name="Requirement Change").click()
            page.get_by_role("button", name="Use This Prompt").click()
            page.get_by_role("button", name="Apply Requirement & Replan").click()
            page.get_by_role("button", name="Resume").click()
            time.sleep(1.5)

            # --- 2. Switch to Baseline Chat on the exact same link ---
            page.get_by_title("Exit session").click()
            page.get_by_role("tab", name="Baseline Chat (Control)").click()
            assert page.get_by_text("MOCK LLM").is_visible()
            page.get_by_label("Participant ID").fill("P01")
            page.get_by_role("button", name="Start Baseline Chat Session").click()
            page.get_by_role("button", name="Insert Task Prompt").click()
            page.get_by_role("button", name="Send").click()
            page.get_by_text("Deliverable Draft").wait_for(timeout=15000)

            page.get_by_role("button", name="Insert Requirement Change").click()
            page.get_by_role("button", name="Send").click()
            time.sleep(1.0)
            browser.close()

        jsonl_files = [
            f for f in logs_dir.glob("P01_*.jsonl") if f.name != "telemetry_all.jsonl"
        ]
        assert len(jsonl_files) >= 2, f"Expected >=2 per-run JSONL logs, found {jsonl_files}"
        for path in jsonl_files:
            events = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
            types = {e["event_type"] for e in events}
            assert "requirement_change_sent" in types, f"Missing requirement_change_sent in {path.name}"
            assert "first_useful_response" in types, f"Missing first_useful_response in {path.name}"

        print(f"[PASS] Playwright E2E smoke test succeeded across both modes on single link ({len(jsonl_files)} logs verified).")
        return 0
    finally:
        for proc in procs:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
