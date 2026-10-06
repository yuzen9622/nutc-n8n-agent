#!/bin/sh
set -eu
uname -sm
cat /etc/os-release
docker version --format '{{.Server.Version}}'
docker compose version
df -h .
docker ps --format '{{.Names}} {{.Ports}}'
ss -ltn
