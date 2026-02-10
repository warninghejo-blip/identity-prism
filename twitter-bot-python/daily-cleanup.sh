#!/bin/bash
# Daily cleanup for /opt/identityprism-bot
# Removes generated media older than 1 day, stale PID/lock files, temp files

set -e

BOT_DIR="/opt/identityprism-bot"

# Remove generated media older than 1 day
find "$BOT_DIR/media/" -type f -mtime +0 -delete 2>/dev/null || true

# Remove stale screenshots/temp images
find "$BOT_DIR" -maxdepth 1 -name "*.png" -mtime +0 -delete 2>/dev/null || true
find "$BOT_DIR" -maxdepth 1 -name "*.jpg" -mtime +0 -delete 2>/dev/null || true
find "$BOT_DIR" -maxdepth 1 -name "*.tmp" -mtime +0 -delete 2>/dev/null || true

# Remove old compressed logs (kept by logrotate)
find "$BOT_DIR" -maxdepth 1 -name "*.log.*.gz" -mtime +1 -delete 2>/dev/null || true

# Clean systemd journal older than 1 day
journalctl --vacuum-time=1d >/dev/null 2>&1 || true

echo "[$(date)] Cleanup done"
