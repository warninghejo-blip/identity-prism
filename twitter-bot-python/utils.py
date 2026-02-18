import asyncio
import json
import logging
import os
import random
import time

DEFAULT_STATE = {
    'replied_tweets': [],
    'last_sniper_seen': {},
    'last_trend_tweet': None,
    'bot_started_at': None,
    'next_post_retry_at': 0,
    'last_post_id': None,
    'last_post_at': None,
    'last_engagement_at': None,
}


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format='[%(asctime)s] %(levelname)s %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    )


def sleep_random(min_seconds, max_seconds, reason=None):
    delay = random.uniform(min_seconds, max_seconds)
    if reason:
        logging.info('Sleeping %.1fs (%s)', delay, reason)
    else:
        logging.info('Sleeping %.1fs', delay)
    time.sleep(delay)
    return delay


async def async_sleep_random(min_seconds, max_seconds, reason=None):
    delay = random.uniform(min_seconds, max_seconds)
    if reason:
        logging.info('Sleeping %.1fs (%s)', delay, reason)
    else:
        logging.info('Sleeping %.1fs', delay)
    await asyncio.sleep(delay)
    return delay


def load_state(path):
    if not os.path.exists(path):
        return DEFAULT_STATE.copy()
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            data = json.load(handle) or {}
    except (json.JSONDecodeError, OSError):
        return DEFAULT_STATE.copy()
    merged = DEFAULT_STATE.copy()
    merged.update(data)
    merged['replied_tweets'] = list(data.get('replied_tweets', merged['replied_tweets']))
    merged['last_sniper_seen'] = dict(data.get('last_sniper_seen', merged['last_sniper_seen']))
    merged['last_trend_tweet'] = data.get('last_trend_tweet', merged['last_trend_tweet'])
    return merged


def save_state(state, path):
    try:
        with open(path, 'w', encoding='utf-8') as handle:
            json.dump(state, handle, indent=2)
    except OSError as exc:
        logging.warning('Failed to save state: %s', exc)


def clamp_text(text, max_len):
    if not text:
        return ''
    if len(text) <= max_len:
        return text
    truncated = text[:max_len]
    for end_char in ['. ', '! ', '? ']:
        idx = truncated.rfind(end_char)
        if idx > max_len // 2:
            return truncated[:idx + 1].strip()
    last_space = truncated.rfind(' ')
    if last_space > max_len // 2:
        return truncated[:last_space].rstrip(' ,;:')
    return truncated.rstrip()


def trim_hashtags(text, max_tags):
    if not text:
        return ''
    tags = [token for token in text.split() if token.startswith('#')]
    if len(tags) <= max_tags:
        return text
    kept = []
    kept_count = 0
    for token in text.split():
        if token.startswith('#'):
            if kept_count < max_tags:
                kept.append(token)
                kept_count += 1
            continue
        kept.append(token)
    return ' '.join(kept).strip()


def is_rate_limit_error(error):
    message = str(error).lower()
    return any(key in message for key in ['rate limit', '429', '344', '403'])


def check_single_instance(lock_name: str):
    """
    Ensure only one instance is running.
    Uses fcntl.flock on Linux (robust, handles crashes).
    Uses file existence/locking on Windows (fallback).
    """
    import sys
    lock_file = os.path.join(os.path.dirname(__file__), lock_name)
    global _lock_fd

    try:
        # Unix/Linux (Server)
        import fcntl
        try:
            # Open the file (create if missing)
            fd = os.open(lock_file, os.O_RDWR | os.O_CREAT, 0o666)
            # Try to acquire an exclusive lock without blocking
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            # Lock acquired! Keep fd open.
            _lock_fd = fd
            # Write PID for info
            os.ftruncate(fd, 0)
            os.write(fd, str(os.getpid()).encode())
            return True
        except (IOError, OSError):
            # Failed to acquire lock
            if 'fd' in locals():
                os.close(fd)
            logging.error("Another instance is already running (flock %s)", lock_name)
            return False

    except ImportError:
        # Windows Fallback
        try:
            if os.path.exists(lock_file):
                try:
                    # On Windows, unlinking an open file usually fails.
                    # If we succeed, the previous lock was stale.
                    os.unlink(lock_file)
                except OSError:
                    logging.error("Another instance is already running (win lock %s)", lock_name)
                    return False
            
            # Open with exclusive creation
            fd = os.open(lock_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            _lock_fd = fd
            
            # Register cleanup
            import atexit
            def _cleanup_lock():
                try:
                    os.close(fd)
                    os.unlink(lock_file)
                except OSError:
                    pass
            atexit.register(_cleanup_lock)
            return True
        except OSError as e:
            logging.error("Could not acquire lock %s: %s", lock_name, e)
            return False
