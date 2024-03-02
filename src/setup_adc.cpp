#include "esp_adc/adc_cali_scheme.h"
#include "esp_log.h"
#include "globals.h"


adc_oneshot_unit_handle_t Global_adc1_handle;
adc_oneshot_unit_init_cfg_t Global_init_config1 = {
    .unit_id = ADC_UNIT_1,
    .ulp_mode = ADC_ULP_MODE_DISABLE,
};
adc_oneshot_chan_cfg_t Global_chan_cfg = {
    .atten = ADC_ATTEN_DB_11,
    .bitwidth = ADC_BITWIDTH_DEFAULT,
};
adc_cali_handle_t Global_cali_handle = NULL;

// ====================================================================================================
static bool adc_calibration_init(adc_unit_t unit, adc_atten_t atten, adc_cali_handle_t *out_handle)
{
    adc_cali_handle_t handle = NULL;
    esp_err_t ret = ESP_FAIL;
    bool calibrated = false;

#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
    if (!calibrated)
    {
        ESP_LOGI(TAG, "ADC calibration scheme is: Curve Fitting");
        adc_cali_curve_fitting_config_t cali_config = {
            .unit_id = unit,
            .atten = atten,
            .bitwidth = ADC_BITWIDTH_DEFAULT,
        };
        ret = adc_cali_create_scheme_curve_fitting(&cali_config, &handle);
        if (ret == ESP_OK)
        {
            calibrated = true;
        }
    }
#endif

#if ADC_CALI_SCHEME_LINE_FITTING_SUPPORTED
    if (!calibrated)
    {
        ESP_LOGI(TAG, "ADC calibration scheme is: Line Fitting");
        adc_cali_line_fitting_config_t cali_config = {
            .unit_id = unit,
            .atten = atten,
            .bitwidth = ADC_BITWIDTH_DEFAULT,
        };
        ret = adc_cali_create_scheme_line_fitting(&cali_config, &handle);
        if (ret == ESP_OK)
        {
            calibrated = true;
        }
    }
#endif

    *out_handle = handle;
    if (ret == ESP_OK)
    {
        ESP_LOGI(TAG, "Calibration Success");
    }
    else if (ret == ESP_ERR_NOT_SUPPORTED || !calibrated)
    {
        ESP_LOGW(TAG, "Error: ADC Calibration: eFuse not burnt, skip software calibration");
    }
    else
    {
        ESP_LOGE(TAG, "Error: ADC Calibration: Invalid arg or no memory");
    }

    return calibrated;
}

// ====================================================================================================
static void adc_calibration_deinit(adc_cali_handle_t handle)
{
#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
    ESP_LOGI(TAG, "ADC deregister Curve Fitting calibration scheme");
    ESP_ERROR_CHECK(adc_cali_delete_scheme_curve_fitting(handle));

#elif ADC_CALI_SCHEME_LINE_FITTING_SUPPORTED
    ESP_LOGI(TAG, "ADC deregister Line Fitting calibration scheme");
    ESP_ERROR_CHECK(adc_cali_delete_scheme_line_fitting(handle));
#endif
}

// ====================================================================================================
void setup_adc()
{
    esp_err_t ret;

    ret = adc_oneshot_new_unit(&Global_init_config1, &Global_adc1_handle);
    if (ret != ESP_OK)
    {
        ESP_LOGE(TAG, "Error: Failed to initialize ADC oneshot unit");
        return;
    }

    ret = adc_oneshot_config_channel(Global_adc1_handle, ADC_CHANNEL_2, &Global_chan_cfg);
    if (ret != ESP_OK)
    {
        ESP_LOGE(TAG, "Error: Failed to configure ADC channel");
        return;
    }

    if (!adc_calibration_init(Global_init_config1.unit_id, Global_chan_cfg.atten, &Global_cali_handle))
    {
        Global_cali_handle = NULL;
        ESP_LOGE(TAG, "Error: Failed to initialize ADC calibration scheme");
        return;
    }

    ESP_LOGI(TAG, "ADC configured and ready to read....");
}

// ====================================================================================================
void shutdown_adc()
{
    adc_calibration_deinit(Global_cali_handle);
    adc_oneshot_del_unit(Global_adc1_handle);
}
