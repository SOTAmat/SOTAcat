#pragma once

#include "smbus.h"
#include <stdint.h>

#define MAX_1726x_ADDR (0x36)

typedef struct {
    float design_cap;  // Battery design capacity, mAh
    float i_chg_term;  // Charge termination current, mA
    float v_empty;     // Voltage considered empty, V
    float v_recovery;  // recovery volgage, V
} max17620_setup_t;

typedef struct {
    float voltage;                   // V
    float voltage_average;           // V
    float current;                   // mA
    float current_average;           // mA
    float reported_capacity;         // mAh
    float reported_state_of_charge;  // %
    float time_to_empty;             // hours
    float time_to_full;              // hours
    float temperature;               // degC
    float temperature_average;       // degC
    float power;                     // mW
    float power_average;             // mW
    bool  charging;
} max17260_info_t;

typedef struct {
    uint16_t RCOMP0;
    uint16_t TempCo;
    uint16_t FullCapRep;
    uint16_t Cycles;
    uint16_t FullCapNom;
} max17260_saved_params_t;

class Max17620 {
  private:
    smbus_info_t *          m_smb;
    max17620_setup_t        m_setup;
    max17260_saved_params_t m_saved_params;
    uint16_t                devnum (uint16_t devname);

  public:
    void      default_setup (max17620_setup_t *);
    esp_err_t present (void);
    esp_err_t check_POR (void);
    esp_err_t init (smbus_info_t *, max17620_setup_t *);
    esp_err_t read_learned_params (max17260_saved_params_t *);
    esp_err_t write_learned_params (max17260_saved_params_t *);
    esp_err_t poll (max17260_info_t *);
};
