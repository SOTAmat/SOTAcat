# SOTAcat Integration Test Makefile

# Configuration
VENV := ../../.venv
PYTHON := $(VENV)/bin/python3
HOST ?= sotacat.local
ITERATIONS ?= 10
STRESS_DURATION ?= 60
STRESS_CLIENTS ?= 7

# Detect if venv exists
VENV_EXISTS := $(shell [ -f $(PYTHON) ] && echo 1 || echo 0)

.PHONY: help setup test test-performance test-mutex clean

help:
	@echo "SOTAcat Integration Tests"
	@echo ""
	@echo "Targets:"
	@echo "  setup            - Create virtual environment and install dependencies"
	@echo "  test             - Run full test suite (performance + mutex stress)"
	@echo "  test-performance - Run web server performance test only"
	@echo "  test-mutex       - Run multi-client mutex stress test only"
	@echo "  clean            - Remove test results and cache files"
	@echo ""
	@echo "Variables:"
	@echo "  HOST=$(HOST)                      - Target host"
	@echo "  ITERATIONS=$(ITERATIONS)                   - Performance test iterations"
	@echo "  STRESS_DURATION=$(STRESS_DURATION)              - Mutex stress test duration (seconds)"
	@echo "  STRESS_CLIENTS=$(STRESS_CLIENTS)                - Concurrent clients for mutex test"
	@echo ""
	@echo "Examples:"
	@echo "  make test                             # Full test suite (10 iterations, 60s)"
	@echo "  make test ITERATIONS=5                # Quick validation (5 iterations)"
	@echo "  make test HOST=192.168.1.100          # Test specific host"
	@echo "  make test-performance ITERATIONS=20   # Extended performance test"
	@echo "  make test-mutex STRESS_DURATION=120   # Extended stress test"

setup:
	@echo "Setting up test environment..."
	@if [ ! -d "$(VENV)" ]; then \
		echo "Creating virtual environment..."; \
		cd ../.. && python3 -m venv .venv; \
	fi
	@echo "Installing dependencies..."
	@$(VENV)/bin/pip install -q requests zeroconf
	@echo "✓ Setup complete"

test: check-venv
	@echo "Running integration test suite..."
	@$(PYTHON) run_tests.py --host $(HOST) --all

test-performance: check-venv
	@echo "Running web server performance test..."
	@$(PYTHON) test_webserver_performance.py \
		--host $(HOST) \
		--iterations $(ITERATIONS)

test-mutex: check-venv
	@echo "Running multi-client mutex stress test..."
	@$(PYTHON) test_mutex_stress.py \
		--host $(HOST) \
		--duration $(STRESS_DURATION) \
		--clients $(STRESS_CLIENTS)

clean:
	@echo "Cleaning test results..."
	@rm -f *.json
	@rm -rf __pycache__
	@rm -rf ../../test_results/
	@echo "✓ Cleaned"

# Internal targets
check-venv:
	@if [ "$(VENV_EXISTS)" = "0" ]; then \
		echo "Error: Virtual environment not found."; \
		echo "Run 'make setup' first."; \
		exit 1; \
	fi
