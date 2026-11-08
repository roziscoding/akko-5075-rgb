#!/usr/bin/env bash
set -euo pipefail

version="$1"
target="x86_64-unknown-linux-gnu"

# The first `version =` line is the one in [package].
sed -i "0,/^version = .*/s//version = \"${version}\"/" cli/Cargo.toml

cargo build --release --manifest-path cli/Cargo.toml

mkdir -p dist
tar -C cli/target/release -czf "dist/akko-rgb-${target}.tar.gz" akko-rgb
