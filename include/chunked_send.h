#pragma once

#include <cstddef>

/**
 * Chunked-send loop over a memory region (host-testable; see
 * test/host/test_chunked_send.cpp).
 *
 * Contract: any chunk failure aborts the transfer immediately — the loop
 * never advances past an unsent chunk — and the terminating zero-length
 * chunk is still attempted so the peer sees a torn connection instead of a
 * truncated body with a clean status. There is deliberately no retry:
 * esp_http_server collapses would-block and dead-socket failures into one
 * error code, and re-sending a partially-transmitted chunk would corrupt
 * the chunked framing.
 *
 * send(ptr, len) transmits one data chunk (len > 0) or the terminator
 * (len == 0) and returns 0 on success. yield() runs after every 4th full
 * chunk, except at the end of the region. Returns 0 when every chunk and
 * the terminator succeeded; otherwise the first failing send's error code.
 */
template <typename SendFn, typename YieldFn>
int send_region_chunked (SendFn && send, YieldFn && yield, const unsigned char * start, const unsigned char * end, size_t chunk_size) {
    size_t total = (size_t)(end - start);
    size_t sent  = 0;

    while (sent < total) {
        size_t to_send = total - sent < chunk_size ? total - sent : chunk_size;
        int    ret     = send (start + sent, to_send);
        if (ret != 0) {
            send (nullptr, 0);  // best-effort terminate; report the original error
            return ret;
        }
        sent += to_send;
        if (sent < total && sent % (chunk_size * 4) == 0)
            yield ();
    }

    return send (nullptr, 0);
}
