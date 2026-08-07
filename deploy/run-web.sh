#!/bin/bash
# Wrapper for the Next.js server under launchd.
#
# launchd gives a job a minimal environment and no shell. Invoking node
# directly from the plist produced a process that started but never bound a
# port, with empty logs. A wrapper fixes that and gives one place to set the
# environment, guarantee the working directory, and force unbuffered output so
# the logs are useful when something goes wrong.
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NODE_ENV=production

# Secrets live in .env.local, which is gitignored. next start does not read it.
if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
fi

# next start serves a build; without one it exits immediately and the tunnel
# reports the origin as unreachable. Fail loudly instead.
if [ ! -f .next/BUILD_ID ]; then
  echo "[run-web] No production build. Run: npx next build" >&2
  exit 1
fi

echo "[run-web] starting next on :3000 (build $(cat .next/BUILD_ID))"
exec node node_modules/next/dist/bin/next start --port 3000
