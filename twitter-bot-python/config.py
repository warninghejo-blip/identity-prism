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
    # Core Solana ecosystem
    'solana', 'toly', 'aeyakovenko', 'rajgokal',
    # Infra & tooling
    'solanamobile', 'MagicBlock_', 'heliuslabs',
    # DEXes & DeFi
    'JupiterExchange', 'DriftProtocol', 'MarginFi', 'kamino_finance',
    # NFT / Consumer
    'tensor_hq', 'MagicEden', 'ORE_Supply',
    # Hackathons & grants
    'colosseum', 'superteamDAO',
    # Identity / social adjacent
    'TapestryProto', 'phantom',
]

SNIPER_INTERVAL_RANGE = (25 * 60, 40 * 60)
TREND_INTERVAL_RANGE = (25 * 60, 40 * 60)
LOOP_SLEEP_RANGE = (3 * 60, 8 * 60)
MENTION_POLL_INTERVAL = int(os.getenv('MENTION_POLL_INTERVAL', str(15 * 60)))  # check mentions every 15 min

WARMUP_HOURS = int(os.getenv('WARMUP_HOURS', '0'))
WARMUP_ACTION_RATE = float(os.getenv('WARMUP_ACTION_RATE', '1.0'))
WARMUP_EXTRA_DELAY_RANGE = (
    int(os.getenv('WARMUP_EXTRA_DELAY_MIN', '600')),
    int(os.getenv('WARMUP_EXTRA_DELAY_MAX', '1200')),
)

SEARCH_QUERIES = [
    '$SOL -filter:retweets min_faves:80',
    'solana NFT -filter:retweets min_faves:50',
    'solana defi -filter:retweets min_faves:50',
    'solana mobile dapp -filter:retweets min_faves:30',
    'solana airdrop -filter:retweets min_faves:80',
    '#Solana -filter:retweets min_faves:100',
]

TREND_QUERIES = [
    'solana ecosystem -filter:retweets min_faves:200',
    'solana AI agent -filter:retweets min_faves:100',
    'web3 identity -filter:retweets min_faves:50',
    'on-chain reputation -filter:retweets min_faves:30',
    'solana hackathon -filter:retweets min_faves:50',
    'DePIN solana -filter:retweets min_faves:100',
    'solana gaming -filter:retweets min_faves:100',
    'crypto identity sybil -filter:retweets min_faves:30',
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
    'post': 6,
    'thread': 6,
    'trend_post': 8,
    'quote': 6,
    'news_post': 14,
    'engage': 60,
}

SHILL_RATE = 0.4
LIKE_RATE = 0.6
RETWEET_RATE = 0.08
MICRO_REPLY_RATE = 0.07
MICRO_REPLIES = [
    'on-chain data never lies',
    'wallet history is the new resume',
    'your transactions tell the whole story',
    'the chain remembers everything',
    'this is why on-chain identity matters',
    'reputation is built one tx at a time',
    'degens with history > degens with none',
    'exactly — the data is all there on-chain',
]
SHILL_PHRASES = [
    'built something that scores wallets from 40+ on-chain signals',
    'been digging into what on-chain history actually reveals about a wallet',
    'turns out your transaction history says more about you than any KYC form',
]

MAX_HASHTAGS = 2
MAX_REPLY_CHARS = int(os.getenv('MAX_REPLY_CHARS', '25000'))
MAX_POST_CHARS = int(os.getenv('MAX_POST_CHARS', '25000'))

MAX_STORED_TWEETS = 2000
CTA_DOMAIN = os.getenv('CTA_DOMAIN', 'identityprism.xyz').strip()
CTA_LINK = os.getenv('CTA_LINK', f'https://{CTA_DOMAIN}').strip()
BLINK_URL = os.getenv('BLINK_URL', f'https://dial.to/?action=solana-action:https://{CTA_DOMAIN}/api/actions/share').strip()

# Link injection (max once per day each)
BLINK_SHARE_URL = os.getenv('BLINK_SHARE_URL', f'https://dial.to/?action=solana-action:https://{CTA_DOMAIN}/api/actions/share').strip()
ATTEST_URL = os.getenv('ATTEST_URL', f'https://dial.to/?action=solana-action:https://{CTA_DOMAIN}/api/actions/attest').strip()
MINT_BLINK_URL = os.getenv('MINT_BLINK_URL', f'https://dial.to/?action=solana-action:https://{CTA_DOMAIN}/api/actions/mint-blink').strip()
LINK_INJECT_RATE = float(os.getenv('LINK_INJECT_RATE', '0.35'))  # 35% chance to add a link to a post
SOFT_CTAS = [
    'built a tool for this — identityprism.xyz',
    'you can check any wallet at identityprism.xyz',
    'we score this at identityprism.xyz if you\'re curious',
    'that\'s exactly what identityprism.xyz measures',
    'this is what the data shows at identityprism.xyz',
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
    'Dark mode UI dashboard screenshot showing a glowing wallet reputation score card '
    'with tier badges, stats bars, and a 3D planetary visual. Clean product UI aesthetic, '
    'purple-to-teal gradient accents on near-black background. Photorealistic, no text.',
    'Cinematic close-up of a translucent holographic identity card floating above a '
    'dark surface, reflecting light like a credit card, with subtle circuit patterns '
    'and a soft purple glow emanating from within. No text, editorial photography style.',
    'Aerial view of a glowing city at night where each city block is a wallet transaction, '
    'brighter blocks = more active wallets. Solana purple and teal neon lights, '
    'ultra-detailed bird-eye render, no text.',
    'Stylized infographic art: a large circular score meter (like a speedometer) '
    'in the center, surrounded by six orbital rings each representing a different '
    'on-chain metric. Dark background, electric blue and violet gradients. No text.',
    'A lone astronaut in full suit standing before a massive glowing portal made of '
    'flowing transaction data streams. Cinematic sci-fi concept art, Solana purple palette, '
    'volumetric light, no text.',
    'Digital painting of a black hole made of tiny crypto token logos spiraling inward, '
    'with streams of golden SOL particles escaping outward. Dark space, high-detail, '
    'painterly style, no text.',
    'Retro pixel art scene: a space arcade cabinet with a leaderboard showing wallet '
    'addresses and scores, glowing CRT screen, synthwave purple-pink color palette. '
    'Nostalgic 16-bit aesthetic, no text.',
    'Abstract generative art: hundreds of thin orbit lines forming a unique 3D sphere '
    'shape, each line a different transaction path, glowing at intersection points. '
    'Deep navy background, bioluminescent teal and coral accents. No text.',
    'Macro photography style: a Solana coin melting into streams of liquid data, '
    'forming a face silhouette. Dark studio background, dramatic side lighting, '
    'hyper-realistic render, no text.',
    'Dark minimalist poster design: a single glowing geometric prism casting rainbow '
    'spectrum light on a dark floor, with faint blockchain node lines visible in the '
    'light beam. Studio lighting, ultra-clean composition. No text.',
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
ENGAGEMENT_COOLDOWN_SECONDS = int(os.getenv('ENGAGEMENT_COOLDOWN_SECONDS', str(2 * 60 * 60)))
POST_HOUR_BLOCK_SECONDS = int(os.getenv('POST_HOUR_BLOCK_SECONDS', str(10 * 60)))
MIN_POST_INTERVAL_SECONDS = int(os.getenv('MIN_POST_INTERVAL_SECONDS', str(60 * 60)))

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
    'You are a solo indie developer who built a Solana identity and reputation tool from scratch. '
    'You are technical, opinionated, and genuinely passionate about on-chain data. '
    'You speak like a real developer sharing insights — not like a marketer. '
    'You never hype or shill. You share observations, hot takes, and builder insights. '
    'One emoji max per message. Never use exclamation marks more than once. '
    'Never start with "I" — vary your sentence openers.'
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
    'Write ONE short, punchy tweet (2-4 sentences MAX). '
    'Pick ONE angle from this list and write about it as a developer who built something real:\n'
    '- A real problem in Solana ecosystem (Sybil farming, dust tokens, anonymous wallets in DeFi, '
    'airdrop abuse, reputation-less wallets) — and connect it to what we built to solve it\n'
    '- A technical insight from building on Solana (MagicBlock rollups, Helius DAS API, '
    'cNFT minting, Mobile Wallet Adapter on Seeker/Saga)\n'
    '- An observation about the Colosseum hackathon, Solana ecosystem growth, or on-chain identity trends\n'
    '- A counterintuitive take about crypto identity, reputation, or wallet behavior\n'
    'Write it like a builder sharing a real observation — not an ad. '
    'Be specific, not generic. If mentioning a problem, name it clearly. '
    'NO hype words. ONE emoji max. '
    'MUST include {hashtags} and $SOL ticker. '
    'Do NOT include any website link. '
    '{shill}'
)

THREAD_PROMPT = (
    'Write a Twitter thread (exactly 3 tweets) about {topic}. '
    'Output ONLY the 3 tweet texts, one per line, nothing else — no numbering, no labels. '
    'Each tweet MUST be a COMPLETE, standalone thought (2-4 sentences). '
    'Tweet 1: a bold, counterintuitive opening statement. End with 🧵 '
    'Tweet 2: back it up with specifics — real numbers, mechanisms, or dev insights. '
    'Tweet 3: practical takeaway or open question for the reader. Include {hashtags} and $SOL. '
    'Tone: technical founder sharing real insights — opinionated but not salesy. '
    'Do NOT include any website link. {shill}'
)

THREAD_TOPICS = [
    'why every Solana airdrop will eventually require on-chain reputation proof',
    'what your Solana wallet history actually reveals about you as a trader',
    'the difference between on-chain reputation and a credit score — and why it matters',
    'why Sybil attacks are destroying Solana airdrop culture and how scoring fixes it',
    'how MagicBlock ephemeral rollups let us build a provably fair on-chain game',
    'the real problem with anonymous wallets in DeFi and what builders are doing about it',
    'why wallet scoring is the unglamorous infrastructure Solana actually needs',
    'what I learned building a live reputation API that scores 40+ on-chain signals',
    'how the Colosseum hackathon pushed us to ship the Black Hole token burner feature',
    'why dust tokens in your wallet are costing you real SOL in rent — and how to fix it',
    'what makes a wallet trustworthy on-chain — and how we measure it',
    'the future of Solana dApps that gate access by on-chain reputation instead of KYC',
    'why building on Solana Mobile (Seeker/Saga) forced us to rethink our entire UX',
    'how Tapestry social graph + reputation scoring creates a new identity primitive',
]

TREND_POST_PROMPT = (
    'You saw this trending Solana tweet:\n'
    'Author: @{user}\nTweet: "{tweet_text}"\n\n'
    'Write your OWN short tweet (2-4 sentences). '
    'React to the topic by connecting it to something you actually built or observed — '
    'on-chain reputation, wallet scoring, identity, token dust, Sybil resistance, or Solana dev experience. '
    'If the tweet is about a problem, briefly note that you built something that addresses it. '
    'If it is about ecosystem growth, add a specific technical angle. '
    'Sound like a dev with relevant first-hand experience — not a bystander. '
    'ONE emoji max. Include {hashtags}. '
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

NEWS_POST_PROMPT = (
    'You just read this crypto/Solana news headline:\n'
    '"{headline}" (Source: {source})\n'
    'Summary: {summary}\n\n'
    'Write ONE short tweet (2-4 sentences) reacting to this news. '
    'Connect it to on-chain identity, wallet reputation, Sybil resistance, '
    'or your experience building on Solana — whichever angle fits best. '
    'Be specific about what this news means for the ecosystem. '
    'Sound like a dev who has a real take — not just resharing news. '
    'ONE emoji max. Include {hashtags}. '
    'Do NOT include any link. {shill}'
)

REFLECTION_PROMPT = (
    'You are an AI agent managing a Twitter account for an indie Solana developer. '
    'Analyze your recent activity and provide a brief strategy adjustment.\n\n'
    'Recent posts (last 24h):\n{posts_summary}\n\n'
    'Today\'s stats: {today_stats}\n\n'
    'Provide EXACTLY two lines:\n'
    'ANALYSIS: [1 sentence — what pattern do you see in the posts above]\n'
    'STRATEGY: [1 sentence — what to adjust today, e.g. "more news reactions" '
    'or "shorter hot takes" or "engage more with DeFi accounts"]'
)

WALLET_SCORE_REPLY_PROMPT = (
    'You scored a Solana wallet and got these results:\n'
    'Address: {short_addr}\n'
    'Score: {score}/1400 | Tier: {tier} | Badges: {badges}\n'
    'Stats: {stats_line}\n\n'
    'Write a short, engaging reply (2-3 COMPLETE sentences) commenting on this wallet. '
    'Be specific — mention something interesting about their score, tier, or activity. '
    'If score is high, compliment genuinely. If low, be encouraging not mean. '
    'ONE emoji max. End with a subtle nudge to check their full card at identityprism.xyz. '
    'Do NOT include any raw link — just mention the site name naturally.'
)

PEAK_HOURS_UTC = list(range(14, 19))  # 14:00-18:00 UTC = prime crypto twitter
ACTIVE_HOURS_UTC = list(range(11, 23))  # broader active window
