"""Auto-restart wrapper for the Colosseum bot (colosseum_bot.py).

Singleton via PID-file + race guard. Self-contained file logging.
"""
import atexit
import os
import signal
import subprocess
import sys
import time
import logging
from pathlib import Path

BOT_DIR = Path(__file__).parent
LOG_FILE = BOT_DIR / 'colosseum.err.log'
LOCK_FILE = BOT_DIR / 'colosseum_bot.lock'
CHILD_PID_FILE = BOT_DIR / 'colosseum_bot_child.pid'
SCRIPT = 'colosseum_bot.py'
MIN_UPTIME = 30
MAX_BACKOFF = 300

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s WRAPPER %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[logging.FileHandler(LOG_FILE, encoding='utf-8')],
)

_child_proc = None


def _is_pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, OSError):
        return False


def _acquire_singleton():
    """Atomic singleton: O_CREAT|O_EXCL ensures only one process creates the lock."""
    if LOCK_FILE.exists():
        try:
            old_pid = int(LOCK_FILE.read_text().strip())
            if _is_pid_alive(old_pid):
                logging.info('Another wrapper (PID %d) is alive — exiting', old_pid)
                return False
        except (ValueError, OSError):
            pass
        LOCK_FILE.unlink(missing_ok=True)
    try:
        fd = os.open(str(LOCK_FILE), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except FileExistsError:
        logging.info('Lock file appeared — another instance won the race')
        return False


def _kill_pid_file(pid_path):
    if not pid_path.exists():
        return
    try:
        pid = int(pid_path.read_text().strip())
        if _is_pid_alive(pid):
            os.kill(pid, signal.SIGTERM)
            logging.info('Killed orphan %d from %s', pid, pid_path.name)
            time.sleep(1)
    except (ProcessLookupError, ValueError, OSError):
        pass
    finally:
        pid_path.unlink(missing_ok=True)


def _cleanup(*_args):
    global _child_proc
    if _child_proc and _child_proc.poll() is None:
        logging.info('Terminating child %d', _child_proc.pid)
        _child_proc.terminate()
        try:
            _child_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _child_proc.kill()
    _child_proc = None
    LOCK_FILE.unlink(missing_ok=True)
    CHILD_PID_FILE.unlink(missing_ok=True)


def run():
    global _child_proc

    if not _acquire_singleton():
        return

    _kill_pid_file(CHILD_PID_FILE)

    atexit.register(_cleanup)
    signal.signal(signal.SIGTERM, lambda *a: (_cleanup(), sys.exit(0)))
    signal.signal(signal.SIGINT, lambda *a: (_cleanup(), sys.exit(0)))

    backoff = 5
    log_fh = open(LOG_FILE, 'a', encoding='utf-8')
    while True:
        logging.info('Starting %s ...', SCRIPT)
        start = time.time()
        try:
            _child_proc = subprocess.Popen(
                [sys.executable, '-u', SCRIPT],
                cwd=str(BOT_DIR),
                stdout=log_fh,
                stderr=log_fh,
            )
            CHILD_PID_FILE.write_text(str(_child_proc.pid))
            _child_proc.wait()
            code = _child_proc.returncode
        except KeyboardInterrupt:
            _cleanup()
            break
        except Exception as e:
            logging.error('Failed to start %s: %s', SCRIPT, e)
            code = -1
        finally:
            CHILD_PID_FILE.unlink(missing_ok=True)
            _child_proc = None

        uptime = time.time() - start
        logging.warning('%s exited (code %s) after %.0fs', SCRIPT, code, uptime)
        backoff = 5 if uptime > MIN_UPTIME else min(backoff * 2, MAX_BACKOFF)
        logging.info('Restarting in %ds ...', backoff)
        try:
            time.sleep(backoff)
        except KeyboardInterrupt:
            _cleanup()
            break
    log_fh.close()


if __name__ == '__main__':
    run()
