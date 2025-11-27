# SOTAcat Integration Test Makefile

# Configuration
VENV := ../../.venv
PYTHON := $(VENV)/bin/python3
HOST ?= sotacat.local
ITERATIONS ?= 10

# Detect if venv exists
VENV_EXISTS := $(shell [ -f $(PYTHON) ] && echo 1 || echo 0)

.PHONY: help setup test test-full baseline stress clean

help:
	@echo "SOTAcat Integration Tests"
	@echo ""
	@echo "Targets:"
	@echo "  setup        - Create virtual environment and install dependencies"
	@echo "  test         - Run quick performance test (5 iterations)"
	@echo "  test-full    - Run full performance test (default 10 iterations)"
	@echo "  baseline     - Capture baseline performance (20 iterations, save to file)"
	@echo "  stress       - Run stress test (100 iterations)"
	@echo "  clean        - Remove test results"
	@echo ""
	@echo "Variables:"
	@echo "  HOST=$(HOST)           - Target host (default: sotacat.local)"
	@echo "  ITERATIONS=$(ITERATIONS)  - Number of test iterations"
	@echo ""
	@echo "Examples:"
	@echo "  make test HOST=192.168.1.100"
	@echo "  make baseline"
	@echo "  make test-full ITERATIONS=20"

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
	@echo "Running quick performance test (5 iterations)..."
	@$(PYTHON) test_webserver_performance.py --host $(HOST) --iterations 5

test-full: check-venv
	@echo "Running full performance test ($(ITERATIONS) iterations)..."
	@$(PYTHON) test_webserver_performance.py --host $(HOST) --iterations $(ITERATIONS)

baseline: check-venv
	@echo "Capturing baseline performance..."
	@$(eval TIMESTAMP := $(shell date +%Y%m%d_%H%M%S))
	@$(PYTHON) test_webserver_performance.py \
		--host $(HOST) \
		--iterations 20 \
		--output baseline_$(TIMESTAMP).json
	@echo "✓ Baseline saved to baseline_$(TIMESTAMP).json"

stress: check-venv
	@echo "Running stress test (100 iterations)..."
	@$(PYTHON) test_webserver_performance.py --host $(HOST) --iterations 100

clean:
	@echo "Cleaning test results..."
	@rm -f *.json
	@rm -rf __pycache__
	@echo "✓ Cleaned"

# Internal targets
check-venv:
	@if [ "$(VENV_EXISTS)" = "0" ]; then \
		echo "Error: Virtual environment not found."; \
		echo "Run 'make setup' first."; \
		exit 1; \
	fi
