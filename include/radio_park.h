#pragma once
// Pure, header-only park table for asynchronous radio HTTP requests.
// No ESP-IDF / FreeRTOS dependencies so it is host-unit-testable.
//
// A "parked" request is an httpd request that was detached from the HTTP
// server task (httpd_req_async_handler_begin) and is waiting for the radio
// service task to finish a refresh or SET, or for its deadline to pass.
// This table only tracks opaque handles + bookkeeping; sending the reply
// and freeing the request is the IDF shim's job.
//
// Rules (see 2026-08-17-radio-async-handlers-design.md):
//   * At most ONE parked request per kind. A newcomer on an occupied kind
//     supersedes the occupant, which the caller must complete immediately
//     with its timeout answer (the client's own newer request made it moot;
//     mirrors the request-slot coalescing in radio_service.cpp).
//   * SET kinds are generation-gated: on_done(kind, gen_applied) completes
//     the parked SET only if gen_applied >= parked.gen, so an op that started
//     before this request armed its slot cannot satisfy it.
//   * GET kinds complete on ANY refresh completion of that kind — a refresh
//     that began just before the park is still fresher than the wait bound.
//   * expire(now) removes every entry whose deadline has passed. Nothing
//     may stay parked past its deadline: parked sockets bypass httpd's LRU
//     purge, so an unbounded park exhausts sockets.
//   * The table is single-actor (HTTP server task only) — no locking here.
#include <cstdint>

enum class RadioParkKind : int {
    GET_FREQUENCY = 0,
    GET_MODE,
    GET_XMIT,
    SET_FREQUENCY,
    SET_MODE,
    SET_VOLUME,
    SET_ATU,
    COUNT
};

static constexpr int RADIO_PARK_KINDS = (int) RadioParkKind::COUNT;

class RadioParkTable {
  public:
    // max_parked caps occupancy below the natural one-per-kind bound so
    // the socket / heap budget can be tightened without touching callers.
    explicit RadioParkTable (int max_parked = RADIO_PARK_KINDS)
        : m_max (max_parked < 1 ? 1 : (max_parked > RADIO_PARK_KINDS ? RADIO_PARK_KINDS : max_parked)) {}

    static bool is_set_kind (RadioParkKind k) { return (int) k >= (int) RadioParkKind::SET_FREQUENCY; }

    int  count() const { return m_count; }
    bool empty() const { return m_count == 0; }
    bool full() const { return m_count >= m_max; }
    bool occupied (RadioParkKind k) const { return valid (k) && m_slots[(int) k].occupied; }

    // Park `handle`. Returns false (and parks nothing) if the kind is invalid
    // or the table is at its cap and this kind is unoccupied — the caller
    // then falls back to a synchronous reply. On success, *superseded (if
    // non-null) receives the handle this park displaced, or nullptr.
    bool park (RadioParkKind k, void * handle, uint32_t gen, int64_t deadline_us, void ** superseded = nullptr) {
        if (superseded) *superseded = nullptr;
        if (!valid (k) || !handle) return false;
        Slot & s = m_slots[(int) k];
        if (!s.occupied && m_count >= m_max) return false;
        if (s.occupied && superseded) *superseded = s.handle;
        if (!s.occupied) ++m_count;
        s.occupied    = true;
        s.handle      = handle;
        s.gen         = gen;
        s.deadline_us = deadline_us;
        return true;
    }

    // An op of `kind` finished (gen_applied is the slot generation the
    // worker drained; ignored for GET kinds). Returns the handle to complete,
    // or nullptr if nothing parked / not yet satisfied. Removes the entry.
    void * on_done (RadioParkKind k, uint32_t gen_applied) {
        if (!valid (k)) return nullptr;
        Slot & s = m_slots[(int) k];
        if (!s.occupied) return nullptr;
        if (is_set_kind (k) && (int32_t) (gen_applied - s.gen) < 0) return nullptr;  // older op
        return take (s);
    }

    // Remove every entry whose deadline has passed (deadline <= now). Writes
    // up to `max_out` handles into `out` (and their kinds into `out_kinds`
    // if non-null); returns the number written. Callers size the arrays at
    // RADIO_PARK_KINDS to never truncate.
    int expire (int64_t now_us, void ** out, int max_out, RadioParkKind * out_kinds = nullptr) {
        int n = 0;
        for (int i = 0; i < RADIO_PARK_KINDS && n < max_out; ++i) {
            Slot & s = m_slots[i];
            if (s.occupied && s.deadline_us <= now_us) {
                if (out_kinds) out_kinds[n] = (RadioParkKind) i;
                out[n++] = take (s);
            }
        }
        return n;
    }

    // Earliest pending deadline, or INT64_MAX if empty. Lets a shim arm a
    // one-shot timer instead of ticking, if it prefers.
    int64_t next_deadline() const {
        int64_t d = INT64_MAX;
        for (int i = 0; i < RADIO_PARK_KINDS; ++i)
            if (m_slots[i].occupied && m_slots[i].deadline_us < d) d = m_slots[i].deadline_us;
        return d;
    }

    // Remove everything (e.g. before stopping the server). Same out/return
    // contract as expire().
    int drain_all (void ** out, int max_out, RadioParkKind * out_kinds = nullptr) {
        int n = 0;
        for (int i = 0; i < RADIO_PARK_KINDS && n < max_out; ++i)
            if (m_slots[i].occupied) {
                if (out_kinds) out_kinds[n] = (RadioParkKind) i;
                out[n++] = take (m_slots[i]);
            }
        return n;
    }

  private:
    struct Slot {
        void *   handle      = nullptr;
        uint32_t gen         = 0;
        int64_t  deadline_us = 0;
        bool     occupied    = false;
    };

    static bool valid (RadioParkKind k) { return (int) k >= 0 && (int) k < RADIO_PARK_KINDS; }

    void * take (Slot & s) {
        void * h   = s.handle;
        s.handle   = nullptr;
        s.occupied = false;
        --m_count;
        return h;
    }

    Slot m_slots[RADIO_PARK_KINDS];
    int  m_max;
    int  m_count = 0;
};
