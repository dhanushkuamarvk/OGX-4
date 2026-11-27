"""Cross-platform single-host dev runner serving UI + API + SSE at http://127.0.0.1:8000."""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _python_exe() -> str:
    venv_win = ROOT / ".venv" / "Scripts" / "python.exe"
    venv_unix = ROOT / ".venv" / "bin" / "python"
    if venv_win.exists():
        return str(venv_win)
    if venv_unix.exists():
        return str(venv_unix)
    return sys.executable


def _needs_frontend_build(coplan_dir: Path, baseline_dir: Path) -> bool:
    index_html = coplan_dir / "dist" / "index.html"
    if not index_html.is_file():
        return True
    dist_mtime = index_html.stat().st_mtime
    for src_dir in (coplan_dir / "src", baseline_dir / "src"):
        if src_dir.is_dir():
            for src_file in src_dir.rglob("*"):
                if src_file.is_file() and src_file.stat().st_mtime > dist_mtime:
                    return True
    return False


def _ensure_frontend_built() -> None:
    coplan_dir = ROOT / "frontend" / "coplan"
    baseline_dir = ROOT / "frontend" / "baseline"
    if not _needs_frontend_build(coplan_dir, baseline_dir):
        return

    npm_exe = shutil.which("npm")
    if not npm_exe:
        print(
            "[warn] `npm` not found in PATH — cannot rebuild frontend/coplan/dist."
        )
        return
    if not (coplan_dir / "node_modules").exists():
        print("[warn] frontend/coplan/node_modules missing — run `npm install` first.")
        return

    print("Building unified frontend bundle (frontend/coplan/dist)...")
    subprocess.run([npm_exe, "run", "build"], cwd=str(coplan_dir), check=True)


def main() -> int:
    _ensure_frontend_built()
    python_exe = _python_exe()
    host = os.environ.get("BACKEND_HOST", "127.0.0.1")
    port = os.environ.get("BACKEND_PORT", "8000")

    print("=" * 68)
    print("  Unified Server (Shared Workspace + Baseline Chat + API)")
    print("=" * 68)
    print(f"  Single App Link: http://{host}:{port}")
    print(f"  API Docs:        http://{host}:{port}/docs")
    print("  Press Ctrl+C to stop.")
    print("=" * 68)

    proc = subprocess.Popen(
        [
            python_exe,
            "-m",
            "uvicorn",
            "backend.api.main:app",
            "--host",
            host,
            "--port",
            port,
            "--reload",
        ],
        cwd=str(ROOT),
    )

    def _shutdown(*_args: object) -> None:
        print("\nShutting down server...")
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _shutdown)

    return proc.wait()


if __name__ == "__main__":
    raise SystemExit(main())
