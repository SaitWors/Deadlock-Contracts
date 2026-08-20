from __future__ import annotations

import os
import tempfile
from pathlib import Path

# app.config is imported during test collection by several modules. Establish
# one isolated, schema-fresh database and safe development secrets before any
# application module can create the global Settings/Engine singletons. This
# makes the full suite independent of import/file ordering.
_test_root = Path(tempfile.mkdtemp(prefix="dc-pytest-suite-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_test_root / 'suite.db'}"
os.environ["APP_ENV"] = "development"
os.environ["MATCH_PROVIDER"] = "mock"
os.environ["ALLOW_DEMO_AUTH"] = "true"
os.environ["ALLOW_DEV_ENDPOINTS"] = "true"
os.environ["SESSION_SECRET"] = "test-secret-not-for-production-use-only-2026"
os.environ["EVIDENCE_DIR"] = str(_test_root / "evidence")
