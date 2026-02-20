#!/bin/bash
cd /opt/identityprism-bot

# Kill only our bot processes (not other bots)
for pid in $(pgrep -f 'identityprism-bot.*python'); do
    kill -9 "$pid" 2>/dev/null
done
sleep 1

rm -f twitter_bot.lock twitter_bot_child.pid

# Start fresh — single instance
nohup .venv/bin/python -u run_twitter_bot.py >> bot.err.log 2>&1 &
WRAPPER_PID=$!
echo "Started wrapper PID: $WRAPPER_PID"

sleep 4

# Verify
echo "--- Running processes ---"
ps -ef | grep 'identityprism-bot.*python' | grep -v grep | grep -v node
echo "--- Last 5 log lines ---"
tail -5 bot.err.log
