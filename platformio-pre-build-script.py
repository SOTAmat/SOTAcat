import datetime

with open("include/build_info.h", "w") as f:
    f.write(
        '#define BUILD_DATE_TIME "{}"\n'.format(
            datetime.datetime.now().strftime("%y%m%d:%H%M")
        )
    )
