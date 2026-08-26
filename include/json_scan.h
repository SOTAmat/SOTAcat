#pragma once

#include <cstddef>
#include <cstdio>
#include <cstring>

/**
 * Minimal JSON array scanning for the settings handlers (host-testable; see
 * test/host/test_json_scan.cpp).
 *
 * String-aware and depth-counting: brackets inside quoted strings (IPv6
 * URLs, macro text) and nested arrays/objects never terminate the scan, so
 * the stored array is always the complete value of the key.
 */

// Locate the JSON array value of `key` within `payload`. Returns a pointer
// to the opening '[' and sets *out_len to the array's full length including
// the closing ']'; returns nullptr when the key is absent, its value is not
// an array, or the array is unterminated.
inline const char * json_find_array (const char * payload, const char * key, size_t * out_len) {
    char quoted[48];
    snprintf (quoted, sizeof (quoted), "\"%s\"", key);
    const char * at = strstr (payload, quoted);
    if (!at)
        return nullptr;

    // The array must be the key's own value: only whitespace and the colon
    // may sit between the key and the '['.
    const char * p = at + strlen (quoted);
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')
        ++p;
    if (*p != ':')
        return nullptr;
    ++p;
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')
        ++p;
    if (*p != '[')
        return nullptr;

    const char * start     = p;
    int          depth     = 0;
    bool         in_string = false;
    for (; *p; ++p) {
        if (in_string) {
            if (*p == '\\' && p[1])
                ++p;  // skip the escaped character
            else if (*p == '"')
                in_string = false;
        }
        else if (*p == '"')
            in_string = true;
        else if (*p == '[')
            ++depth;
        else if (*p == ']') {
            if (--depth == 0) {
                *out_len = (size_t)(p - start) + 1;
                return start;
            }
        }
    }
    return nullptr;  // unterminated
}

// Count the top-level elements of an array located by json_find_array().
// Commas inside strings or nested arrays/objects do not count.
inline int json_array_count (const char * array, size_t len) {
    int  count     = 0;
    int  depth     = 0;
    bool in_string = false;
    bool has_value = false;
    for (size_t i = 0; i < len; ++i) {
        char c = array[i];
        if (in_string) {
            if (c == '\\' && i + 1 < len)
                ++i;
            else if (c == '"')
                in_string = false;
            continue;
        }
        switch (c) {
        case '"': in_string = true; has_value = true; break;
        case '[':
        case '{': ++depth; if (depth > 1) has_value = true; break;
        case ']':
        case '}': --depth; break;
        case ',':
            if (depth == 1)
                ++count;
            break;
        default:
            if (depth == 1 && c != ' ' && c != '\t' && c != '\r' && c != '\n')
                has_value = true;
        }
    }
    return has_value ? count + 1 : 0;
}
