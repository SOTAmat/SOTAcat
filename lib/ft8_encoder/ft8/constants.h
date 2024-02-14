#ifndef _INCLUDE_CONSTANTS_H_
#define _INCLUDE_CONSTANTS_H_

#include <stdint.h>

#ifdef __cplusplus
extern "C"
{
#endif

#ifndef M_PI
    #define M_PI 3.14159265358979323846
#endif

#define FT8_SYMBOL_PERIOD (0.160f) ///< FT8 symbol duration, defines tone deviation in Hz and symbol rate
#define FT8_SLOT_TIME     (15.0f)  ///< FT8 slot period

// Define FT8 symbol counts
// FT8 message structure:
//     S D1 S D2 S
// S  - sync block (7 symbols of Costas pattern)
// D1 - first data block (29 symbols each encoding 3 bits)
#define FT8_ND          (58) ///< Data symbols
#define FT8_NN          (79) ///< Total channel symbols (FT8_NS + FT8_ND)

// Define LDPC parameters
#define FTX_LDPC_N       (174)                  ///< Number of bits in the encoded message (payload with LDPC checksum bits)
#define FTX_LDPC_K       (91)                   ///< Number of payload bits (including CRC)
#define FTX_LDPC_M       (83)                   ///< Number of LDPC checksum bits (FTX_LDPC_N - FTX_LDPC_K)
#define FTX_LDPC_N_BYTES ((FTX_LDPC_N + 7) / 8) ///< Number of whole bytes needed to store 174 bits (full message)
#define FTX_LDPC_K_BYTES ((FTX_LDPC_K + 7) / 8) ///< Number of whole bytes needed to store 91 bits (payload + CRC only)

// Define CRC parameters
#define FT8_CRC_POLYNOMIAL ((uint16_t)0x2757u) ///< CRC-14 polynomial without the leading (MSB) 1
#define FT8_CRC_WIDTH      (14)

    /// Costas 7x7 tone pattern for synchronization
    extern const uint8_t kFT8_Costas_pattern[7];

    /// Gray code map to encode 8 symbols (tones)
    extern const uint8_t kFT8_Gray_map[8];

    /// Parity generator matrix for (174,91) LDPC code, stored in bitpacked format (MSB first)
    extern const uint8_t kFTX_LDPC_generator[FTX_LDPC_M][FTX_LDPC_K_BYTES];

#ifdef __cplusplus
}
#endif

#endif // _INCLUDE_CONSTANTS_H_
