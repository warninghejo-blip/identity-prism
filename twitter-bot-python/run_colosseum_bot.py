"""Auto-restart wrapper for the Colosseum bot (colosseum_bot.py)."""
import subprocess
import sys
import time
import logging

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)

SCRIPT = 'colosseum_bot.py'
MIN_UPTIME = 30  # seconds — if it crashes faster, increase backoff
MAX_BACKOFF = 300  # 5 min max wait between restarts

def run():
    backoff = 5
    while True:
        logging.info('Starting %s ...', SCRIPT)
        start = time.time()
        try:
            proc = subprocess.run(
                [sys.executable, SCRIPT],
                cwd=sys.path[0] or '.',
            )
            code = proc.returncode
        except KeyboardInterrupt:
            logging.info('Interrupted — exiting')
            break
        except Exception as e:
            logging.error('Failed to start %s: %s', SCRIPT, e)
            code = -1

        uptime = time.time() - start
        logging.warning('%s exited with code %s after %.0fs', SCRIPT, code, uptime)

        if uptime > MIN_UPTIME:
            backoff = 5  # reset backoff if it ran for a while
        else:
            backoff = min(backoff * 2, MAX_BACKOFF)

        logging.info('Restarting in %ds ...', backoff)
        try:
            time.sleep(backoff)
        except KeyboardInterrupt:
            logging.info('Interrupted during backoff — exiting')
            break

if __name__ == '__main__':
    run()
