#include "max17260.h"
#include <string.h>

#include <esp_log.h>
static const char * TAG8 = "sc:max17260";

typedef enum {
    STATUS         = 0,
    REPCAPREG      = 0x05,
    REPSOC         = 0x06,
    TEMPERATURE    = 0x08,
    VCELL          = 0x09,
    CURRENT        = 0x0A,
    CURRENTAVG     = 0x0B,
    FULLCAPREP     = 0x10,
    TTEREG         = 0x11,
    TEMPERATUREAVG = 0x16,
    CYCLES         = 0x17,
    DESIGNCAP      = 0x18,
    VCELLAVG       = 0x19,
    ICGHTERM       = 0x1E,
    TTFREG         = 0x20,
    DEVNAME        = 0x21,
    FULLCAPNOM     = 0x23,
    RCOMP0         = 0x38,
    TEMPCO         = 0x39,
    VEMPTY         = 0x3A,
    FSTAT          = 0x3D,
    SOFTWKUP       = 0x60,
    HIBCFG         = 0xBA,
    POWER          = 0xB1,
    POWERAVG       = 0xB3,
    MODELCFG       = 0xDB,
} max17620_register_e;

typedef enum {
    DEV_ID_MAX17260 = 0x4031,
    DEV_ID_MAX17261 = 0x4033,
    DEV_ID_MAX17262 = 0x4039,
    DEV_ID_MAX17263 = 0x4037,
} max_device_type_e;

const uint16_t SATUS_POR_BITS            = 0x0002;
const uint16_t FSTAT_DNR_BITS            = 0x0001;
const uint16_t SOFTWKUP_EXIT_HIBERNATE_1 = 0x0090;
const uint16_t HIBCFG_EXIT_HIBERNATE_2   = 0x0000;
const uint16_t SOFTWKUP_EXIT_HIBERNATE_3 = 0x0000;
const uint8_t  VEMPTY_BIT_SHIFT          = 7;
const uint8_t  VRECOVERY_BIT_MASK        = 0x7f;
const uint16_t MODELCFG_REFRESH_BITS     = (1 << 15);
const uint8_t  MODEL_REFRESH_RETRIES     = 10;
const uint8_t  FSTAT_DNR_RETRIES         = 10;

// These values are derived from the table in the datasheet, p16
// https://www.analog.com/media/en/technical-documentation/data-sheets/MAX17260.pdf
// Note that in some cases the registers differ from these units
// as described per the user guide
// https://www.analog.com/media/en/technical-documentation/user-guides/max1726x-modelgauge-m5-ez-user-guide.pdf
// and the software implementation guide
// https://www.analog.com/media/en/technical-documentation/user-guides/modelgauge-m5-host-side-software-implementation-guide.pdf
const float rSense_ohms        = 10.0e-3;  // SotaCat Hardware; really should be initialized with the class
const float mAh_per_bit        = 0.5;      // datasheet page 16 (uVh/mOhms ?)
const float uV_per_bit         = 78.125;
const float uA_per_bit         = 1.5625 / rSense_ohms;  // (1.5625uV/ohm)*10mOhms = 156.25uA per bit
const float uW_per_bit         = 8.0 / 10e-3;
const float pct_SOC_per_bit    = 1.0 / 256.0;  // See page 16 of datasheet
const float degC_per_bit       = 0.00391;
const float sec_per_bit        = 5.625;
const float sec_per_min        = 60.0;
const float sec_per_hour       = 60.0 * sec_per_min;
const float vempty_v_per_bit   = 0.010;  // default 3.30  -- voltage at which to declare SOC 0%
const float vrecover_v_per_bit = 0.040;  // default 3.88 -- voltage at which to clear empty

// Registers like capacity are odd and can cause problems if the units are incorrect
// Divide by units_per_bit to set a register, multiply when reading for display

void Max17620::default_setup (max17620_setup_t * setup) {
    setup->design_cap = (500.0);           // Battery cell design capacity, mAh
    setup->i_chg_term = (0.13 * 370.370);  // mA per XC6802MR datasheet and XIAO charge current TODO
    setup->v_empty    = (3.50);            // ESP32-C3 wifi falls over below 3.5V, so we call that empty
    setup->v_recovery = (3.88);            // voltage at which empty detection is cleared. 40mV resolution
}

esp_err_t Max17620::check_POR (void) {
    uint16_t data = 0;
    smbus_read_word (m_smb, STATUS, &data);
    bool statusPOR = (data & SATUS_POR_BITS);
    if (statusPOR) {
        ESP_LOGV (TAG8, "STATUS.POR 1, battery monitor needs configuration");
        return ESP_FAIL;
    }
    else {
        return ESP_OK;
    }
}

// Return an integer max1726x device number from the device id register value
uint16_t Max17620::devnum (uint16_t devname) {

    switch (devname) {
    case DEV_ID_MAX17260: return 17260;
    case DEV_ID_MAX17261: return 17261;
    case DEV_ID_MAX17262: return 17262;
    case DEV_ID_MAX17263: return 17263;
    default: return 0;
    }
}

esp_err_t Max17620::present (void) {
    uint16_t data = 0;
    if (ESP_OK == smbus_quick (m_smb, 0)) {
        ESP_LOGV (TAG8, "Device found at address 0x%02x", MAX_1726x_ADDR);
    }
    else {
        ESP_LOGE (TAG8, "No device found at address 0x%02x", MAX_1726x_ADDR);
        return ESP_FAIL;
    }

    smbus_read_word (m_smb, DEVNAME, &data);
    uint16_t num = devnum (data);
    if (num != 0) {
        ESP_LOGV (TAG8, "Battery monitor of type MAX%05d found", num);
    }
    else {
        ESP_LOGE (TAG8, "Battery monitor device not found");
        return ESP_FAIL;
    }
    return ESP_OK;
}

esp_err_t Max17620::init (smbus_info_t * smb, max17620_setup_t * setup) {
    uint16_t data = 0;

    m_smb = smb;
    memcpy (&m_setup, setup, sizeof (max17620_setup_t));

    if (ESP_OK != present())
        return ESP_FAIL;

    if (ESP_OK == check_POR()) {  // chip is already configured
        ESP_LOGV (TAG8, "Battery Monitor is already configured, skipping configuration");
        return ESP_OK;
    }
    ESP_LOGV (TAG8, "Battery Monitor needs configuration, configuring");

    // Wait for FSTAT.DNR == 0
    smbus_read_word (m_smb, FSTAT, &data);
    int retries = FSTAT_DNR_RETRIES;
    while ((data & FSTAT_DNR_BITS) && --retries) {
        ESP_LOGV (TAG8, "FSTAT.DNR is 1; waiting 10ms to retry");
        smbus_read_word (m_smb, FSTAT, &data);
        vTaskDelay (10 / portTICK_PERIOD_MS);
    }
    if (0 == retries) {
        ESP_LOGE (TAG8, "Timed out waiting for FSTAT.DNR to be 0");
        return ESP_FAIL;
    }

    ESP_LOGV (TAG8, "Updating battery model");

    uint16_t HibCFG_val = 0;
    uint16_t DesignCap  = (uint16_t)(setup->design_cap / mAh_per_bit);  // Write 1000
    uint16_t IchgTerm   = (uint16_t)(setup->i_chg_term / uA_per_bit);   // mA per XC6802MR datasheet and XIAO charge current TODO
    uint16_t vempty     = (uint16_t)(setup->v_empty / vempty_v_per_bit);
    uint16_t vrecovery  = (uint16_t)(setup->v_recovery / vrecover_v_per_bit);

    smbus_read_word (m_smb, HIBCFG, &HibCFG_val);
    smbus_write_word (m_smb, SOFTWKUP, SOFTWKUP_EXIT_HIBERNATE_1);
    smbus_write_word (m_smb, HIBCFG, HIBCFG_EXIT_HIBERNATE_2);
    smbus_write_word (m_smb, SOFTWKUP, SOFTWKUP_EXIT_HIBERNATE_3);

    smbus_write_word (m_smb, DESIGNCAP, DesignCap);  // Write DesignCap
    smbus_write_word (m_smb, ICGHTERM, IchgTerm);    // Write IchgTerm

    smbus_write_word (m_smb, VEMPTY, (vempty << VEMPTY_BIT_SHIFT) | (vrecovery & VRECOVERY_BIT_MASK));  // Write VEmpty/VRecovery
    smbus_write_word (m_smb, MODELCFG, MODELCFG_REFRESH_BITS);                                          // Set ModelCFG.Refresh to refresh the model

    ESP_LOGV (TAG8, "Setting ModelCFG.Refresh to refresh the model");

    // Poll ModelCFG.Refresh(highest bit),
    ESP_LOGV (TAG8, "Checking ModelCFG.Refresh for 0. Can take up to 1000ms");
    smbus_read_word (m_smb, MODELCFG, &data);
    retries = MODEL_REFRESH_RETRIES;
    while ((data & MODELCFG_REFRESH_BITS) && --retries) {
        ESP_LOGV (TAG8, "ModelCFG.Refresh is 1; waiting 250ms to retry");
        smbus_read_word (m_smb, MODELCFG, &data);
        vTaskDelay (250 / portTICK_PERIOD_MS);
    }
    if (0 == retries) {
        ESP_LOGE (TAG8, "Timed out waiting for ModelCFG.Refresh to be 0");
        return ESP_FAIL;
    }

    // Wait for FSTAT.DNR == 0
    ESP_LOGV (TAG8, "Checking FSTAT.DNR for 0");
    smbus_read_word (m_smb, FSTAT, &data);
    retries = MODEL_REFRESH_RETRIES;
    while ((data & FSTAT_DNR_BITS) && --retries) {
        ESP_LOGV (TAG8, "FSTAT.DNR is 1; waiting 10ms to retry");
        smbus_read_word (m_smb, FSTAT, &data);
        vTaskDelay (10 / portTICK_PERIOD_MS);
    }
    if (0 == retries) {
        ESP_LOGE (TAG8, "Timed out waiting for FSTAT.DNR to be 0");
        return ESP_FAIL;
    }

    smbus_write_word (m_smb, 0xBA, HibCFG_val);  // Restore Original HibCFG value

    smbus_read_word (m_smb, STATUS, &data);
    ESP_LOGV (TAG8, "STATUS: 0x%04x before reset", data);
    smbus_write_word (m_smb, STATUS, data & 0xFFFD);
    ESP_LOGV (TAG8, "STATUS: 0x%04x after reset", data);
    // reset all status registers?

    ESP_LOGI (TAG8, "Finished Battery Monitor IC configuation");
    return ESP_OK;
}

// It is recommended saving the learned capacity parameters every time bit 6 of the Cycles register toggles
// (so that it is saved every 64% change in the battery) so that if power is lost, the values can easily be
// restored.  TODO
esp_err_t Max17620::read_learned_params (max17260_saved_params_t * params) {
    smbus_read_word (m_smb, RCOMP0, &(params->RCOMP0));          // Read RCOMP0
    smbus_read_word (m_smb, TEMPCO, &(params->TempCo));          // Read TempCo
    smbus_read_word (m_smb, FULLCAPREP, &(params->FullCapRep));  // Read FullCapRep
    smbus_read_word (m_smb, CYCLES, &(params->Cycles));          // Read Cycles
    smbus_read_word (m_smb, FULLCAPNOM, &(params->FullCapNom));  // Read FullCapNom

    ESP_LOGV (TAG8, "RCOMP0: %d TempCo: %d, FullCapRep: %3.1f, Cycles: %3.2f, FullCapNom: %3.1f", params->RCOMP0, params->TempCo, params->FullCapRep * mAh_per_bit, (float)params->Cycles * 0.01, params->FullCapNom * mAh_per_bit);

    return ESP_OK;
}

// It is recommended saving the learned capacity parameters every time bit 6 of the Cycles register toggles
// (so that it is saved every 64% change in the battery) so that if power is lost, the values can easily be
// restored.  TODO
esp_err_t Max17620::write_learned_params (max17260_saved_params_t * params) {

    smbus_write_word (m_smb, RCOMP0, params->RCOMP0);          // Write RCOMP0
    smbus_write_word (m_smb, TEMPCO, params->TempCo);          // Write TempCo
    smbus_write_word (m_smb, FULLCAPREP, params->FullCapRep);  // Write FullCapRep
    smbus_write_word (m_smb, CYCLES, params->Cycles);          // Write Cycles
    smbus_write_word (m_smb, FULLCAPNOM, params->FullCapNom);  // Write FullCapNom
    ESP_LOGV (TAG8, "Battery monitor Wrote saved params back to");

    return ESP_OK;
}

esp_err_t Max17620::poll (max17260_info_t * info) {
    // Periodically the host should check if the fuel gauge has been reset and initialize it if needed.
    //  This is necessary because the max17620 is always connected to the battery, so normally it stays
    //  powered even if the SOTAcat is switched off. However, if the battery is disconnected, the
    //  Max17620 will need to be reconfigured.
    if (ESP_OK != check_POR())  // chip is not already configured
        init (m_smb, &m_setup);

    uint16_t RepCap         = 0;
    uint16_t RepSOC         = 0;
    uint16_t TimeToEmpty    = 0;
    uint16_t TimeToFull     = 0;
    uint16_t VCell          = 0;
    uint16_t VCellAvg       = 0;
    int16_t  Current        = 0;
    int16_t  CurrentAvg     = 0;
    int16_t  Temperature    = 0;
    int16_t  TemperatureAvg = 0;
    int16_t  Power          = 0;
    int16_t  PowerAvg       = 0;

    smbus_read_word (m_smb, REPCAPREG, &RepCap);
    smbus_read_word (m_smb, REPSOC, &RepSOC);
    smbus_read_word (m_smb, TTEREG, &TimeToEmpty);
    smbus_read_word (m_smb, TTFREG, &TimeToFull);

    smbus_read_word (m_smb, VCELL, &VCell);
    smbus_read_word (m_smb, VCELLAVG, &VCellAvg);

    smbus_read_word (m_smb, CURRENT, (uint16_t *)&Current);        // 8uV^2 / Rsense
    smbus_read_word (m_smb, CURRENTAVG, (uint16_t *)&CurrentAvg);  // 8uV^2 / Rsense

    smbus_read_word (m_smb, TEMPERATURE, (uint16_t *)&Temperature);
    smbus_read_word (m_smb, TEMPERATUREAVG, (uint16_t *)&TemperatureAvg);

    smbus_read_word (m_smb, POWER, (uint16_t *)&Power);
    smbus_read_word (m_smb, POWERAVG, (uint16_t *)&PowerAvg);

    info->voltage                  = (float)VCell * uV_per_bit * 1e-6;
    info->voltage_average          = (float)VCellAvg * uV_per_bit * 1e-6;
    info->current                  = (float)Current * uA_per_bit * 1e-3;
    info->current_average          = (float)CurrentAvg * uA_per_bit * 1e-3;
    info->reported_capacity        = RepCap * mAh_per_bit;
    info->reported_state_of_charge = (float)RepSOC * pct_SOC_per_bit;
    info->time_to_empty            = TimeToEmpty * sec_per_bit / sec_per_hour;
    info->time_to_full             = TimeToFull * sec_per_bit / sec_per_hour;
    info->temperature              = (float)Temperature * degC_per_bit;
    info->temperature_average      = (float)TemperatureAvg * degC_per_bit;
    info->power                    = (float)Power * uW_per_bit * 1e-3;
    info->power_average            = (float)PowerAvg * uW_per_bit * 1e-3;

    info->charging = info->current_average > (0.125 * m_setup.i_chg_term);
    // TODO: Consider using the FSTAT.FQ bit when charging to detect full.

    ESP_LOGV (TAG8, "RemCap: %3.1fmAh SOC: %2.1f%% TTE: %3.2fhr TTF: %3.2fhr", info->reported_capacity, info->reported_state_of_charge, info->time_to_empty, info->time_to_full);
    ESP_LOGV (TAG8, "V: %3.2fV Va: %3.2fV I: %3.2fmA Ia: %3.2fmA", info->voltage, info->voltage_average, info->current, info->current_average);
    ESP_LOGV (TAG8, "T: %2.1f Ta: %2.1f P: %3.2fmW Pa: %3.2fmW", info->temperature, info->temperature_average, info->power, info->power_average);

    read_learned_params (&m_saved_params);

    return ESP_OK;
}
