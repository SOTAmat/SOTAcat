#pragma once

/**
 * Retry policy for UART command transactions, extracted from kx_radio.cpp
 * for host-testability (CR-03; see test/host/test_uart_retry.cpp).
 *
 * The old recursive form both decremented its counter and recursed with
 * `tries - 1`, so a budget of 3 bought 2 attempts — and its "radio busy,
 * don't count as retry" branch still consumed budget while placing no bound
 * of its own, so a radio streaming `?;` recursed without limit.
 *
 * Contract: `tries` is the exact number of transmissions granted to plain
 * (non-busy) failures. Busy responses do not consume that budget; they draw
 * on a separate tolerance of `busy_budget` responses, after which the
 * transaction gives up. between() (buffer flush, settle delay) runs before
 * every retry and never after the final failure.
 */

enum class UartAttemptResult {
    OK,    // valid response received
    BUSY,  // radio answered "?;" — try again without spending an attempt
    BAD,   // anything else — spend one attempt
};

// A radio pausing for a menu redraw or relay click answers busy a few times;
// tolerating 5 (~0.5-1 s with typical waits) outlasts that without letting a
// wedged radio pin the caller.
inline constexpr int UART_BUSY_TOLERANCE = 5;

template <typename AttemptFn, typename BetweenFn>
bool uart_retry (AttemptFn && attempt, BetweenFn && between, int tries, int busy_budget = UART_BUSY_TOLERANCE) {
    int busy_seen = 0;
    while (true) {
        switch (attempt ()) {
        case UartAttemptResult::OK:
            return true;
        case UartAttemptResult::BUSY:
            if (++busy_seen > busy_budget)
                return false;
            break;
        case UartAttemptResult::BAD:
            if (--tries <= 0)
                return false;
            break;
        }
        between ();
    }
}
