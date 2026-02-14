import logging
import random
import time
from typing import List, Optional

from curl_cffi import requests as cffi_requests


class TwitterApiIoClient:
    _RATE_LIMIT_BACKOFFS = [120, 300, 900, 1800]  # escalating 429 waits (2m → 5m → 15m → 30m)

    def __init__(
        self,
        api_key: str,
        proxies: List[str],
        username: str,
        email: str,
        password: str,
        totp_secret: str,
        login_cookie: Optional[str] = None,
        timeout: int = 60,
    ) -> None:
        self.api_key = api_key
        self.proxies = proxies or []
        self.proxy_index = 0
        self.proxy = self.proxies[0] if self.proxies else ''
        self.username = username
        self.email = email
        self.password = password
        self.totp_secret = totp_secret
        self.login_cookie = login_cookie
        self.timeout = timeout
        self.cookie_obtained_at = 0.0
        self.cookie_proxy_index = -1  # which proxy the cookie was created with
        self.cookie_ttl = 240
        self._consecutive_429 = 0
        self._rate_limited_until = 0.0

    def rotate_proxy(self):
        if len(self.proxies) <= 1:
            return
        self.proxy_index = (self.proxy_index + 1) % len(self.proxies)
        self.proxy = self.proxies[self.proxy_index]
        logging.info('Rotated to proxy #%d', self.proxy_index)

    def _headers(self):
        return {'X-API-Key': self.api_key}

    def _require_proxy(self):
        if not self.proxy:
            raise RuntimeError('TWITTERAPI_IO_PROXY is required by twitterapi.io.')

    def _is_429(self, response=None, exc=None):
        if response is not None and response.status_code == 429:
            return True
        if exc and '429' in str(exc):
            return True
        return False

    def _handle_429_backoff(self):
        idx = min(self._consecutive_429, len(self._RATE_LIMIT_BACKOFFS) - 1)
        wait = self._RATE_LIMIT_BACKOFFS[idx]
        self._consecutive_429 += 1
        self._rate_limited_until = time.time() + wait
        self.rotate_proxy()
        logging.warning('429 rate limit (#%d); backing off %ds, rotated proxy', self._consecutive_429, wait)

    def _wait_if_rate_limited(self):
        now = time.time()
        if now < self._rate_limited_until:
            wait = self._rate_limited_until - now
            logging.info('Rate-limit cooldown: sleeping %.0fs', wait)
            time.sleep(wait)
        # Human-like jitter before every API call
        time.sleep(random.uniform(1.5, 5.0))

    def _handle_response(self, response):
        if self._is_429(response=response):
            self._handle_429_backoff()
            raise RuntimeError('twitterapi.io 429 rate limit')
        if response.status_code != 200:
            logging.warning('twitterapi.io HTTP %d — body: %s', response.status_code, response.text[:300])
            response.raise_for_status()
        data = response.json()
        status = str(data.get('status', '')).lower()
        if status not in {'success', 'ok'}:
            raise RuntimeError(f"twitterapi.io error: {data.get('msg') or data.get('message') or data}")
        self._consecutive_429 = 0  # reset on success
        return data

    def login(self) -> str:
        self._require_proxy()
        if not all([self.username, self.email, self.password, self.totp_secret]):
            raise RuntimeError('twitterapi.io login requires username, email, password, and TOTP secret.')
        # Try each proxy once for login
        errors = []
        proxies_to_try = len(self.proxies) if len(self.proxies) > 1 else 1
        for i in range(proxies_to_try):
            payload = {
                'user_name': self.username,
                'email': self.email,
                'password': self.password,
                'proxy': self.proxy,
                'totp_secret': self.totp_secret,
            }
            try:
                logging.info('Login attempt #%d via proxy #%d', i + 1, self.proxy_index)
                resp = cffi_requests.post(
                    'https://api.twitterapi.io/twitter/user_login_v2',
                    json=payload,
                    headers=self._headers(),
                    impersonate='chrome131',
                    timeout=self.timeout,
                )
                data = self._handle_response(resp)
            except Exception as exc:
                errors.append(f'proxy#{self.proxy_index}: {exc}')
                self.rotate_proxy()
                time.sleep(5)
                continue
            cookie = data.get('login_cookie') or data.get('login_cookies')
            if not cookie:
                errors.append(f'proxy#{self.proxy_index}: no cookie in response')
                self.rotate_proxy()
                time.sleep(5)
                continue
            self.login_cookie = cookie
            self.cookie_obtained_at = time.time()
            self.cookie_proxy_index = self.proxy_index
            logging.info('Login success via proxy #%d', self.proxy_index)
            return self.login_cookie
        raise RuntimeError(f'twitterapi.io login failed on all proxies: {errors}')

    def ensure_login(self) -> str:
        if self.login_cookie and (time.time() - self.cookie_obtained_at) < self.cookie_ttl:
            if self.cookie_proxy_index == self.proxy_index:
                return self.login_cookie
            logging.info('Proxy changed (%d→%d); re-login needed', self.cookie_proxy_index, self.proxy_index)
        elif self.login_cookie:
            logging.info('Cookie TTL expired; re-logging in')
        self.login_cookie = None
        return self.login()

    def upload_media(self, media_path: str) -> str:
        self._require_proxy()
        import mimetypes
        mime_type = mimetypes.guess_type(media_path)[0] or 'image/jpeg'
        filename = media_path.rsplit('/', 1)[-1].rsplit('\\', 1)[-1]
        for attempt in range(3):
            self._wait_if_rate_limited()
            self.ensure_login()
            try:
                with open(media_path, 'rb') as handle:
                    file_bytes = handle.read()
                resp = cffi_requests.post(
                    'https://api.twitterapi.io/twitter/upload_media_v2',
                    files=[('file', (filename, file_bytes, mime_type))],
                    data={
                        'proxy': self.proxy,
                        'login_cookies': self.login_cookie,
                    },
                    headers=self._headers(),
                    impersonate='chrome131',
                    timeout=self.timeout,
                )
                data = self._handle_response(resp)
            except Exception as exc:
                kind = self._classify_error(str(exc))
                if kind in ('429', 'automated'):
                    logging.warning('Upload %s (attempt %d); will retry', kind, attempt + 1)
                    continue
                if kind == 'auth':
                    logging.warning('Upload auth error; re-login & retry')
                    self._force_relogin()
                    continue
                raise
            media_id = data.get('media_id')
            if not media_id:
                raise RuntimeError(f"twitterapi.io upload failed: {data.get('msg') or data}")
            return str(media_id)
        raise RuntimeError('upload_media failed after retries')

    _AUTH_ERROR_HINTS = ('unauthorized', '401', 'cookie expired', 'login failed', 'forbidden')
    _AUTOMATED_HINTS = ('automated', '226')
    _TRANSIENT_HINTS = ()  # intentionally empty; 'could not extract' = tweet was created
    _CREATED_NO_ID_HINTS = ('could not extract tweet_id', 'could not extract')

    def _is_auth_error(self, error_msg: str) -> bool:
        lower = error_msg.lower()
        return any(hint in lower for hint in self._AUTH_ERROR_HINTS)

    def _is_automated_reject(self, error_msg: str) -> bool:
        lower = error_msg.lower()
        return any(hint in lower for hint in self._AUTOMATED_HINTS)

    def _is_transient(self, error_msg: str) -> bool:
        lower = error_msg.lower()
        return any(hint in lower for hint in self._TRANSIENT_HINTS)

    def _force_relogin(self):
        self.login_cookie = None
        self.rotate_proxy()

    def _classify_error(self, err_str: str) -> str:
        if '429' in err_str:
            return '429'
        if self._is_automated_reject(err_str):
            return 'automated'
        if self._is_auth_error(err_str):
            return 'auth'
        lower = err_str.lower()
        if any(h in lower for h in self._CREATED_NO_ID_HINTS):
            return 'created_no_id'
        if self._is_transient(err_str):
            return 'transient'
        return 'unknown'

    def _call_with_retry(
        self,
        build_payload,
        extract_result,
        label: str = 'api_call',
        max_attempts: int = 3,
    ):
        self._require_proxy()
        last_error = None
        for attempt in range(max_attempts):
            self._wait_if_rate_limited()
            self.ensure_login()
            payload = build_payload()
            payload['login_cookies'] = self.login_cookie
            payload['proxy'] = self.proxy
            try:
                resp = cffi_requests.post(
                    'https://api.twitterapi.io/twitter/create_tweet_v2',
                    json=payload,
                    headers=self._headers(),
                    impersonate='chrome131',
                    timeout=self.timeout,
                )
                data = self._handle_response(resp)
            except Exception as exc:
                last_error = exc
                kind = self._classify_error(str(exc))
                if kind == '429':
                    logging.warning('%s 429 (attempt %d/%d)', label, attempt + 1, max_attempts)
                    continue  # _handle_429_backoff already set cooldown
                if kind == 'automated':
                    wait = random.uniform(300, 900)
                    logging.warning('%s automated-reject/226 (attempt %d/%d); rotate proxy, wait %.0fs', label, attempt + 1, max_attempts, wait)
                    self.rotate_proxy()
                    time.sleep(wait)
                    continue
                if kind == 'auth':
                    logging.warning('%s auth error (%s); re-login & retry', label, str(exc)[:80])
                    self._force_relogin()
                    continue
                if kind == 'created_no_id':
                    logging.warning('%s: tweet likely created but no ID returned; NOT retrying. err=%s',
                                    label, str(exc)[:100])
                    return None
                if kind == 'transient':
                    wait = random.uniform(15, 45)
                    logging.warning('%s transient error (%s); wait %.0fs & retry', label, str(exc)[:60], wait)
                    time.sleep(wait)
                    continue
                raise
            result = extract_result(data)
            if result:
                return result
            # Response was accepted (status=success/ok) — tweet may already exist
            status_val = str(data.get('status', '')).lower()
            if status_val in ('success', 'ok'):
                # Don't retry: the action likely succeeded but response format is unexpected
                logging.warning('%s: status=%s but no result extracted; NOT retrying to avoid duplicates. data=%s',
                                label, status_val, str(data)[:200])
                return None
            error_msg = str(data.get('msg') or data.get('message') or data)
            kind = self._classify_error(error_msg)
            if kind == 'automated':
                wait = random.uniform(300, 900)
                logging.warning('%s automated-reject/226 in response (attempt %d/%d); rotate proxy, wait %.0fs', label, attempt + 1, max_attempts, wait)
                self.rotate_proxy()
                time.sleep(wait)
                continue
            if kind == 'auth':
                logging.warning('%s auth error in response (%s); re-login & retry', label, error_msg[:80])
                self._force_relogin()
                continue
            if kind == 'transient':
                wait = random.uniform(15, 45)
                logging.warning('%s transient in response (%s); wait %.0fs & retry', label, error_msg[:60], wait)
                time.sleep(wait)
                continue
            logging.warning('%s unexpected response: %s', label, data)
            raise RuntimeError(f'{label} error: {error_msg}')
        raise RuntimeError(f'{label} failed after {max_attempts} attempts: {last_error}')

    def create_tweet(
        self,
        text: str,
        reply_to_tweet_id: Optional[str] = None,
        media_ids: Optional[List[str]] = None,
        reply_settings: Optional[str] = None,
    ) -> str:
        def build():
            p = {'tweet_text': text}
            if reply_to_tweet_id:
                p['reply_to_tweet_id'] = reply_to_tweet_id
            if media_ids:
                p['media_ids'] = media_ids
            return p
        return self._call_with_retry(
            build_payload=build,
            extract_result=lambda d: str(d['tweet_id']) if d.get('tweet_id') else None,
            label='create_tweet',
            max_attempts=5,
        )

    def reply(self, tweet_id: str, text: str) -> str:
        return self.create_tweet(text=text, reply_to_tweet_id=tweet_id, reply_settings=None)

    def _simple_write(self, endpoint: str, extra: dict, label: str) -> bool:
        self._require_proxy()
        for attempt in range(2):
            self._wait_if_rate_limited()
            self.ensure_login()
            payload = {
                'login_cookies': self.login_cookie,
                'proxy': self.proxy,
                **extra,
            }
            try:
                resp = cffi_requests.post(
                    endpoint,
                    json=payload,
                    headers=self._headers(),
                    impersonate='chrome131',
                    timeout=self.timeout,
                )
                self._handle_response(resp)
                return True
            except Exception as exc:
                kind = self._classify_error(str(exc))
                if kind in ('429', 'automated', 'transient'):
                    logging.warning('%s %s; will retry', label, kind)
                    continue
                if kind == 'auth' and attempt == 0:
                    self._force_relogin()
                    continue
                raise
        return False

    def like_tweet(self, tweet_id: str) -> bool:
        return self._simple_write(
            'https://api.twitterapi.io/twitter/like_tweet_v2',
            {'tweet_id': tweet_id},
            'like_tweet',
        )

    def retweet(self, tweet_id: str) -> bool:
        return self._simple_write(
            'https://api.twitterapi.io/twitter/retweet_v2',
            {'tweet_id': tweet_id},
            'retweet',
        )

    def search_tweets(self, query: str, count: int = 20) -> list:
        params = {
            'query': query,
            'queryType': 'Top',
        }
        self._wait_if_rate_limited()
        resp = cffi_requests.get(
            'https://api.twitterapi.io/twitter/tweet/advanced_search',
            params=params,
            headers=self._headers(),
            impersonate='chrome131',
            timeout=self.timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        tweets = data.get('tweets') or data.get('data') or []
        return tweets[:count]

    def quote(self, text: str, attachment_url: str, media_ids: Optional[List[str]] = None) -> str:
        def build():
            p = {'tweet_text': text, 'attachment_url': attachment_url}
            if media_ids:
                p['media_ids'] = media_ids
            return p
        return self._call_with_retry(
            build_payload=build,
            extract_result=lambda d: str(d['tweet_id']) if d.get('tweet_id') else None,
            label='quote',
            max_attempts=5,
        )
