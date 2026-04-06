#!/bin/bash
cd "$(dirname "$0")"
nohup ./start.sh > start.log 2>&1 &
echo "Started start.sh in background (PID: $!)"
