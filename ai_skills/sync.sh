#!/bin/bash
# Edit files in claude/ only, then run this to sync to other AI tools.

SOURCE="$(dirname "$0")/claude"

for TARGET in agents codex; do
  rm -rf "$(dirname "$0")/$TARGET"
  cp -r "$SOURCE" "$(dirname "$0")/$TARGET"
  echo "Synced -> $TARGET/"
done
