CXX ?= g++
CXXFLAGS = -std=c++17 -Wall -Wextra -Werror -O0 -g

.PHONY: test
test: test_radio_link_health test_radio_snapshot test_radio_park
	./test_radio_link_health
	./test_radio_snapshot
	./test_radio_park

test_radio_link_health: test_radio_link_health.cpp ../../include/radio_link_health.h
	$(CXX) $(CXXFLAGS) test_radio_link_health.cpp -o test_radio_link_health

test_radio_snapshot: test_radio_snapshot.cpp ../../include/radio_snapshot.h
	$(CXX) $(CXXFLAGS) test_radio_snapshot.cpp -o test_radio_snapshot

test_radio_park: test_radio_park.cpp ../../include/radio_park.h
	$(CXX) $(CXXFLAGS) test_radio_park.cpp -o test_radio_park

.PHONY: clean
clean:
	rm -f test_radio_link_health test_radio_snapshot test_radio_park
