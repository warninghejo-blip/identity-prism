import base64
import logging
import os
import random
import time
from io import BytesIO

from google import genai
from google.genai import types as genai_types

from config import (
    BLINK_URL,
    SOFT_CTAS,
    GEMINI_API_KEY,
    GEMINI_IMAGE_MODEL,
    GEMINI_IMAGE_PROMPT,
    GEMINI_MODEL,
    IMAGE_KEEP_COUNT,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_DIM,
    MAX_HASHTAGS,
    MAX_POST_CHARS,
    MAX_REPLY_CHARS,
    MEDIA_DIR,
    MICRO_REPLIES,
    MICRO_REPLY_RATE,
    POST_PROMPT,
    REPLY_BACK_PROMPT,
    SHILL_INSTRUCTION,
    SHILL_PHRASES,
    SNIPER_PROMPT,
    SYSTEM_PROMPT,
    TREND_PROMPT,
    WALLET_ROAST_PROMPT,
)
from utils import clamp_text, trim_hashtags


class AIEngine:
    def __init__(self):
        if not GEMINI_API_KEY:
            raise RuntimeError('Missing GEMINI_API_KEY in environment.')
        self._client = genai.Client(api_key=GEMINI_API_KEY)
        self._model_name = GEMINI_MODEL

    @staticmethod
    def _fit_twitter_limit(text, limit=280):
        if len(text) <= limit:
            return text
        truncated = text[:limit]
        for end_char in ['. ', '! ', '? ']:
            idx = truncated.rfind(end_char)
            if idx > limit // 3:
                return truncated[:idx + 1].strip()
        for end_char in ['.', '!', '?']:
            idx = truncated.rfind(end_char)
            if idx > limit // 3:
                return truncated[:idx + 1].strip()
        last_space = truncated.rfind(' ')
        if last_space > limit // 3:
            return truncated[:last_space].rstrip(' ,;:')
        return truncated.rstrip()

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
        # Extract trailing tags (#hashtag, $TICKER) before truncation
        words = cleaned.split()
        tags = []
        while words and re.match(r'^[#$]\w+$', words[-1]):
            tags.append(words.pop())
        tags.reverse()
        body = ' '.join(words).rstrip()
        tag_str = ' '.join(tags)
        # Truncate body to leave room for tags on a new line
        if tag_str:
            max_body = 280 - len(tag_str) - 1  # -1 for newline
            body = self._fit_twitter_limit(body, max_body)
            cleaned = f'{body}\n{tag_str}'
        else:
            cleaned = self._fit_twitter_limit(body)
        return cleaned

    def _append_cta(self, text):
        if not text or not SOFT_CTAS:
            return text
        cta = random.choice(SOFT_CTAS)
        body = text.strip()
        combined = f'{body}\n{cta}'
        if len(combined) > 280:
            return body
        return combined

    def _build_prompt(self, template, tweet_text, user, include_shill):
        shill = ''
        if include_shill:
            phrase = random.choice(SHILL_PHRASES)
            shill = SHILL_INSTRUCTION.format(phrase=phrase)
        return template.format(user=user, tweet_text=tweet_text, shill=shill)

    def _build_post_prompt(self, include_shill):
        shill = ''
        if include_shill:
            phrase = random.choice(SHILL_PHRASES)
            shill = SHILL_INSTRUCTION.format(phrase=phrase)
        return POST_PROMPT.format(shill=shill)

    def _generate(self, prompt):
        try:
            response = self._client.models.generate_content(
                model=self._model_name,
                contents=f'{SYSTEM_PROMPT}\n\n{prompt}',
                config=genai_types.GenerateContentConfig(
                    temperature=0.7,
                    max_output_tokens=8192,
                ),
            )
        except Exception as exc:
            logging.warning('LLM request failed: %s', exc)
            return ''
        content = getattr(response, 'text', '')
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
        return post

    def generate_micro_reply(self):
        if not MICRO_REPLIES:
            return None
        return random.choice(MICRO_REPLIES)

    def should_micro_reply(self):
        return random.random() < MICRO_REPLY_RATE

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
        prompt = GEMINI_IMAGE_PROMPT
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
        return path
