#!/bin/sh
# Queries CSW in 6-hour intervals over a historical date range.
# Splits the range into 6-hour windows and runs node-cli for each one,
# printing each window's JSON result to stdout.
#
# Usage:
#   ./backfill.sh --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD>
#
# Example:
#   ./backfill.sh --start-date 2026-01-01 --end-date 2026-02-01

set -e

INTERVAL=21600  # 6 hours in seconds
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
    echo "Usage: $0 --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD>"
    echo ""
    echo "Queries CSW in 6-hour intervals over a historical date range."
    echo ""
    echo "Options:"
    echo "  --start-date    Start date (e.g. 2026-01-01)"
    echo "  --end-date      End date, exclusive (e.g. 2026-02-01)"
    echo "  --help          Show this help message"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --start-date) start_date="$2"; shift 2 ;;
        --end-date)   end_date="$2";   shift 2 ;;
        --help)       usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
    esac
done

if [ -z "$start_date" ] || [ -z "$end_date" ]; then
    echo "Error: --start-date and --end-date are required" >&2
    usage >&2
    exit 1
fi

start_epoch=$(date -d "${start_date}T00:00:00Z" +%s)
end_epoch=$(date -d "${end_date}T00:00:00Z" +%s)

if [ "$start_epoch" -ge "$end_epoch" ]; then
    echo "Error: --start-date must be before --end-date" >&2
    exit 1
fi

current=$start_epoch
while [ "$current" -lt "$end_epoch" ]; do
    next=$((current + INTERVAL))
    if [ "$next" -gt "$end_epoch" ]; then
        next=$end_epoch
    fi

    window_start=$(date -u -d "@$current" +%Y-%m-%dT%H:%M:%SZ)
    window_end=$(date -u -d "@$next" +%Y-%m-%dT%H:%M:%SZ)

    echo "=== $window_start to $window_end ===" >&2
    node "$SCRIPT_DIR/src/node-cli.ts" --start-date "$window_start" --end-date "$window_end"

    current=$next
done
