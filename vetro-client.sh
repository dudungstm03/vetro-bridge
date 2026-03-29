#!/bin/bash
# ============================================================
#  VETRO BRIDGE CLIENT — AndroidIDE
#  Ganti SERVER_URL dan SECRET sesuai Railway kamu!
# ============================================================

SERVER_URL="https://GANTI-INI.railway.app"
SECRET="vetro-secret-key"
POLL_INTERVAL=3  # detik

# ── Warna ──────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

# ── Setup env AndroidIDE ───────────────────────────────────
AIDE="/data/user/0/android.studio.pro/files"
export JAVA_HOME="$AIDE/usr/opt/openjdk-17"
[ ! -d "$JAVA_HOME" ] && export JAVA_HOME="$AIDE/usr/opt/openjdk"
export ANDROID_HOME="$AIDE/home/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
export PATH="$AIDE/usr/opt/gradle/bin:$JAVA_HOME/bin:$AIDE/usr/bin:$PATH"

# ── Cek curl tersedia ──────────────────────────────────────
if ! command -v curl &>/dev/null; then
    echo -e "${RED}curl tidak ditemukan! Install dulu: pkg install curl${NC}"
    exit 1
fi

send_output() {
    CMD_ID="$1"
    CMD="$2"
    OUTPUT="$3"
    EXIT_CODE="$4"

    # Escape JSON
    OUTPUT_ESC=$(echo "$OUTPUT" | head -100 | python3 -c "
import sys, json
print(json.dumps(sys.stdin.read()))
" 2>/dev/null || echo "$OUTPUT" | head -100 | sed 's/"/\\"/g; s/$/\\n/' | tr -d '\n')

    curl -s -X POST "$SERVER_URL/output" \
        -H "Content-Type: application/json" \
        -H "x-secret: $SECRET" \
        -d "{\"id\":\"$CMD_ID\",\"cmd\":\"$CMD\",\"output\":$OUTPUT_ESC,\"exit\":$EXIT_CODE,\"pwd\":\"$(pwd)\"}" \
        > /dev/null
}

poll_and_run() {
    RESPONSE=$(curl -s -H "x-secret: $SECRET" "$SERVER_URL/poll" 2>/dev/null)
    CMD=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('command',''))" 2>/dev/null)
    CMD_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cmd',''))" 2>/dev/null)

    [ -z "$CMD" ] && return

    echo -e "${CYAN}[CMD]${NC} $CMD"

    # Eksekusi command
    OUTPUT=$(eval "$CMD" 2>&1)
    EXIT_CODE=$?

    [ $EXIT_CODE -eq 0 ] \
        && echo -e "${GREEN}[✔]${NC}" \
        || echo -e "${RED}[✘] exit=$EXIT_CODE${NC}"

    echo "$OUTPUT" | head -20

    # Kirim output ke server
    send_output "$CMD_ID" "$CMD" "$OUTPUT" "$EXIT_CODE"
    echo -e "${YELLOW}[→ output terkirim ke server]${NC}\n"
}

# ── Banner ─────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}"
echo "╔═══════════════════════════════════════╗"
echo "║    VETRO BRIDGE CLIENT — AKTIF 🔥     ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"
echo -e "Server  : ${GREEN}$SERVER_URL${NC}"
echo -e "Interval: ${GREEN}${POLL_INTERVAL}s${NC}"
echo -e "PWD     : ${GREEN}$(pwd)${NC}"
echo ""

# Test koneksi dulu
STATUS=$(curl -s "$SERVER_URL/status" 2>/dev/null)
if echo "$STATUS" | grep -q "online"; then
    echo -e "${GREEN}✔ Server terhubung!${NC}"
else
    echo -e "${RED}✘ Server tidak bisa dijangkau! Cek URL.${NC}"
    exit 1
fi

echo -e "${YELLOW}Menunggu command dari Claude...${NC}\n"

# ── Loop polling ───────────────────────────────────────────
while true; do
    poll_and_run
    sleep $POLL_INTERVAL
done