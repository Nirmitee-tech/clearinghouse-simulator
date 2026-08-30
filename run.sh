#!/bin/bash
# Start clearmock, replacing whatever already holds the port. Killing by port
# rather than by process name: the process argv is just "node src/index.js",
# so a path-based pkill silently misses it and the restart dies on EADDRINUSE
# while the old build keeps serving.
PORT="${CM_PORT:-8093}"
lsof -ti tcp:"$PORT" | xargs kill -9 2>/dev/null
for i in $(seq 1 20); do lsof -ti tcp:"$PORT" >/dev/null 2>&1 || break; sleep 0.2; done
cd "$(dirname "$0")"
CM_PORT="$PORT" nohup node src/index.js > /tmp/clearmock.log 2>&1 &
for i in $(seq 1 30); do
  sleep 0.3
  if curl -s -o /dev/null "http://localhost:$PORT/api/stubs"; then
    echo "clearmock listening on http://localhost:$PORT"
    exit 0
  fi
done
echo "clearmock failed to start:"; tail -5 /tmp/clearmock.log; exit 1
