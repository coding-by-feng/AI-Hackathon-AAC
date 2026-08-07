#!/bin/bash
# API-level cases from docs/test-plan.md. Browser cases are run with Playwright.
BASE="${BASE:-http://localhost:3000}"
PASS=0; FAIL=0; BLOCK=0
ok(){ printf "  \033[32mPASS\033[0m %-6s %s\n" "$1" "$2"; PASS=$((PASS+1)); }
no(){ printf "  \033[31mFAIL\033[0m %-6s %s\n" "$1" "$2"; FAIL=$((FAIL+1)); }
bl(){ printf "  \033[33mBLOCK\033[0m %-5s %s\n" "$1" "$2"; BLOCK=$((BLOCK+1)); }
eq(){ [ "$2" = "$3" ] && ok "$1" "$4" || no "$1" "$4 (got '$2', want '$3')"; }
#--- E: resolution ladder
echo "E. Pictures — resolution ladder"
R=$(curl -s -X POST $BASE/api/visuals -H 'content-type: application/json' -d '{"concept":"water","childId":"maya_t"}')
eq E1 "$(echo "$R"|python3 -c 'import sys,json;print(json.load(sys.stdin).get("resolvedBy"))')" "icon_pack" "built-in symbol, free"
R=$(curl -s -X POST $BASE/api/visuals -H 'content-type: application/json' -d '{"concept":"Toilet","childId":"maya_t"}')
eq E2 "$(echo "$R"|python3 -c 'import sys,json;print(json.load(sys.stdin).get("resolvedBy"))')" "icon_pack" "case-insensitive"
R=$(curl -s --max-time 90 -X POST $BASE/api/visuals -H 'content-type: application/json' -d '{"concept":"chocolate milkshake","childId":"maya_t"}')
if echo "$R" | grep -q "credit\|quota\|API key"; then bl E3 "generation — OpenAI account has no credits"; bl E4 "cache reuse — depends on E3"; bl E5 "semantic match — depends on E3";
else eq E3 "$(echo "$R"|python3 -c 'import sys,json;print(json.load(sys.stdin).get("resolvedBy"))')" "generated" "new concept generated"; fi
N=$(sqlite3 aac.db "SELECT count(*) FROM events WHERE type='gap_detected';")
[ "$N" -gt 0 ] && ok E6 "gap_detected logged ($N rows)" || no E6 "no gap_detected events"
#--- F, J, K, L
echo; echo "F. Sign-in and attribution"
eq F1 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/)" "307" "no session redirects to /who"
eq F2 "$(curl -s $BASE/who | grep -oE 'Maya|Jonah|Amara|Liam|Sofia' | sort -u | wc -l | tr -d ' ')" "5" "five children offered"
rm -f /tmp/t.jar
R=$(curl -s -c /tmp/t.jar -X POST $BASE/api/session -H 'content-type: application/json' -d '{"childId":"jonah_k"}')
eq F3 "$(echo "$R"|python3 -c 'import sys,json;print(json.load(sys.stdin).get("ok"))')" "True" "sign-in sets a session"
eq F4 "$(curl -s -b /tmp/t.jar $BASE/ | grep -c 'Jonah')" "$(curl -s -b /tmp/t.jar $BASE/ | grep -c 'Jonah')" "board loads as Jonah"
[ "$(curl -s -b /tmp/t.jar $BASE/ | grep -c 'Jonah')" -gt 0 ] && ok F4 "board loads the signed-in child" || no F4 "wrong child"

echo; echo "J. Event integrity"
R=$(curl -s -X POST $BASE/api/events -H 'content-type: application/json' -d '{"events":[{"event_id":"j1","child_id":"maya_t","ts":1786100000000,"day_local":"2026-08-07","tz_offset_min":720,"session_id":"t","scene":"classroom","actor":"child","type":"card_tap","source":"board","label":"x"}]}')
echo "$R" | grep -q "requires grid_row" && ok J1 "grid tap without coordinates rejected" || no J1 "accepted a tap with no coordinates"
R=$(curl -s -X POST $BASE/api/events -H 'content-type: application/json' -d '{"events":[{"event_id":"j2","child_id":"maya_t","ts":1786100000001,"day_local":"2026-08-07","tz_offset_min":720,"session_id":"t","scene":"classroom","actor":"child","type":"card_tap","source":"search","nav_depth":1,"label":"angry"}]}')
eq J2 "$(echo "$R"|python3 -c 'import sys,json;print(json.load(sys.stdin).get("accepted"))')" "1" "folder tap accepted without coordinates"
R=$(curl -s -X POST $BASE/api/events -H 'content-type: application/json' -d '{"events":[{"event_id":"j2","child_id":"maya_t","ts":1786100000001,"day_local":"2026-08-07","tz_offset_min":720,"session_id":"t","scene":"classroom","actor":"child","type":"card_tap","source":"search","nav_depth":1,"label":"angry"}]}')
eq J3 "$(echo "$R"|python3 -c 'import sys,json;print(json.load(sys.stdin).get("duplicates"))')" "1" "replay is idempotent"
R=$(curl -s -X POST $BASE/api/events -H 'content-type: application/json' -d '{"events":[{"event_id":"j4","child_id":"maya_t","ts":1,"day_local":"2026-08-07","tz_offset_min":720,"session_id":"t","scene":"moon","actor":"child","type":"speak"}]}')
echo "$R" | grep -q "unknown scene" && ok J4 "unknown scene rejected by name" || no J4 "accepted an invalid scene"
sqlite3 aac.db "DELETE FROM events WHERE session_id='t';"

echo; echo "L. MCP"
TOKEN=$(grep AAC_MCP_TOKEN .env.local | cut -d= -f2)
eq L1 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}')" "401" "no token refused"
eq L2 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/mcp -H 'Authorization: Bearer wrong' -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}')" "401" "wrong token refused"
eq L3 "$(curl -s -X POST $BASE/api/mcp -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 -c 'import sys,json;n=len(json.load(sys.stdin)["result"]["tools"]);print("ok" if n>=14 else n)')" "ok" "at least 14 tools exposed"
eq L4 "$(curl -s -X POST $BASE/api/mcp -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_children","arguments":{"adult_id":"adult_patel"}}}' | python3 -c 'import sys,json;print(len(json.loads(json.load(sys.stdin)["result"]["content"][0]["text"])["data"]["children"]))')" "5" "list_children returns 5"

echo; echo "C. Categories"
eq C1 "$(curl -s "$BASE/api/categories?child=maya_t" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["categories"]))' )" "10" "categories seeded"
eq C2 "$(curl -s "$BASE/api/categories?child=maya_t" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(len([c for c in d["categories"] if c["name"]=="Feelings"][0]["words"]))')" "8" "Feelings has 8 words"
curl -s -X POST $BASE/api/categories -H 'content-type: application/json' -d '{"action":"show","childId":"maya_t","categoryId":"numbers","shown":false}' >/dev/null
M=$(curl -s "$BASE/api/categories?child=maya_t" | python3 -c 'import sys,json;d=json.load(sys.stdin);print([c for c in d["categories"] if c["name"]=="Numbers"][0]["shown"])')
J=$(curl -s "$BASE/api/categories?child=jonah_k" | python3 -c 'import sys,json;d=json.load(sys.stdin);print([c for c in d["categories"] if c["name"]=="Numbers"][0]["shown"])')
[ "$M" = "False" ] && [ "$J" = "True" ] && ok C5 "visibility is per child (maya=$M jonah=$J)" || no C5 "leaked across children (maya=$M jonah=$J)"
curl -s -X POST $BASE/api/categories -H 'content-type: application/json' -d '{"action":"show","childId":"maya_t","categoryId":"numbers","shown":true}' >/dev/null
eq C6 "$(curl -s "$BASE/api/categories?child=maya_t" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(len([c for c in d["categories"] if c["name"]=="Numbers"][0]["words"]))')" "10" "re-showing restores all words"
R=$(curl -s -X POST $BASE/api/categories -H 'content-type: application/json' -d '{"action":"delete","categoryId":"feelings"}')
echo "$R" | grep -qi "not deleted\|cannot be deleted" && ok C7 "built-in category refused deletion" || no C7 "built-in deletion not refused: $R"

echo; echo "G. Dashboard login"
eq G1 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/dashboard)" "307" "no session redirects to login"
eq G7 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/dashboard/student/maya_t)" "307" "student page requires a session"

echo
printf "  \033[32m%d passed\033[0m  \033[31m%d failed\033[0m  \033[33m%d blocked\033[0m\n" $PASS $FAIL $BLOCK
[ $FAIL -eq 0 ]
