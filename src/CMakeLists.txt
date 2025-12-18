# This file was automatically generated for projects
# without default 'CMakeLists.txt' file.

FILE(GLOB_RECURSE app_sources ${CMAKE_SOURCE_DIR}/src/*.cpp)

#target_add_binary_data(${COMPONENT_TARGET} "index.html" TEXT)
#target_add_binary_data(${COMPONENT_TARGET} "sclogo.jpg" TEXT)

idf_component_register(
    SRCS ${app_sources}
    INCLUDE_DIRS "../include"
    REQUIRES esp_http_server esp_timer nvs_flash esp_wifi esp_netif
             esp_driver_uart esp_driver_gpio esp_driver_i2c esp_adc
             app_update
    EMBED_FILES
        "web/index.htmlgz"
        "web/sclogo.jpg"
        "web/favicon.ico"
        "web/style.cssgz"
        "web/main.jsgz"
        "web/chase.htmlgz"
        "web/chase.jsgz"
        "web/chase_api.jsgz"
        "web/cat.htmlgz"
        "web/cat.jsgz"
        "web/settings.htmlgz"
        "web/settings.jsgz"
        "web/about.htmlgz"
        "web/about.jsgz"
        )

# Apply compile definitions to this component
target_compile_definitions(${COMPONENT_LIB} PRIVATE LOG_LOCAL_LEVEL=ESP_LOG_VERBOSE)
