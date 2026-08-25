// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
//
// Contract pinned here: any chunk failure aborts immediately (no chunk is
// ever skipped, so a truncated body can never ship under a clean status),
// the terminator is still attempted so the client sees a torn connection,
// and the first failure's error code is what the caller gets.
#include "../../include/chunked_send.h"
#include <cassert>
#include <cstdio>
#include <cstddef>
#include <vector>

struct Call {
    bool   is_data;  // false = zero-length terminator
    size_t offset;   // offset of chunk start within the region (data only)
    size_t len;
};

struct FakeSender {
    explicit FakeSender (const unsigned char * b) : base (b) {}
    const unsigned char * base;
    std::vector<Call>     calls;
    int                   fail_on_call = -1;  // index that fails, -1 = never
    int                   error_code   = -7;

    int operator() (const unsigned char * p, size_t n) {
        int idx = (int)calls.size ();
        calls.push_back ({n > 0, n > 0 ? (size_t)(p - base) : 0, n});
        return idx == fail_on_call ? error_code : 0;
    }
};

int main () {
    unsigned char region[20000] = {0};
    const size_t  CHUNK        = 8192;

    {  // Success: 8192 + 8192 + 3616, then terminator; returns 0.
        FakeSender s (region);
        int        yields = 0;
        int ret = send_region_chunked (s, [&] { yields++; }, region, region + sizeof (region), CHUNK);
        assert (ret == 0);
        assert (s.calls.size () == 4);
        assert (s.calls[0].is_data && s.calls[0].offset == 0 && s.calls[0].len == CHUNK);
        assert (s.calls[1].is_data && s.calls[1].offset == CHUNK && s.calls[1].len == CHUNK);
        assert (s.calls[2].is_data && s.calls[2].offset == 2 * CHUNK && s.calls[2].len == 3616);
        assert (!s.calls[3].is_data);
        assert (yields == 0);  // fewer than 4 full chunks, no yield
    }

    {  // A chunk failure must abort — terminator attempted, no further
       // data chunks, and the failing send's error is returned.
        FakeSender s (region);
        s.fail_on_call = 1;
        int ret = send_region_chunked (s, [] {}, region, region + sizeof (region), CHUNK);
        assert (ret == s.error_code);
        assert (s.calls.size () == 3);  // chunk0 ok, chunk1 fail, terminator — nothing more
        assert (s.calls[0].is_data && !s.calls[2].is_data);
    }

    {  // First-chunk failure: no data ever counted as sent.
        FakeSender s (region);
        s.fail_on_call = 0;
        int ret = send_region_chunked (s, [] {}, region, region + sizeof (region), CHUNK);
        assert (ret == s.error_code);
        assert (s.calls.size () == 2 && !s.calls[1].is_data);
    }

    {  // Terminator failure on an otherwise clean send surfaces its error.
        FakeSender s (region);
        s.fail_on_call = 3;
        int ret = send_region_chunked (s, [] {}, region, region + sizeof (region), CHUNK);
        assert (ret == s.error_code);
        assert (s.calls.size () == 4);
    }

    {  // Exact multiple of chunk size: no empty data chunk before terminator.
        FakeSender s (region);
        int ret = send_region_chunked (s, [] {}, region, region + 2 * CHUNK, CHUNK);
        assert (ret == 0);
        assert (s.calls.size () == 3);
        assert (s.calls[1].is_data && s.calls[1].len == CHUNK && !s.calls[2].is_data);
    }

    {  // Empty region: terminator only.
        FakeSender s (region);
        int ret = send_region_chunked (s, [] {}, region, region, CHUNK);
        assert (ret == 0);
        assert (s.calls.size () == 1 && !s.calls[0].is_data);
    }

    {  // Yield cadence: after every 4th full chunk, but never after the end.
        static unsigned char big[8192 * 9];
        FakeSender           s (big);
        int                  yields = 0;
        int ret = send_region_chunked (s, [&] { yields++; }, big, big + sizeof (big), CHUNK);
        assert (ret == 0);
        assert (s.calls.size () == 10);  // 9 chunks + terminator
        assert (yields == 2);            // after chunks 4 and 8; not after 9 (end)
    }

    printf ("test_chunked_send: all assertions passed\n");
    return 0;
}
