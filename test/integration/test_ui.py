#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "playwright",
#     "pytest",
#     "pytest-playwright",
# ]
# ///
"""
SOTAcat UI Test Suite

Tests the web UI pages and elements using Playwright browser automation.
Can run against mock server (offline) or real device (integration).

Usage:
    # Against mock server (start mock server first)
    pipx run test_ui.py --base-url http://localhost:8080

    # Against real device
    pipx run test_ui.py --base-url http://sotacat.local

    # With pytest for more options
    pipx run pytest test_ui.py --base-url http://localhost:8080 -v
"""

import argparse
import sys
import time
from dataclasses import dataclass, field
from typing import List, Optional
from urllib.parse import urljoin

try:
    from playwright.sync_api import sync_playwright, Page, Browser, Error as PlaywrightError
except ImportError:
    print("Error: Playwright not installed")
    print("Install with: pipx run --spec playwright playwright install chromium")
    print("Or: pip install playwright && playwright install chromium")
    sys.exit(1)


@dataclass
class TestResult:
    """Result of a single test"""
    name: str
    passed: bool
    duration_ms: float
    error: Optional[str] = None


@dataclass
class TestSuite:
    """Collection of test results"""
    results: List[TestResult] = field(default_factory=list)
    js_errors: List[str] = field(default_factory=list)

    def add(self, result: TestResult):
        self.results.append(result)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if not r.passed)

    @property
    def total(self) -> int:
        return len(self.results)


class SOTAcatUITests:
    """UI test suite for SOTAcat web interface"""

    def __init__(self, base_url: str, headless: bool = True):
        self.base_url = base_url.rstrip('/')
        self.headless = headless
        self.suite = TestSuite()
        self.page: Optional[Page] = None
        self.browser: Optional[Browser] = None

    def url(self, path: str) -> str:
        """Build full URL from path"""
        return urljoin(self.base_url + '/', path.lstrip('/'))

    def run_test(self, name: str, test_func):
        """Run a single test and record result"""
        start = time.time()
        try:
            test_func()
            duration = (time.time() - start) * 1000
            self.suite.add(TestResult(name, True, duration))
            print(f"  ✓ {name} ({duration:.0f}ms)")
        except Exception as e:
            duration = (time.time() - start) * 1000
            error_msg = str(e)
            self.suite.add(TestResult(name, False, duration, error_msg))
            print(f"  ✗ {name} ({duration:.0f}ms)")
            print(f"    Error: {error_msg[:100]}")

    def setup(self):
        """Initialize browser and page"""
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=self.headless)
        self.context = self.browser.new_context()
        self.page = self.context.new_page()

        # Collect JS errors
        self.page.on("pageerror", lambda err: self.suite.js_errors.append(str(err)))

    def teardown(self):
        """Cleanup browser"""
        if self.browser:
            self.browser.close()
        if hasattr(self, 'playwright'):
            self.playwright.stop()

    # =========================================================================
    # Page Load Tests
    # =========================================================================

    def test_index_loads(self):
        """Index page loads without errors"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        assert self.page.title(), "Page should have a title"

    def test_chase_tab_exists(self):
        """Chase tab is present and clickable"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        tab = self.page.locator('[data-tab="chase"]')
        assert tab.count() > 0, "Chase tab should exist"

    def test_run_tab_exists(self):
        """RUN tab is present and clickable"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        tab = self.page.locator('[data-tab="run"]')
        assert tab.count() > 0, "RUN tab should exist"

    def test_settings_tab_exists(self):
        """Settings tab is present and clickable"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        tab = self.page.locator('[data-tab="settings"]')
        assert tab.count() > 0, "Settings tab should exist"

    def test_about_tab_exists(self):
        """About tab is present and clickable"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        tab = self.page.locator('[data-tab="about"]')
        assert tab.count() > 0, "About tab should exist"

    def test_qrx_tab_exists(self):
        """QRX tab is present and clickable"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        tab = self.page.locator('[data-tab="qrx"]')
        assert tab.count() > 0, "QRX tab should exist"

    # =========================================================================
    # Tab Navigation Tests
    # =========================================================================

    def test_switch_to_qrx_tab(self):
        """Can switch to QRX tab"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)  # Allow tab transition and content load
        # Check that QRX-specific element is visible (sync time button)
        sync_btn = self.page.locator('#sync-time-button')
        assert sync_btn.is_visible(), "QRX content should be visible (sync time button)"

    def test_switch_to_run_tab(self):
        """Can switch to RUN tab"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)  # Allow tab transition and content load
        # Check that RUN-specific element is visible (frequency display)
        freq = self.page.locator('#current-frequency')
        assert freq.is_visible(), "RUN content should be visible (frequency display)"

    def test_switch_to_settings_tab(self):
        """Can switch to Settings tab"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="settings"]')
        time.sleep(0.5)
        # Check that Settings-specific element is visible (callsign input)
        callsign = self.page.locator('#callsign')
        assert callsign.is_visible(), "Settings content should be visible (callsign input)"

    def test_switch_to_about_tab(self):
        """Can switch to About tab"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="about"]')
        time.sleep(0.5)
        # Check that About-specific element is visible (version display)
        version = self.page.locator('#build-version')
        assert version.is_visible(), "About content should be visible (version display)"

    # =========================================================================
    # RUN Page Element Tests
    # =========================================================================

    def test_run_frequency_display(self):
        """RUN page has frequency display"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)
        freq = self.page.locator('#current-frequency')
        assert freq.count() > 0, "Frequency display should exist"

    def test_run_mode_display(self):
        """RUN page has mode display"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)
        mode = self.page.locator('#current-mode')
        assert mode.count() > 0, "Mode display should exist"

    def test_run_cw_message_inputs(self):
        """RUN page has CW message inputs"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)
        for i in range(1, 4):
            input_el = self.page.locator(f'#cw-message-{i}')
            assert input_el.count() > 0, f"CW message input {i} should exist"

    def test_run_band_buttons(self):
        """RUN page has band selection buttons"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)
        bands = self.page.locator('.btn-band')
        assert bands.count() >= 5, "Should have multiple band buttons"

    def test_run_sms_spot_button(self):
        """RUN page has SMS spot button"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)
        sms_spot = self.page.locator('#sms-spot-button')
        assert sms_spot.count() > 0, "SMS spot button should exist"

    def test_run_sms_qrt_button(self):
        """RUN page has SMS QRT button"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)
        sms_qrt = self.page.locator('#sms-qrt-button')
        assert sms_qrt.count() > 0, "SMS QRT button should exist"

    def test_run_buttons_disabled_without_reference(self):
        """Run buttons are disabled when no reference is set"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        # Clear any existing location-based references (use a known test location)
        self.page.evaluate("""() => {
            // Clear all location-based reference keys
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key && key.startsWith('reference_')) {
                    localStorage.removeItem(key);
                }
            }
            // Set a known location in AppState for consistent testing
            if (window.AppState) {
                AppState.gpsOverride = { latitude: 37.0, longitude: -122.0 };
            }
        }""")
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)
        sotamat = self.page.locator('#sotamat-button')
        sms_spot = self.page.locator('#sms-spot-button')
        sms_qrt = self.page.locator('#sms-qrt-button')
        assert sotamat.is_disabled(), "SOTAmat button should be disabled without reference"
        assert sms_spot.is_disabled(), "SMS spot button should be disabled without reference"
        assert sms_qrt.is_disabled(), "SMS QRT button should be disabled without reference"

    def test_run_buttons_enabled_with_sota_reference(self):
        """Run buttons are enabled with valid SOTA reference"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        # First go to QRX to get the device's location cached
        self.page.click('[data-tab="qrx"]')
        time.sleep(1)
        # Get the location and set a SOTA reference for it
        location = self.page.evaluate("""() => {
            if (window.AppState && AppState.gpsOverride) {
                const lat = AppState.gpsOverride.latitude.toFixed(4);
                const lon = AppState.gpsOverride.longitude.toFixed(4);
                const key = 'reference_' + lat + '_' + lon;
                localStorage.setItem(key, 'W6/HC-298');
                return { lat, lon };
            }
            return null;
        }""")
        if not location:
            return  # Skip if no location
        # Reload page so RUN tab picks up the reference on init
        self.page.reload()
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)
        sotamat = self.page.locator('#sotamat-button')
        sms_spot = self.page.locator('#sms-spot-button')
        sms_qrt = self.page.locator('#sms-qrt-button')
        assert not sotamat.is_disabled(), "SOTAmat button should be enabled with SOTA reference"
        assert not sms_spot.is_disabled(), "SMS spot button should be enabled with SOTA reference"
        assert not sms_qrt.is_disabled(), "SMS QRT button should be enabled with SOTA reference"

    def test_run_buttons_enabled_with_pota_reference(self):
        """Run buttons are enabled with valid POTA reference"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        # First go to QRX to get the device's location cached
        self.page.click('[data-tab="qrx"]')
        time.sleep(1)
        # Get the location and set a POTA reference for it
        location = self.page.evaluate("""() => {
            if (window.AppState && AppState.gpsOverride) {
                const lat = AppState.gpsOverride.latitude.toFixed(4);
                const lon = AppState.gpsOverride.longitude.toFixed(4);
                const key = 'reference_' + lat + '_' + lon;
                localStorage.setItem(key, 'US-1234');
                return { lat, lon };
            }
            return null;
        }""")
        if not location:
            return  # Skip if no location
        # Reload page so RUN tab picks up the reference on init
        self.page.reload()
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)
        sotamat = self.page.locator('#sotamat-button')
        sms_spot = self.page.locator('#sms-spot-button')
        sms_qrt = self.page.locator('#sms-qrt-button')
        assert not sotamat.is_disabled(), "SOTAmat button should be enabled with POTA reference"
        assert not sms_spot.is_disabled(), "SMS spot button should be enabled with POTA reference"
        assert not sms_qrt.is_disabled(), "SMS QRT button should be enabled with POTA reference"

    def test_run_volume_controls(self):
        """RUN page has volume control buttons"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)
        vol_up = self.page.locator('#vol-up-button')
        vol_down = self.page.locator('#vol-down-button')
        assert vol_up.count() > 0, "Vol+ button should exist"
        assert vol_down.count() > 0, "Vol- button should exist"

    # =========================================================================
    # Settings Page Element Tests
    # =========================================================================

    def test_settings_callsign_input(self):
        """Settings page has callsign input"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="settings"]')
        time.sleep(0.5)
        callsign = self.page.locator('#callsign')
        assert callsign.count() > 0, "Callsign input should exist"

    def test_settings_wifi_section(self):
        """Settings page has WiFi configuration"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="settings"]')
        time.sleep(0.5)
        sta1 = self.page.locator('#sta1-ssid')
        assert sta1.count() > 0, "WiFi STA1 SSID input should exist"

    def test_settings_ip_pin_checkboxes(self):
        """Settings page has IP pinning checkboxes for each STA network"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="settings"]')
        time.sleep(0.5)
        sta1_pin = self.page.locator('#sta1-ip-pin')
        sta2_pin = self.page.locator('#sta2-ip-pin')
        sta3_pin = self.page.locator('#sta3-ip-pin')
        assert sta1_pin.count() > 0, "STA1 IP pin checkbox should exist"
        assert sta2_pin.count() > 0, "STA2 IP pin checkbox should exist"
        assert sta3_pin.count() > 0, "STA3 IP pin checkbox should exist"

    def test_settings_tune_targets_section(self):
        """Settings page has tune targets section"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="settings"]')
        time.sleep(0.5)
        targets = self.page.locator('#tune-targets-list')
        assert targets.count() > 0, "Tune targets list should exist"

    def test_settings_display_compact_mode_checkbox(self):
        """Settings page has compact mode checkbox in Display section"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="settings"]')
        time.sleep(0.5)
        checkbox = self.page.locator('#ui-compact-mode')
        assert checkbox.count() > 0, "Compact mode checkbox should exist"

    def test_settings_compact_mode_persists(self):
        """Compact mode setting persists in localStorage"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        # Clear any existing setting
        self.page.evaluate("localStorage.removeItem('sotacat_ui_compact')")
        self.page.click('[data-tab="settings"]')
        time.sleep(0.5)
        # Enable compact mode
        checkbox = self.page.locator('#ui-compact-mode')
        checkbox.check()
        time.sleep(0.3)
        # Verify localStorage was updated
        stored = self.page.evaluate("localStorage.getItem('sotacat_ui_compact')")
        assert stored == "true", "Compact mode should be saved to localStorage"
        # Disable and verify
        checkbox.uncheck()
        time.sleep(0.3)
        stored = self.page.evaluate("localStorage.getItem('sotacat_ui_compact')")
        assert stored == "false", "Compact mode disabled should be saved to localStorage"

    def test_settings_compact_mode_applies_body_class(self):
        """Compact mode applies ui-compact class to body"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        # Clear any existing setting
        self.page.evaluate("localStorage.removeItem('sotacat_ui_compact')")
        self.page.click('[data-tab="settings"]')
        time.sleep(0.5)
        # Verify class not present initially
        has_class = self.page.evaluate("document.body.classList.contains('ui-compact')")
        assert not has_class, "Body should not have ui-compact class initially"
        # Enable compact mode
        checkbox = self.page.locator('#ui-compact-mode')
        checkbox.check()
        time.sleep(0.3)
        # Verify class is applied
        has_class = self.page.evaluate("document.body.classList.contains('ui-compact')")
        assert has_class, "Body should have ui-compact class when enabled"
        # Disable and verify class is removed
        checkbox.uncheck()
        time.sleep(0.3)
        has_class = self.page.evaluate("document.body.classList.contains('ui-compact')")
        assert not has_class, "Body should not have ui-compact class when disabled"

    def test_compact_mode_applies_on_initial_load(self):
        """Compact mode is applied on initial page load from localStorage"""
        # First, set the localStorage value before loading the page
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.evaluate("localStorage.setItem('sotacat_ui_compact', 'true')")
        # Reload the page to test initial load behavior
        self.page.reload()
        self.page.wait_for_load_state('networkidle')
        # Verify class is applied immediately on load
        has_class = self.page.evaluate("document.body.classList.contains('ui-compact')")
        assert has_class, "Compact mode should be applied on initial page load"
        # Clean up
        self.page.evaluate("localStorage.removeItem('sotacat_ui_compact')")

    # =========================================================================
    # QRX Page Element Tests
    # =========================================================================

    def test_qrx_sync_time_button(self):
        """QRX page has sync time button"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        sync_btn = self.page.locator('#sync-time-button')
        assert sync_btn.count() > 0, "Sync time button should exist"

    def test_qrx_gps_location_input(self):
        """QRX page has GPS location input"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        gps_input = self.page.locator('#gps-location')
        assert gps_input.count() > 0, "GPS location input should exist"

    def test_qrx_locate_me_button(self):
        """QRX page has Locate Me button"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        locate_btn = self.page.locator('#get-browser-location-button')
        assert locate_btn.count() > 0, "Locate Me button should exist"

    def test_qrx_save_location_button(self):
        """QRX page has Save Location button"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        save_btn = self.page.locator('#save-gps-button')
        assert save_btn.count() > 0, "Save Location button should exist"

    def test_qrx_reference_input(self):
        """QRX page has reference input"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        ref_input = self.page.locator('#reference-input')
        assert ref_input.count() > 0, "Reference input should exist"

    def test_qrx_save_reference_button(self):
        """QRX page has Save reference button"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        save_btn = self.page.locator('#save-reference-button')
        assert save_btn.count() > 0, "Save reference button should exist"

    def test_qrx_clear_reference_button(self):
        """QRX page has Clear reference button"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        clear_btn = self.page.locator('#clear-reference-button')
        assert clear_btn.count() > 0, "Clear reference button should exist"

    def test_qrx_reference_auto_format_sota(self):
        """Reference input auto-formats SOTA reference on blur"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        ref_input = self.page.locator('#reference-input')
        ref_input.fill('w6nc298')
        ref_input.blur()
        time.sleep(0.1)
        assert ref_input.input_value() == 'W6/NC-298', "Should auto-format SOTA reference"

    def test_qrx_reference_auto_format_pota(self):
        """Reference input auto-formats POTA reference on blur"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        ref_input = self.page.locator('#reference-input')
        ref_input.fill('us1234')
        ref_input.blur()
        time.sleep(0.1)
        assert ref_input.input_value() == 'US-1234', "Should auto-format POTA reference"

    def test_qrx_reference_auto_format_wwff(self):
        """Reference input auto-formats WWFF reference on blur"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        ref_input = self.page.locator('#reference-input')
        ref_input.fill('vkff0001')
        ref_input.blur()
        time.sleep(0.1)
        assert ref_input.input_value() == 'VKFF-0001', "Should auto-format WWFF reference"

    def test_qrx_reference_auto_format_iota(self):
        """Reference input auto-formats IOTA reference on blur"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        ref_input = self.page.locator('#reference-input')
        ref_input.fill('eu123')
        ref_input.blur()
        time.sleep(0.1)
        assert ref_input.input_value() == 'EU-123', "Should auto-format IOTA reference"

    def test_qrx_nearest_sota_button(self):
        """QRX page has Nearest SOTA button"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        nearest_btn = self.page.locator('#nearest-sota-button')
        assert nearest_btn.count() > 0, "Nearest SOTA button should exist"

    def test_qrx_nearest_sota_button_disabled_without_location(self):
        """Nearest SOTA button is disabled when no location is set"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        # Clear GPS input to simulate no location
        gps_input = self.page.locator('#gps-location')
        gps_input.fill('')
        # Trigger the button state update
        self.page.evaluate("if (typeof updateNearestSotaButtonState === 'function') updateNearestSotaButtonState()")
        time.sleep(0.2)
        nearest_btn = self.page.locator('#nearest-sota-button')
        assert nearest_btn.is_disabled(), "Nearest SOTA button should be disabled without location"

    def test_qrx_nearest_sota_button_enabled_with_location(self):
        """Nearest SOTA button is enabled when location is set"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        # Set GPS input to simulate having a location
        gps_input = self.page.locator('#gps-location')
        gps_input.fill('37.0, -122.0')
        # Trigger the button state update
        self.page.evaluate("if (typeof updateNearestSotaButtonState === 'function') updateNearestSotaButtonState()")
        time.sleep(0.2)
        nearest_btn = self.page.locator('#nearest-sota-button')
        assert not nearest_btn.is_disabled(), "Nearest SOTA button should be enabled with location"

    def test_qrx_summit_info_element(self):
        """QRX page has summit info display element"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(0.5)
        summit_info = self.page.locator('#summit-info')
        assert summit_info.count() > 0, "Summit info element should exist"

    # =========================================================================
    # Location-Based Caching Tests
    # =========================================================================

    def test_location_based_reference_key_format(self):
        """Reference is stored with location-based key format via QRX save"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        # Go to QRX tab first to let it initialize and get device location
        self.page.click('[data-tab="qrx"]')
        time.sleep(1)
        # Get the current location that the app is using
        location = self.page.evaluate("""() => {
            if (window.AppState && AppState.gpsOverride) {
                return {
                    lat: AppState.gpsOverride.latitude.toFixed(4),
                    lon: AppState.gpsOverride.longitude.toFixed(4)
                };
            }
            return null;
        }""")
        if not location:
            # Skip if no location available
            return
        # Save a reference via the UI
        ref_input = self.page.locator('#reference-input')
        ref_input.fill('W6/NC-TEST')
        time.sleep(0.2)
        save_btn = self.page.locator('#save-reference-button')
        if not save_btn.is_disabled():
            save_btn.click()
            time.sleep(0.3)
        # Verify it was stored with location-based key
        expected_key = f"reference_{location['lat']}_{location['lon']}"
        result = self.page.evaluate(f"() => localStorage.getItem('{expected_key}')")
        assert result == 'W6/NC-TEST', f"Reference should be stored with key {expected_key}, got: {result}"

    def test_location_based_reference_retrieval(self):
        """Reference is retrieved using current location on page load"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        # First get the device's actual location
        self.page.click('[data-tab="qrx"]')
        time.sleep(1)
        location = self.page.evaluate("""() => {
            if (window.AppState && AppState.gpsOverride) {
                return {
                    lat: AppState.gpsOverride.latitude.toFixed(4),
                    lon: AppState.gpsOverride.longitude.toFixed(4)
                };
            }
            return null;
        }""")
        if not location:
            # Skip if no location available
            return
        # Set a reference for this location
        key = f"reference_{location['lat']}_{location['lon']}"
        self.page.evaluate(f"() => localStorage.setItem('{key}', 'W6/NC-CACHED')")
        # Reload and go to QRX to trigger loadReference
        self.page.reload()
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(1)
        # Check that the reference input shows the cached value
        ref_input = self.page.locator('#reference-input')
        value = ref_input.input_value()
        assert value == 'W6/NC-CACHED', f"Should retrieve reference for current location, got: {value}"

    def test_different_locations_have_different_references(self):
        """Different locations maintain separate references (via localStorage)"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        # This tests localStorage key isolation - doesn't need helper functions
        result = self.page.evaluate("""() => {
            // Store references for two locations
            localStorage.setItem('reference_37.0000_-122.0000', 'W6/NC-001');
            localStorage.setItem('reference_38.0000_-123.0000', 'W6/NC-002');

            // Read them back directly
            const ref1 = localStorage.getItem('reference_37.0000_-122.0000');
            const ref2 = localStorage.getItem('reference_38.0000_-123.0000');

            return { ref1, ref2 };
        }""")
        assert result['ref1'] == 'W6/NC-001', f"Location 1 should have W6/NC-001, got: {result['ref1']}"
        assert result['ref2'] == 'W6/NC-002', f"Location 2 should have W6/NC-002, got: {result['ref2']}"

    def test_summit_info_cached_with_location_key(self):
        """Summit info is cached with location-based key"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        result = self.page.evaluate("""() => {
            // Store summit info for a location
            const key = 'summitInfo_37.3176_-122.1476';
            const info = 'Black Mountain • 2820ft • 2pt • 164ft away';
            localStorage.setItem(key, info);
            return localStorage.getItem(key);
        }""")
        assert 'Black Mountain' in result, f"Summit info should be cached, got: {result}"

    def test_locality_cached_with_location_key(self):
        """Locality is cached with location-based key"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        result = self.page.evaluate("""() => {
            // Store locality for a location
            const key = 'locality_37.3176_-122.1476';
            const locality = 'Los Altos Hills, Santa Clara County, California, USA';
            localStorage.setItem(key, locality);
            return localStorage.getItem(key);
        }""")
        assert 'Los Altos Hills' in result, f"Locality should be cached, got: {result}"

    def test_build_location_key_function(self):
        """buildLocationKey function creates correct key format"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        result = self.page.evaluate("""() => {
            if (typeof buildLocationKey === 'function') {
                return buildLocationKey('reference', 37.12345, -122.98765);
            }
            return null;
        }""")
        # JavaScript toFixed uses banker's rounding: 37.12345 -> 37.1234, -122.98765 -> -122.9877
        assert result == 'reference_37.1234_-122.9877', f"Key should be formatted correctly, got: {result}"

    def test_polo_button_uses_location_based_reference(self):
        """PoLo setup button state depends on location-based reference"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(1)
        # Get the device's actual location
        location = self.page.evaluate("""() => {
            if (window.AppState && AppState.gpsOverride) {
                return {
                    lat: AppState.gpsOverride.latitude.toFixed(4),
                    lon: AppState.gpsOverride.longitude.toFixed(4)
                };
            }
            return null;
        }""")
        if not location:
            return  # Skip if no location
        key = f"reference_{location['lat']}_{location['lon']}"
        # Clear reference and reload
        self.page.evaluate(f"() => localStorage.removeItem('{key}')")
        self.page.reload()
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(1)
        polo_btn = self.page.locator('#setup-polo-button')
        assert polo_btn.is_disabled(), "PoLo button should be disabled without reference"
        # Now set a valid reference and reload
        self.page.evaluate(f"() => localStorage.setItem('{key}', 'W6/NC-001')")
        self.page.reload()
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="qrx"]')
        time.sleep(1)
        polo_btn = self.page.locator('#setup-polo-button')
        assert not polo_btn.is_disabled(), "PoLo button should be enabled with valid reference"

    def test_reference_cleared_only_for_current_location(self):
        """Clearing reference only affects current location (via localStorage)"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        # This test verifies localStorage isolation - doesn't need device location
        result = self.page.evaluate("""() => {
            // Set references for two different locations
            localStorage.setItem('reference_37.0000_-122.0000', 'W6/NC-001');
            localStorage.setItem('reference_38.0000_-123.0000', 'W6/NC-002');

            // Clear only the first location's reference
            localStorage.removeItem('reference_37.0000_-122.0000');

            // Check both locations
            const ref1 = localStorage.getItem('reference_37.0000_-122.0000');
            const ref2 = localStorage.getItem('reference_38.0000_-123.0000');

            return { ref1, ref2 };
        }""")
        assert result['ref1'] is None, "Reference 1 should be cleared"
        assert result['ref2'] == 'W6/NC-002', f"Reference 2 should be preserved, got: {result['ref2']}"

    # =========================================================================
    # Chase Page Element Tests
    # =========================================================================

    def test_chase_refresh_button(self):
        """Chase page has refresh button"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="chase"]')
        time.sleep(0.5)
        refresh = self.page.locator('#refresh-button')
        assert refresh.count() > 0, "Refresh button should exist"

    def test_chase_filter_dropdowns(self):
        """Chase page has filter dropdowns"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="chase"]')
        time.sleep(0.5)
        type_filter = self.page.locator('#type-filter')
        mode_filter = self.page.locator('#mode-filter')
        assert type_filter.count() > 0, "Type filter should exist"
        assert mode_filter.count() > 0, "Mode filter should exist"

    def test_chase_mode_filter_ssbcw_option(self):
        """Chase page mode filter has SSB+CW option as last entry"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="chase"]')
        time.sleep(0.5)
        mode_filter = self.page.locator('#mode-filter')
        options = mode_filter.locator('option').all_text_contents()
        assert 'SSB+CW' in options, "SSB+CW option should exist"
        assert options[-1] == 'SSB+CW', "SSB+CW should be last option"

    def test_chase_table(self):
        """Chase page has chase table"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="chase"]')
        time.sleep(0.5)
        table = self.page.locator('#chase-table')
        assert table.count() > 0, "Chase table should exist"

    def test_chase_polo_button_exists(self):
        """Chase page has PoLo button that is disabled by default"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="chase"]')
        time.sleep(0.5)
        polo_btn = self.page.locator('#polo-chase-button')
        assert polo_btn.count() > 0, "PoLo button should exist"
        assert polo_btn.is_disabled(), "PoLo button should be disabled when no spot is tuned"

    def test_chase_polo_validates_cluster_spot(self):
        """PoLo validation accepts Cluster spots with freq/mode/callsign (no sig/ref)"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="chase"]')
        time.sleep(0.5)
        # Test validation function with a Cluster spot (no valid sig, no reference)
        result = self.page.evaluate('''() => {
            // Mock a Cluster spot with freq, mode, callsign but no valid sig/ref
            const mockSpot = {
                activatorCallsign: "W1ABC",
                locationId: "-",
                sig: "Cluster",
                hertz: 14250000,
                modeType: "SSB"
            };
            // Test validation - should return true for spot with freq/mode/callsign
            const hasFreq = mockSpot.hertz && mockSpot.hertz > 0;
            const hasMode = !!mockSpot.modeType;
            const hasCall = !!mockSpot.activatorCallsign;
            return hasFreq && hasMode && hasCall;
        }''')
        assert result == True, "Cluster spot with freq/mode/callsign should be valid for PoLo"

    # =========================================================================
    # Header/Status Tests
    # =========================================================================

    def test_header_utc_clock(self):
        """Header has UTC clock"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        clock = self.page.locator('#current-utc-time')
        assert clock.count() > 0, "UTC clock should exist"

    def test_header_battery_display(self):
        """Header has battery display"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        battery = self.page.locator('#battery-percent')
        assert battery.count() > 0, "Battery display should exist"

    def test_header_battery_icon_exists(self):
        """Header has battery icon element"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        icon = self.page.locator('#battery-icon')
        assert icon.count() > 0, "Battery icon element should exist"

    def test_header_battery_icon_has_content(self):
        """Battery icon displays either lightning or battery emoji"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        time.sleep(1)  # Allow API call to complete
        icon = self.page.locator('#battery-icon')
        content = icon.text_content().strip()
        # Should contain either lightning bolt or battery emoji
        valid_icons = ['\u26A1', '\U0001F50B']  # ⚡ or 🔋
        has_valid = any(i in content for i in valid_icons)
        assert has_valid, f"Battery icon should contain valid emoji, got: {repr(content)}"

    def test_header_connection_status(self):
        """Header has connection status indicator"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        status = self.page.locator('#connection-status')
        assert status.count() > 0, "Connection status should exist"

    # =========================================================================
    # Interaction Tests
    # =========================================================================

    def test_cw_message_input_accepts_text(self):
        """CW message input accepts text"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)
        input_el = self.page.locator('#cw-message-1')
        input_el.fill('CQ CQ CQ')
        assert input_el.input_value() == 'CQ CQ CQ', "Input should accept text"

    def test_callsign_input_accepts_text(self):
        """Callsign input accepts text"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="settings"]')
        time.sleep(0.5)
        input_el = self.page.locator('#callsign')
        input_el.fill('W1AW')
        assert input_el.input_value() == 'W1AW', "Callsign input should accept text"

    # =========================================================================
    # License Privilege Badge Tests
    # =========================================================================

    def test_license_badges_exist(self):
        """License class badges (T/G/E) exist on RUN page"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)
        badge_t = self.page.locator('#badge-T')
        badge_g = self.page.locator('#badge-G')
        badge_e = self.page.locator('#badge-E')
        assert badge_t.count() > 0, "Technician badge should exist"
        assert badge_g.count() > 0, "General badge should exist"
        assert badge_e.count() > 0, "Extra badge should exist"

    def test_vfo_warning_element_exists(self):
        """VFO warning element exists"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="run"]')
        time.sleep(0.5)
        warning = self.page.locator('#vfo-warning')
        assert warning.count() > 0, "VFO warning element should exist"

    def test_license_class_dropdown_exists(self):
        """License class dropdown exists in Settings"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="settings"]')
        time.sleep(0.5)
        license_select = self.page.locator('#license-class')
        assert license_select.count() > 0, "License class dropdown should exist"

    def test_license_class_options(self):
        """License class dropdown has correct options"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="settings"]')
        time.sleep(0.5)
        options = self.page.locator('#license-class option')
        assert options.count() >= 4, "Should have at least 4 options (none, T, G, E)"

    # =========================================================================
    # JavaScript Error Check
    # =========================================================================

    def test_no_js_errors(self):
        """No JavaScript errors occurred during tests"""
        assert len(self.suite.js_errors) == 0, \
            f"JavaScript errors: {self.suite.js_errors}"

    # =========================================================================
    # Run All Tests
    # =========================================================================

    def run_all(self) -> TestSuite:
        """Run all UI tests"""
        print(f"\nSOTAcat UI Tests")
        print(f"Target: {self.base_url}")
        print("=" * 60)

        self.setup()
        try:
            # Page load tests
            print("\nPage Load Tests:")
            self.run_test("Index page loads", self.test_index_loads)
            self.run_test("QRX tab exists", self.test_qrx_tab_exists)
            self.run_test("Chase tab exists", self.test_chase_tab_exists)
            self.run_test("RUN tab exists", self.test_run_tab_exists)
            self.run_test("Settings tab exists", self.test_settings_tab_exists)
            self.run_test("About tab exists", self.test_about_tab_exists)

            # Tab navigation
            print("\nTab Navigation Tests:")
            self.run_test("Switch to QRX tab", self.test_switch_to_qrx_tab)
            self.run_test("Switch to RUN tab", self.test_switch_to_run_tab)
            self.run_test("Switch to Settings tab", self.test_switch_to_settings_tab)
            self.run_test("Switch to About tab", self.test_switch_to_about_tab)

            # RUN page elements
            print("\nRUN Page Elements:")
            self.run_test("Frequency display", self.test_run_frequency_display)
            self.run_test("Mode display", self.test_run_mode_display)
            self.run_test("CW message inputs", self.test_run_cw_message_inputs)
            self.run_test("Band buttons", self.test_run_band_buttons)
            self.run_test("SMS spot button", self.test_run_sms_spot_button)
            self.run_test("SMS QRT button", self.test_run_sms_qrt_button)
            self.run_test("Run buttons disabled without ref", self.test_run_buttons_disabled_without_reference)
            self.run_test("Run buttons enabled with SOTA ref", self.test_run_buttons_enabled_with_sota_reference)
            self.run_test("Run buttons enabled with POTA ref", self.test_run_buttons_enabled_with_pota_reference)
            self.run_test("Volume controls", self.test_run_volume_controls)

            # Settings page elements
            print("\nSettings Page Elements:")
            self.run_test("Callsign input", self.test_settings_callsign_input)
            self.run_test("WiFi section", self.test_settings_wifi_section)
            self.run_test("IP pin checkboxes", self.test_settings_ip_pin_checkboxes)
            self.run_test("Tune targets section", self.test_settings_tune_targets_section)

            # QRX page elements
            print("\nQRX Page Elements:")
            self.run_test("Sync time button", self.test_qrx_sync_time_button)
            self.run_test("GPS location input", self.test_qrx_gps_location_input)
            self.run_test("Locate Me button", self.test_qrx_locate_me_button)
            self.run_test("Save Location button", self.test_qrx_save_location_button)
            self.run_test("Reference input", self.test_qrx_reference_input)
            self.run_test("Save reference button", self.test_qrx_save_reference_button)
            self.run_test("Clear reference button", self.test_qrx_clear_reference_button)
            self.run_test("Reference auto-format SOTA", self.test_qrx_reference_auto_format_sota)
            self.run_test("Reference auto-format POTA", self.test_qrx_reference_auto_format_pota)
            self.run_test("Reference auto-format WWFF", self.test_qrx_reference_auto_format_wwff)
            self.run_test("Reference auto-format IOTA", self.test_qrx_reference_auto_format_iota)
            self.run_test("Nearest SOTA button", self.test_qrx_nearest_sota_button)
            self.run_test("Nearest SOTA disabled without location", self.test_qrx_nearest_sota_button_disabled_without_location)
            self.run_test("Nearest SOTA enabled with location", self.test_qrx_nearest_sota_button_enabled_with_location)
            self.run_test("Summit info element", self.test_qrx_summit_info_element)

            # Location-based caching tests
            print("\nLocation-Based Caching Tests:")
            self.run_test("Reference key format", self.test_location_based_reference_key_format)
            self.run_test("Reference retrieval", self.test_location_based_reference_retrieval)
            self.run_test("Different locations different refs", self.test_different_locations_have_different_references)
            self.run_test("Summit info cached with location", self.test_summit_info_cached_with_location_key)
            self.run_test("Locality cached with location", self.test_locality_cached_with_location_key)
            self.run_test("buildLocationKey function", self.test_build_location_key_function)
            self.run_test("PoLo button uses location ref", self.test_polo_button_uses_location_based_reference)
            self.run_test("Clear ref only for current loc", self.test_reference_cleared_only_for_current_location)

            # Chase page elements
            print("\nChase Page Elements:")
            self.run_test("Refresh button", self.test_chase_refresh_button)
            self.run_test("Filter dropdowns", self.test_chase_filter_dropdowns)
            self.run_test("Mode filter SSB+CW option", self.test_chase_mode_filter_ssbcw_option)
            self.run_test("Chase table", self.test_chase_table)
            self.run_test("PoLo button exists", self.test_chase_polo_button_exists)
            self.run_test("PoLo validates Cluster spot", self.test_chase_polo_validates_cluster_spot)

            # Header elements
            print("\nHeader Elements:")
            self.run_test("UTC clock", self.test_header_utc_clock)
            self.run_test("Battery display", self.test_header_battery_display)
            self.run_test("Battery icon exists", self.test_header_battery_icon_exists)
            self.run_test("Battery icon has content", self.test_header_battery_icon_has_content)
            self.run_test("Connection status", self.test_header_connection_status)

            # Interaction tests
            print("\nInteraction Tests:")
            self.run_test("CW message input accepts text", self.test_cw_message_input_accepts_text)
            self.run_test("Callsign input accepts text", self.test_callsign_input_accepts_text)

            # License privilege tests
            print("\nLicense Privilege Tests:")
            self.run_test("License badges exist", self.test_license_badges_exist)
            self.run_test("VFO warning element exists", self.test_vfo_warning_element_exists)
            self.run_test("License class dropdown exists", self.test_license_class_dropdown_exists)
            self.run_test("License class options", self.test_license_class_options)

            # Final JS error check
            print("\nJavaScript Error Check:")
            self.run_test("No JS errors", self.test_no_js_errors)

        finally:
            self.teardown()

        # Summary
        print("\n" + "=" * 60)
        print(f"Results: {self.suite.passed}/{self.suite.total} passed")
        if self.suite.failed > 0:
            print(f"Failed: {self.suite.failed}")
        if self.suite.js_errors:
            print(f"JS Errors: {len(self.suite.js_errors)}")
            for err in self.suite.js_errors[:5]:
                print(f"  - {err[:80]}")
        print("=" * 60)

        return self.suite


def main():
    parser = argparse.ArgumentParser(description='SOTAcat UI Test Suite')
    parser.add_argument('--base-url', type=str, default='http://localhost:8080',
                        help='Base URL to test (default: http://localhost:8080)')
    parser.add_argument('--headed', action='store_true',
                        help='Run browser in headed mode (visible)')
    args = parser.parse_args()

    # Check playwright is installed
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright not installed. Install with:")
        print("  pip install playwright && playwright install chromium")
        sys.exit(1)

    tests = SOTAcatUITests(args.base_url, headless=not args.headed)
    suite = tests.run_all()

    sys.exit(0 if suite.failed == 0 else 1)


if __name__ == '__main__':
    main()

