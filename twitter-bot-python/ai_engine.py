import base64
import logging
import os
import random
import time
from io import BytesIO

from curl_cffi import requests as cffi_requests
from google import genai
from google.genai import types as genai_types

from config import (
    BLINK_URL,
    SOFT_CTAS,
    GEMINI_API_KEY,
    GEMINI_IMAGE_MODEL,
    GEMINI_PROXY,
    GEMINI_IMAGE_PROMPT,
    GEMINI_MODEL,
    HASHTAG_SETS,
    IMAGE_KEEP_COUNT,
    IMAGE_PROMPT_VARIANTS,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_DIM,
    MAX_HASHTAGS,
    MAX_POST_CHARS,
    MAX_REPLY_CHARS,
    MEDIA_DIR,
    MICRO_REPLIES,
    MICRO_REPLY_RATE,
    POST_PROMPT,
    QUOTE_PROMPT,
    REPLY_BACK_PROMPT,
    SHILL_INSTRUCTION,
    SHILL_PHRASES,
    SNIPER_PROMPT,
    SYSTEM_PROMPT,
    THREAD_PROMPT,
    THREAD_TOPICS,
    TREND_POST_PROMPT,
    TREND_PROMPT,
    WALLET_ROAST_PROMPT,
)
from utils import clamp_text, trim_hashtags

_GEMINI_REST_URL = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent'


def _human_delay(lo=1.0, hi=4.0):
    time.sleep(random.uniform(lo, hi))


def _apply_gemini_proxy():
    if GEMINI_PROXY:
        os.environ.setdefault('HTTPS_PROXY', GEMINI_PROXY)
        os.environ.setdefault('HTTP_PROXY', GEMINI_PROXY)


class AIEngine:
    def __init__(self):
        if not GEMINI_API_KEY:
            raise RuntimeError('Missing GEMINI_API_KEY in environment.')
        _apply_gemini_proxy()
        http_opts = None
        if GEMINI_PROXY:
            from google.genai import types as _t
            http_opts = _t.HttpOptions(api_version='v1beta')
        self._client = genai.Client(api_key=GEMINI_API_KEY, http_options=http_opts)
        self._model_name = GEMINI_MODEL
        self._rest_url = f'{_GEMINI_REST_URL}?key={GEMINI_API_KEY}'
        self._proxy = GEMINI_PROXY

    @staticmethod
    def _fit_twitter_limit(text, limit=25000):
        return text

    @staticmethod
    def _format_tags(text):
        """Move trailing hashtags/cashtags to a new line."""
        import re
        words = text.split()
        if not words:
            return text
        # Collect trailing tag tokens from the end
        tags = []
        while words and re.match(r'^[#$]\w+$', words[-1]):
            tags.append(words.pop())
        if not tags or not words:
            return text
        tags.reverse()
        body = ' '.join(words).rstrip()
        return f'{body}\n{" ".join(tags)}'

    def _clean_text(self, text):
        if not text:
            return ''
        import re
        cleaned = text.strip().strip('"').strip("'")
        cleaned = ' '.join(cleaned.split())
        cleaned = trim_hashtags(cleaned, MAX_HASHTAGS)
        # Extract ALL #hashtag and $TICKER tokens, place them on a new line
        words = cleaned.split()
        tags = []
        body_words = []
        for w in words:
            if re.match(r'^[#$]\w+$', w):
                tags.append(w)
            else:
                body_words.append(w)
        body = ' '.join(body_words).rstrip().rstrip('✨⚡🔥💎🚀🌟💫⭐🔮🌙')
        body = body.rstrip()
        tag_str = ' '.join(tags)
        if tag_str:
            cleaned = f'{body}\n{tag_str}'
        else:
            cleaned = body
        return cleaned

    def _ensure_hashtags(self, text):
        """Append hashtags and $SOL if the AI didn't include them."""
        if not text:
            return text
        has_hashtag = '#' in text
        has_cashtag = '$' in text
        if has_hashtag and has_cashtag:
            return text
        additions = []
        if not has_cashtag:
            additions.append('$SOL')
        if not has_hashtag:
            tags = random.choice(HASHTAG_SETS)
            additions.extend(tags)
        return f'{text.rstrip()}\n{" ".join(additions)}'

    def _append_cta(self, text):
        if not text or not SOFT_CTAS:
            return text
        cta = random.choice(SOFT_CTAS)
        body = text.strip()
        combined = f'{body}\n{cta}'
        if len(combined) > 25000:
            return body
        return combined

    def _build_prompt(self, template, tweet_text, user, include_shill):
        shill = ''
        if include_shill:
            phrase = random.choice(SHILL_PHRASES)
            shill = SHILL_INSTRUCTION.format(phrase=phrase)
        return template.format(user=user, tweet_text=tweet_text, shill=shill)

    @staticmethod
    def _random_hashtags():
        return ' '.join(random.choice(HASHTAG_SETS))

    def _build_post_prompt(self, include_shill):
        shill = ''
        if include_shill:
            phrase = random.choice(SHILL_PHRASES)
            shill = SHILL_INSTRUCTION.format(phrase=phrase)
        return POST_PROMPT.format(shill=shill, hashtags=self._random_hashtags())

    def _generate(self, prompt):
        _human_delay(1.5, 5.0)
        payload = {
            'contents': [{'parts': [{'text': f'{SYSTEM_PROMPT}\n\n{prompt}'}]}],
            'generationConfig': {'temperature': 0.7, 'maxOutputTokens': 8192},
        }
        try:
            proxy_kw = {'proxy': self._proxy} if self._proxy else {}
            resp = cffi_requests.post(
                self._rest_url, json=payload,
                impersonate='chrome131', timeout=30, **proxy_kw,
            )
            if resp.status_code != 200:
                logging.warning('LLM request failed: HTTP %d %s', resp.status_code, resp.text[:200])
                return ''
            data = resp.json()
            content = data['candidates'][0]['content']['parts'][0]['text']
        except Exception as exc:
            logging.warning('LLM request failed: %s', exc)
            return ''
        return self._clean_text(content)

    def generate_sniper_reply(self, tweet_text, user, include_shill=False):
        prompt = self._build_prompt(SNIPER_PROMPT, tweet_text, user, include_shill)
        return self._generate(prompt)

    def generate_trend_reply(self, tweet_text, user, include_shill=False):
        prompt = self._build_prompt(TREND_PROMPT, tweet_text, user, include_shill)
        return self._generate(prompt)

    def generate_post_text(self, include_shill=False):
        prompt = self._build_post_prompt(include_shill)
        post = self._generate(prompt)
        return self._ensure_hashtags(post)

    def generate_micro_reply(self):
        if not MICRO_REPLIES:
            return None
        return random.choice(MICRO_REPLIES)

    def should_micro_reply(self):
        return random.random() < MICRO_REPLY_RATE

    def generate_thread(self, include_shill=False):
        topic = random.choice(THREAD_TOPICS)
        shill = ''
        if include_shill:
            phrase = random.choice(SHILL_PHRASES)
            shill = SHILL_INSTRUCTION.format(phrase=phrase)
        prompt = THREAD_PROMPT.format(
            topic=topic, hashtags=self._random_hashtags(), shill=shill,
        )
        _human_delay(2.0, 6.0)
        payload = {
            'contents': [{'parts': [{'text': f'{SYSTEM_PROMPT}\n\n{prompt}'}]}],
            'generationConfig': {'temperature': 0.8, 'maxOutputTokens': 4096},
        }
        try:
            proxy_kw = {'proxy': self._proxy} if self._proxy else {}
            resp = cffi_requests.post(
                self._rest_url, json=payload,
                impersonate='chrome131', timeout=30, **proxy_kw,
            )
            if resp.status_code != 200:
                logging.warning('Thread generation failed: HTTP %d', resp.status_code)
                return []
            data = resp.json()
            raw = data['candidates'][0]['content']['parts'][0]['text']
        except Exception as exc:
            logging.warning('Thread generation failed: %s', exc)
            return []
        lines = [l.strip() for l in raw.strip().split('\n') if l.strip()]
        tweets = []
        for line in lines:
            cleaned = self._clean_text(line)
            if cleaned and len(cleaned) > 20:
                tweets.append(cleaned)
            if len(tweets) >= 3:
                break
        if len(tweets) < 2:
            logging.warning('Thread generation returned too few tweets (%d)', len(tweets))
            return []
        # Ensure last tweet has hashtags/$SOL
        tweets[-1] = self._ensure_hashtags(tweets[-1])
        return tweets

    def generate_trend_post(self, tweet_text, user, include_shill=False):
        shill = ''
        if include_shill:
            phrase = random.choice(SHILL_PHRASES)
            shill = SHILL_INSTRUCTION.format(phrase=phrase)
        prompt = TREND_POST_PROMPT.format(
            tweet_text=tweet_text[:300], user=user,
            hashtags=self._random_hashtags(), shill=shill,
        )
        return self._ensure_hashtags(self._generate(prompt))

    def generate_quote_text(self, tweet_text, user, include_shill=False):
        shill = ''
        if include_shill:
            phrase = random.choice(SHILL_PHRASES)
            shill = SHILL_INSTRUCTION.format(phrase=phrase)
        prompt = QUOTE_PROMPT.format(
            tweet_text=tweet_text[:300], user=user, shill=shill,
        )
        return self._ensure_hashtags(self._generate(prompt))

    def generate_reply_back(self, our_text, reply_text):
        prompt = REPLY_BACK_PROMPT.format(our_text=our_text[:200], reply_text=reply_text[:200])
        return self._generate(prompt)

    def generate_wallet_roast(self, tweet_text):
        prompt = WALLET_ROAST_PROMPT.format(tweet_text=tweet_text[:200])
        roast = self._generate(prompt)
        if not roast:
            roast = 'your wallet is about to get exposed'
        return f'{roast}\n\n{BLINK_URL}'

    def _extract_image_bytes(self, response):
        if response is None:
            return None
        generated = getattr(response, 'generated_images', None)
        if generated:
            image_obj = getattr(generated[0], 'image', generated[0])
            for attr in ['image_bytes', 'bytes', 'data']:
                value = getattr(image_obj, attr, None)
                if value:
                    if attr == 'data':
                        return base64.b64decode(value)
                    return value
            if isinstance(image_obj, (bytes, bytearray)):
                return bytes(image_obj)
        candidates = getattr(response, 'candidates', None)
        if candidates:
            for candidate in candidates:
                content = getattr(candidate, 'content', None)
                if not content:
                    continue
                parts = getattr(content, 'parts', None) or []
                for part in parts:
                    inline = getattr(part, 'inline_data', None) or getattr(part, 'inlineData', None)
                    if inline and getattr(inline, 'data', None):
                        return base64.b64decode(inline.data)
        return None

    def _cleanup_images(self):
        if IMAGE_KEEP_COUNT <= 0 or not os.path.isdir(MEDIA_DIR):
            return
        images = [
            os.path.join(MEDIA_DIR, name)
            for name in os.listdir(MEDIA_DIR)
            if name.startswith('gemini_') and name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))
        ]
        if len(images) <= IMAGE_KEEP_COUNT:
            return
        images.sort(key=lambda path: os.path.getmtime(path))
        for path in images[:-IMAGE_KEEP_COUNT]:
            try:
                os.remove(path)
            except OSError:
                continue

    def _compress_image(self, path):
        if MAX_IMAGE_BYTES <= 0 and MAX_IMAGE_DIM <= 0:
            return path
        try:
            current_size = os.path.getsize(path)
        except OSError:
            return path
        try:
            from PIL import Image
        except ImportError:
            logging.warning('Pillow not installed; skipping image compression.')
            return path
        try:
            with Image.open(path) as image:
                image.load()
                width, height = image.size
                max_dim = max(width, height)
                if (MAX_IMAGE_DIM > 0 and max_dim > MAX_IMAGE_DIM) or (
                    MAX_IMAGE_BYTES > 0 and current_size > MAX_IMAGE_BYTES
                ):
                    scale = 1.0
                    if MAX_IMAGE_DIM > 0 and max_dim > MAX_IMAGE_DIM:
                        scale = MAX_IMAGE_DIM / float(max_dim)
                    new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
                    if new_size != image.size:
                        image = image.resize(new_size, Image.LANCZOS)
                if image.mode not in ('RGB', 'L'):
                    image = image.convert('RGB')
                base_path, _ = os.path.splitext(path)
                compressed_path = f'{base_path}.jpg'
                for quality in (85, 75, 65, 55):
                    buffer = BytesIO()
                    image.save(buffer, format='JPEG', quality=quality, optimize=True)
                    if MAX_IMAGE_BYTES <= 0 or buffer.tell() <= MAX_IMAGE_BYTES:
                        with open(compressed_path, 'wb') as handle:
                            handle.write(buffer.getvalue())
                        return compressed_path
                with open(compressed_path, 'wb') as handle:
                    handle.write(buffer.getvalue())
                return compressed_path
        except Exception as exc:
            logging.warning('Image compression failed: %s', exc)
            return path
        return path

    def generate_post_image(self, post_text=None):
        if not GEMINI_IMAGE_MODEL:
            logging.warning('Missing GEMINI_IMAGE_MODEL; skipping image generation.')
            return None
        prompt = random.choice(IMAGE_PROMPT_VARIANTS) if IMAGE_PROMPT_VARIANTS else GEMINI_IMAGE_PROMPT
        if post_text:
            trimmed = post_text[:120].strip()
            prompt = f'{prompt} Inspired by: {trimmed}'
        try:
            response = self._client.models.generate_images(
                model=GEMINI_IMAGE_MODEL,
                prompt=prompt,
            )
        except Exception as exc:
            logging.warning('Gemini image generation failed: %s', exc)
            return None
        image_bytes = self._extract_image_bytes(response)
        if not image_bytes:
            logging.warning('Gemini image generation returned no data.')
            return None
        os.makedirs(MEDIA_DIR, exist_ok=True)
        filename = f'gemini_{int(time.time())}.png'
        path = os.path.join(MEDIA_DIR, filename)
        try:
            with open(path, 'wb') as handle:
                handle.write(image_bytes)
        except OSError as exc:
            logging.warning('Failed to write image: %s', exc)
            return None
        path = self._compress_image(path)
        self._cleanup_images()
        logging.info('Image generated OK: %s (%d bytes)', path, os.path.getsize(path))
        return path
