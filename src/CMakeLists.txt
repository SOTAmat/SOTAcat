# This file was automatically generated for projects
# without default 'CMakeLists.txt' file.

FILE(GLOB_RECURSE app_sources ${CMAKE_SOURCE_DIR}/src/*.cpp)

#target_add_binary_data(${COMPONENT_TARGET} "index.html" TEXT)
#target_add_binary_data(${COMPONENT_TARGET} "sclogo.png" TEXT)

idf_component_register(
    SRCS ${app_sources} 
    EMBED_FILES 
        "web/index.html"
        "web/sclogo.png"
        "web/favicon.ico"
        "web/style.css"
        "web/main.js"
        "web/sota.html"
        "web/sota.js"
        "web/pota.html"
        "web/pota.js"
        "web/cat.html"
        "web/cat.js"
        "web/settings.html"
        "web/settings.js"
        "web/about.html"
        )

# Apply compile definitions to this component
target_compile_definitions(${COMPONENT_LIB} PRIVATE LOG_LOCAL_LEVEL=ESP_LOG_VERBOSE)
