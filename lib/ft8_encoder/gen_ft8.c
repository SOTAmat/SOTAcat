#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#include <stdbool.h>
#include "ft8/pack.h"
#include "ft8/encode.h"
#include "ft8/constants.h"

#define LOG_LEVEL LOG_INFO

#define FT8_SYMBOL_BT 2.0f ///< symbol smoothing filter bandwidth factor (BT)

#define GFSK_CONST_K 5.336446f ///< == pi * sqrt(2 / log(2))

void usage()
{
    printf("\nGenerate an array of FSK-8 symbols given an FT8 message.\n");
    printf("Usage:\n");
    printf("\n");
    printf("gen_ft8 \"YOUR_FT8_MESSAGE\"\n");
    printf("\n");
    printf("(Enclose your message in quote marks if it contains spaces)\n");
}

int main(int argc, char** argv)
{
    // Expect two command-line arguments
    if (argc < 2)
    {
        usage();
        return -1;
    }

    const char* message = argv[1];

    // First, pack the text data into binary message
    uint8_t packed[FTX_LDPC_K_BYTES];
    int rc = pack77(message, packed);
    if (rc < 0)
    {
        printf("Cannot parse message!\n");
        printf("RC = %d\n", rc);
        return -2;
    }

    int num_tones = FT8_NN;
    // float symbol_period = FT8_SYMBOL_PERIOD;
    // float symbol_bt = FT8_SYMBOL_BT;
    // float slot_time = FT8_SLOT_TIME;

    // Second, encode the binary message as a sequence of FSK tones
    uint8_t tones[num_tones]; // Array of 79 tones (symbols)
    ft8_encode(packed, tones);

    printf("FSK tones:\n");
    for (int j = 0; j < num_tones; ++j)
    {
        printf("%d", tones[j]);
    }
    printf("\n");

    return 0;
}
