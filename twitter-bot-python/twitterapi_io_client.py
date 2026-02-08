import logging
import time
from typing import List, Optional

import requests


class TwitterApiIoClient:
    def __init__(
        self,
        api_key: str,
        proxy: str,
        username: str,
        email: str,
        password: str,
        totp_secret: str,
        login_cookie: Optional[str] = None,
        timeout: int = 60,
        login_backoff: int = 120,
    ) -> None:
        self.api_key = api_key
        self.proxy = proxy
        self.username = username
        self.email = email
        self.password = password
        self.totp_secret = totp_secret
        self.login_cookie = login_cookie
        self.timeout = timeout
        self.login_backoff = login_backoff
        self.last_login_attempt = 0.0
        self.last_login_error = None
        self.cookie_obtained_at = 0.0
        self.cookie_ttl = 300

    def _headers(self):
        return {
            'X-API-Key': self.api_key,
        }

    def _require_proxy(self):
        if not self.proxy:
            raise RuntimeError('TWITTERAPI_IO_PROXY is required by twitterapi.io.')

    def _handle_response(self, response):
        if response.status_code != 200:
            logging.warning('twitterapi.io HTTP %d — body: %s', response.status_code, response.text[:300])
            response.raise_for_status()
        data = response.json()
        status = str(data.get('status', '')).lower()
        if status not in {'success', 'ok'}:
            raise RuntimeError(f"twitterapi.io error: {data.get('msg') or data.get('message') or data}")
        return data

    def login(self) -> str:
        self._require_proxy()
        if self.last_login_error and (time.time() - self.last_login_attempt) < self.login_backoff:
            raise RuntimeError('twitterapi.io login throttled; wait before retrying.')
        if not all([self.username, self.email, self.password, self.totp_secret]):
            raise RuntimeError('twitterapi.io login requires username, email, password, and TOTP secret.')
        self.last_login_attempt = time.time()
        payload = {
            'user_name': self.username,
            'email': self.email,
            'password': self.password,
            'proxy': self.proxy,
            'totp_secret': self.totp_secret,
        }
        try:
            resp = requests.post(
                'https://api.twitterapi.io/twitter/user_login_v2',
                json=payload,
                headers=self._headers(),
                timeout=self.timeout,
            )
            data = self._handle_response(resp)
        except Exception as exc:
            self.last_login_error = str(exc)
            raise
        self.login_cookie = data.get('login_cookie') or data.get('login_cookies')
        if not self.login_cookie:
            self.last_login_error = data.get('msg') or data.get('message') or data
            raise RuntimeError(
                f"twitterapi.io login failed: {data.get('msg') or data.get('message') or data}"
            )
        self.last_login_error = None
        self.cookie_obtained_at = time.time()
        return self.login_cookie

    def ensure_login(self) -> str:
        if self.login_cookie and (time.time() - self.cookie_obtained_at) < self.cookie_ttl:
            return self.login_cookie
        logging.debug('Cookie expired or missing; re-logging in to twitterapi.io')
        self.login_cookie = None
        self.last_login_error = None
        return self.login()

    def upload_media(self, media_path: str) -> str:
        self._require_proxy()
        self.ensure_login()
        import mimetypes
        mime_type = mimetypes.guess_type(media_path)[0] or 'image/jpeg'
        filename = media_path.rsplit('/', 1)[-1].rsplit('\\', 1)[-1]
        with open(media_path, 'rb') as handle:
            files = {'file': (filename, handle, mime_type)}
            data = {
                'proxy': self.proxy,
                'login_cookies': self.login_cookie,
            }
            resp = requests.post(
                'https://api.twitterapi.io/twitter/upload_media_v2',
                files=files,
                data=data,
                headers=self._headers(),
                timeout=self.timeout,
            )
        data = self._handle_response(resp)
        media_id = data.get('media_id')
        if not media_id:
            raise RuntimeError(f"twitterapi.io upload failed: {data.get('msg') or data}")
        return str(media_id)

    _STALE_COOKIE_HINTS = ('404', 'could not extract', 'login', 'cookie', 'unauthorized')

    def _is_stale_cookie_error(self, error_msg: str) -> bool:
        lower = error_msg.lower()
        return any(hint in lower for hint in self._STALE_COOKIE_HINTS)

    def create_tweet(
        self,
        text: str,
        reply_to_tweet_id: Optional[str] = None,
        media_ids: Optional[List[str]] = None,
    ) -> str:
        self._require_proxy()
        self.ensure_login()
        payload = {
            'login_cookies': self.login_cookie,
            'tweet_text': text,
            'proxy': self.proxy,
            'reply_settings': 'everyone',
        }
        if reply_to_tweet_id:
            payload['reply_to_tweet_id'] = reply_to_tweet_id
        if media_ids:
            payload['media_ids'] = media_ids
        resp = requests.post(
            'https://api.twitterapi.io/twitter/create_tweet_v2',
            json=payload,
            headers=self._headers(),
            timeout=self.timeout,
        )
        data = self._handle_response(resp)
        tweet_id = data.get('tweet_id')
        if not tweet_id:
            logging.warning('create_tweet full response: %s', data)
            raise RuntimeError(f"twitterapi.io error: {data.get('msg') or data.get('message') or data}")
        return str(tweet_id)

    def reply(self, tweet_id: str, text: str) -> str:
        return self.create_tweet(text=text, reply_to_tweet_id=tweet_id)

    def like_tweet(self, tweet_id: str) -> bool:
        self._require_proxy()
        self.ensure_login()
        payload = {
            'login_cookies': self.login_cookie,
            'tweet_id': tweet_id,
            'proxy': self.proxy,
        }
        resp = requests.post(
            'https://api.twitterapi.io/twitter/like_tweet_v2',
            json=payload,
            headers=self._headers(),
            timeout=self.timeout,
        )
        self._handle_response(resp)
        return True

    def retweet(self, tweet_id: str) -> bool:
        self._require_proxy()
        self.ensure_login()
        payload = {
            'login_cookies': self.login_cookie,
            'tweet_id': tweet_id,
            'proxy': self.proxy,
        }
        resp = requests.post(
            'https://api.twitterapi.io/twitter/retweet_v2',
            json=payload,
            headers=self._headers(),
            timeout=self.timeout,
        )
        self._handle_response(resp)
        return True

    def search_tweets(self, query: str, count: int = 20) -> list:
        params = {
            'query': query,
            'queryType': 'Top',
        }
        resp = requests.get(
            'https://api.twitterapi.io/twitter/tweet/advanced_search',
            params=params,
            headers=self._headers(),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        tweets = data.get('tweets') or data.get('data') or []
        return tweets[:count]

    def quote(self, text: str, attachment_url: str) -> str:
        self._require_proxy()
        self.ensure_login()
        payload = {
            'login_cookies': self.login_cookie,
            'tweet_text': text,
            'proxy': self.proxy,
            'attachment_url': attachment_url,
            'reply_settings': 'everyone',
        }
        resp = requests.post(
            'https://api.twitterapi.io/twitter/create_tweet_v2',
            json=payload,
            headers=self._headers(),
            timeout=self.timeout,
        )
        data = self._handle_response(resp)
        tweet_id = data.get('tweet_id')
        if not tweet_id:
            raise RuntimeError(f"twitterapi.io quote failed: {data.get('msg') or data}")
        return str(tweet_id)
