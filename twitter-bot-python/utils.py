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
