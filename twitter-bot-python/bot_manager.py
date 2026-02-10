"""
Single process manager for both Twitter and Colosseum bots.
Uses atomic O_CREAT|O_EXCL lock to guarantee only one instance runs.
Auto-restarts children if they crash.
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
LOCK_FILE = BOT_DIR / 'bot_manager.lock'
LOG_FILE = BOT_DIR / 'manager.log'
PYTHON = str(BOT_DIR / '.venv' / 'Scripts' / 'pythonw.exe')

BOTS = {
    'twitter': {
        'script': 'main.py',
        'log': BOT_DIR / 'bot.err.log',
    },
    'colosseum': {
        'script': 'colosseum_bot.py',
        'log': BOT_DIR / 'colosseum.err.log',
    },
}

MIN_UPTIME = 30
MAX_BACKOFF = 300

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s MGR %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[logging.FileHandler(LOG_FILE, encoding='utf-8')],
)

_children = {}  # name -> (Popen, log_fh, start_time, backoff)


def _acquire_lock():
    """Atomic singleton via O_CREAT|O_EXCL. Returns True if we own the lock."""
    if LOCK_FILE.exists():
        try:
            old_pid = int(LOCK_FILE.read_text().strip())
            try:
                os.kill(old_pid, 0)
                logging.info('Manager already running (PID %d) — exiting', old_pid)
                return False
            except (ProcessLookupError, OSError):
                pass  # dead process, clean up
        except (ValueError, OSError):
            pass
        LOCK_FILE.unlink(missing_ok=True)
    try:
        fd = os.open(str(LOCK_FILE), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except FileExistsError:
        logging.info('Lock race lost — exiting')
        return False


def _start_bot(name):
    """Start a bot subprocess, return (Popen, log_fh)."""
    cfg = BOTS[name]
    log_fh = open(cfg['log'], 'a', encoding='utf-8')
    proc = subprocess.Popen(
        [PYTHON, '-u', cfg['script']],
        cwd=str(BOT_DIR),
        stdout=log_fh,
        stderr=log_fh,
    )
    logging.info('Started %s (PID %d)', name, proc.pid)
    return proc, log_fh


def _cleanup(*_args):
    """Terminate all children, remove lock."""
    for name, (proc, log_fh, _, _) in list(_children.items()):
        if proc.poll() is None:
            logging.info('Stopping %s (PID %d)', name, proc.pid)
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        log_fh.close()
    _children.clear()
    LOCK_FILE.unlink(missing_ok=True)


def main():
    if not _acquire_lock():
        sys.exit(0)

    atexit.register(_cleanup)
    signal.signal(signal.SIGTERM, lambda *a: (_cleanup(), sys.exit(0)))
    signal.signal(signal.SIGINT, lambda *a: (_cleanup(), sys.exit(0)))

    # Start all bots
    for name in BOTS:
        proc, log_fh = _start_bot(name)
        _children[name] = (proc, log_fh, time.time(), 5)

    # Monitor loop
    while True:
        time.sleep(5)
        for name in list(BOTS.keys()):
            if name not in _children:
                continue
            proc, log_fh, start_time, backoff = _children[name]
            if proc.poll() is not None:
                uptime = time.time() - start_time
                logging.warning('%s exited (code %s) after %.0fs',
                                name, proc.returncode, uptime)
                log_fh.close()
                new_backoff = 5 if uptime > MIN_UPTIME else min(backoff * 2, MAX_BACKOFF)
                logging.info('Restarting %s in %ds', name, new_backoff)
                time.sleep(new_backoff)
                new_proc, new_fh = _start_bot(name)
                _children[name] = (new_proc, new_fh, time.time(), new_backoff)


if __name__ == '__main__':
    main()
