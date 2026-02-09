import asyncio
import json
import logging
import os
import random
import time

from twikit import Client

from config import (
    BOT_USERNAME,
    COOKIES_PATH,
    MEDIA_UPLOAD_RETRIES,
    MEDIA_UPLOAD_RETRY_DELAY,
    RATE_LIMIT_BACKOFF_RANGE,
    TWITTER_LANG,
    TWITTERAPI_IO_API_KEY,
    TWITTERAPI_IO_EMAIL,
    TWITTERAPI_IO_LOGIN_COOKIE,
    TWITTERAPI_IO_PASSWORD,
    TWITTERAPI_IO_PROXIES,
    TWITTERAPI_IO_PROXY,
    TWITTERAPI_IO_TIMEOUT,
    TWITTERAPI_IO_TOTP_SECRET,
    TWITTERAPI_IO_USERNAME,
    USE_TWITTERAPI_IO,
)
from twitterapi_io_client import TwitterApiIoClient
from utils import async_sleep_random, is_rate_limit_error


class TwitterClient:
    """twikit = read-only (search, get tweets, mentions).
    twitterapi.io = ALL writes (reply, post, like, retweet, media upload)."""

    def __init__(self, cookies_path=COOKIES_PATH):
        self.cookies_path = cookies_path
        self.client = Client(language=TWITTER_LANG)
        self.rate_limit_until = 0
        self.api_client = None
        self.api_proxies = []
        if USE_TWITTERAPI_IO:
            if TWITTERAPI_IO_PROXIES:
                self.api_proxies = TWITTERAPI_IO_PROXIES
            elif TWITTERAPI_IO_PROXY:
                self.api_proxies = [TWITTERAPI_IO_PROXY]
            if not TWITTERAPI_IO_API_KEY:
                raise RuntimeError('TWITTERAPI_IO_API_KEY is required when USE_TWITTERAPI_IO=true')
            if not self.api_proxies:
                raise RuntimeError('TWITTERAPI_IO_PROXY or TWITTERAPI_IO_PROXIES is required when USE_TWITTERAPI_IO=true')
            if not all([TWITTERAPI_IO_USERNAME, TWITTERAPI_IO_EMAIL, TWITTERAPI_IO_PASSWORD, TWITTERAPI_IO_TOTP_SECRET]):
                raise RuntimeError('TWITTERAPI_IO_* login credentials are required when USE_TWITTERAPI_IO=true')
            self.api_client = TwitterApiIoClient(
                api_key=TWITTERAPI_IO_API_KEY,
                proxies=self.api_proxies,
                username=TWITTERAPI_IO_USERNAME,
                email=TWITTERAPI_IO_EMAIL,
                password=TWITTERAPI_IO_PASSWORD,
                totp_secret=TWITTERAPI_IO_TOTP_SECRET,
                login_cookie=TWITTERAPI_IO_LOGIN_COOKIE or None,
                timeout=TWITTERAPI_IO_TIMEOUT,
            )

    def _rotate_api_proxy(self):
        if self.api_client:
            self.api_client.rotate_proxy()

    def _require_api_client(self):
        if not self.api_client:
            raise RuntimeError('twitterapi.io client not configured; cannot perform write operations.')

    def load_cookies(self):
        if not os.path.exists(self.cookies_path):
            raise FileNotFoundError(f'cookies.json not found at {self.cookies_path}')
        with open(self.cookies_path, 'r', encoding='utf-8') as handle:
            raw = json.load(handle)
        if isinstance(raw, list):
            cookies = {item['name']: item['value'] for item in raw if 'name' in item and 'value' in item}
        elif isinstance(raw, dict):
            cookies = raw
        else:
            raise ValueError('cookies.json format not recognized')
        self.client.set_cookies(cookies)

    async def verify_session(self):
        if BOT_USERNAME:
            try:
                await self.client.get_user_by_screen_name(BOT_USERNAME)
                return
            except Exception as exc:
                message = str(exc).lower()
                if any(token in message for token in ['401', '403', 'unauthorized', 'forbidden']):
                    raise RuntimeError('Cookies invalid or expired. Refresh cookies.json.') from exc
                logging.warning('Cookie verification via handle failed: %s', exc)
                return
        try:
            await self.client.user_id()
        except Exception as exc:
            logging.warning('Cookie verification failed: %s', exc)
            raise RuntimeError('Cookies invalid or expired. Refresh cookies.json.') from exc

    async def wait_if_rate_limited(self):
        if time.time() < self.rate_limit_until:
            await async_sleep_random(180, 360, reason='rate-limit backoff')

    def mark_rate_limited(self):
        cooldown = random.uniform(*RATE_LIMIT_BACKOFF_RANGE)
        self.rate_limit_until = time.time() + cooldown
        logging.warning('Rate limit detected; backing off for %.0f seconds.', cooldown)

    def _extract_tweet_id(self, tweet):
        for key in ['id', 'id_str', 'tweet_id']:
            value = getattr(tweet, key, None)
            if value:
                return str(value)
        return None

    def _extract_text(self, tweet):
        for key in ['text', 'full_text']:
            value = getattr(tweet, key, None)
            if value:
                return value
        return ''

    # ── READ operations (twikit, with twitterapi.io search fallback) ──

    async def get_latest_tweets(self, username, count=5):
        await self.wait_if_rate_limited()
        try:
            handle = username.replace('@', '')
            user = await self.client.get_user_by_screen_name(handle)
            tweets = await user.get_tweets('Tweets', count=count)
            return tweets or []
        except Exception as exc:
            if is_rate_limit_error(exc):
                self.mark_rate_limited()
            logging.warning('Failed to fetch tweets for %s: %s', username, exc)
            return []

    async def search_tweets(self, query, count=20):
        await self.wait_if_rate_limited()
        try:
            results = await self.client.search_tweet(query, product='Top', count=count)
            if hasattr(results, 'tweets'):
                return results.tweets
            return results or []
        except Exception as exc:
            if is_rate_limit_error(exc):
                self.mark_rate_limited()
            logging.warning('Search failed (twikit): %s; trying twitterapi.io fallback', exc)
        if self.api_client:
            self._rotate_api_proxy()
            try:
                raw = await asyncio.to_thread(self.api_client.search_tweets, query, count)
                return self._wrap_api_tweets(raw)
            except Exception as exc2:
                logging.warning('Search fallback failed (twitterapi.io): %s', exc2)
        return []

    async def get_mentions(self, count=20):
        await self.wait_if_rate_limited()
        try:
            notifs = await self.client.get_notifications('Mentions', count=count)
            if hasattr(notifs, 'tweets'):
                return notifs.tweets or []
            return notifs or []
        except Exception as exc:
            logging.warning('Get mentions failed: %s', exc)
            return []

    def _wrap_api_tweets(self, raw_tweets):
        wrapped = []
        for item in raw_tweets:
            if isinstance(item, dict):
                wrapped.append(_DictTweet(item))
            else:
                wrapped.append(item)
        return wrapped

    # ── WRITE operations (twitterapi.io ONLY) ──

    async def reply_to_tweet(self, tweet, text):
        self._require_api_client()
        tweet_id = self._extract_tweet_id(tweet)
        if not tweet_id:
            return None
        try:
            reply_id = await asyncio.to_thread(self.api_client.reply, tweet_id, text)
            return reply_id
        except Exception as exc:
            logging.warning('Reply failed (twitterapi.io): %s', exc)
            return None

    async def try_reply(self, tweet_id: str, text: str):
        """Reply returning (status, reply_id). status: 'ok', '429', 'error'."""
        self._require_api_client()
        try:
            reply_id = await asyncio.to_thread(self.api_client.reply, tweet_id, text)
            if reply_id is None:
                # Reply likely created but no ID; treat as success
                logging.warning('Reply likely created but no reply_id returned')
                return 'ok', 'unknown'
            return 'ok', reply_id
        except Exception as exc:
            if '429' in str(exc):
                return '429', None
            logging.warning('Reply error: %s', exc)
            return 'error', None

    async def upload_media(self, media_path):
        self._require_api_client()
        for attempt in range(1, MEDIA_UPLOAD_RETRIES + 1):
            self._rotate_api_proxy()
            try:
                result = await asyncio.to_thread(self.api_client.upload_media, media_path)
                return result
            except Exception as exc:
                logging.warning('Media upload attempt %d/%d failed (twitterapi.io): %s', attempt, MEDIA_UPLOAD_RETRIES, exc)
                if attempt < MEDIA_UPLOAD_RETRIES:
                    await asyncio.sleep(MEDIA_UPLOAD_RETRY_DELAY)
        return None

    async def post_tweet(self, text, media_paths=None):
        self._require_api_client()
        media_ids = []
        if media_paths:
            for media_path in media_paths:
                media_id = await self.upload_media(media_path)
                if media_id:
                    media_ids.append(media_id)
            if not media_ids:
                logging.warning('All media uploads failed; posting text-only.')
        try:
            tweet_id = await asyncio.to_thread(
                self.api_client.create_tweet,
                text,
                None,
                media_ids or None,
            )
            if tweet_id is None:
                logging.warning('Post likely created but no tweet_id returned; treating as success')
                return 'unknown', None
            return tweet_id, None
        except Exception as exc:
            if media_ids:
                logging.warning('Post with media failed (%s); retrying text-only', exc)
                try:
                    tweet_id = await asyncio.to_thread(
                        self.api_client.create_tweet,
                        text,
                        None,
                        None,
                    )
                    if tweet_id is None:
                        logging.warning('Text-only post likely created but no tweet_id; treating as success')
                        return 'unknown', None
                    return tweet_id, None
                except Exception as exc2:
                    logging.warning('Text-only fallback also failed: %s', exc2)
                    return None, str(exc2)
            logging.warning('Post failed (twitterapi.io): %s', exc)
            return None, str(exc)

    async def like_tweet(self, tweet):
        tweet_id = self._extract_tweet_id(tweet)
        if not tweet_id:
            return False
        if not self.api_client:
            return False
        try:
            await asyncio.to_thread(self.api_client.like_tweet, tweet_id)
            return True
        except Exception as exc:
            logging.warning('Like failed (twitterapi.io): %s', exc)
            return False

    async def retweet(self, tweet):
        tweet_id = self._extract_tweet_id(tweet)
        if not tweet_id:
            return False
        if not self.api_client:
            return False
        try:
            await asyncio.to_thread(self.api_client.retweet, tweet_id)
            return True
        except Exception as exc:
            logging.warning('Retweet failed (twitterapi.io): %s', exc)
            return False

    # ── Helpers ──

    def get_tweet_text(self, tweet):
        return self._extract_text(tweet)

    def get_like_count(self, tweet):
        for key in ['favorite_count', 'like_count', 'likes', 'favorite']:
            value = getattr(tweet, key, None)
            if isinstance(value, (int, float)):
                return value
        return 0

    def is_retweet(self, tweet):
        return bool(getattr(tweet, 'retweeted_tweet', None)) or self._extract_text(tweet).startswith('RT @')


class _DictTweet:
    def __init__(self, data):
        self._data = data
        self.id = str(data.get('id') or data.get('id_str') or data.get('tweet_id') or '')
        self.text = data.get('text') or data.get('full_text') or ''
        self.favorite_count = data.get('favorite_count') or data.get('likes') or 0
        self.retweeted_tweet = data.get('retweeted_tweet')
        author = data.get('author') or data.get('user') or {}
        self.user_screen_name = author.get('screen_name') or author.get('userName') or ''
        self.in_reply_to_tweet_id = data.get('in_reply_to_status_id_str') or data.get('in_reply_to_tweet_id') or None

    def __getattr__(self, name):
        return self._data.get(name)
