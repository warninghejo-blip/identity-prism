import argparse
import asyncio
import datetime
import logging
import random
import time

from dotenv import load_dotenv

from ai_engine import AIEngine
from config import (
    BOT_USERNAME,
    LIKE_RATE,
    MAX_STORED_TWEETS,
    POST_IMAGE_ENABLED,
    POST_IMAGE_RATE,
    STATE_PATH,
    SHILL_RATE,
    TARGET_USERS,
    WALLET_CHECK_KEYWORDS,
)
from twitter_client import TwitterClient
from utils import async_sleep_random, load_state, save_state, setup_logging


def should_shill():
    return random.random() < SHILL_RATE


async def build_media_paths(ai_engine, post_text):
    if not POST_IMAGE_ENABLED:
        return []
    if random.random() > POST_IMAGE_RATE:
        return []
    image_path = await asyncio.to_thread(ai_engine.generate_post_image, post_text)
    if not image_path:
        logging.warning('Gemini image unavailable; posting without media.')
        return []
    return [image_path]


def remember_reply(state, tweet_id):
    if not tweet_id:
        return
    replied = state['replied_tweets']
    replied.append(str(tweet_id))
    if len(replied) > MAX_STORED_TWEETS:
        state['replied_tweets'] = replied[-MAX_STORED_TWEETS:]


async def maybe_like(client, tweet):
    if random.random() < LIKE_RATE:
        ok = await client.like_tweet(tweet)
        if ok:
            logging.info('Liked tweet %s', client._extract_tweet_id(tweet))
        await asyncio.sleep(random.uniform(2, 8))


# ── Daily tracking ──

def today_str():
    return datetime.date.today().isoformat()


def is_commented_today(state, handle):
    return state.get('commented_today', {}).get(handle) == today_str()


def mark_commented_today(state, handle):
    state.setdefault('commented_today', {})[handle] = today_str()


def cleanup_old_comments(state):
    today = today_str()
    old = state.get('commented_today', {})
    state['commented_today'] = {h: d for h, d in old.items() if d == today}


def get_next_account(state):
    idx = state.get('account_index', 0)
    for i in range(len(TARGET_USERS)):
        handle = TARGET_USERS[(idx + i) % len(TARGET_USERS)]
        if not is_commented_today(state, handle):
            state['account_index'] = (idx + i + 1) % len(TARGET_USERS)
            return handle
    return None


# ── POST action ──

async def do_post(client, ai_engine, state):
    post_text = ai_engine.generate_post_text(include_shill=True)
    if not post_text:
        logging.warning('Failed to generate post text')
        return False
    logging.info('Post [%d chars]: %s', len(post_text), post_text)
    media_paths = await build_media_paths(ai_engine, post_text)
    if media_paths:
        logging.info('Attaching media: %s', ', '.join(media_paths))
    tweet_id, error_message = await client.post_tweet(post_text, media_paths=media_paths)
    if tweet_id:
        state['last_post_id'] = tweet_id
        state['last_post_at'] = time.time()
        save_state(state, state['state_path'])
        logging.info('Posted: https://x.com/i/web/status/%s', tweet_id)
        return True
    logging.warning('Post failed: %s', error_message)
    return False


# ── ENGAGE action (comment on one account OR reply to mention) ──

async def do_engage(client, ai_engine, state):
    now = time.time()

    # Separate comment rate-limit check
    comment_rl = state.get('comment_rate_limit_until', 0)
    if now < comment_rl:
        logging.info('Comment rate-limited for %.0f more min', (comment_rl - now) / 60)
        return 'rate_limited'

    # Try deferred comment first (saved from previous 429)
    deferred = state.get('deferred_comment')
    if deferred:
        logging.info('Retrying deferred comment on @%s tweet %s', deferred['handle'], deferred['tweet_id'])
        state['deferred_comment'] = None
        status, reply_id = await client.try_reply(deferred['tweet_id'], deferred['text'])
        if status == '429':
            state['deferred_comment'] = deferred
            state['comment_rate_limit_until'] = now + random.uniform(3600, 5400)
            save_state(state, state['state_path'])
            logging.warning('429 on deferred comment; rate-limited for ~1h')
            return '429'
        if status == 'ok' and reply_id:
            remember_reply(state, deferred['tweet_id'])
            mark_commented_today(state, deferred['handle'])
            state['last_engagement_at'] = now
            save_state(state, state['state_path'])
            logging.info('Deferred comment posted: %s', reply_id)
            return 'commented'
        logging.warning('Deferred comment failed (status=%s); moving on', status)

    # Pick next uncommented account
    handle = get_next_account(state)
    if not handle:
        logging.info('All %d accounts commented today; trying mention reply', len(TARGET_USERS))
        return await _try_mention_reply(client, ai_engine, state)

    logging.info('Checking @%s for new posts', handle)
    await asyncio.sleep(random.uniform(3, 10))

    try:
        tweets = await client.get_latest_tweets(handle, count=5)
    except Exception as exc:
        logging.warning('Failed to fetch tweets for @%s: %s', handle, exc)
        tweets = []

    target_tweet_id = None
    target_text = None

    if tweets:
        for tweet in tweets[:3]:
            tid = client._extract_tweet_id(tweet)
            if not tid or tid in state['replied_tweets']:
                continue
            if client.is_retweet(tweet):
                continue
            text = client.get_tweet_text(tweet)
            if not text:
                continue
            await maybe_like(client, tweet)
            await asyncio.sleep(random.uniform(2, 6))
            if ai_engine.should_micro_reply():
                reply_text = ai_engine.generate_micro_reply()
            else:
                reply_text = ai_engine.generate_sniper_reply(text, handle, include_shill=should_shill())
            if not reply_text:
                continue
            target_tweet_id = tid
            target_text = reply_text
            break

    if target_tweet_id and target_text:
        logging.info('Commenting on @%s tweet %s: %s', handle, target_tweet_id, target_text)
        status, reply_id = await client.try_reply(target_tweet_id, target_text)
        if status == '429':
            state['deferred_comment'] = {
                'handle': handle,
                'tweet_id': target_tweet_id,
                'text': target_text,
            }
            state['comment_rate_limit_until'] = now + random.uniform(3600, 5400)
            save_state(state, state['state_path'])
            logging.warning('429 on comment @%s; deferred to next cycle', handle)
            return '429'
        if status == 'ok' and reply_id:
            remember_reply(state, target_tweet_id)
            mark_commented_today(state, handle)
            state['last_engagement_at'] = now
            save_state(state, state['state_path'])
            logging.info('Comment on @%s posted: %s', handle, reply_id)
            return 'commented'
        logging.warning('Comment on @%s failed (status=%s)', handle, status)
        return 'error'

    logging.info('No fresh post from @%s; trying mention reply', handle)
    return await _try_mention_reply(client, ai_engine, state)


async def _try_mention_reply(client, ai_engine, state):
    try:
        mentions = await client.get_mentions(count=10)
    except Exception as exc:
        logging.warning('Get mentions failed: %s', exc)
        return 'skipped'
    if not mentions:
        logging.info('No mentions to reply to')
        return 'skipped'
    replied_mentions = state.get('replied_mentions', [])
    our_name = (BOT_USERNAME or '').lower().replace('@', '')
    for mention in mentions:
        mention_id = client._extract_tweet_id(mention)
        if not mention_id or mention_id in replied_mentions:
            continue
        reply_to = (getattr(mention, 'in_reply_to_tweet_id', None)
                    or getattr(mention, 'in_reply_to_status_id_str', None))
        if not reply_to:
            continue
        author = getattr(mention, 'user_screen_name', '') or ''
        if author.lower() == our_name:
            continue
        mention_text = client.get_tweet_text(mention)
        if not mention_text:
            continue
        is_wallet = any(kw in mention_text.lower() for kw in WALLET_CHECK_KEYWORDS)
        if is_wallet:
            reply_back = ai_engine.generate_wallet_roast(mention_text)
        else:
            our_text = '[our earlier reply]' if str(reply_to) in state['replied_tweets'] else ''
            reply_back = ai_engine.generate_reply_back(our_text, mention_text)
        if not reply_back:
            continue
        logging.info('Replying to mention %s: %.80s', mention_id, reply_back)
        status, reply_id = await client.try_reply(str(mention_id), reply_back)
        if status == 'ok' and reply_id:
            replied_mentions.append(mention_id)
            if len(replied_mentions) > MAX_STORED_TWEETS:
                replied_mentions = replied_mentions[-MAX_STORED_TWEETS:]
            state['replied_mentions'] = replied_mentions
            state['last_engagement_at'] = time.time()
            save_state(state, state['state_path'])
            logging.info('Mention reply posted: %s', reply_id)
            return 'replied'
        if status == '429':
            logging.warning('429 on mention reply; skipping')
            return '429'
    return 'skipped'


# ── Main loop ──

SLOT_INTERVAL = 2 * 3600   # 2 hours between slots
SLEEP_CHECK = 300           # poll every 5 min


async def main():
    load_dotenv()
    setup_logging()

    parser = argparse.ArgumentParser(description='Identity Prism Twikit bot')
    parser.add_argument('--post-once', action='store_true')
    args = parser.parse_args()

    state = load_state(STATE_PATH)
    state['state_path'] = STATE_PATH
    state.setdefault('replied_tweets', [])
    state.setdefault('replied_mentions', [])
    state.setdefault('commented_today', {})
    state.setdefault('account_index', 0)
    state.setdefault('deferred_comment', None)
    state.setdefault('comment_rate_limit_until', 0)
    state.setdefault('skip_next_engage', False)

    client = TwitterClient()
    try:
        client.load_cookies()
        await client.verify_session()
    except Exception as exc:
        logging.error('Cookie validation failed: %s', exc)
        while True:
            await async_sleep_random(600, 900, reason='waiting for fresh cookies')

    ai_engine = AIEngine()

    if args.post_once:
        post_text = ai_engine.generate_post_text(include_shill=True)
        if not post_text:
            logging.warning('No text generated; aborting.')
            return
        media_paths = await build_media_paths(ai_engine, post_text)
        tweet_id, err = await client.post_tweet(post_text, media_paths=media_paths)
        logging.info('Test post: %s (err=%s)', tweet_id, err)
        return

    # Slot 0 = POST, Slot 1 = ENGAGE; alternating every 2h
    # → posts happen every 4h, engagements every 4h offset by 2h
    slot = state.get('slot', 0)
    last_slot_at = state.get('last_slot_at', 0)

    # On fresh start: don't immediately post — derive timing from last_post_at
    if last_slot_at == 0 and state.get('last_post_at'):
        last_slot_at = state['last_post_at']
        slot = 1  # next action is ENGAGE, not another POST
        state['slot'] = slot
        state['last_slot_at'] = last_slot_at
        save_state(state, state['state_path'])
        logging.info('Resuming from last_post_at=%.0f; next slot=ENGAGE', last_slot_at)

    cleanup_old_comments(state)
    commented_count = sum(1 for d in state['commented_today'].values() if d == today_str())
    logging.info('Bot started. slot=%s, accounts=%d, commented_today=%d',
                 'POST' if slot == 0 else 'ENGAGE', len(TARGET_USERS), commented_count)

    while True:
        now = time.time()
        try:
            cleanup_old_comments(state)

            wait_left = SLOT_INTERVAL - (now - last_slot_at)
            if wait_left > 0:
                slot_name = 'POST' if slot == 0 else 'ENGAGE'
                logging.info('Next %s in %.0f min', slot_name, wait_left / 60)
                await asyncio.sleep(min(wait_left, SLEEP_CHECK) + random.uniform(5, 30))
                continue

            await asyncio.sleep(random.uniform(10, 60))

            if slot == 0:
                # Safety: skip POST if we posted less than 1h ago
                last_post = state.get('last_post_at') or 0
                if time.time() - last_post < 3600:
                    logging.info('=== POST skipped (last post %.0f min ago) ===',
                                 (time.time() - last_post) / 60)
                else:
                    logging.info('=== POST ===')
                    ok = await do_post(client, ai_engine, state)
                    logging.info('Post result: %s', 'OK' if ok else 'FAIL')
            else:
                if state.get('skip_next_engage'):
                    logging.info('=== ENGAGE skipped (previous 429) ===')
                    state['skip_next_engage'] = False
                else:
                    logging.info('=== ENGAGE ===')
                    result = await do_engage(client, ai_engine, state)
                    logging.info('Engage result: %s', result)
                    if result == '429':
                        state['skip_next_engage'] = True
                        logging.warning('Next engage will be skipped due to 429')

        except Exception as exc:
            logging.warning('Cycle error: %s', exc)

        # ALWAYS advance slot after action (or error) — prevents POST spam loops
        # This is outside try/except so it runs after both success and failure,
        # but NOT after 'continue' (waiting branch).
        slot = 1 - slot
        last_slot_at = time.time()
        state['slot'] = slot
        state['last_slot_at'] = last_slot_at
        save_state(state, state['state_path'])

        await asyncio.sleep(random.uniform(30, 90))


if __name__ == '__main__':
    asyncio.run(main())
