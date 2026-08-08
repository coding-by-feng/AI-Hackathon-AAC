#!/bin/zsh
# Tunnel watchdog — kicks services that are "running" but not serving.
#
# Why it exists: after a Mac sleep or network change, cloudflared's QUIC
# connections to the Cloudflare edge can die while the PROCESS stays alive.
# launchd's KeepAlive sees a healthy process; visitors see Error 1033. The only
# reliable probe is the public URL itself.
#
# Ran by launchd (app.kason.aac.watchdog) every 120 s. Two consecutive
# failures 10 s apart are required before kicking, so a single edge blip
# never restarts anything.
set -u

PROBE="https://aac.kason.app/who"
LOCAL="http://localhost:3000/who"
UID_NUM=$(id -u)
STAMP() { date "+%Y-%m-%dT%H:%M:%S%z" }

check() { curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$1" 2>/dev/null }

pub=$(check "$PROBE")
[ "$pub" = "200" ] && exit 0

sleep 10
pub=$(check "$PROBE")
[ "$pub" = "200" ] && exit 0

# Public is down twice. Is the origin itself healthy?
loc=$(check "$LOCAL")
if [ "$loc" != "200" ]; then
  echo "$(STAMP) public=$pub local=$loc — kicking WEB then tunnel"
  launchctl kickstart -k "gui/$UID_NUM/app.kason.aac.web"
  sleep 5
else
  echo "$(STAMP) public=$pub local=200 — tunnel connector stale, kicking tunnel"
fi

launchctl kickstart -k "gui/$UID_NUM/app.kason.aac.tunnel"

# Report the outcome so the log tells a complete story.
sleep 20
echo "$(STAMP) after kick: public=$(check "$PROBE")"
