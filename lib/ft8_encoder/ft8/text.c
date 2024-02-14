#include "text.h"

#include <string.h>

bool is_digit(char c)
{
    return (c >= '0') && (c <= '9');
}

bool is_letter(char c)
{
    return ((c >= 'A') && (c <= 'Z')) || ((c >= 'a') && (c <= 'z'));
}

bool in_range(char c, char min, char max)
{
    return (c >= min) && (c <= max);
}

bool starts_with(const char* string, const char* prefix)
{
    return 0 == memcmp(string, prefix, strlen(prefix));
}

bool equals(const char* string1, const char* string2)
{
    return 0 == strcmp(string1, string2);
}

int char_index(const char* string, char c)
{
    for (int i = 0; *string; ++i, ++string)
    {
        if (c == *string)
        {
            return i;
        }
    }
    return -1; // Not found
}

// Parse a 2 digit integer from string
int dd_to_int(const char* str, int length)
{
    int result = 0;
    bool negative;
    int i;
    if (str[0] == '-')
    {
        negative = true;
        i = 1; // Consume the - sign
    }
    else
    {
        negative = false;
        i = (str[0] == '+') ? 1 : 0; // Consume a + sign if found
    }

    while (i < length)
    {
        if (str[i] == 0)
            break;
        if (!is_digit(str[i]))
            break;
        result *= 10;
        result += (str[i] - '0');
        ++i;
    }

    return negative ? -result : result;
}
