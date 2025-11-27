#!/bin/bash
# Convenience wrapper to run performance tests with correct Python environment

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/../.."
VENV_PYTHON="$PROJECT_ROOT/.venv/bin/python3"

# Check if venv exists
if [ ! -f "$VENV_PYTHON" ]; then
    echo "Error: Virtual environment not found at $PROJECT_ROOT/.venv"
    echo ""
    echo "Please create it first:"
    echo "  cd $PROJECT_ROOT"
    echo "  python3 -m venv .venv"
    echo "  .venv/bin/pip install requests zeroconf"
    exit 1
fi

# Run the test with venv Python
exec "$VENV_PYTHON" "$SCRIPT_DIR/test_webserver_performance.py" "$@"
