.PHONY: install dev dev-backend dev-baseline test check e2e export-telemetry analyze counterbalancing

PYTHON ?= python3

install:
	uv venv --python 3.11 .venv || $(PYTHON) -m venv .venv
	uv pip install --python .venv -e ".[dev]" || .venv/bin/pip install -e ".[dev]"
	cd frontend/coplan && npm install
	cd frontend/baseline && npm install

dev:
	uv run --python 3.11 python scripts/dev.py || $(PYTHON) scripts/dev.py

dev-backend:
	uv run --python 3.11 uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --reload

dev-baseline:
	uv run --python 3.11 uvicorn backend.baseline.app:app --host 127.0.0.1 --port 8001 --reload

test:
	uv run --python 3.11 pytest -v

check:
	uv run --python 3.11 pytest -v
	cd frontend/coplan && npx tsc -b && npm run build
	cd frontend/baseline && npx tsc -b && npm run build

e2e:
	uv run --python 3.11 python e2e/run_e2e.py

counterbalancing:
	uv run --python 3.11 python scripts/generate_counterbalancing.py

export-telemetry:
	uv run --python 3.11 python eval/export_csv.py

analyze:
	uv run --python 3.11 python eval/notebooks/analyze_telemetry.py
