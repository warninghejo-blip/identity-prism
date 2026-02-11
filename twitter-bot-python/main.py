import argparse
import asyncio
import datetime
import logging
import random
import re
import time

from curl_cffi import requests as cffi_requests
from dotenv import load_dotenv

from ai_engine import AIEngine
from config import (
    ACTION_WEIGHTS,
    ACTIVE_HOURS_UTC,
    BOT_USERNAME,
    CTA_DOMAIN,
    LIKE_RATE,
    MAX_STORED_TWEETS,
    PEAK_HOURS_UTC,
    POST_IMAGE_ENABLED,
    POST_IMAGE_RATE,
    STATE_PATH,
    SEARCH_QUERIES,
    SHILL_RATE,
    TARGET_USERS,
    TREND_QUERIES,
    WALLET_CHECK_KEYWORDS,
)
from twitter_client import TwitterClient
from utils import async_sleep_random, load_state, save_state, setup_logging

REPUTATION_API_URL = f'https://{CTA_DOMAIN}/api/reputation'
_SOLANA_ADDR_RE = re.compile(r'\b[1-9A-HJ-NP-Za-km-z]{32,44}\b')

TIER_EMOJI = {
    'mercury': '☿️', 'mars': '🔴', 'venus': '🌋', 'earth': '🌍',
    'neptune': '🔵', 'uranus': '💎', 'saturn': '🪐', 'jupiter': '🟠',
    'sun': '☀️', 'binary_sun': '🌟🌟',
}


def _extract_solana_addresses(text):
    """Find Solana-like base58 addresses in text."""
    candidates = _SOLANA_ADDR_RE.findall(text)
    # Filter out common English words and short tokens
    return [c for c in candidates if len(c) >= 32 and not c.isalpha()]


def _fetch_reputation(address):
    """Call our Reputation API and return dict or None."""
    try:
        resp = cffi_requests.get(
            REPUTATION_API_URL,
            params={'address': address},
            impersonate='chrome131',
            timeout=15,
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception as exc:
        logging.warning('Reputation API call failed for %s: %s', address[:8], exc)
    return None


def _format_reputation_reply(data, address):
    """Format reputation data into a tweet reply."""
    score = data.get('score', 0)
    tier = data.get('tier', 'mercury')
    badges = data.get('badges', [])
    stats = data.get('stats', {})
    emoji = TIER_EMOJI.get(tier, '🌑')
    badge_str = ', '.join(badges) if badges else 'none yet'
    short_addr = f'{address[:4]}...{address[-4:]}'
    lines = [
        f'{emoji} Wallet {short_addr} — Reputation Score: {score}/1400',
        f'Tier: {tier.replace("_", " ").title()} {emoji}',
        f'Badges: {badge_str}',
        f'SOL: {stats.get("solBalance", 0)} | Txns: {stats.get("txCount", 0)} | NFTs: {stats.get("nftCount", 0)} | Age: {stats.get("walletAgeDays", 0)}d',
        f'',
        f'Full card: https://{CTA_DOMAIN}/?address={address}',
    ]
    return '\n'.join(lines)


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
            state['comment_rate_limit_until'] = now + random.uniform(7200, 10800)
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
            state['comment_rate_limit_until'] = now + random.uniform(7200, 10800)
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
        author = getattr(mention, 'user_screen_name', '') or ''
        if author.lower() == our_name:
            continue
        mention_text = client.get_tweet_text(mention)
        if not mention_text:
            continue

        # --- Wallet address auto-reply (Reputation API) ---
        addresses = _extract_solana_addresses(mention_text)
        if addresses:
            addr = addresses[0]
            logging.info('Wallet address detected in mention %s: %s', mention_id, addr[:8])
            rep = await asyncio.to_thread(_fetch_reputation, addr)
            if rep and 'score' in rep:
                reply_back = _format_reputation_reply(rep, addr)
                logging.info('Reputation reply for %s: score=%d tier=%s', addr[:8], rep['score'], rep.get('tier'))
            else:
                reply_back = ai_engine.generate_wallet_roast(mention_text)
        elif any(kw in mention_text.lower() for kw in WALLET_CHECK_KEYWORDS):
            reply_back = ai_engine.generate_wallet_roast(mention_text)
        else:
            reply_to = (getattr(mention, 'in_reply_to_tweet_id', None)
                        or getattr(mention, 'in_reply_to_status_id_str', None))
            if not reply_to:
                continue
            our_text = '[our earlier reply]' if str(reply_to) in state['replied_tweets'] else ''
            reply_back = ai_engine.generate_reply_back(our_text, mention_text)

        if not reply_back:
            continue
        logging.info('Replying to mention %s: %.120s', mention_id, reply_back)
        status, reply_id = await client.try_reply(str(mention_id), reply_back)
        if status == 'ok' and reply_id:
            replied_mentions.append(mention_id)
            if len(replied_mentions) > MAX_STORED_TWEETS:
                replied_mentions = replied_mentions[-MAX_STORED_TWEETS:]
            state['replied_mentions'] = replied_mentions
            state['last_engagement_at'] = time.time()
            _track_action(state, 'wallet_check' if addresses else 'mention_reply')
            save_state(state, state['state_path'])
            logging.info('Mention reply posted: %s', reply_id)
            return 'replied'
        if status == '429':
            logging.warning('429 on mention reply; skipping')
            return '429'
    return 'skipped'


# ── Main loop ──

SLOT_INTERVAL_MIN = 3600    # minimum 1 hour between actions
SLOT_INTERVAL_MAX = 5400    # up to 1.5 hours
SLEEP_CHECK = 300           # poll every 5 min
POST_COOLDOWN_MIN = 14400   # minimum 4 hours between ANY write action
POST_COOLDOWN_MAX = 18000   # up to 5 hours
MAX_POSTS_PER_DAY = 5       # total write actions (posts + threads + trends + quotes)
MAX_ENGAGEMENTS_PER_DAY = 12


def _pick_action(state):
    """Weighted random action selection from ACTION_WEIGHTS."""
    weights = dict(ACTION_WEIGHTS)
    # Reduce thread weight if we already did one today
    if state.get('daily_threads', 0) >= 2:
        weights['thread'] = 0
    # Reduce quote if already done 3 today
    if state.get('daily_quotes', 0) >= 3:
        weights['quote'] = 0
    total = sum(weights.values())
    if total == 0:
        return 'engage'
    r = random.uniform(0, total)
    cumulative = 0
    for action, w in weights.items():
        cumulative += w
        if r <= cumulative:
            return action
    return 'engage'


def _is_peak_hour():
    return datetime.datetime.now(datetime.UTC).hour in PEAK_HOURS_UTC


def _is_active_hour():
    return datetime.datetime.now(datetime.UTC).hour in ACTIVE_HOURS_UTC


# ── Thread action ──

async def do_thread(client, ai_engine, state):
    tweets = ai_engine.generate_thread(include_shill=should_shill())
    if not tweets:
        logging.warning('Thread generation failed')
        return False
    media_paths = await build_media_paths(ai_engine, tweets[0])
    logging.info('Thread [%d tweets]: %s ...', len(tweets), tweets[0][:80])
    results = await client.post_thread(tweets, media_paths=media_paths)
    if results and results[0][0]:
        state['last_post_at'] = time.time()
        state['last_post_id'] = results[0][0]
        state['daily_threads'] = state.get('daily_threads', 0) + 1
        _track_action(state, 'thread')
        save_state(state, state['state_path'])
        logging.info('Thread posted: %s', results[0][0])
        return True
    return False


# ── Trend post action ──

async def do_trend_post(client, ai_engine, state):
    query = random.choice(TREND_QUERIES)
    try:
        tweets = await client.search_tweets(query, count=10)
    except Exception as exc:
        logging.warning('Trend search failed: %s', exc)
        return False
    if not tweets:
        logging.info('No trending tweets found for: %s', query)
        return False
    # Pick a popular tweet we haven't reacted to
    reacted = set(state.get('reacted_trend_ids', []))
    for tweet in tweets:
        tid = client._extract_tweet_id(tweet)
        if not tid or tid in reacted:
            continue
        text = client.get_tweet_text(tweet)
        user = getattr(tweet, 'user_screen_name', '') or 'anon'
        if not text or len(text) < 30:
            continue
        post_text = ai_engine.generate_trend_post(text, user, include_shill=should_shill())
        if not post_text:
            continue
        media_paths = await build_media_paths(ai_engine, post_text)
        tweet_id, err = await client.post_tweet(post_text, media_paths=media_paths)
        if tweet_id:
            reacted.add(tid)
            state['reacted_trend_ids'] = list(reacted)[-200:]
            state['last_post_at'] = time.time()
            state['last_post_id'] = tweet_id
            _track_action(state, 'trend_post')
            save_state(state, state['state_path'])
            logging.info('Trend post: %s (inspired by %s)', tweet_id, tid)
            return True
        logging.warning('Trend post failed: %s', err)
        return False
    logging.info('No fresh trend tweets to react to')
    return False


# ── Quote tweet action ──

async def do_quote(client, ai_engine, state):
    query = random.choice(SEARCH_QUERIES)
    try:
        tweets = await client.search_tweets(query, count=10)
    except Exception as exc:
        logging.warning('Quote search failed: %s', exc)
        return False
    if not tweets:
        return False
    quoted = set(state.get('quoted_tweet_ids', []))
    for tweet in tweets:
        tid = client._extract_tweet_id(tweet)
        if not tid or tid in quoted:
            continue
        text = client.get_tweet_text(tweet)
        user = getattr(tweet, 'user_screen_name', '') or 'anon'
        if not text or len(text) < 30:
            continue
        likes = client.get_like_count(tweet)
        if likes < 5:
            continue
        quote_text = ai_engine.generate_quote_text(text, user, include_shill=should_shill())
        if not quote_text:
            continue
        tweet_url = f'https://x.com/{user}/status/{tid}'
        qt_id, err = await client.quote_tweet(quote_text, tweet_url)
        if qt_id:
            quoted.add(tid)
            state['quoted_tweet_ids'] = list(quoted)[-200:]
            state['last_post_at'] = time.time()
            state['daily_quotes'] = state.get('daily_quotes', 0) + 1
            _track_action(state, 'quote')
            save_state(state, state['state_path'])
            logging.info('Quote tweet: %s (quoted %s)', qt_id, tid)
            return True
        logging.warning('Quote tweet failed: %s', err)
        return False
    return False


# ── Engagement tracking ──

def _track_action(state, action_type):
    stats = state.setdefault('action_stats', {})
    today = today_str()
    day_stats = stats.setdefault(today, {})
    day_stats[action_type] = day_stats.get(action_type, 0) + 1
    # Prune old days (keep 7)
    all_days = sorted(stats.keys())
    while len(all_days) > 7:
        del stats[all_days.pop(0)]


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
    state.setdefault('daily_posts', 0)
    state.setdefault('daily_engagements', 0)
    state.setdefault('daily_threads', 0)
    state.setdefault('daily_quotes', 0)
    state.setdefault('daily_reset_date', today_str())
    state.setdefault('reacted_trend_ids', [])
    state.setdefault('quoted_tweet_ids', [])
    state.setdefault('action_stats', {})

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

    def reset_daily_counters_if_needed():
        if state.get('daily_reset_date') != today_str():
            state['daily_posts'] = 0
            state['daily_engagements'] = 0
            state['daily_threads'] = 0
            state['daily_quotes'] = 0
            state['daily_reset_date'] = today_str()
            logging.info('Daily counters reset')

    last_action_at = state.get('last_slot_at', 0)

    # On fresh start: don't immediately act
    if last_action_at == 0 and state.get('last_post_at'):
        last_action_at = state['last_post_at']
        state['last_slot_at'] = last_action_at
        save_state(state, state['state_path'])
        logging.info('Resuming from last_post_at=%.0f', last_action_at)

    cleanup_old_comments(state)
    commented_count = sum(1 for d in state['commented_today'].values() if d == today_str())
    logging.info('Bot started. accounts=%d, commented_today=%d, stats=%s',
                 len(TARGET_USERS), commented_count,
                 state.get('action_stats', {}).get(today_str(), {}))

    while True:
        now = time.time()
        try:
            cleanup_old_comments(state)

            slot_interval = random.uniform(SLOT_INTERVAL_MIN, SLOT_INTERVAL_MAX)
            # During quiet hours, increase interval
            if not _is_active_hour():
                slot_interval *= 1.5

            wait_left = slot_interval - (now - last_action_at)
            if wait_left > 0:
                logging.info('Next action in %.0f min', wait_left / 60)
                await asyncio.sleep(min(wait_left, SLEEP_CHECK) + random.uniform(5, 30))
                continue

            # Pre-action jitter
            await asyncio.sleep(random.uniform(15, 90))

            reset_daily_counters_if_needed()

            # Pick action
            action = _pick_action(state)
            total_writes = state.get('daily_posts', 0)

            # Enforce 4h+ cooldown for ALL write actions
            last_post = state.get('last_post_at') or 0
            post_cooldown = random.uniform(POST_COOLDOWN_MIN, POST_COOLDOWN_MAX)
            since_last_post = time.time() - last_post
            write_on_cooldown = since_last_post < post_cooldown

            # If write action picked but on cooldown → force engage instead
            if action != 'engage' and write_on_cooldown:
                logging.info('=== %s → ENGAGE (post cooldown: %.0f min left) ===',
                             action.upper(), (post_cooldown - since_last_post) / 60)
                action = 'engage'

            if action == 'engage':
                if state.get('skip_next_engage'):
                    logging.info('=== ENGAGE skipped (previous 429) ===')
                    state['skip_next_engage'] = False
                elif state.get('daily_engagements', 0) >= MAX_ENGAGEMENTS_PER_DAY:
                    logging.info('=== ENGAGE skipped (daily cap %d/%d) ===',
                                 state['daily_engagements'], MAX_ENGAGEMENTS_PER_DAY)
                else:
                    logging.info('=== ENGAGE ===')
                    result = await do_engage(client, ai_engine, state)
                    logging.info('Engage result: %s', result)
                    if result in ('commented', 'replied'):
                        state['daily_engagements'] = state.get('daily_engagements', 0) + 1
                        _track_action(state, 'engage')
                    if result == '429':
                        state['skip_next_engage'] = True

            elif total_writes >= MAX_POSTS_PER_DAY:
                logging.info('=== %s skipped (daily write cap %d/%d) ===',
                             action.upper(), total_writes, MAX_POSTS_PER_DAY)

            elif action == 'thread':
                logging.info('=== THREAD ===')
                ok = await do_thread(client, ai_engine, state)
                logging.info('Thread result: %s', 'OK' if ok else 'FAIL')
                if ok:
                    state['daily_posts'] = total_writes + 1

            elif action == 'trend_post':
                logging.info('=== TREND POST ===')
                ok = await do_trend_post(client, ai_engine, state)
                logging.info('Trend post result: %s', 'OK' if ok else 'FAIL')
                if ok:
                    state['daily_posts'] = total_writes + 1

            elif action == 'quote':
                logging.info('=== QUOTE ===')
                ok = await do_quote(client, ai_engine, state)
                logging.info('Quote result: %s', 'OK' if ok else 'FAIL')
                if ok:
                    state['daily_posts'] = total_writes + 1

            else:  # 'post'
                logging.info('=== POST ===')
                ok = await do_post(client, ai_engine, state)
                logging.info('Post result: %s', 'OK' if ok else 'FAIL')
                if ok:
                    state['daily_posts'] = total_writes + 1
                    _track_action(state, 'post')

        except Exception as exc:
            logging.warning('Cycle error: %s', exc)

        last_action_at = time.time()
        state['last_slot_at'] = last_action_at
        save_state(state, state['state_path'])

        await asyncio.sleep(random.uniform(30, 90))


if __name__ == '__main__':
    _backoff = 5
    while True:
        try:
            asyncio.run(main())
        except KeyboardInterrupt:
            break
        except Exception as exc:
            logging.error('FATAL: %s', exc, exc_info=True)
        logging.warning('Bot exited — restarting in %ds', _backoff)
        time.sleep(_backoff)
        _backoff = min(_backoff * 2, 300)
