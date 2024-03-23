Import("env")

# Assuming merge_binaries.py is in the same directory as this script
from merge_binaries import merge_binaries

# env.AddPostAction(
#     "$BUILD_DIR/${PROGNAME}.elf", lambda *args, **kwargs: merge_binaries(env)
# )

env.AddPostAction("upload", merge_binaries)
