#!/bin/bash
# End-to-end through a real SFTP server, the way an application reaches the
# simulator in practice. Opt-in because it needs Docker; the other suites do not.
#
#   bash test/sftp-e2e.sh
set -u
BASE="${CM_BASE:-http://localhost:8093}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SFTP_ROOT="$ROOT/data/sftp"
pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1)); else echo "  FAIL  $1 — expected '$3', got '$2'"; fail=$((fail+1)); fi; }

command -v docker >/dev/null || { echo "  SKIP  docker not available"; exit 0; }
python3 -c "import paramiko" 2>/dev/null || { echo "  SKIP  paramiko not installed (pip install paramiko)"; exit 0; }

echo "1. bring up an SFTP server over the simulator's directories"
# One mount for everything: applications move processed files by SFTP rename,
# which fails across separate mounts.
mkdir -p "$SFTP_ROOT"/{Upload,Download,Processed,Error}; chmod -R 777 "$SFTP_ROOT"
docker rm -f cm-sftp-test >/dev/null 2>&1
docker run -d --name cm-sftp-test -p 2223:22 -v "$SFTP_ROOT:/home/simulator/edi" \
  atmoz/sftp:alpine simulator:simulator:1001:1001 >/dev/null 2>&1
sleep 5
chk "sftp container running" "$(docker inspect -f '{{.State.Running}}' cm-sftp-test 2>/dev/null)" "true"

echo "2. upload a claim the way an application would"
before=$(find "$SFTP_ROOT/Download" -type f 2>/dev/null | wc -l | tr -d ' ')
python3 - "$ROOT" <<'PY'
import sys, paramiko
root = sys.argv[1]
t = paramiko.Transport(("localhost", 2223)); t.connect(username="simulator", password="simulator")
s = paramiko.SFTPClient.from_transport(t)
s.put(f"{root}/samples/sample-837-claim.txt", "/edi/Upload/e2e-claim.txt")
t.close()
PY
chk "upload accepted" "$?" "0"

echo "3. the simulator answers into the drop folder"
curl -s -X POST "$BASE/api/settings" -H 'Content-Type: application/json' -d '{"speed":10000}' >/dev/null
for i in $(seq 1 15); do
  sleep 1
  now=$(find "$SFTP_ROOT/Download" -type f 2>/dev/null | wc -l | tr -d ' ')
  [ "$now" -gt "$before" ] && break
done
now=$(find "$SFTP_ROOT/Download" -type f 2>/dev/null | wc -l | tr -d ' ')
chk "responses delivered over the shared volume" "$([ "$now" -gt "$before" ] && echo yes || echo no)" "yes"
chk "a remittance is among them" \
  "$(find "$SFTP_ROOT/Download" -name '*ERA.835.edi' | wc -l | tr -d ' ' | awk '{print ($1>0)?"yes":"no"}')" "yes"

echo "4. an application can read them back over SFTP"
python3 - <<'PY'
import paramiko, sys
t = paramiko.Transport(("localhost", 2223)); t.connect(username="simulator", password="simulator")
s = paramiko.SFTPClient.from_transport(t)
def walk(p):
    out=[]
    for e in s.listdir_attr(p):
        full=f"{p}/{e.filename}"
        out += walk(full) if e.longname.startswith('d') else [full]
    return out
files = walk("/edi/Download")
era = [f for f in files if f.endswith("ERA.835.edi")]
body = s.open(era[0]).read().decode() if era else ""
t.close()
print("  PASS  remittance readable over SFTP" if body.startswith("ISA|") else "  FAIL  remittance unreadable or wrong format")
sys.exit(0 if body.startswith("ISA|") else 1)
PY
[ "$?" = "0" ] && pass=$((pass+1)) || fail=$((fail+1))

docker rm -f cm-sftp-test >/dev/null 2>&1
echo; echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
