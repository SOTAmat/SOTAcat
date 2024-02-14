# This file was automatically generated for projects
# without default 'CMakeLists.txt' file.

FILE(GLOB_RECURSE app_sources ${CMAKE_SOURCE_DIR}/src/*.c)

#target_add_binary_data(${COMPONENT_TARGET} "index.html" TEXT)
#target_add_binary_data(${COMPONENT_TARGET} "sclogo.png" TEXT)

idf_component_register(SRCS ${app_sources} EMBED_FILES "web/index.html" "web/sclogo.png" "web/favicon.ico" "web/style.css" "web/script.js")

