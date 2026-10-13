#!/usr/bin/env bash
# Smoke-test a built image: endpoints, health check, non-root user and
# graceful SIGTERM shutdown. Usage: scripts/smoke-test.sh <image>
set -euo pipefail

image=${1:?usage: $0 <image>}
name="temp-api-smoke-$$"
sensor_dir=$(mktemp -d)
echo 45000 > "$sensor_dir/temp"
chmod -R a+rX "$sensor_dir"

cleanup() {
    docker rm -f "$name" >/dev/null 2>&1 || true
    rm -rf "$sensor_dir"
}
trap cleanup EXIT

docker run -d --name "$name" -p 127.0.0.1::64567 \
    -v "$sensor_dir/temp:/sensor/temp:ro" -e temp_file_path=/sensor/temp \
    "$image" >/dev/null
port=$(docker port "$name" 64567/tcp | head -n1 | sed 's/.*://')
base="http://127.0.0.1:$port/temp"

for _ in $(seq 1 30); do
    curl -fsS --noproxy '*' "$base/ping" >/dev/null 2>&1 && break
    sleep 0.5
done

fail=0
check() {
    local desc=$1 expected=$2 actual=$3
    if [[ "$actual" == *"$expected"* ]]; then
        echo "ok   $desc"
    else
        echo "FAIL $desc: expected '$expected', got '$actual'"
        fail=1
    fi
}

get() { curl -sS --noproxy '*' "$@"; }
status() { curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' "$@"; }

check "GET /temp/ping"               '{"status":"UP"}' "$(get "$base/ping")"
check "GET /temp"                    '{"temp":45}' "$(get "$base")"
check "GET /temp/metrics"            'cpu_temperature_celsius 45' "$(get "$base/metrics")"
check "GET /temp/config"             '"size":12' "$(get "$base/config")"
check "GET /temp/demo"               '200' "$(status "$base/demo")"
check "GET /temp/homarr.html"        '200' "$(status "$base/homarr.html")"
check "GET /temp/chart.js"           '200' "$(status "$base/chart.js")"
check "GET /temp/style.css"          '200' "$(status "$base/style.css")"
check "GET /temp/favicon.ico"        '200' "$(status "$base/favicon.ico")"
check "GET /temp/nope is 404"        '404' "$(status "$base/nope")"
check "health-check.js exits 0"      '0' "$(docker exec "$name" node health-check.js >/dev/null 2>&1; echo $?)"
check "runs as non-root"             '1000' "$(docker exec "$name" id -u)"

docker stop -t 10 "$name" >/dev/null
check "SIGTERM exits cleanly"        '0' "$(docker inspect -f '{{.State.ExitCode}}' "$name")"
check "graceful shutdown logged"     'HTTP server closed' "$(docker logs "$name" 2>&1)"

if [[ $fail -ne 0 ]]; then
    docker logs "$name" 2>&1 | tail -n 30
    exit 1
fi
echo "smoke test passed"
