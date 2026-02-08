import argparse
import asyncio
import datetime
import logging
import random
import time

from dotenv import load_dotenv

from ai_engine import AIEngine
from config import (
    ACTIVITY_SCHEDULE_UTC,
    BOT_USERNAME,
    ENGAGEMENT_COOLDOWN_SECONDS,
    LIKE_RATE,
    LOOP_SLEEP_RANGE,
    MAX_STORED_TWEETS,
    MENTION_CHECK_INTERVAL,
    MENTION_REPLY_MAX_AGE,
    MIN_POST_INTERVAL_SECONDS,
    POST_RETRY_AUTOMATION_RANGE,
    POST_RETRY_DAILY_RANGE,
    POST_RETRY_ENABLED,
    POST_RETRY_INTERVAL_RANGE,
    POST_HOUR_BLOCK_SECONDS,
    POST_IMAGE_ENABLED,
    POST_IMAGE_RATE,
    RETWEET_RATE,
    SEARCH_QUERIES,
    STATE_PATH,
    SHILL_RATE,
    SNIPER_INTERVAL_RANGE,
    TARGET_USERS,
    TREND_INTERVAL_RANGE,
    WALLET_CHECK_KEYWORDS,
    WARMUP_ACTION_RATE,
    WARMUP_EXTRA_DELAY_RANGE,
    WARMUP_HOURS,
)
from twitter_client import TwitterClient
from utils import async_sleep_random, load_state, save_state, setup_logging


def get_activity_multiplier():
    hour = datetime.datetime.now(datetime.UTC).hour
    for period in ACTIVITY_SCHEDULE_UTC.values():
        if hour in period['hours']:
            return period['multiplier']
    return 0.3


def should_skip_by_schedule():
    mult = get_activity_multiplier()
    return random.random() > mult


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


def is_morning_post(text):
    lower = text.lower()
    return 'gm' in lower or 'good morning' in lower


def remember_reply(state, tweet_id):
    if not tweet_id:
        return
    replied = state['replied_tweets']
    replied.append(tweet_id)
    if len(replied) > MAX_STORED_TWEETS:
        state['replied_tweets'] = replied[-MAX_STORED_TWEETS:]


def is_warmup_active(state):
    started_at = state.get('bot_started_at')
    if not started_at:
        return False
    return (time.time() - started_at) < (WARMUP_HOURS * 3600)


async def maybe_warmup_delay(state, reason):
    if not is_warmup_active(state):
        return
    await async_sleep_random(*WARMUP_EXTRA_DELAY_RANGE, reason=reason)


def should_run_action(state):
    if not is_warmup_active(state):
        return True
    return random.random() < WARMUP_ACTION_RATE


def can_engage_now(state, now):
    last_post_at = state.get('last_post_at')
    if last_post_at and (now - last_post_at) < POST_HOUR_BLOCK_SECONDS:
        logging.info('Post hour active; skipping engagement cycle.')
        return False
    last_engagement_at = state.get('last_engagement_at')
    if last_engagement_at and (now - last_engagement_at) < ENGAGEMENT_COOLDOWN_SECONDS:
        return False
    return True


def can_post_now(state, now):
    last_post_at = state.get('last_post_at')
    if last_post_at and (now - last_post_at) < MIN_POST_INTERVAL_SECONDS:
        return False
    return True


def pick_retry_delay(error_message):
    message = (error_message or '').lower()
    if '226' in message or 'automated' in message:
        return random.uniform(*POST_RETRY_AUTOMATION_RANGE)
    if '344' in message or 'daily limit' in message:
        return random.uniform(*POST_RETRY_DAILY_RANGE)
    if '422' in message or '403' in message or '409' in message:
        return random.uniform(60 * 60, 2 * 60 * 60)
    return random.uniform(*POST_RETRY_INTERVAL_RANGE)


async def maybe_like(client, tweet):
    if random.random() < LIKE_RATE:
        ok = await client.like_tweet(tweet)
        if ok:
            logging.info('Liked tweet %s', client._extract_tweet_id(tweet))
        await asyncio.sleep(random.uniform(2, 8))


async def maybe_retweet(client, tweet):
    if random.random() < RETWEET_RATE:
        ok = await client.retweet(tweet)
        if ok:
            logging.info('Retweeted %s', client._extract_tweet_id(tweet))
        await asyncio.sleep(random.uniform(2, 8))


async def run_sniper(client, ai_engine, state):
    logging.info('Sniper monitor cycle')
    if not should_run_action(state):
        logging.info('Warm-up active; skipping sniper cycle.')
        return
    now = time.time()
    if not can_engage_now(state, now):
        return
    await maybe_warmup_delay(state, 'warmup sniper delay')
    handles = random.sample(TARGET_USERS, min(4, len(TARGET_USERS)))
    replied = False
    for handle in handles:
        tweets = await client.get_latest_tweets(handle, count=5)
        if not tweets:
            continue
        for tweet in tweets[:3]:
            tweet_id = client._extract_tweet_id(tweet)
            if not tweet_id:
                continue
            if tweet == tweets[0]:
                state['last_sniper_seen'][handle] = tweet_id
                await maybe_like(client, tweet)
            if tweet_id in state['replied_tweets']:
                continue
            if client.is_retweet(tweet):
                logging.debug('Skipping retweet %s from @%s', tweet_id, handle)
                continue
            text = client.get_tweet_text(tweet)
            if not text:
                continue
            if ai_engine.should_micro_reply():
                reply = ai_engine.generate_micro_reply()
            else:
                reply = ai_engine.generate_sniper_reply(text, handle, include_shill=should_shill())
            if not reply:
                continue
            logging.info('Sniper replying to %s (@%s): %s', tweet_id, handle, reply)
            reply_id = await client.reply_to_tweet(tweet, reply)
            if reply_id:
                remember_reply(state, tweet_id)
                state['last_engagement_at'] = time.time()
                save_state(state, state['state_path'])
                logging.info('Sniper reply posted: %s', reply_id)
                await async_sleep_random(20, 60, reason='post-sniper cooldown')
                replied = True
            break
        if replied:
            break


async def run_trend(client, ai_engine, state):
    logging.info('Trend surfer cycle')
    if not should_run_action(state):
        logging.info('Warm-up active; skipping trend cycle.')
        return
    now = time.time()
    if not can_engage_now(state, now):
        return
    await maybe_warmup_delay(state, 'warmup trend delay')
    query = random.choice(SEARCH_QUERIES)
    logging.info('Trend query: %s', query)
    tweets = await client.search_tweets(query, count=20)
    if not tweets:
        logging.info('Trend search returned 0 tweets')
        return
    logging.info('Trend search returned %d tweets', len(tweets))
    candidates = sorted(tweets, key=client.get_like_count, reverse=True)[:5]
    for top in candidates:
        tweet_id = client._extract_tweet_id(top)
        if not tweet_id or tweet_id == state.get('last_trend_tweet'):
            continue
        if tweet_id in state['replied_tweets']:
            continue
        if client.is_retweet(top):
            continue
        text = client.get_tweet_text(top)
        if not text:
            continue
        await maybe_like(client, top)
        await maybe_retweet(client, top)
        if ai_engine.should_micro_reply():
            reply = ai_engine.generate_micro_reply()
        else:
            reply = ai_engine.generate_trend_reply(text, '', include_shill=should_shill())
        if not reply:
            continue
        logging.info('Trend replying to %s: %s', tweet_id, reply)
        reply_id = await client.reply_to_tweet(top, reply)
        if reply_id:
            remember_reply(state, tweet_id)
            state['last_trend_tweet'] = tweet_id
            state['last_engagement_at'] = time.time()
            save_state(state, state['state_path'])
            logging.info('Trend reply posted: %s', reply_id)
            await async_sleep_random(30, 90, reason='post-trend cooldown')
        else:
            logging.warning('Trend reply failed for tweet %s', tweet_id)
        break


async def run_post_retry(client, ai_engine, state):
    if not POST_RETRY_ENABLED:
        return
    now = time.time()
    next_retry = state.get('next_post_retry_at') or 0
    if now < next_retry:
        return
    if not can_post_now(state, now):
        last_post_at = state.get('last_post_at') or 0
        next_allowed = now
        if last_post_at:
            next_allowed = max(next_allowed, last_post_at + MIN_POST_INTERVAL_SECONDS)
        state['next_post_retry_at'] = max(next_retry, next_allowed)
        save_state(state, state['state_path'])
        return
    if not should_run_action(state):
        state['next_post_retry_at'] = now + random.uniform(*POST_RETRY_INTERVAL_RANGE)
        save_state(state, state['state_path'])
        logging.info('Warm-up active; skipping post retry.')
        return
    await maybe_warmup_delay(state, 'warmup post delay')
    post_text = ai_engine.generate_post_text(include_shill=True)
    if not post_text:
        state['next_post_retry_at'] = now + random.uniform(*POST_RETRY_INTERVAL_RANGE)
        save_state(state, state['state_path'])
        logging.warning('Post retry failed to generate text.')
        return
    logging.info('Post text [%d chars]: %s', len(post_text), post_text)
    media_paths = await build_media_paths(ai_engine, post_text)
    if media_paths:
        logging.info('Attaching media: %s', ', '.join(media_paths))
    tweet_id, error_message = await client.post_tweet(post_text, media_paths=media_paths)
    if tweet_id:
        state['last_post_id'] = tweet_id
        state['last_post_at'] = now
        delay = random.uniform(*POST_RETRY_INTERVAL_RANGE)
        state['next_post_retry_at'] = now + delay
        save_state(state, state['state_path'])
        logging.info('Post retry success: https://x.com/i/web/status/%s', tweet_id)
        return
    delay = pick_retry_delay(error_message)
    state['next_post_retry_at'] = now + delay
    save_state(state, state['state_path'])
    logging.warning('Post retry failed; next attempt in %.0fs.', delay)


async def run_mentions(client, ai_engine, state):
    now = time.time()
    last_check = state.get('last_mention_check_at') or 0
    if (now - last_check) < MENTION_CHECK_INTERVAL:
        return
    state['last_mention_check_at'] = now
    logging.info('Checking mentions')
    mentions = await client.get_mentions(count=10)
    if not mentions:
        return
    replied_mentions = state.get('replied_mentions', [])
    our_name = (BOT_USERNAME or '').lower().replace('@', '')
    for mention in mentions:
        mention_id = client._extract_tweet_id(mention)
        if not mention_id or mention_id in replied_mentions:
            continue
        reply_to = getattr(mention, 'in_reply_to_tweet_id', None) or getattr(mention, 'in_reply_to_status_id_str', None)
        if not reply_to:
            continue
        author = getattr(mention, 'user_screen_name', '') or ''
        if author.lower() == our_name:
            continue
        mention_text = client.get_tweet_text(mention)
        if not mention_text:
            continue
        mention_lower = mention_text.lower()
        is_wallet_check = any(kw in mention_lower for kw in WALLET_CHECK_KEYWORDS)
        if is_wallet_check:
            reply_back = ai_engine.generate_wallet_roast(mention_text)
            logging.info('Wallet roast for mention %s: %.80s', mention_id, reply_back)
        else:
            our_text = ''
            if str(reply_to) in state['replied_tweets']:
                our_text = '[our earlier reply]'
            reply_back = ai_engine.generate_reply_back(our_text, mention_text)
        if not reply_back:
            continue
        reply_id = await client.reply_to_tweet(mention, reply_back)
        if reply_id:
            replied_mentions.append(mention_id)
            if len(replied_mentions) > MAX_STORED_TWEETS:
                replied_mentions = replied_mentions[-MAX_STORED_TWEETS:]
            state['replied_mentions'] = replied_mentions
            state['last_engagement_at'] = time.time()
            save_state(state, state['state_path'])
            logging.info('Replied to mention %s', mention_id)
            await async_sleep_random(15, 45, reason='post-mention cooldown')
            break


async def main():
    load_dotenv()
    setup_logging()

    parser = argparse.ArgumentParser(description='Identity Prism Twikit bot')
    parser.add_argument('--post-once', action='store_true', help='Send a single test post and exit.')
    args = parser.parse_args()

    state = load_state(STATE_PATH)
    state['state_path'] = STATE_PATH
    state.setdefault('replied_mentions', [])
    state.setdefault('last_mention_check_at', 0)
    if not state.get('bot_started_at'):
        state['bot_started_at'] = time.time()
        save_state(state, state['state_path'])

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
            logging.warning('Failed to generate test post; aborting.')
            return
        media_paths = await build_media_paths(ai_engine, post_text)
        if media_paths:
            logging.info('Attaching media: %s', ', '.join(media_paths))
        tweet_id, error_message = await client.post_tweet(post_text, media_paths=media_paths)
        if tweet_id:
            logging.info('Test post sent: https://x.com/i/web/status/%s', tweet_id)
        else:
            logging.warning('Test post failed to send: %s', error_message)
        return

    # 2h rotation: post -> comment (sniper/trend) -> reply (mentions) -> post ...
    ACTION_CYCLE = ['post', 'comment', 'reply']
    ACTION_INTERVAL = 2 * 3600  # 2 hours between actions
    action_idx = state.get('action_index', 0) % len(ACTION_CYCLE)
    use_trend = state.get('use_trend_next', False)  # alternate sniper/trend for comments

    mult = get_activity_multiplier()
    logging.info('Bot started (2h rotation). Next action: %s, multiplier=%.1f',
                 ACTION_CYCLE[action_idx], mult)

    while True:
        now = time.time()
        try:
            last_action_at = state.get('last_action_at', 0)
            wait_left = ACTION_INTERVAL - (now - last_action_at)

            if wait_left > 0:
                logging.info('Next action "%s" in %.0f min', ACTION_CYCLE[action_idx], wait_left / 60)
                await asyncio.sleep(min(wait_left, 300) + random.uniform(5, 30))
                continue

            action = ACTION_CYCLE[action_idx]
            logging.info('=== Action: %s ===', action)
            did_something = False

            if action == 'post':
                prev_post = state.get('last_post_id')
                await run_post_retry(client, ai_engine, state)
                did_something = state.get('last_post_id') != prev_post

            elif action == 'comment':
                prev_eng = state.get('last_engagement_at', 0)
                if use_trend:
                    await run_trend(client, ai_engine, state)
                else:
                    await run_sniper(client, ai_engine, state)
                did_something = state.get('last_engagement_at', 0) > prev_eng
                use_trend = not use_trend
                state['use_trend_next'] = use_trend

            elif action == 'reply':
                prev_eng = state.get('last_engagement_at', 0)
                await run_mentions(client, ai_engine, state)
                did_something = state.get('last_engagement_at', 0) > prev_eng
                if not did_something:
                    logging.info('No mentions to reply — doing comment instead')
                    if use_trend:
                        await run_trend(client, ai_engine, state)
                    else:
                        await run_sniper(client, ai_engine, state)
                    did_something = state.get('last_engagement_at', 0) > prev_eng
                    use_trend = not use_trend
                    state['use_trend_next'] = use_trend

            if did_something:
                state['last_action_at'] = time.time()
                action_idx = (action_idx + 1) % len(ACTION_CYCLE)
                state['action_index'] = action_idx
                save_state(state, state['state_path'])
                logging.info('Action done. Next: %s in ~2h', ACTION_CYCLE[action_idx])
            else:
                logging.info('Action "%s" had nothing to do — retrying next cycle', action)

        except Exception as exc:
            logging.warning('Cycle error: %s', exc)
        save_state(state, state['state_path'])
        await async_sleep_random(*LOOP_SLEEP_RANGE, reason='idle')


if __name__ == '__main__':
    asyncio.run(main())
