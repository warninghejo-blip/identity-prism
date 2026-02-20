"""Fetch Solana-related news from RSS feeds. No external dependencies — uses regex XML parsing."""

import logging
import re
import time

from curl_cffi import requests as cffi_requests

SOLANA_FEEDS = [
    ('https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk'),
    ('https://cointelegraph.com/rss', 'CoinTelegraph'),
    ('https://thedefiant.io/feed', 'TheDefiant'),
    ('https://blockworks.co/feed', 'Blockworks'),
]

RELEVANCE_KEYWORDS = [
    'solana', 'sol ', 'phantom', 'jupiter', 'jito', 'marinade',
    'raydium', 'tensor', 'magic eden', 'helius', 'drift',
    'pyth', 'wormhole', 'nft', 'defi', 'web3', 'identity',
    'airdrop', 'token', 'blockchain', 'crypto', 'hackathon',
    'sybil', 'reputation', 'wallet', 'seeker', 'saga',
    'colosseum', 'breakpoint', 'superteam',
]

_ITEM_RE = re.compile(r'<item[^>]*>(.*?)</item>', re.DOTALL | re.IGNORECASE)
_ENTRY_RE = re.compile(r'<entry[^>]*>(.*?)</entry>', re.DOTALL | re.IGNORECASE)
_TITLE_RE = re.compile(r'<title[^>]*>(.*?)</title>', re.DOTALL | re.IGNORECASE)
_LINK_RE = re.compile(r'<link[^>]*>(.*?)</link>', re.DOTALL | re.IGNORECASE)
_ATOM_LINK_RE = re.compile(r'<link[^>]*href=["\']([^"\']+)["\']', re.IGNORECASE)
_DESC_RE = re.compile(
    r'<(?:description|summary)[^>]*>(.*?)</(?:description|summary)>',
    re.DOTALL | re.IGNORECASE,
)
_CDATA_RE = re.compile(r'<!\[CDATA\[(.*?)\]\]>', re.DOTALL)
_TAG_RE = re.compile(r'<[^>]+>')


def _clean_xml(text):
    text = _CDATA_RE.sub(r'\1', text)
    text = _TAG_RE.sub('', text)
    return text.strip()


def _parse_feed(xml_text):
    """Minimal RSS/Atom parser."""
    items = []
    for match in _ITEM_RE.finditer(xml_text):
        block = match.group(1)
        title_m = _TITLE_RE.search(block)
        link_m = _LINK_RE.search(block)
        desc_m = _DESC_RE.search(block)
        title = _clean_xml(title_m.group(1)) if title_m else ''
        link = _clean_xml(link_m.group(1)) if link_m else ''
        desc = _clean_xml(desc_m.group(1))[:300] if desc_m else ''
        if title and link:
            items.append({'title': title, 'link': link, 'summary': desc})
    # Fallback to Atom <entry> if no RSS <item>
    if not items:
        for match in _ENTRY_RE.finditer(xml_text):
            block = match.group(1)
            title_m = _TITLE_RE.search(block)
            link_m = _ATOM_LINK_RE.search(block)
            desc_m = _DESC_RE.search(block)
            title = _clean_xml(title_m.group(1)) if title_m else ''
            link = link_m.group(1).strip() if link_m else ''
            desc = _clean_xml(desc_m.group(1))[:300] if desc_m else ''
            if title and link:
                items.append({'title': title, 'link': link, 'summary': desc})
    return items


def _is_relevant(title, summary=''):
    text = f'{title} {summary}'.lower()
    return any(kw in text for kw in RELEVANCE_KEYWORDS)


class NewsFetcher:
    def __init__(self, memory, proxy=None):
        self.memory = memory
        self.proxy = proxy
        self._last_fetch = 0
        self._fetch_interval = 3600  # 1h between full fetches

    def fetch_all(self):
        """Fetch all RSS feeds and store relevant articles in memory."""
        now = time.time()
        if now - self._last_fetch < self._fetch_interval:
            return
        self._last_fetch = now
        total_new = 0
        for url, source in SOLANA_FEEDS:
            try:
                kw = {'proxy': self.proxy} if self.proxy else {}
                resp = cffi_requests.get(
                    url, impersonate='chrome131', timeout=15, **kw,
                )
                if resp.status_code != 200:
                    logging.debug('RSS %s returned %d', source, resp.status_code)
                    continue
                items = _parse_feed(resp.text)
                for item in items[:20]:
                    if _is_relevant(item['title'], item.get('summary', '')):
                        self.memory.record_news(
                            item['title'], item['link'], source,
                            item.get('summary', ''),
                        )
                        total_new += 1
            except Exception as exc:
                logging.warning('RSS fetch failed (%s): %s', source, exc)
        if total_new:
            logging.info('News: fetched %d relevant articles', total_new)

    def get_fresh_news(self, limit=5):
        """Return unused news items from memory."""
        return self.memory.get_unused_news(limit=limit)
