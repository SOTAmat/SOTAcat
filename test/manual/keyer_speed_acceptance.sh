#!/usr/bin/env bash
# Guided at-radio acceptance for keyer speed over rigctld and REST (#155).
# Usage: keyer_speed_acceptance.sh [host] [first-step]
#        (defaults: sotacat.local, 1)
# Steps 1-3 do not transmit. Step 4 keys the transmitter and asks first.

set -u

HOST="${1:-sotacat.local}"
PORT=4532
START="${2:-1}"
RESULTS=()
ORIGINAL=""

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; RESULTS+=("PASS  $1"); }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; RESULTS+=("FAIL  $1"); }
skip() { printf '  \033[33mSKIP\033[0m %s\n' "$1"; RESULTS+=("SKIP  $1"); }

# One rigctld command on its own connection; prints the first reply line.
rig() {
    local wait="${2:-5}" line=""
    exec 3<>"/dev/tcp/$IP/$PORT" || { echo "CONNECT-FAILED"; return; }
    printf '%s\n' "$1" >&3
    IFS= read -r -t "$wait" line <&3 || line="TIMEOUT"
    exec 3<&- 3>&-
    printf '%s' "${line%$'\r'}"
}

rest_get() { curl -s -m 5 "http://$IP/api/v1/keyerSpeed"; }
rest_get_code() { curl -s -m 5 -o /dev/null -w '%{http_code}' "http://$IP/api/v1/keyerSpeed"; }
rest_put_code() { curl -s -m 5 -o /dev/null -w '%{http_code}' -X PUT "http://$IP/api/v1/keyerSpeed?wpm=$1"; }

check() { # label, got, want
    if [[ "$2" == "$3" ]]; then pass "$1 = $2"; else fail "$1: got '$2', want '$3'"; fi
}

ask_number() { # prompt -> REPLY_NUM
    while true; do
        read -r -p "$1 " REPLY_NUM || exit 1
        [[ "$REPLY_NUM" =~ ^[0-9]+$ ]] && return
        echo "  a whole number, please"
    done
}

ask_yn() { # prompt -> 0 for yes
    local a
    while true; do
        read -r -p "$1 [y/n] " a || exit 1
        case "$a" in y|Y) return 0 ;; n|N) return 1 ;; esac
    done
}

restore() {
    [[ -n "$ORIGINAL" ]] || return
    rig "L KEYSPD $ORIGINAL" >/dev/null
    echo
    echo "Keyer speed restored to $ORIGINAL wpm (reads $(rig 'l KEYSPD'))."
}

summary() {
    bold "Summary"
    printf '  %s\n' "${RESULTS[@]}"
}

trap 'restore; summary' EXIT

# ---------------------------------------------------------------- preflight
bold "Preflight"
IP="$(getent hosts "$HOST" | awk '{print $1; exit}')"
if [[ -z "$IP" ]]; then echo "cannot resolve $HOST"; exit 1; fi
echo "  device:   $HOST ($IP)"
echo "  firmware: $(curl -s -m 5 "http://$IP/api/v1/version")"
ORIGINAL="$(rig 'l KEYSPD')"
if ! [[ "$ORIGINAL" =~ ^[0-9]+$ ]]; then
    echo "  rigctld KEYSPD read gave '$ORIGINAL'; cannot continue"
    ORIGINAL=""
    exit 1
fi
echo "  speed now: $ORIGINAL wpm (restored when this script exits)"

# ------------------------------------------------------- 1. read vs display
if (( START <= 1 )); then
bold "Step 1 of 5: read matches the display"
echo "Nudge the KX2 KEYER knob one click and back so the display shows the speed."
ask_number "What speed does the KX2 display show?"
check "rigctld read vs display" "$(rig 'l KEYSPD')" "$REPLY_NUM"
check "REST read vs display" "$(rest_get)" "$REPLY_NUM"

fi

# ------------------------------------------------------ 2. read follows dial
if (( START <= 2 )); then
bold "Step 2 of 5: read follows the dial"
echo "Turn the KEYER knob to a different speed."
ask_number "What speed does the display show now?"
sleep 1
check "rigctld read after dial change" "$(rig 'l KEYSPD')" "$REPLY_NUM"
check "REST read after dial change" "$(rest_get)" "$REPLY_NUM"

fi

# ---------------------------------------------------- 3. set changes display
if (( START <= 3 )); then
bold "Step 3 of 5: set changes the display"
echo "Setting 25 wpm over rigctld..."
check "rigctld set 25 reply" "$(rig 'L KEYSPD 25')" "RPRT 0"
ask_number "What speed does the display show? (nudge the knob if it has timed out; enter what it showed first)"
check "display after rigctld set 25" "$REPLY_NUM" "25"

echo "Setting 18 wpm over REST..."
check "REST set 18 status" "$(rest_put_code 18)" "204"
ask_number "What speed does the display show?"
check "display after REST set 18" "$REPLY_NUM" "18"

rig "L KEYSPD $ORIGINAL" >/dev/null
echo "  back to $ORIGINAL wpm for the next step"

fi

# ------------------------------------------------------- 4. during a send
if (( START <= 4 )); then
bold "Step 4 of 5: read and refused set during a keyer send"
echo "THIS TRANSMITS about 15 seconds of CW at $ORIGINAL wpm."
echo "Connect a dummy load or pick a clear frequency, and put the KX2 in CW."
read -r -p "Type TX to transmit, anything else to skip: " go
if [[ "$go" == "TX" ]]; then
    # The web keyer starts the send. A send started over rigctld would only
    # queue other rigctld commands behind it, and the queued set would apply
    # afterwards.
    check "web keyer start (status)" "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X PUT "http://$IP/api/v1/keyer?message=TEST%20TEST%20TEST%20TEST%20TEST%20TEST%20TEST%20TEST")" "204"
    sleep 3
    get_code="$(rest_get_code)"
    get_val="$(rest_get)"
    put_code="$(rest_put_code 30)"
    set_reply="$(rig 'L KEYSPD 30')"
    check "send still in flight after the probes (PTT)" "$(rig 't')" "1"
    check "REST read during send (status)" "$get_code" "200"
    check "REST read during send (value)" "$get_val" "$ORIGINAL"
    check "REST set during send (status)" "$put_code" "503"
    check "rigctld set during send" "$set_reply" "RPRT -9"
    echo "  waiting for the message to finish..."
    for _ in $(seq 40); do
        [[ "$(rig 't')" == "0" ]] && break
        sleep 1
    done
    check "send finished (PTT)" "$(rig 't')" "0"
    sleep 1
    check "speed unchanged after send" "$(rig 'l KEYSPD')" "$ORIGINAL"
    if ask_yn "Did the whole message go out at one steady speed?"; then
        pass "message speed steady (by ear)"
    else
        fail "message speed changed mid-send (by ear)"
    fi
else
    skip "during-send checks (not run, no transmit)"
fi

fi

# ------------------------------------------------------------------ 5. halo
bold "Step 5 of 5: Ham2K (halo)"
if ask_yn "Do you have halo ready to connect to $HOST now?"; then
    echo "Connect halo to the device and open its CW messages dialog."
    if ask_yn "Does halo show $ORIGINAL wpm?"; then pass "halo reads speed at connect"; else fail "halo speed at connect"; fi

    echo "Change the speed in halo to any other value."
    ask_number "What speed did you pick in halo?"
    check "radio speed after halo set" "$(rig 'l KEYSPD')" "$REPLY_NUM"
    if ask_yn "Does the KX2 display show $REPLY_NUM?"; then pass "display follows halo set"; else fail "display after halo set"; fi

    echo "Turn the KX2 KEYER knob to a new speed, then close and reopen halo's CW messages dialog."
    ask_number "What speed does the KX2 display show?"
    if ask_yn "Does halo now show $REPLY_NUM?"; then pass "halo re-reads on dialog open"; else fail "halo re-read on dialog open"; fi

    if ask_yn "Send a message from halo (THIS TRANSMITS)? Answer y only once it has finished"; then
        if ask_yn "Did halo's on-screen pacing track the sidetone?"; then pass "halo pacing tracks sidetone"; else fail "halo pacing vs sidetone"; fi
    else
        skip "halo pacing (no transmit)"
    fi
else
    skip "halo checks"
fi
