// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
//
// Contract pinned here: the settings handlers' JSON array scanner is
// string-aware and depth-counting, so a bracket inside a quoted string
// (an IPv6 URL like "http://[2001:db8::1]:8073/") or a nested object can
// never truncate the stored array; and the top-level element count is
// exact, so the server can enforce its own limits instead of trusting the
// client's byte budget.
#include "../../include/json_scan.h"
#include <cassert>
#include <cstring>
#include <cstdio>

int main () {
    size_t       len = 0;
    const char * a;

    // Flat array of strings.
    a = json_find_array ("{\"targets\": [\"http://a/\", \"http://b/\"], \"mobile\": true}", "targets", &len);
    assert (a && *a == '[');
    assert (strncmp (a, "[\"http://a/\", \"http://b/\"]", len) == 0);
    assert (json_array_count (a, len) == 2);

    // The IPv6 case: ']' inside a quoted string must not end the array.
    const char * ipv6 = "{\"targets\": [{\"url\":\"http://[2001:db8::1]:8073/\"}], \"mobile\": false}";
    a = json_find_array (ipv6, "targets", &len);
    assert (a);
    assert (a[len - 1] == ']');
    assert (strstr (ipv6, "}]") + 1 == a + len - 1);  // ends at the real array close
    assert (json_array_count (a, len) == 1);

    // Nested objects with commas inside them count as single elements.
    a = json_find_array ("{\"macros\": [{\"label\":\"CQ\",\"template\":\"CQ {MYCALL}\"}, {\"label\":\"73\",\"template\":\"73\"}]}", "macros", &len);
    assert (a && json_array_count (a, len) == 2);

    // Escaped quotes inside strings do not end string mode.
    a = json_find_array ("{\"macros\": [{\"label\":\"say \\\"hi\\\", ok\",\"template\":\"x]y\"}]}", "macros", &len);
    assert (a);
    assert (a[len - 1] == ']');
    assert (json_array_count (a, len) == 1);

    // Empty array counts zero.
    a = json_find_array ("{\"macros\": []}", "macros", &len);
    assert (a && json_array_count (a, len) == 0);

    // Missing key, missing bracket, unterminated array.
    assert (json_find_array ("{\"other\": []}", "targets", &len) == nullptr);
    assert (json_find_array ("{\"targets\": 5}", "targets", &len) == nullptr);
    assert (json_find_array ("{\"targets\": [\"a\"", "targets", &len) == nullptr);

    // Nested arrays keep depth.
    a = json_find_array ("{\"targets\": [[1,2],[3]]}", "targets", &len);
    assert (a && strncmp (a, "[[1,2],[3]]", len) == 0);
    assert (json_array_count (a, len) == 2);

    printf ("test_json_scan: all assertions passed\n");
    return 0;
}
