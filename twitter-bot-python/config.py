import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
ENV_CANDIDATES = [
    BASE_DIR / '.env',
    BASE_DIR / '.env.scraper',
    BASE_DIR.parent / '.env.scraper',
    BASE_DIR.parent / '.env',
]

for env_path in ENV_CANDIDATES:
    if env_path.exists():
        load_dotenv(env_path, override=False)


def _split_list(value: str) -> list:
    if not value:
        return []
    normalized = value.replace('\n', ',').replace(';', ',')
    return [item.strip() for item in normalized.split(',') if item.strip()]

TARGET_USERS = [
    'solana', 'solanamobile', 'toly', 'colosseum',
    'JupiterExchange', 'tensor_hq', 'MagicEden',
    'phantom', 'DriftProtocol', 'aborose_sol',
]

SNIPER_INTERVAL_RANGE = (25 * 60, 40 * 60)
TREND_INTERVAL_RANGE = (25 * 60, 40 * 60)
LOOP_SLEEP_RANGE = (3 * 60, 8 * 60)

WARMUP_HOURS = int(os.getenv('WARMUP_HOURS', '0'))
WARMUP_ACTION_RATE = float(os.getenv('WARMUP_ACTION_RATE', '1.0'))
WARMUP_EXTRA_DELAY_RANGE = (
    int(os.getenv('WARMUP_EXTRA_DELAY_MIN', '600')),
    int(os.getenv('WARMUP_EXTRA_DELAY_MAX', '1200')),
)

SEARCH_QUERIES = [
    '$SOL -filter:retweets',
    'solana NFT -filter:retweets',
    'solana defi -filter:retweets',
    'solana mobile -filter:retweets',
    'solana airdrop -filter:retweets',
    '#Solana -filter:retweets',
]

TREND_QUERIES = [
    'solana ecosystem -filter:retweets min_faves:50',
    'solana AI agent -filter:retweets',
    'web3 identity -filter:retweets',
    'on-chain reputation -filter:retweets',
    'solana hackathon -filter:retweets',
    'DePIN solana -filter:retweets',
    'solana gaming -filter:retweets',
]

HASHTAG_SETS = [
    ['#Solana', '#IdentityPrism'],
    ['#Solana', '#Web3'],
    ['#Solana', '#OnChain'],
    ['#Web3Identity', '#Solana'],
    ['#SolanaAI', '#IdentityPrism'],
    ['#DeFi', '#Solana'],
    ['#Solana', '#cNFT'],
]

ACTION_WEIGHTS = {
    'post': 25,
    'thread': 12,
    'trend_post': 18,
    'quote': 15,
    'engage': 30,
}

SHILL_RATE = 0.4
LIKE_RATE = 0.6
RETWEET_RATE = 0.08
MICRO_REPLY_RATE = 0.2
MICRO_REPLIES = [
    'based', 'this \U0001f525', 'real ones know', 'big if true',
    'lfg', 'wagmi', 'ngl this is fire', 'facts',
    'the vibes are immaculate', 'bullish on this',
]
SHILL_PHRASES = [
    'been checking my on-chain soul lately',
    'Identity Prism vibes are strong today',
    'my on-chain soul looks wild in Identity Prism',
]

MAX_HASHTAGS = 2
MAX_REPLY_CHARS = int(os.getenv('MAX_REPLY_CHARS', '25000'))
MAX_POST_CHARS = int(os.getenv('MAX_POST_CHARS', '25000'))
MAX_STORED_TWEETS = 2000
CTA_DOMAIN = os.getenv('CTA_DOMAIN', 'identityprism.xyz').strip()
CTA_LINK = os.getenv('CTA_LINK', f'https://{CTA_DOMAIN}').strip()
BLINK_URL = os.getenv('BLINK_URL', f'https://dial.to/?action=solana-action:https://{CTA_DOMAIN}/api/actions/share').strip()
SOFT_CTAS = [
    'peep my profile if you wanna see your on-chain stats',
    'link in my bio if you want to check your wallet score',
    'curious about your on-chain identity? check my profile',
    'wanna see what your wallet says about you? profile link',
    'your on-chain soul is waiting — link in bio',
]
MEDIA_UPLOAD_RETRIES = int(os.getenv('MEDIA_UPLOAD_RETRIES', '2'))
MEDIA_UPLOAD_RETRY_DELAY = int(os.getenv('MEDIA_UPLOAD_RETRY_DELAY', '15'))

ACTIVITY_SCHEDULE_UTC = {
    'peak':   {'hours': range(11, 19), 'multiplier': 1.0},
    'normal': {'hours': list(range(7, 11)) + list(range(19, 23)), 'multiplier': 0.85},
    'quiet':  {'hours': list(range(0, 7)) + [23], 'multiplier': 0.5},
}

MENTION_CHECK_INTERVAL = int(os.getenv('MENTION_CHECK_INTERVAL', str(30 * 60)))
MENTION_REPLY_MAX_AGE = int(os.getenv('MENTION_REPLY_MAX_AGE', str(6 * 60 * 60)))

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '').strip()
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash').strip()
GEMINI_PROXY = os.getenv('GEMINI_PROXY', '').strip()
GEMINI_IMAGE_MODEL = os.getenv('GEMINI_IMAGE_MODEL', 'imagen-4.0-fast-generate-001').strip()
GEMINI_IMAGE_PROMPT = os.getenv(
    'GEMINI_IMAGE_PROMPT',
    'Create a clean, futuristic visual for Identity Prism on Solana. '
    'Cosmic gradients, neon accents, subtle blockchain motifs, dark background, no text.',
).strip()

IMAGE_PROMPT_VARIANTS = [
    'Create a clean, futuristic visual for Identity Prism on Solana. '
    'Cosmic gradients, neon accents, subtle blockchain motifs, dark background, no text.',
    'A cosmic 3D solar system where planets represent crypto tokens and moons are NFTs. '
    'Deep space background with neon purple and blue gradients, Solana-inspired. No text.',
    'Abstract digital identity visualization: glowing fingerprint made of blockchain nodes '
    'and transaction paths, cosmic dark background with teal and magenta accents. No text.',
    'Futuristic holographic wallet card floating in space, showing a reputation score '
    'and cosmic badges, dark background with stars and nebula colors. No text.',
    'A cosmic black hole consuming small token icons, with rent SOL particles escaping '
    'back outward. Dark space background, neon green and purple accents. No text.',
    'Digital soul portrait: abstract face made of on-chain data streams, transaction '
    'histories forming neural patterns, Solana purple-blue palette. No text.',
]

COOKIES_PATH = os.getenv('COOKIES_PATH', str(BASE_DIR / 'cookies.json')).strip()
STATE_PATH = os.getenv('STATE_PATH', str(BASE_DIR / 'state.json')).strip()
BOT_USERNAME = os.getenv(
    'BOT_USERNAME',
    os.getenv('TWITTER_USER_NAME', os.getenv('TWITTER_USERNAME', 'IdentityPrism')),
).strip()
TWITTER_LANG = os.getenv('TWITTER_LANG', 'en-US').strip()

USE_TWITTERAPI_IO = os.getenv('USE_TWITTERAPI_IO', 'false').lower() == 'true'
TWITTERAPI_IO_API_KEY = os.getenv('TWITTERAPI_IO_API_KEY', '').strip()
TWITTERAPI_IO_PROXY = os.getenv('TWITTERAPI_IO_PROXY', '').strip()
TWITTERAPI_IO_PROXIES = _split_list(os.getenv('TWITTERAPI_IO_PROXIES', ''))
TWITTERAPI_IO_USERNAME = os.getenv('TWITTERAPI_IO_USERNAME', BOT_USERNAME).strip()
TWITTERAPI_IO_EMAIL = os.getenv('TWITTERAPI_IO_EMAIL', '').strip()
TWITTERAPI_IO_PASSWORD = os.getenv('TWITTERAPI_IO_PASSWORD', '').strip()
TWITTERAPI_IO_TOTP_SECRET = os.getenv('TWITTERAPI_IO_TOTP_SECRET', '').strip()
TWITTERAPI_IO_LOGIN_COOKIE = os.getenv('TWITTERAPI_IO_LOGIN_COOKIE', '').strip()
TWITTERAPI_IO_TIMEOUT = int(os.getenv('TWITTERAPI_IO_TIMEOUT', '60'))

# Official Twitter API v2 (for posting with reply_settings)
TWITTER_CONSUMER_KEY = os.getenv('TWITTER_CONSUMER_KEY', '')
TWITTER_CONSUMER_SECRET = os.getenv('TWITTER_CONSUMER_SECRET', '')
TWITTER_ACCESS_TOKEN = os.getenv('TWITTER_ACCESS_TOKEN', '')
TWITTER_ACCESS_TOKEN_SECRET = os.getenv('TWITTER_ACCESS_TOKEN_SECRET', '')

MEDIA_DIR = os.getenv('MEDIA_DIR', str(BASE_DIR / 'media')).strip()
MEDIA_FILES = [item.strip() for item in os.getenv('MEDIA_FILES', '').split(',') if item.strip()]
POST_IMAGE_ENABLED = os.getenv('POST_IMAGE_ENABLED', 'true').lower() == 'true'
POST_IMAGE_RATE = float(os.getenv('POST_IMAGE_RATE', '1.0'))
IMAGE_KEEP_COUNT = int(os.getenv('IMAGE_KEEP_COUNT', '20'))
MAX_IMAGE_BYTES = int(os.getenv('MAX_IMAGE_BYTES', str(1_500_000)))
MAX_IMAGE_DIM = int(os.getenv('MAX_IMAGE_DIM', '1024'))

RATE_LIMIT_BACKOFF_RANGE = (60 * 60, 120 * 60)  # 1-2h backoff on twikit rate limits
ENGAGEMENT_COOLDOWN_SECONDS = int(os.getenv('ENGAGEMENT_COOLDOWN_SECONDS', str(60 * 60)))
POST_HOUR_BLOCK_SECONDS = int(os.getenv('POST_HOUR_BLOCK_SECONDS', str(10 * 60)))
MIN_POST_INTERVAL_SECONDS = int(os.getenv('MIN_POST_INTERVAL_SECONDS', str(150 * 60)))

POST_RETRY_ENABLED = os.getenv('POST_RETRY_ENABLED', 'true').lower() == 'true'
POST_RETRY_INTERVAL_RANGE = (
    int(os.getenv('POST_RETRY_MIN', str(30 * 60))),
    int(os.getenv('POST_RETRY_MAX', str(60 * 60))),
)
POST_RETRY_AUTOMATION_RANGE = (
    int(os.getenv('POST_RETRY_AUTOMATION_MIN', str(30 * 60))),
    int(os.getenv('POST_RETRY_AUTOMATION_MAX', str(60 * 60))),
)
POST_RETRY_DAILY_RANGE = (
    int(os.getenv('POST_RETRY_DAILY_MIN', str(10 * 60 * 60))),
    int(os.getenv('POST_RETRY_DAILY_MAX', str(14 * 60 * 60))),
)

SYSTEM_PROMPT = (
    'You are a Solana degen developer promoting Identity Prism — a tool that reveals '
    'your on-chain soul on Solana. You are supportive, witty, and insightful. '
    'Never sound like a bot or a generic ad. Keep it conversational. '
    'One emoji max per message.'
)

SHILL_INSTRUCTION = (
    'If it feels natural, weave in this phrase verbatim: "{phrase}". '
    'Do not make it sound like an ad.'
)

SNIPER_PROMPT = (
    'Reply to @{user} in 1-3 short but COMPLETE sentences. '
    'Be context-aware, add value to the conversation, show you understand the topic. '
    'You may use $SOL or one hashtag like #Solana if it fits naturally. '
    'You MUST always finish every sentence — NEVER stop mid-sentence. '
    'Do NOT mention any website, link, or "check my profile". '
    'Tweet: "{tweet_text}". {shill}'
)

REPLY_BACK_PROMPT = (
    'Someone replied to your tweet. Continue the conversation naturally in 1-2 short but COMPLETE sentences. '
    'Be friendly, stay on topic, and keep it genuine. '
    'You MUST always finish every sentence — NEVER stop mid-sentence. '
    'Do NOT mention any website or link. '
    'Your original tweet: "{our_text}". Their reply: "{reply_text}".'
)

TREND_PROMPT = (
    'Write a sharp, engaging comment (1-3 short but COMPLETE sentences) for this Solana tweet. '
    'Show genuine interest, add an insight or opinion, not just agreement. '
    'You may use $SOL or one hashtag like #Solana if it fits naturally. '
    'You MUST always finish every sentence — NEVER stop mid-sentence. '
    'If it is a morning vibe you may say "GM" once. '
    'Do NOT mention any website, link, or "check my profile". '
    'Tweet: "{tweet_text}". {shill}'
)

POST_PROMPT = (
    'Write a tweet (2-4 COMPLETE sentences) about Identity Prism and what it '
    'reveals about your on-chain identity on Solana. Be creative and varied — '
    'talk about badges, wallet scores, on-chain reputation, cosmic vibes, etc. '
    'You MUST always finish every sentence — NEVER stop mid-sentence. '
    'MUST include 1-2 of these exact hashtags: {hashtags} and a $SOL ticker. '
    'Do NOT include any website link or "check my profile" — that part is handled separately. '
    'One emoji max. {shill}'
)

THREAD_PROMPT = (
    'Write a Twitter thread (exactly 3 tweets) about {topic}. '
    'Format: tweet 1 on first line, tweet 2 on second line, tweet 3 on third line. '
    'Each tweet MUST be a COMPLETE thought — never cut off mid-sentence. '
    'Tweet 1: hook/bold statement that makes people want to read more. End with a thread emoji 🧵. '
    'Tweet 2: the meat — explain/elaborate with specific details or insights. '
    'Tweet 3: conclusion with a takeaway. Include {hashtags}. '
    'Be conversational, opinionated, and genuine — NOT generic or salesy. '
    'Do NOT include any website link. {shill}'
)

THREAD_TOPICS = [
    'why on-chain identity will matter more than ENS domains',
    'what your Solana wallet says about your degen personality',
    'the difference between on-chain reputation and credit scores',
    'why most people have no idea what their wallet reveals about them',
    'how Identity Prism turns raw on-chain data into a cosmic identity card',
    'the future of AI agents that can verify your on-chain reputation',
    'why wallet scoring is the next big thing in Solana DeFi',
    'how we built a 3D solar system from on-chain data',
    'what makes a Mythic-tier wallet on Solana',
    'burning tokens to reclaim rent SOL — the Black Hole feature explained',
]

TREND_POST_PROMPT = (
    'You just saw this trending tweet in the Solana ecosystem:\n'
    'Author: @{user}\nTweet: "{tweet_text}"\n\n'
    'Write your own original tweet (NOT a reply) inspired by or reacting to this trend/topic. '
    'Add your unique perspective as an on-chain identity builder. '
    '2-3 COMPLETE sentences. '
    'Include {hashtags}. One emoji max. '
    'Do NOT mention the original author. Do NOT include any link. {shill}'
)

QUOTE_PROMPT = (
    'You are quote-tweeting this:\n@{user}: "{tweet_text}"\n\n'
    'Write a short, sharp comment (1-2 COMPLETE sentences) '
    'that adds genuine value — an insight, hot take, or connection to on-chain identity. '
    'Be conversational and opinionated. One emoji max. '
    'Do NOT include any link or hashtag — those are added separately. {shill}'
)

WALLET_ROAST_PROMPT = (
    'Someone asked to check their Solana wallet. Write a short, funny roast/commentary '
    '(1-2 COMPLETE sentences) about what their on-chain identity might look like. '
    'Be playful and witty, like a fortune teller roasting their crypto habits. '
    'You MUST always finish every sentence — NEVER stop mid-sentence. '
    'Do NOT include any link — that will be appended automatically. '
    'Their message: "{tweet_text}"'
)

WALLET_CHECK_KEYWORDS = [
    'check my wallet', 'check wallet', 'analyze my wallet', 'scan my wallet',
    'look at my wallet', 'roast my wallet', 'what does my wallet', 'my on-chain',
    'check my address', 'check this wallet', 'identity prism me',
]

PEAK_HOURS_UTC = list(range(14, 19))  # 14:00-18:00 UTC = prime crypto twitter
ACTIVE_HOURS_UTC = list(range(11, 23))  # broader active window
