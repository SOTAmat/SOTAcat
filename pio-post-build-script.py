Import("env")

def log_message(message):
    print(
        "SOTACAT Post-build step: " + message
    )  # Or use logging module for more advanced logging


log_message("Post-build script loaded")
log_message("No automatic webtools publish in post-build; use package_webtools or verify_and_publish_webtools targets")
