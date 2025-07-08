#!/bin/sh
dir=$(dirname "$0")

/root/.deno/bin/deno serve -A --env-file="$dir/.env" --port $PORT server.ts

# apt install poppler-data poppler-utils