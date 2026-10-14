#!/bin/bash
# Build native helpers (macOS only)
set -e; cd "$(dirname "$0")/.."; mkdir -p native/mac/build
swiftc -O native/mac/axhelper.swift -o native/mac/build/waterly-axhelper 2>&1 | grep -E "error" || true
swiftc -O native/mac/ncwatch.swift -o native/mac/build/ncwatch 2>&1 | grep -E "error" || true
bash native/mac/grokcall/build.sh 2>&1 | grep -E "error|built" || true
ls -l native/mac/build
