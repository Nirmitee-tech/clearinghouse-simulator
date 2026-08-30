#!/bin/bash
# End-to-end smoke test: every feature exercised against a running clearmock.
BASE="${1:-http://localhost:8093}"
pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1)); else echo "  FAIL  $1 — expected '$3', got '$2'"; fail=$((fail+1)); fi; }
jq_(){ python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
inject(){ curl -s -X POST "$BASE/api/inject" -H "Content-Type: text/plain" --data-binary @"$1"; }

curl -s -X POST "$BASE/api/settings" -H "Content-Type: application/json" -d '{"speed":10000,"outage":false,"hold":false}' >/dev/null
curl -s -X DELETE "$BASE/api/expectations" >/dev/null

echo "1. transaction identification"
chk "270 recognised"  "$(inject samples/sample-270-eligibility.txt | jq_ "d['transaction']")" "270"
chk "837 recognised"  "$(inject samples/sample-837-claim.txt      | jq_ "d['transaction']")" "837"
chk "276 recognised"  "$(inject samples/sample-276-status.txt     | jq_ "d['transaction']")" "276"

echo "2. defaults for an unbound patient"
chk "eligibility falls back to active coverage" \
  "$(inject samples/sample-270-eligibility.txt | jq_ "d['matchedStub']")" "eligibility/01-active-full"
chk "claim falls back to paid with deductible" \
  "$(inject samples/sample-837-claim.txt | jq_ "d['matchedStub']")" "remit/02-deductible"

echo "3. response flow scheduling"
chk "claim schedules three responses" \
  "$(inject samples/sample-837-claim.txt | jq_ "len(d['deliveries'])")" "3"

echo "4. value echo (correlation)"
sleep 2
last835=$(ls -t data/outbound/ERA_835_* 2>/dev/null | head -1)
chk "835 echoes patient control number" "$(tr '~' '\n' < "$last835" | grep -c 'CLP\*PCN-TEST-1')" "1"
chk "835 echoes member id"      "$(tr '~' '\n' < "$last835" | grep -c 'MI\*2232')" "1"
chk "835 echoes billing tax id" "$(tr '~' '\n' < "$last835" | grep -c 'REF\*TJ\*840000000')" "1"
chk "835 CAS split present"     "$(tr '~' '\n' < "$last835" | grep -cE '^CAS\*(PR\*1|CO\*45)')" "2"

echo "5. expectations (identifier -> scenario)"
curl -s -X POST "$BASE/api/expectations" -H "Content-Type: application/json" \
  -d '{"label":"smoke","keyField":"memberId","keyValue":"2299","transaction":"270","respondWith":["eligibility/07-subscriber-not-found"]}' >/dev/null
chk "expectation overrides the default" \
  "$(inject samples/sample-270-eligibility.txt | jq_ "d['matchedStub']")" "eligibility/07-subscriber-not-found"
chk "flagged as expectation-driven" \
  "$(inject samples/sample-270-eligibility.txt | jq_ "d['viaExpectation']")" "True"

echo "6. sequences (answer changes per call)"
curl -s -X POST "$BASE/api/cursors/reset" >/dev/null
chk "276 poll 1 -> step 1/2" "$(inject samples/sample-276-status.txt | jq_ "d['sequencePosition']")" "1/2"
chk "276 poll 2 -> step 2/2" "$(inject samples/sample-276-status.txt | jq_ "d['sequencePosition']")" "2/2"

echo "7. outage mode"
curl -s -X POST "$BASE/api/settings" -H "Content-Type: application/json" -d '{"outage":true}' >/dev/null
before=$(ls data/outbound | wc -l | tr -d ' ')
inject samples/sample-837-claim.txt >/dev/null; sleep 2
chk "no files written during outage" "$(ls data/outbound | wc -l | tr -d ' ')" "$before"
curl -s -X POST "$BASE/api/settings" -H "Content-Type: application/json" -d '{"outage":false}' >/dev/null

echo "8. hold and release"
curl -s -X POST "$BASE/api/settings" -H "Content-Type: application/json" -d '{"hold":true}' >/dev/null
inject samples/sample-837-claim.txt >/dev/null; sleep 2
chk "responses held" "$(curl -s "$BASE/api/settings" | jq_ "d['held'] > 0")" "True"
chk "release delivers them" "$(curl -s -X POST "$BASE/api/release" | jq_ "d['released'] > 0")" "True"
curl -s -X POST "$BASE/api/settings" -H "Content-Type: application/json" -d '{"hold":false}' >/dev/null

echo "9. safety"
printf 'ISA*00*          *00*          *ZZ*A              *ZZ*B              *260830*1200*^*00501*../../evil*0*P*:~GS*HS*A*B*20260830*1200*1*X*005010X279A1~ST*270*0001~SE*2*0001~GE*1*1~IEA*1*1~' > /tmp/evil.txt
inject /tmp/evil.txt >/dev/null; sleep 1
chk "traversal attempt writes nothing outside outbound" "$(ls data/ | grep -c evil)" "0"
chk "garbage input does not crash the engine" \
  "$(echo 'not x12 at all' | curl -s -X POST "$BASE/api/inject" -H 'Content-Type: text/plain' --data-binary @- | jq_ "d['transaction']")" "unparseable"

echo; echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
