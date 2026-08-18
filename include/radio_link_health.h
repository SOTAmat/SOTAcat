#pragma once
// Pure, header-only radio link-health state machine.
// No ESP-IDF / FreeRTOS dependencies so it is host-unit-testable.
//
// Semantics (see 2026-05-15-radio-decoupling-design.md):
//   * Starts "down" — the link is not considered up until a CAT
//     exchange has actually succeeded.
//   * record_failure(): N consecutive failures (LINK_DOWN_FAIL_THRESHOLD)
//     flips up->down. Failures below threshold while up keep it up.
//   * record_success(): immediately flips down->up and resets the
//     consecutive-failure counter (anti-flap: recovery needs a real
//     success, not merely the absence of failure).

class RadioLinkHealth {
  public:
    static constexpr int LINK_DOWN_FAIL_THRESHOLD = 3;

    void record_success() {
        m_consecutive_failures = 0;
        m_up                   = true;
    }

    void record_failure() {
        if (m_consecutive_failures < LINK_DOWN_FAIL_THRESHOLD)
            ++m_consecutive_failures;  // clamp: avoids overflow on long outages
        // Separate (not else-if): must re-test AFTER the possible
        // increment so the failure that crosses the threshold trips it.
        if (m_consecutive_failures >= LINK_DOWN_FAIL_THRESHOLD)
            m_up = false;
    }

    bool is_up() const { return m_up; }
    // Failures since the last success (clamped at the threshold). >0 means
    // "suspicious": callers may pre-flight a cheap ping before a slow op.
    int  consecutive_failures() const { return m_consecutive_failures; }

  private:
    int  m_consecutive_failures = LINK_DOWN_FAIL_THRESHOLD;  // start "down"
    bool m_up                   = false;
};
