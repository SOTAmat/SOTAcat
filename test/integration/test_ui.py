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

    def test_cat_tab_exists(self):
        """CAT tab is present and clickable"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        tab = self.page.locator('[data-tab="cat"]')
        assert tab.count() > 0, "CAT tab should exist"

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

    # =========================================================================
    # Tab Navigation Tests
    # =========================================================================

    def test_switch_to_cat_tab(self):
        """Can switch to CAT tab"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="cat"]')
        time.sleep(0.5)  # Allow tab transition and content load
        # Check that CAT-specific element is visible (frequency display)
        freq = self.page.locator('#current-frequency')
        assert freq.is_visible(), "CAT content should be visible (frequency display)"

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
    # CAT Page Element Tests
    # =========================================================================

    def test_cat_frequency_display(self):
        """CAT page has frequency display"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="cat"]')
        time.sleep(0.5)
        freq = self.page.locator('#current-frequency')
        assert freq.count() > 0, "Frequency display should exist"

    def test_cat_mode_display(self):
        """CAT page has mode display"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="cat"]')
        time.sleep(0.5)
        mode = self.page.locator('#current-mode')
        assert mode.count() > 0, "Mode display should exist"

    def test_cat_cw_message_inputs(self):
        """CAT page has CW message inputs"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="cat"]')
        time.sleep(0.5)
        for i in range(1, 4):
            input_el = self.page.locator(f'#cw-message-{i}')
            assert input_el.count() > 0, f"CW message input {i} should exist"

    def test_cat_band_buttons(self):
        """CAT page has band selection buttons"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="cat"]')
        time.sleep(0.5)
        bands = self.page.locator('.btn-band')
        assert bands.count() >= 5, "Should have multiple band buttons"

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

    def test_settings_tune_targets_section(self):
        """Settings page has tune targets section"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="settings"]')
        time.sleep(0.5)
        targets = self.page.locator('#tune-targets-list')
        assert targets.count() > 0, "Tune targets list should exist"

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

    def test_chase_table(self):
        """Chase page has chase table"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="chase"]')
        time.sleep(0.5)
        table = self.page.locator('#chase-table')
        assert table.count() > 0, "Chase table should exist"

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
        self.page.click('[data-tab="cat"]')
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
        """License class badges (T/G/E) exist on CAT page"""
        self.page.goto(self.url('/'))
        self.page.wait_for_load_state('networkidle')
        self.page.click('[data-tab="cat"]')
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
        self.page.click('[data-tab="cat"]')
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
            self.run_test("Chase tab exists", self.test_chase_tab_exists)
            self.run_test("CAT tab exists", self.test_cat_tab_exists)
            self.run_test("Settings tab exists", self.test_settings_tab_exists)
            self.run_test("About tab exists", self.test_about_tab_exists)

            # Tab navigation
            print("\nTab Navigation Tests:")
            self.run_test("Switch to CAT tab", self.test_switch_to_cat_tab)
            self.run_test("Switch to Settings tab", self.test_switch_to_settings_tab)
            self.run_test("Switch to About tab", self.test_switch_to_about_tab)

            # CAT page elements
            print("\nCAT Page Elements:")
            self.run_test("Frequency display", self.test_cat_frequency_display)
            self.run_test("Mode display", self.test_cat_mode_display)
            self.run_test("CW message inputs", self.test_cat_cw_message_inputs)
            self.run_test("Band buttons", self.test_cat_band_buttons)

            # Settings page elements
            print("\nSettings Page Elements:")
            self.run_test("Callsign input", self.test_settings_callsign_input)
            self.run_test("WiFi section", self.test_settings_wifi_section)
            self.run_test("Tune targets section", self.test_settings_tune_targets_section)

            # Chase page elements
            print("\nChase Page Elements:")
            self.run_test("Refresh button", self.test_chase_refresh_button)
            self.run_test("Filter dropdowns", self.test_chase_filter_dropdowns)
            self.run_test("Chase table", self.test_chase_table)

            # Header elements
            print("\nHeader Elements:")
            self.run_test("UTC clock", self.test_header_utc_clock)
            self.run_test("Battery display", self.test_header_battery_display)
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
