Import("env")

# Assuming merge_binaries.py is in the same directory as this script
from merge_binaries import merge_binaries

# env.AddPostAction(
#     "$BUILD_DIR/${PROGNAME}.elf", lambda *args, **kwargs: merge_binaries(env)
# )


def log_message(message):
    print(
        "SOTACAT Post-build step: " + message
    )  # Or use logging module for more advanced logging


log_message("Defining post-build step to merge binaries...")
env.AddPostAction("upload", merge_binaries)
