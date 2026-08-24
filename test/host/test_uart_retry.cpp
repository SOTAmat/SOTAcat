// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
//
// CR-03: the old recursive retry both decremented `tries` and recursed with
// `tries - 1`, so a budget of 3 bought 2 attempts; and the "radio busy,
// don't count as retry" branch neither honored that promise (the recursion
// still consumed budget) nor bounded itself (a persistently busy radio
// recursed without limit). The contract pinned here: `tries` is the exact
// number of transmissions for non-busy failures; busy responses consume a
// separate bounded tolerance; the between() hook (buffer flush + delay)
// runs before every retry and never after the final failure.
#include "../../include/uart_retry.h"
#include <cassert>
#include <cstdio>
#include <vector>

using R = UartAttemptResult;

struct Script {
    std::vector<R> results;
    size_t         attempts = 0;
    int            betweens = 0;

    R operator() () {
        assert (attempts < results.size () && "more attempts than scripted");
        return results[attempts++];
    }
};

int main () {
    {  // tries=3 buys exactly 3 attempts on plain failures (the bug gave 2).
        Script s{{R::BAD, R::BAD, R::BAD, R::BAD}};
        bool   ok = uart_retry ([&] { return s (); }, [&] { s.betweens++; }, 3);
        assert (!ok);
        assert (s.attempts == 3);
        assert (s.betweens == 2);  // between retries only, not after final failure
    }

    {  // Success on the last permitted attempt.
        Script s{{R::BAD, R::BAD, R::OK}};
        bool   ok = uart_retry ([&] { return s (); }, [&] { s.betweens++; }, 3);
        assert (ok && s.attempts == 3 && s.betweens == 2);
    }

    {  // First-try success: no between() calls.
        Script s{{R::OK}};
        bool   ok = uart_retry ([&] { return s (); }, [&] { s.betweens++; }, 3);
        assert (ok && s.attempts == 1 && s.betweens == 0);
    }

    {  // Busy responses don't consume the tries budget...
        Script s{{R::BUSY, R::BUSY, R::BAD, R::BUSY, R::BAD, R::BAD}};
        bool   ok = uart_retry ([&] { return s (); }, [&] { s.betweens++; }, 3);
        assert (!ok);
        assert (s.attempts == 6);  // 3 busy (tolerated) + 3 bad (the budget)
    }

    {  // ...and a busy streak can still end in success.
        Script s{{R::BUSY, R::BUSY, R::OK}};
        bool   ok = uart_retry ([&] { return s (); }, [&] { s.betweens++; }, 1);
        assert (ok && s.attempts == 3);
    }

    {  // But busy is bounded: with tolerance B, the (B+1)th busy response
       // gives up instead of recursing forever (the old code never returned).
        Script s{{R::BUSY, R::BUSY, R::BUSY, R::BUSY}};
        bool   ok = uart_retry ([&] { return s (); }, [&] { s.betweens++; }, 3, 3);
        assert (!ok);
        assert (s.attempts == 4);   // 3 tolerated busies + the one that gives up
        assert (s.betweens == 3);   // no between() after the final failure
    }

    {  // tries=1: single attempt, no retry on failure.
        Script s{{R::BAD}};
        bool   ok = uart_retry ([&] { return s (); }, [&] { s.betweens++; }, 1);
        assert (!ok && s.attempts == 1 && s.betweens == 0);
    }

    printf ("test_uart_retry: all assertions passed\n");
    return 0;
}
