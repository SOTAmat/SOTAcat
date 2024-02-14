CFLAGS = -O3 -ggdb3 -fsanitize=address
CPPFLAGS = -std=c11 -I.
LDFLAGS = -lm -fsanitize=address

TARGETS = gen_ft8

.PHONY: run_tests all clean

all: $(TARGETS)

gen_ft8: gen_ft8.o ft8/constants.o ft8/text.o ft8/pack.o ft8/encode.o ft8/crc.o
	$(CXX) $(LDFLAGS) -o $@ $^

clean:
	rm -f *.o ft8/*.o common/*.o fft/*.o $(TARGETS)
install:
	$(AR) rc libft8.a ft8/constants.o ft8/encode.o ft8/pack.o ft8/text.o
	install libft8.a /usr/lib/libft8.a
