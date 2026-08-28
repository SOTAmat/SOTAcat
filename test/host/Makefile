CXX ?= g++
CXXFLAGS = -std=c++17 -Wall -Wextra -Werror -O0 -g

.PHONY: test
test: test_radio_link_health test_radio_snapshot test_radio_park test_radio_mode test_chunked_send test_uart_retry test_radio_set_gate test_battery_learned test_json_scan test_radio_get_gate
	./test_radio_link_health
	./test_radio_snapshot
	./test_radio_park
	./test_radio_mode
	./test_chunked_send
	./test_uart_retry
	./test_radio_set_gate
	./test_battery_learned
	./test_json_scan
	./test_radio_get_gate

test_radio_link_health: test_radio_link_health.cpp ../../include/radio_link_health.h
	$(CXX) $(CXXFLAGS) test_radio_link_health.cpp -o test_radio_link_health

test_radio_snapshot: test_radio_snapshot.cpp ../../include/radio_snapshot.h
	$(CXX) $(CXXFLAGS) test_radio_snapshot.cpp -o test_radio_snapshot

test_radio_park: test_radio_park.cpp ../../include/radio_park.h
	$(CXX) $(CXXFLAGS) test_radio_park.cpp -o test_radio_park

test_radio_mode: test_radio_mode.cpp ../../include/radio_mode.h
	$(CXX) $(CXXFLAGS) test_radio_mode.cpp -o test_radio_mode

test_chunked_send: test_chunked_send.cpp ../../include/chunked_send.h
	$(CXX) $(CXXFLAGS) test_chunked_send.cpp -o test_chunked_send

test_uart_retry: test_uart_retry.cpp ../../include/uart_retry.h
	$(CXX) $(CXXFLAGS) test_uart_retry.cpp -o test_uart_retry

test_radio_set_gate: test_radio_set_gate.cpp ../../include/radio_set_gate.h
	$(CXX) $(CXXFLAGS) test_radio_set_gate.cpp -o test_radio_set_gate

test_battery_learned: test_battery_learned.cpp ../../include/battery_learned_policy.h
	$(CXX) $(CXXFLAGS) test_battery_learned.cpp -o test_battery_learned

test_json_scan: test_json_scan.cpp ../../include/json_scan.h
	$(CXX) $(CXXFLAGS) test_json_scan.cpp -o test_json_scan

test_radio_get_gate: test_radio_get_gate.cpp ../../include/radio_get_gate.h
	$(CXX) $(CXXFLAGS) test_radio_get_gate.cpp -o test_radio_get_gate

.PHONY: clean
clean:
	rm -f test_radio_link_health test_radio_snapshot test_radio_park test_radio_mode test_chunked_send test_uart_retry test_radio_set_gate test_battery_learned test_json_scan test_radio_get_gate
