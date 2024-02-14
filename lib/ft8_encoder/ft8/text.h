#ifndef _INCLUDE_TEXT_H_
#define _INCLUDE_TEXT_H_

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C"
{
#endif

    // Utility functions for characters and strings

    bool is_digit(char c);
    bool is_letter(char c);
    bool in_range(char c, char min, char max);
    bool starts_with(const char* string, const char* prefix);
    bool equals(const char* string1, const char* string2);

    int char_index(const char* string, char c);

    // Parse a 2 digit integer from string
    int dd_to_int(const char* str, int length);

#ifdef __cplusplus
}
#endif

#endif // _INCLUDE_TEXT_H_
