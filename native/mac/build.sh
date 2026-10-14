#!/bin/sh
set -e; cd "$(dirname "$0")"; mkdir -p build
swiftc -O axhelper.swift -o build/waterly-axhelper -framework Cocoa -framework ApplicationServices
