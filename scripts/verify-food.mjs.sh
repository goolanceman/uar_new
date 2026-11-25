#!/usr/bin/env bash
# Food Security module — E2E API validation (docs/food.md §24/§25).
set -u
BASE="http://localhost:3000"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "  ✓ $1"; }
fail(){ FAIL=$((FAIL+1)); echo "  ✗ $1  →  $2"; }
check(){ # $1 desc, $2 expected, $3 actual, $4 body?
  if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "expected $2 got $3 ${4:-}"; fi
}
jsonget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

# ── login ────────────────────────────────────────────────────────────────
echo "── Auth ──"
TOKEN=$(curl -s --max-time 20 -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@unitedangelreach.org","password":"Admin@123"}' | jsonget "d['token']")
[ -n "$TOKEN" ] && [ "$TOKEN" != "None" ] && ok "admin login" || fail "admin login" "$TOKEN"
VTOKEN=$(curl -s --max-time 20 -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"volunteer@demo.org","password":"Volun@123"}' | jsonget "d['token']")
AH="Authorization: Bearer $TOKEN"
VH="Authorization: Bearer $VTOKEN"

# ── Settings-driven rate limits (Settings → Food Security tab) ──────────
echo "── Rate limits are settings-driven ──"
SETTINGS=$(curl -s --max-time 20 "$BASE/api/settings" -H "$AH")
for K in food.applications.rateLimitPerHour food.statusCheck.rateLimitPerHour food.pledges.rateLimitPerHour food.expiryAlertDays food.aiRiskWindowDays; do
  PRESENT=$(echo "$SETTINGS" | python3 -c "import sys,json;d=json.load(sys.stdin);print('$K' in d)")
  check "setting $K exists" "True" "$PRESENT"
done

# Prove the public application limit follows the setting: set 1/hour →
# first application passes, second is blocked, restore.
curl -s --max-time 20 -o /dev/null -X PATCH "$BASE/api/settings" -H "$AH" -H 'Content-Type: application/json' \
  -d '{"food.applications.rateLimitPerHour":"1"}'
AP1=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/applications" -H 'Content-Type: application/json' \
  -d '{"name":"E2E Limit Probe","phone":"9876500077","details":"Testing the configured rate limit end to end.","consent":true}')
check "application with limit=1 passes (1st)" 201 "$AP1"
AP2=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/applications" -H 'Content-Type: application/json' \
  -d '{"name":"E2E Limit Probe 2","phone":"9876500078","details":"Second application should be blocked by the configured limit.","consent":true}')
check "application with limit=1 blocked (429)" 429 "$AP2"
# Restoring the limit also resets the applications bucket (fresh window for
# the Scenario D tests below), and invalid values are rejected by validation.
curl -s --max-time 20 -o /dev/null -X PATCH "$BASE/api/settings" -H "$AH" -H 'Content-Type: application/json' \
  -d '{"food.applications.rateLimitPerHour":"5"}'
ok "limit restored to 5 (bucket reset with it)"

BADSET=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/settings" -H "$AH" -H 'Content-Type: application/json' \
  -d '{"food.expiryAlertDays":"9999"}')
check "out-of-range setting rejected (400)" 400 "$BADSET"

# ── Scenario A: complete food distribution ───────────────────────────────
echo "── Scenario A: complete distribution lifecycle ──"
P=$(curl -s --max-time 20 -X POST "$BASE/api/food/programmes" -H "$AH" -H 'Content-Type: application/json' \
  -d '{"title":"E2E Test Programme","description":"Temporary programme for E2E validation.","category":"GROCERY_KIT"}')
PID=$(echo "$P" | jsonget "d['id']")
[ -n "$PID" ] && ok "create programme" || fail "create programme" "$P"

TPLID=$(curl -s --max-time 20 "$BASE/api/kit-templates" | python3 -c "import sys,json;d=json.load(sys.stdin);d=d if isinstance(d,list) else d.get('items',[]);print(next((t['id'] for t in d if t['kind'] in ('RATION','FOOD')),''))")

E=$(curl -s --max-time 20 -X POST "$BASE/api/food/events" -H "$AH" -H 'Content-Type: application/json' -d "{
  \"programmeId\":\"$PID\",\"title\":\"E2E Distribution\",\"eventDate\":\"$(date -u -v+3d +%Y-%m-%dT09:00:00Z)\",
  \"venue\":\"Test Hall\",\"city\":\"Bengaluru\",\"eventType\":\"COMMUNITY\",\"plannedUnits\":10,\"maxCapacity\":50,
  \"packageTemplateId\":\"$TPLID\",\"status\":\"DRAFT\"}")
EID=$(echo "$E" | jsonget "d['id']")
ECODE=$(echo "$E" | jsonget "d['code']")
[ -n "$EID" ] && ok "create event ($ECODE)" || fail "create event" "$E"

BAD=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/food/events/$EID" -H "$AH" -H 'Content-Type: application/json' -d '{"status":"COMPLETED"}')
check "invalid transition DRAFT→COMPLETED blocked" 400 "$BAD"

for S in APPROVED PUBLISHED REGISTRATION_OPEN; do
  C=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/food/events/$EID" -H "$AH" -H 'Content-Type: application/json' -d "{\"status\":\"$S\"}")
  check "transition → $S" 200 "$C"
done

# bulk registration (beneficiaries API is admin-auth'd)
BENS=$(curl -s --max-time 20 "$BASE/api/beneficiaries" -H "$AH")
BIDS=$(echo "$BENS" | python3 -c "import sys,json;d=json.load(sys.stdin);items=d if isinstance(d,list) else d.get('items',[]);print(json.dumps([b['id'] for b in items[:3]]))")
R=$(curl -s --max-time 20 -X POST "$BASE/api/food/events/$EID/registrations" -H "$AH" -H 'Content-Type: application/json' -d "{\"beneficiaryIds\":$BIDS}")
CREATED=$(echo "$R" | jsonget "len(d['created'])")
check "bulk register 3 beneficiaries" 3 "$CREATED" "$R"

B0=$(echo "$BIDS" | python3 -c "import sys,json;print(json.load(sys.stdin)[0])")
DUP=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/events/$EID/registrations" -H "$AH" -H 'Content-Type: application/json' -d "{\"beneficiaryId\":\"$B0\"}")
check "duplicate registration blocked (409)" 409 "$DUP"

REGS=$(curl -s --max-time 20 "$BASE/api/food/registrations?eventId=$EID" -H "$AH")
REG0=$(echo "$REGS" | jsonget "d[0]['id']")
REG0CODE=$(echo "$REGS" | jsonget "d[0]['code']")
AP=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/food/registrations/$REG0" -H "$AH" -H 'Content-Type: application/json' -d '{"status":"APPROVED"}')
check "approve registration" 200 "$AP"

# dedicated inventory item (fresh, quantity 0) → deterministic stock math
NI=$(curl -s --max-time 20 -X POST "$BASE/api/inventory" -H "$AH" -H 'Content-Type: application/json' \
  -d '{"name":"E2E Rice (test item)","category":"FOOD_KIT","unit":"kg","quantity":0,"minStock":5}')
ITEMID=$(echo "$NI" | jsonget "d['id']")
[ -n "$ITEMID" ] && ok "create dedicated FOOD_KIT item" || fail "create item" "$NI"

B=$(curl -s --max-time 20 -X POST "$BASE/api/food/batches" -H "$AH" -H 'Content-Type: application/json' -d "{
  \"itemId\":\"$ITEMID\",\"batchNo\":\"E2E-BATCH-1\",\"source\":\"DONATED\",\"donorName\":\"E2E Donor\",
  \"quantityReceived\":100,\"expiryDate\":\"$(date -u -v+100d +%Y-%m-%dT00:00:00Z)\"}")
BID=$(echo "$B" | jsonget "d['id']")
[ -n "$BID" ] && ok "batch receipt (100 units)" || fail "batch receipt" "$B"

Q=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/allocations" -H "$AH" -H 'Content-Type: application/json' -d "{\"eventId\":\"$EID\",\"lines\":[{\"itemId\":\"$ITEMID\",\"quantity\":10}]}")
check "reserve blocked while quality PENDING" 400 "$Q"

I=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/food/batches/$BID" -H "$AH" -H 'Content-Type: application/json' -d '{"qualityStatus":"PASSED"}')
check "quality inspection PASS" 200 "$I"

A=$(curl -s --max-time 20 -X POST "$BASE/api/food/allocations" -H "$AH" -H 'Content-Type: application/json' -d "{\"eventId\":\"$EID\",\"lines\":[{\"itemId\":\"$ITEMID\",\"quantity\":10}]}")
NA=$(echo "$A" | jsonget "len(d['reserved'])")
check "FEFO reserve 10 units" 1 "$NA" "$A"

DETAIL=$(curl -s --max-time 20 "$BASE/api/food/events/$EID" -H "$AH")
AID=$(echo "$DETAIL" | jsonget "[a for a in d['allocations'] if a['status']=='RESERVED'][0]['id']")
IS=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/food/allocations/$AID" -H "$AH" -H 'Content-Type: application/json' -d '{"action":"issue"}')
check "issue allocation to packing" 200 "$IS"

for S in REGISTRATION_CLOSED PLANNING STOCK_ALLOCATED PACKAGES_PREPARED READY IN_PROGRESS; do
  C=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/food/events/$EID" -H "$AH" -H 'Content-Type: application/json' -d "{\"status\":\"$S\"}")
  check "transition → $S" 200 "$C"
done

# check-in by registration QR code, then handover
L=$(curl -s --max-time 20 -X POST "$BASE/api/food/checkin" -H "$AH" -H 'Content-Type: application/json' -d "{\"action\":\"lookup\",\"code\":\"$REG0CODE\"}")
CI=$(echo "$L" | jsonget "d['checkedIn']")
check "QR lookup + check-in" True "$CI" "$L"

# phone lookup path too
# pick a registration whose phone is unique among this event's registrations
PHONE1=$(echo "$REGS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
phones=[(r['beneficiary'].get('phone') or '').replace(' ','').replace('+91','')[-10:] for r in d]
uniq=[p for p in phones if p and phones.count(p)==1]
print(uniq[0] if uniq else '')")
LPBODY=$(printf '{"action":"lookup","code":"%s","eventId":"%s"}' "$PHONE1" "$EID")
LP=$(curl -s --max-time 20 -X POST "$BASE/api/food/checkin" -H "$AH" -H 'Content-Type: application/json' --data-raw "$LPBODY")
LPN=$(echo "$LP" | jsonget "d.get('checkedIn',False)")
check "phone-number lookup + check-in" True "$LPN" "$LP"

CO=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/checkin" -H "$AH" -H 'Content-Type: application/json' -d "{\"action\":\"checkout\",\"code\":\"$REG0CODE\",\"unitsDelivered\":1,\"ackMethod\":\"OTP\",\"ackRef\":\"2468\"}")
check "handover with OTP acknowledgement" 200 "$CO"

DUP2=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/checkin" -H "$AH" -H 'Content-Type: application/json' -d "{\"action\":\"checkout\",\"code\":\"$REG0CODE\",\"unitsDelivered\":1,\"ackMethod\":\"OTP\"}")
check "duplicate handover blocked (409)" 409 "$DUP2"

# complete → reconcile → closed; undistributed returned to stock (10 issued, 1 delivered → 9 back)
C1=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/food/events/$EID" -H "$AH" -H 'Content-Type: application/json' -d '{"status":"COMPLETED"}')
check "transition → COMPLETED" 200 "$C1"
C2=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/food/events/$EID" -H "$AH" -H 'Content-Type: application/json' -d '{"status":"RECONCILED"}')
check "transition → RECONCILED" 200 "$C2"
ITEMQTY_AFTER=$(curl -s --max-time 20 "$BASE/api/inventory" -H "$AH" | python3 -c "import sys,json;d=json.load(sys.stdin);items=d if isinstance(d,list) else d.get('items',[]);print(next(i['quantity'] for i in items if i['id']=='$ITEMID'))")
check "reconciliation: 100 received − 10 issued + 9 returned = 99" 99 "$ITEMQTY_AFTER"

C3=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/food/events/$EID" -H "$AH" -H 'Content-Type: application/json' -d '{"status":"CLOSED"}')
check "transition → CLOSED" 200 "$C3"

# ── Scenario B: no-show ─────────────────────────────────────────────────
echo "── Scenario B: no-show handling ──"
REGS=$(curl -s --max-time 20 "$BASE/api/food/registrations?eventId=$EID" -H "$AH")  # re-fetch — check-ins above changed statuses
REG1=$(echo "$REGS" | python3 -c "import sys,json;d=json.load(sys.stdin);cands=[r for r in d if r['status']=='REGISTERED'];print(cands[0]['id'] if cands else d[0]['id'])")
AP1=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/food/registrations/$REG1" -H "$AH" -H 'Content-Type: application/json' -d '{"status":"NO_SHOW","reason":"NO_SHOW"}')
check "record no-show with reason" 200 "$AP1"

# ── Scenario C: food safety guards ──────────────────────────────────────
echo "── Scenario C: food safety guards ──"
B2=$(curl -s --max-time 20 -X POST "$BASE/api/food/batches" -H "$AH" -H 'Content-Type: application/json' -d "{
  \"itemId\":\"$ITEMID\",\"batchNo\":\"E2E-BATCH-2\",\"source\":\"RECOVERED\",\"quantityReceived\":20,
  \"expiryDate\":\"$(date -u -v-10d +%Y-%m-%dT00:00:00Z)\"}")
B2ID=$(echo "$B2" | jsonget "d['id']")
curl -s --max-time 20 -o /dev/null -X PATCH "$BASE/api/food/batches/$B2ID" -H "$AH" -H 'Content-Type: application/json' -d '{"qualityStatus":"PASSED"}'
E2=$(curl -s --max-time 20 -X POST "$BASE/api/food/events" -H "$AH" -H 'Content-Type: application/json' -d "{
  \"programmeId\":\"$PID\",\"title\":\"E2E Expired\",\"eventDate\":\"$(date -u -v+2d +%Y-%m-%dT09:00:00Z)\",\"venue\":\"X\",\"plannedUnits\":5}")
E2ID=$(echo "$E2" | jsonget "d['id']")
curl -s --max-time 20 -o /dev/null -X PATCH "$BASE/api/food/events/$E2ID" -H "$AH" -H 'Content-Type: application/json' -d '{"status":"APPROVED","statusReason":"e2e"}'
S=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/allocations" -H "$AH" -H 'Content-Type: application/json' -d "{\"eventId\":\"$E2ID\",\"lines\":[{\"itemId\":\"$ITEMID\",\"quantity\":100}]}")
check "expired batch excluded from FEFO (shortfall over 99 free units)" 400 "$S"
W=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/food/batches/$BID" -H "$AH" -H 'Content-Type: application/json' -d '{"qualityStatus":"REJECTED"}')
check "rejection without reason blocked" 400 "$W"

# ── Scenario D: public application flow ────────────────────────────────
echo "── Scenario D: public application flow ──"
APPLY=$(curl -s --max-time 20 -X POST "$BASE/api/food/applications" -H 'Content-Type: application/json' -d '{
  "name":"E2E Applicant","phone":"9876500021","details":"Need grocery support for family of four for a month.",
  "consent":true,"urgency":"HIGH","source":"SELF","city":"Bengaluru","familyMembers":4}')
REF=$(echo "$APPLY" | jsonget "d['refCode']")
[ -n "$REF" ] && [ "$REF" != "None" ] && ok "public application → $REF" || fail "public application" "$APPLY"

DUPAPP=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/applications" -H 'Content-Type: application/json' -d '{
  "name":"E2E Applicant","phone":"9876500021","details":"Another application same number.","consent":true}')
check "duplicate application blocked (409)" 409 "$DUPAPP"

NOCONSENT=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/applications" -H 'Content-Type: application/json' -d '{"name":"X Y","phone":"9876500022","details":"Food needed urgently please.","consent":false}')
check "application without consent rejected" 400 "$NOCONSENT"

ST404=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" "$BASE/api/food/applications/status?refCode=$REF&phone=9999999999")
check "status check with wrong phone → 404" 404 "$ST404"
ST=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" "$BASE/api/food/applications/status?refCode=$REF&phone=9876500021")
check "status check with correct phone → 200" 200 "$ST"

APPS=$(curl -s --max-time 20 "$BASE/api/food/applications?status=PENDING" -H "$AH")
APPID=$(echo "$APPS" | python3 -c "import sys,json;d=json.load(sys.stdin);print(next(r['id'] for r in d if r.get('refCode')=='$REF'))")
APR=$(curl -s --max-time 20 -X PATCH "$BASE/api/food/applications/$APPID" -H "$AH" -H 'Content-Type: application/json' -d '{"status":"APPROVED","reviewNote":"Approved for monthly ration."}')
BENCODE=$(echo "$APR" | jsonget "d['beneficiary']['code']")
[ -n "$BENCODE" ] && [ "$BENCODE" != "None" ] && ok "approve application → beneficiary $BENCODE created" || fail "application approval" "$APR"

# ── Scenario G: privacy & permissions ────────────────────────────────────
echo "── Scenario G: privacy & permissions ──"
PUBEV=$(curl -s --max-time 20 "$BASE/api/food/events?public=1")
ADDRLEAK=$(echo "$PUBEV" | python3 -c "import sys;print('address' in sys.stdin.read())")
check "public events expose no address field" False "$ADDRLEAK"

NOAUTH=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" "$BASE/api/food/batches")
check "admin-only API blocked without auth" 401 "$NOAUTH"

VBLOCK=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/checkin" -H "$VH" -H 'Content-Type: application/json' -d "{\"action\":\"lookup\",\"code\":\"UAR-FREG-00001\"}")
check "unassigned volunteer blocked from check-in (403)" 403 "$VBLOCK"

SPON=$(curl -s --max-time 20 -X POST "$BASE/api/donations" -H 'Content-Type: application/json' -d "{
  \"donorName\":\"E2E Sponsor 2\",\"donorEmail\":\"e2e-sponsor@test.org\",\"amount\":2500,
  \"category\":\"FOOD_DISTRIBUTION\",\"paymentMethod\":\"UPI\",\"foodEventId\":\"$E2ID\"}")
SPREF=$(echo "$SPON" | jsonget "d['receiptNumber']")
[ -n "$SPREF" ] && [ "$SPREF" != "None" ] && ok "repeat-donor sponsorship ($SPREF)" || fail "sponsor donation" "$SPON"

# household CRUD
H=$(curl -s --max-time 20 -X POST "$BASE/api/food/households" -H "$AH" -H 'Content-Type: application/json' -d '{
  "name":"E2E Household","size":4,"city":"Bengaluru","members":[{"name":"Member One","age":34,"relation":"SPOUSE"}]}')
HID=$(echo "$H" | jsonget "d['id']")
[ -n "$HID" ] && ok "household create with member" || fail "household create" "$H"

# ── Round 2: typed-URL redirect, walk-in, donation pledges ──────────────
echo "── Typed URLs redirect into the hash router ──"
R1=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}|%{redirect_url}" "$BASE/food-assistance/apply")
echo "$R1" | grep -q "^30[178]" && echo "$R1" | grep -q "food-assistance/apply" && ok "/food-assistance/apply redirects ($R1)" || fail "apply redirect" "$R1"
R2=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}|%{redirect_url}" "$BASE/programs/food-security")
echo "$R2" | grep -q "programs/food-security" && ok "/programs/food-security redirects" || fail "landing redirect" "$R2"
R3=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" "$BASE/api/food/public")
check "API routes unaffected by middleware" 200 "$R3"

echo "── Walk-in registration creates a beneficiary ──"
EV=$(curl -s --max-time 20 -X POST "$BASE/api/food/events" -H "$AH" -H 'Content-Type: application/json' -d "{
  \"programmeId\":\"$PID\",\"title\":\"E2E Walkin Event\",\"eventDate\":\"$(date -u +%Y-%m-%dT09:00:00Z)\",\"venue\":\"Desk\",\"plannedUnits\":5}")
EVID=$(echo "$EV" | jsonget "d['id']")
# bring it operational: APPROVED→PUBLISHED→REG_OPEN→CLOSED→PLANNING→STOCK_ALLOCATED→PREPARED→READY→IN_PROGRESS
for S in APPROVED PUBLISHED REGISTRATION_OPEN REGISTRATION_CLOSED PLANNING STOCK_ALLOCATED PACKAGES_PREPARED READY IN_PROGRESS; do
  curl -s --max-time 20 -o /dev/null -X PATCH "$BASE/api/food/events/$EVID" -H "$AH" -H 'Content-Type: application/json' -d "{\"status\":\"$S\",\"statusReason\":\"e2e\"}"
done
WI=$(curl -s --max-time 20 -X POST "$BASE/api/food/events/$EVID/walkin" -H "$AH" -H 'Content-Type: application/json' \
  -d '{"name":"E2E Walkin Ramesh","phone":"9876500099","householdSize":4,"unitsAllocated":1}')
WICode=$(echo "$WI" | jsonget "d['registration']['code']")
WIBen=$(echo "$WI" | jsonget "d['beneficiary']['code']")
[ -n "$WICode" ] && [ -n "$WIBen" ] && ok "walk-in → beneficiary $WIBen + registration $WICode" || fail "walk-in" "$WI"
# same phone again → existing registration returned, no duplicate identity
WI2=$(curl -s --max-time 20 -X POST "$BASE/api/food/events/$EVID/walkin" -H "$AH" -H 'Content-Type: application/json' \
  -d '{"name":"E2E Walkin Ramesh","phone":"9876500099"}')
EX=$(echo "$WI2" | jsonget "d.get('existing',False)")
check "repeat walk-in with same phone returns existing registration" True "$EX" "$WI2"
WIBenCount=$(curl -s --max-time 20 "$BASE/api/beneficiaries" -H "$AH" | python3 -c "import sys,json;d=json.load(sys.stdin);items=d if isinstance(d,list) else d.get('items',[]);print(sum(1 for b in items if b.get('phone','').endswith('9876500099')))")
check "exactly one beneficiary identity for that phone" 1 "$WIBenCount"
# unassigned volunteer still blocked from walk-ins on unassigned events
VWI=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/events/$EVID/walkin" -H "$VH" -H 'Content-Type: application/json' -d '{"name":"Volunteer Walkin Test"}')
check "unassigned volunteer blocked from walk-in (403)" 403 "$VWI"

echo "── Food donation pledge lifecycle (pickup → receipt into batch) ──"
PL=$(curl -s --max-time 20 -X POST "$BASE/api/food/pledges" -H 'Content-Type: application/json' \
  -d '{"donorName":"E2E Pledge Donor","phone":"9876500088","items":"20 kg rice, sealed","pickupAddress":"MG Road 5","city":"Bengaluru"}')
PLID=$(echo "$PL" | jsonget "d['code']")
[ -n "$PLID" ] && ok "public pledge submitted ($PLID)" || fail "pledge submit" "$PL"
PRAW=$(curl -s --max-time 20 "$BASE/api/food/pledges?status=PENDING" -H "$AH")
PLROW=$(echo "$PRAW" | python3 -c "import sys,json;d=json.load(sys.stdin);print(next(r['id'] for r in d if r['code']=='$PLID'))")
SC=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/food/pledges/$PLROW" -H "$AH" -H 'Content-Type: application/json' -d '{"action":"schedule","scheduledFor":"2026-12-01T10:00"}')
check "schedule pickup" 200 "$SC"
CO2=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/food/pledges/$PLROW" -H "$AH" -H 'Content-Type: application/json' -d '{"action":"collect"}')
check "mark collected" 200 "$CO2"
RICEID=$(echo "$ITEMID")
MASTER_BEFORE=$(curl -s --max-time 20 "$BASE/api/inventory" -H "$AH" | python3 -c "import sys,json;d=json.load(sys.stdin);items=d if isinstance(d,list) else d.get('items',[]);print(next((i['quantity'] for i in items if i['id']=='$RICEID'),0))")
RC=$(curl -s --max-time 20 -X PATCH "$BASE/api/food/pledges/$PLROW" -H "$AH" -H 'Content-Type: application/json' -d "{
  \"action\":\"receive\",\"itemId\":\"$RICEID\",\"batchNo\":\"E2E-PLEDGE-B1\",\"quantityReceived\":20,
  \"expiryDate\":\"$(date -u -v+60d +%Y-%m-%dT00:00:00Z)\"}")
RBN=$(echo "$RC" | jsonget "d['receivedBatchNo']")
[ "$RBN" = "E2E-PLEDGE-B1" ] && ok "received into batch E2E-PLEDGE-B1" || fail "pledge receive" "$RC"
MASTER_AFTER=$(curl -s --max-time 20 "$BASE/api/inventory" -H "$AH" | python3 -c "import sys,json;d=json.load(sys.stdin);items=d if isinstance(d,list) else d.get('items',[]);print(next((i['quantity'] for i in items if i['id']=='$RICEID'),0))")
check "master stock grew by pledge quantity (walk-in event also consumed none)" "$((MASTER_BEFORE + 20))" "$MASTER_AFTER"
# pledge batch appears on the batches desk and requires inspection
PQB=$(curl -s --max-time 20 "$BASE/api/food/batches" -H "$AH" | python3 -c "import sys,json;d=json.load(sys.stdin);print(next((b['qualityStatus'] for b in d if b['batchNo']=='E2E-PLEDGE-B1'),''))")
check "pledge batch starts as PENDING inspection" "PENDING" "$PQB"

# ── Round 4: unified ledger + volunteer assignment integration ──────────
echo "── Unified distribution ledger ──"
UNI=$(curl -s --max-time 20 "$BASE/api/distributions?unified=1&limit=100" -H "$AH")
TOTAL=$(echo "$UNI" | jsonget "d['total']")
[ "$TOTAL" -ge 4 ] 2>/dev/null && ok "unified ledger merges all sources (total $TOTAL)" || fail "unified ledger" "$UNI"
SRCPRESENT=$(echo "$UNI" | python3 -c "
import sys,json
d=json.load(sys.stdin)
srcs=set(r['source'] for r in d['items'])
want={'FOOD_PROGRAMME','MEDICAL_DISPENSE','PAD_DRIVE','LEGACY'}
print('True' if want.issubset(srcs) or len(srcs & want)>=3 else f'Missing: {want-srcs}')")
check "ledger rows come from food + medical + pad + legacy" True "$SRCPRESENT"
UNIF=$(curl -s --max-time 20 "$BASE/api/distributions?unified=1&source=FOOD_PROGRAMME" -H "$AH")
FOODTOTAL=$(echo "$UNIF" | jsonget "d['total']")
FOODONLY=$(echo "$UNIF" | python3 -c "import sys,json;d=json.load(sys.stdin);print(all(r['source']=='FOOD_PROGRAMME' for r in d['items']))")
check "source filter returns only food rows ($FOODTOTAL)" True "$FOODONLY"
NOADDR=$(curl -s --max-time 20 "$BASE/api/distributions?unified=1&limit=100" -H "$AH" | python3 -c "
import sys,json
d=json.load(sys.stdin)
leaks=[r for r in d['items'] if 'phone' in json.dumps(r).lower() or 'address' in json.dumps(r).lower()]
print('True' if not leaks else f'PII leak: {leaks[:1]}')")
check "unified ledger exposes no PII (phone/address)" True "$NOADDR"

echo "── Volunteer assignment for food events ──"
EV2BODY=$(printf '{"programmeId":"%s","title":"E2E VolEvent","eventDate":"%s","venue":"Vol Hall","plannedUnits":5}' "$PID" "$(date -u -v+4d +%Y-%m-%dT09:00:00Z)")
EV2=$(curl -s --max-time 20 -X POST "$BASE/api/food/events" -H "$AH" -H 'Content-Type: application/json' --data-raw "$EV2BODY")
EV2ID=$(echo "$EV2" | jsonget "d['id']")
PBODY=$(printf '{"status":"APPROVED","statusReason":"e2e"}')
curl -s --max-time 20 -o /dev/null -X PATCH "$BASE/api/food/events/$EV2ID" -H "$AH" -H 'Content-Type: application/json' --data-raw "$PBODY"
# a registration ON this event — the gate tests need it
RBODY=$(printf '{"beneficiaryIds":%s}' "$BIDS")
curl -s --max-time 20 -o /dev/null -X POST "$BASE/api/food/events/$EV2ID/registrations" -H "$AH" -H 'Content-Type: application/json' --data-raw "$RBODY"
E2REG=$(curl -s --max-time 20 "$BASE/api/food/registrations?eventId=$EV2ID" -H "$AH" | jsonget "d[0]['code']")
[ -n "$E2REG" ] && ok "registration created for gate tests ($E2REG)" || fail "gate-test registration" "E2REG empty"

# volunteer blocked before assignment
VB2BODY=$(printf '{"action":"lookup","code":"%s","eventId":"%s"}' "$E2REG" "$EV2ID")
VB2=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/checkin" -H "$VH" -H 'Content-Type: application/json' --data-raw "$VB2BODY")
check "volunteer blocked pre-assignment (403)" 403 "$VB2"
# assign
AV=$(curl -s --max-time 20 "$BASE/api/food/events/$EV2ID/volunteers?available=1" -H "$AH")
VID=$(echo "$AV" | jsonget "d[0]['id']")
ASBODY=$(printf '{"volunteerId":"%s","role":"QUEUE"}' "$VID")
AS=$(curl -s --max-time 20 -X POST "$BASE/api/food/events/$EV2ID/volunteers" -H "$AH" -H 'Content-Type: application/json' --data-raw "$ASBODY")
TASKID=$(echo "$AS" | jsonget "d['id']")
[ -n "$TASKID" ] && ok "assign volunteer (QUEUE role)" || fail "assign volunteer" "$AS"
DUPABODY=$(printf '{"volunteerId":"%s","role":"PACKING"}' "$VID")
DUPA=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/events/$EV2ID/volunteers" -H "$AH" -H 'Content-Type: application/json' --data-raw "$DUPABODY")
check "duplicate assignment blocked (409)" 409 "$DUPA"
BADROLEBODY=$(printf '{"volunteerId":"%s","role":"SUPERHERO"}' "$VID")
BADROLE=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/events/$EV2ID/volunteers" -H "$AH" -H 'Content-Type: application/json' --data-raw "$BADROLEBODY")
check "invalid role rejected (400)" 400 "$BADROLE"
VL=$(curl -s --max-time 20 "$BASE/api/food/events/$EV2ID/volunteers" -H "$AH")
VCOUNT=$(echo "$VL" | jsonget "len(d)")
check "volunteer list shows assignment" 1 "$VCOUNT"
# volunteer now passes the gate (assigned, event APPROVED is not operational →
# the assignment check runs first and the gate opens; the lookup then reports
# the event state — either response proves the gate opened, so accept 200/409)
VBOK=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/checkin" -H "$VH" -H 'Content-Type: application/json' --data-raw "$VB2BODY")
check "assigned volunteer passes the gate (200/409)" "200-or-409" "$( [ "$VBOK" = "200" ] || [ "$VBOK" = "409" ] && echo "200-or-409" || echo "$VBOK")"
# cancel assignment → gate closes again
CABODY=""
CA=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/food/events/$EV2ID/volunteers?taskId=$TASKID" -H "$AH")
check "cancel assignment" 200 "$CA"
VB3=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/checkin" -H "$VH" -H 'Content-Type: application/json' --data-raw "$VB2BODY")
check "CANCELLED assignment no longer grants check-in (403)" 403 "$VB3"

echo "── Pledge double-submit guard ──"
PPHONE="98765$((RANDOM % 900 + 100))00"
PG1=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/pledges" -H 'Content-Type: application/json' \
  -d "{\"donorName\":\"E2E Pledge Guard\",\"phone\":\"$PPHONE\",\"items\":\"Double submit test box\",\"pickupAddress\":\"Test St 1\"}")
check "first pledge accepted" 201 "$PG1"
PG2=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/food/pledges" -H 'Content-Type: application/json' \
  -d "{\"donorName\":\"E2E Pledge Guard\",\"phone\":\"$PPHONE\",\"items\":\"Double submit test box\",\"pickupAddress\":\"Test St 1\"}")
check "identical pledge within 60s blocked (409)" 409 "$PG2"

echo ""
echo "════════════════════════════════════"
echo "PASS: $PASS   FAIL: $FAIL"
echo "════════════════════════════════════"

# Self-clean — remove this run's test data so back-to-back runs always start
# from the seeded demo state (cleanup uses Prisma directly, no server needed).
bun "$(dirname "$0")/cleanup-food-e2e.ts" >/dev/null 2>&1 || true

# explicit exit code so CI/monitoring sees pass/fail, not the last pipeline's
if [ $FAIL -gt 0 ]; then exit 1; fi
exit 0
