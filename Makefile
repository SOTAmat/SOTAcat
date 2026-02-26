# SOTAcat Firmware Build Makefile
#
# Convenience wrapper around PlatformIO commands for common development tasks.
# All targets are optional - you can use PlatformIO directly if preferred:
#   pio run -e seeed_xiao_esp32c3_release
#   pio run -e seeed_xiao_esp32c3_release -t upload
#
# This Makefile provides simplified commands for:
#   - Building firmware (debug/release)
#   - OTA updates over WiFi
#   - Running integration tests
#

# Default environment
ENV ?= seeed_xiao_esp32c3_release

# Default OTA target
IP ?= sotacat.local

# Default test target
HOST ?= sotacat.local

# Output directories
FIRMWARE_DIR := firmware/webtools
OTA_BIN := $(FIRMWARE_DIR)/SOTACAT-ESP32C3-OTA.bin
MERGED_BIN := $(FIRMWARE_DIR)/esp32c3.bin

.PHONY: help build upload clean ota ota-upload monitor test test-setup github-release

help:
	@echo "SOTAcat Firmware Build Targets"
	@echo ""
	@echo "Build Targets:"
	@echo "  build         - Build firmware (default: release)"
	@echo "  upload        - Build and upload via USB"
	@echo "  ota           - Build OTA-ready firmware (release only)"
	@echo "  monitor       - Open serial monitor"
	@echo ""
	@echo "OTA Targets:"
	@echo "  ota-upload    - Upload firmware via OTA (default: sotacat.local)"
	@echo ""
	@echo "Test Targets:"
	@echo "  test-setup    - Setup test environment (venv + dependencies)"
	@echo "  test          - Run integration test suite"
	@echo ""
	@echo "Release Targets:"
	@echo "  github-release - Build firmware and create a GitHub release"
	@echo ""
	@echo "Utility Targets:"
	@echo "  clean         - Clean build artifacts"
	@echo ""
	@echo "Variables:"
	@echo "  ENV=<env>     - Build environment (default: seeed_xiao_esp32c3_release)"
	@echo "                  Options: seeed_xiao_esp32c3_debug, seeed_xiao_esp32c3_release"
	@echo "  IP=<address>  - Device IP for OTA upload (default: sotacat.local)"
	@echo "  HOST=<host>   - Device hostname/IP for testing (default: sotacat.local)"
	@echo ""
	@echo "Examples:"
	@echo "  make build                    # Build release firmware"
	@echo "  make build ENV=...debug       # Build debug firmware"
	@echo "  make ota                      # Build OTA-ready firmware"
	@echo "  make ota-upload               # Upload via OTA (default: sotacat.local)"
	@echo "  make ota-upload IP=192.168.1.100  # Upload via OTA to specific IP"
	@echo "  make upload                   # Build and upload via USB"
	@echo "  make test                     # Run integration tests (default: 10 iterations, 60s stress)"
	@echo "  make test HOST=192.168.1.100  # Test specific device"

build:
	@echo "Building firmware for $(ENV)..."
	pio run -e $(ENV)

upload:
	@echo "Building and uploading firmware for $(ENV)..."
	pio run -e $(ENV) -t upload

ota:
	@echo "Building OTA-ready firmware (release)..."
	@pio run -e seeed_xiao_esp32c3_release
	@echo ""
	@echo "Copying OTA binary to firmware/webtools/..."
	@mkdir -p firmware/webtools
	@cp .pio/build/seeed_xiao_esp32c3_release/firmware.bin $(OTA_BIN)
	@echo ""
	@echo "✓ OTA firmware built successfully:"
	@ls -lh $(OTA_BIN)
	@echo ""
	@echo "Ready to upload with: make ota-upload"

ota-upload:
	@echo "Uploading OTA firmware to $(IP)..."
	@if [ ! -f "$(OTA_BIN)" ]; then \
		echo "Error: OTA binary not found. Run 'make ota' first."; \
		exit 1; \
	fi
	@echo "Uploading $(OTA_BIN) ($(shell ls -lh $(OTA_BIN) | awk '{print $$5}'))..."
	@curl -X POST \
		--data-binary "@$(OTA_BIN)" \
		-H "Content-Type: application/octet-stream" \
		http://$(IP)/api/v1/ota
	@echo ""
	@echo "✓ OTA upload complete. Device will reboot automatically."

monitor:
	@echo "Opening serial monitor for $(ENV)..."
	pio device monitor -e $(ENV)

clean:
	@echo "Removing derived sdkconfig files..."
	@rm -f sdkconfig.seeed_xiao_esp32c3_debug sdkconfig.seeed_xiao_esp32c3_release
	@echo "Cleaning build artifacts..."
	pio run -t clean
	@echo "Cleaning firmware directory..."
	@rm -f $(FIRMWARE_DIR)/*.bin
	@echo "Clean complete."

test-setup:
	@echo "Setting up test environment..."
	@cd test/integration && make setup

test:
	@echo "Running integration test suite..."
	@cd test/integration && make test HOST=$(HOST)

github-release:
	@echo "Building release firmware and webtools assets..."
	pio run -e seeed_xiao_esp32c3_release -t package_webtools
	@TAG=$$(sed -n 's/.*BUILD_DATE_TIME "\([0-9]*\):\([0-9]*\)".*/v\1.\2/p' include/build_info.h); \
	echo "Creating GitHub release $$TAG..."; \
	gh release create "$$TAG" \
		$(FIRMWARE_DIR)/SOTACAT-ESP32C3-OTA.bin \
		$(FIRMWARE_DIR)/esp32c3.bin \
		$(FIRMWARE_DIR)/manifest.json \
		--generate-notes \
		--title "$$TAG"

# Convenience aliases
.PHONY: flash debug release
flash: upload
debug:
	@$(MAKE) build ENV=seeed_xiao_esp32c3_debug
release:
	@$(MAKE) build ENV=seeed_xiao_esp32c3_release
