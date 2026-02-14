"""Official Twitter API v2 client using tweepy.
Primary client for all write operations (post, reply, like, retweet, media upload).
"""

import logging
import os

import tweepy

from config import (
    TWITTER_ACCESS_TOKEN,
    TWITTER_ACCESS_TOKEN_SECRET,
    TWITTER_CONSUMER_KEY,
    TWITTER_CONSUMER_SECRET,
)


def is_configured() -> bool:
    return all([TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET,
                TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET])


class OfficialTwitterClient:
    def __init__(self):
        if not is_configured():
            raise RuntimeError('Official Twitter API credentials not set in env')

        # v1.1 auth (needed for media upload)
        self.auth = tweepy.OAuth1UserHandler(
            TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET,
            TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET,
        )
        self.api_v1 = tweepy.API(self.auth, wait_on_rate_limit=True)

        # v2 client (for tweets, likes, retweets)
        self.client = tweepy.Client(
            consumer_key=TWITTER_CONSUMER_KEY,
            consumer_secret=TWITTER_CONSUMER_SECRET,
            access_token=TWITTER_ACCESS_TOKEN,
            access_token_secret=TWITTER_ACCESS_TOKEN_SECRET,
            wait_on_rate_limit=True,
        )
        logging.info('Official Twitter API client initialized')

    # ── Media ──

    def upload_media(self, file_path: str) -> str | None:
        try:
            media = self.api_v1.media_upload(filename=file_path)
            media_id = str(media.media_id)
            logging.info('Official API: media uploaded -> %s', media_id)
            return media_id
        except Exception as exc:
            logging.warning('Official API media upload failed: %s', exc)
            return None

    # ── Tweet ──

    def create_tweet(self, text: str, reply_to: str | None = None,
                     media_ids: list[str] | None = None,
                     quote_tweet_id: str | None = None) -> str | None:
        kwargs = {'text': text}
        if reply_to:
            kwargs['in_reply_to_tweet_id'] = reply_to
        if media_ids:
            kwargs['media_ids'] = media_ids
        if quote_tweet_id:
            kwargs['quote_tweet_id'] = quote_tweet_id
        try:
            resp = self.client.create_tweet(**kwargs)
            tweet_id = str(resp.data['id'])
            logging.info('Official API: tweet created -> %s', tweet_id)
            return tweet_id
        except Exception as exc:
            logging.warning('Official API create_tweet failed: %s', exc)
            raise

    # ── Reply ──

    def reply(self, tweet_id: str, text: str) -> str | None:
        return self.create_tweet(text, reply_to=tweet_id)

    # ── Like ──

    def like_tweet(self, tweet_id: str) -> bool:
        try:
            self.client.like(tweet_id)
            logging.info('Official API: liked tweet %s', tweet_id)
            return True
        except Exception as exc:
            logging.warning('Official API like failed: %s', exc)
            return False

    # ── Retweet ──

    def retweet(self, tweet_id: str) -> bool:
        try:
            self.client.retweet(tweet_id)
            logging.info('Official API: retweeted %s', tweet_id)
            return True
        except Exception as exc:
            logging.warning('Official API retweet failed: %s', exc)
            return False

    # ── Quote ──

    def quote(self, text: str, tweet_url: str, media_ids: list[str] | None = None) -> str | None:
        # Extract tweet ID from URL
        quote_id = tweet_url.rstrip('/').split('/')[-1].split('?')[0]
        return self.create_tweet(text, media_ids=media_ids, quote_tweet_id=quote_id)
