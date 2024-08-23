#include "globals.h"
#include "kx_radio.h"
#include "webserver.h"

#include <esp_flash_partitions.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_timer.h>

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_ota.";

/**
 * Handles a HTTP PUT request to upload new firmware.
 * If upload is successful, a subsequent reboot will be scheduled.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on successful upload, appropriate error code otherwise.
 */
esp_err_t handler_ota_post (httpd_req_t * req) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    showActivity();

#ifndef SEEED_XIAO
    REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA update not supported on this platform");
#endif
    const esp_partition_t * running_partition = esp_ota_get_running_partition();
    if (running_partition == NULL)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to retrieve running partition");
    ESP_LOGI (TAG8, "running partition is '%s'", running_partition->label);

    const esp_partition_t * update_partition = esp_ota_get_next_update_partition (NULL);
    if (update_partition == NULL)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "No OTA partition available");
    ESP_LOGI (TAG8, "update partition is '%s'", update_partition->label);

    esp_ota_handle_t ota_handle;
    esp_err_t        err = esp_ota_begin (update_partition, OTA_SIZE_UNKNOWN, &ota_handle);
    if (err != ESP_OK) {
        ESP_LOGE (TAG8, "OTA: esp_ota_begin failed (%s)", esp_err_to_name (err));
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA begin failed");
    }

    int  total_len = req->content_len;
    int  remaining = total_len;
    char ota_buff[1024];

    ESP_LOGI (TAG8, "receiving upload of new firmware");
    while (remaining > 0) {
        int recv_len = httpd_req_recv (req, ota_buff, MIN (remaining, sizeof (ota_buff)));
        if (recv_len <= 0) {
            ESP_LOGE (TAG8, "OTA: Data reception error (%d)", recv_len);
            esp_ota_abort (ota_handle);
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA data reception error");
        }
        ESP_LOGV (TAG8, "received chunk");

        err = esp_ota_write (ota_handle, (const void *)ota_buff, recv_len);
        if (err != ESP_OK) {
            ESP_LOGE (TAG8, "OTA: esp_ota_write failed (%s)", esp_err_to_name (err));
            esp_ota_abort (ota_handle);
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA write failed");
        }
        ESP_LOGV (TAG8, "wrote chunk");

        remaining -= recv_len;
    }

    err = esp_ota_end (ota_handle);
    if (err != ESP_OK) {
        ESP_LOGE (TAG8, "OTA: esp_ota_end failed (%s)", esp_err_to_name (err));
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA end failed");
    }

    err = esp_ota_set_boot_partition (update_partition);
    if (err != ESP_OK) {
        ESP_LOGE (TAG8, "OTA: esp_ota_set_boot_partition failed (%s)", esp_err_to_name (err));
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "Setting boot partition failed");
    }

    const esp_partition_t * boot_partition = esp_ota_get_boot_partition();
    if (boot_partition == NULL)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to retrieve boot partition");
    ESP_LOGI (TAG8, "boot partition is '%s'", boot_partition->label);

    ESP_LOGI (TAG8, "ota update successful. restarting.");
    err = schedule_deferred_reboot (req);
    if (err != ESP_OK)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to schedule reboot");

    REPLY_WITH_SUCCESS();
}
