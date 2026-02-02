#!/usr/bin/env python3
"""
Create venv and install test dependencies. Cross-platform (Windows + Linux/macOS).
Run from project root: python test/integration/setup_env.py
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
VENV = ROOT / ".venv"

if sys.platform == "win32":
    VENV_PYTHON = VENV / "Scripts" / "python.exe"
    VENV_PIP = VENV / "Scripts" / "pip.exe"
    VENV_PLAYWRIGHT = VENV / "Scripts" / "playwright.exe"
else:
    VENV_PYTHON = VENV / "bin" / "python3"
    VENV_PIP = VENV / "bin" / "pip"
    VENV_PLAYWRIGHT = VENV / "bin" / "playwright"


def clean():
    """Remove test results and cache. Cross-platform."""
    for pattern in ["*.json", "mutex_stress_*"]:
        for f in (ROOT / "test" / "integration").glob(pattern):
            if f.is_dir():
                shutil.rmtree(f, ignore_errors=True)
            else:
                f.unlink(missing_ok=True)
    pycache = ROOT / "test" / "integration" / "__pycache__"
    if pycache.exists():
        shutil.rmtree(pycache)
    results = ROOT / "test_results"
    if results.exists():
        shutil.rmtree(results)
    print("Cleaned")


def main():
    print("Setting up test environment...")
    if not VENV_PYTHON.exists():
        print("Creating virtual environment...")
        subprocess.run(
            [sys.executable, "-m", "venv", str(VENV)],
            cwd=ROOT,
            check=True,
        )
    print("Installing dependencies...")
    subprocess.run(
        [
            str(VENV_PIP),
            "install",
            "-q",
            "requests",
            "zeroconf",
            "pytest",
            "playwright",
            "pytest-playwright",
        ],
        cwd=ROOT,
        check=True,
    )
    print("Installing Playwright browsers...")
    subprocess.run(
        [str(VENV_PLAYWRIGHT), "install", "chromium"],
        cwd=ROOT,
        check=True,
    )
    print("Setup complete")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "clean":
        clean()
    else:
        main()
