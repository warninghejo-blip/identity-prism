"""
Colosseum Agent Hackathon engagement bot for Identity Prism.
Runs alongside the Twitter bot, handling forum activity, voting,
heartbeat checks, progress updates, and poll responses.
"""

import asyncio
import json
import logging
import os
import random
import time
from pathlib import Path

from curl_cffi import requests as cffi_requests
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_URL = 'https://agents.colosseum.com/api'
SECRETS_PATH = Path(os.getenv('COLOSSEUM_SECRETS_PATH', str(Path(__file__).parent / 'secrets' / 'colosseum-hackathon.json')))
STATE_PATH = Path(__file__).parent / 'colosseum_state.json'
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')

# Intervals (seconds)
STATUS_INTERVAL = 2 * 3600
LEADERBOARD_INTERVAL = 3600
FORUM_NEW_INTERVAL = 3600
FORUM_REPLIES_INTERVAL = 1800
PROGRESS_POST_INTERVAL = 8 * 3600
VOTE_INTERVAL = 3600
CYCLE_SLEEP = 300

MAX_COMMENTS_PER_CYCLE = 3
MAX_VOTES_PER_CYCLE = 5

PROJECT_CONTEXT = """You are Identity Prism's AI agent participating in the Colosseum Agent Hackathon on Solana.
Identity Prism reveals your on-chain soul — connect any wallet and get a cosmic identity card with reputation score (up to 1200), rarest badges, and wallet personality from real on-chain data.
Features: 3D solar system visualization (planets=tokens, moons=NFTs, dust=activity), multi-factor reputation scoring, rarity tiers (Common to Mythic), cNFT minting via Metaplex Bubblegum, Black Hole token burner (burn unwanted tokens, reclaim rent SOL), Solana Blinks/Actions for shareable wallet checks, Solana MWA for Saga/Seeker mobile, AI agent on Twitter (@Identity_Prism).
Tech: Vite+React+Three.js, Node.js, Helius RPC/DAS API, Gemini AI (text+images), Bubblegum cNFTs, Solana Actions/Blinks, Capacitor.
Live at https://identityprism.xyz | Twitter: https://x.com/Identity_Prism
Be helpful, concise, and genuinely engaging. Never be spammy."""

PROJECT_VOTE_LINK = 'https://www.colosseum.com/projects/identity-prism'
VOTE_CTA = f'\n\nCheck out Identity Prism and vote if you like it: {PROJECT_VOTE_LINK}'

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_secrets():
    with open(SECRETS_PATH) as f:
        return json.load(f)

def load_state():
    if STATE_PATH.exists():
        with open(STATE_PATH) as f:
            return json.load(f)
    return {}

def save_state(state):
    with open(STATE_PATH, 'w') as f:
        json.dump(state, f, indent=2)

def hdrs(api_key):
    return {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }

def api_get(path, api_key=None, params=None):
    h = hdrs(api_key) if api_key else {'Content-Type': 'application/json'}
    time.sleep(random.uniform(1.0, 3.0))
    try:
        r = cffi_requests.get(f'{BASE_URL}{path}', headers=h, params=params,
                              impersonate='chrome131', timeout=30)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logging.warning('GET %s failed: %s', path, e)
        return None

RATE_LIMITED = 'RATE_LIMITED'

def api_post(path, api_key, payload=None):
    time.sleep(random.uniform(2.0, 5.0))
    try:
        r = cffi_requests.post(f'{BASE_URL}{path}', headers=hdrs(api_key),
                               json=payload or {}, impersonate='chrome131', timeout=30)
        if r.status_code == 429:
            logging.warning('429 on POST %s — rate limited', path)
            return RATE_LIMITED
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logging.warning('POST %s failed: %s', path, e)
        return None

# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------

_GEMINI_REST_URL = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}'

def generate_text(prompt, max_tokens=1024):
    if not GEMINI_API_KEY:
        return None
    time.sleep(random.uniform(1.5, 4.0))
    payload = {
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {'temperature': 0.9, 'maxOutputTokens': max_tokens},
    }
    try:
        resp = cffi_requests.post(
            _GEMINI_REST_URL, json=payload,
            impersonate='chrome131', timeout=30,
        )
        if resp.status_code != 200:
            logging.warning('Gemini generation failed: HTTP %d %s', resp.status_code, resp.text[:200])
            return None
        data = resp.json()
        candidate = data.get('candidates', [{}])[0]
        finish = candidate.get('finishReason', '')
        if finish in ('MAX_TOKENS', 'STOP_CANDIDATE_MAX_TOKENS'):
            logging.warning('Gemini response truncated (finish_reason=%s)', finish)
            return None
        text = candidate.get('content', {}).get('parts', [{}])[0].get('text', '').strip()
        if not text:
            return None
        if text.startswith('"') and text.endswith('"'):
            text = text[1:-1].strip()
        return text
    except Exception as e:
        logging.warning('Gemini generation failed: %s', e)
        return None

def is_quality(text, min_len=40):
    """Reject truncated or too-short text."""
    if not text or len(text) < min_len:
        return False
    stripped = text.rstrip()
    if not stripped:
        return False
    last = stripped[-1]
    # Must end with sentence-ending punctuation or quote or unicode
    if last not in '.!?)"' and ord(last) <= 127:
        return False
    # Reject if it ends mid-phrase (common truncation patterns)
    lower_end = stripped[-30:].lower()
    truncation_markers = [' and ', ' the ', ' we ', ' at ', ' to ', ' in ', ' a ', ' an ',
                          ' or ', ' but ', ' with ', ' for ', ' of ', ' is ', ' are ']
    for marker in truncation_markers:
        if lower_end.endswith(marker.rstrip()):
            return False
    return True

# ---------------------------------------------------------------------------
# Actions (each does exactly ONE forum write)
# ---------------------------------------------------------------------------

def action_post(api_key, state):
    """Post a progress update on the forum."""
    status_data = api_get('/agents/status', api_key)
    day = status_data.get('hackathon', {}).get('currentDay', '?') if status_data else '?'
    remaining = status_data.get('hackathon', {}).get('timeRemainingFormatted', '') if status_data else ''
    prompt = f"""{PROJECT_CONTEXT}

Write a hackathon progress update forum post for Day {day} ({remaining}).
Topics to cover (pick 2-3):
- What we've built/improved recently (AI agent, cosmic identity cards, on-chain scoring, cNFT minting)
- Interesting technical challenges solved
- What's coming next
- Invitation for feedback or collaboration

Format: title on first line, then blank line, then body (3-6 paragraphs, ~200-400 words).
Be genuine and interesting. Show real technical depth.
Do NOT start with "Progress Update Day X" — be creative with the title."""
    text = None
    for attempt in range(3):
        text = generate_text(prompt)
        if text and is_quality(text, min_len=100):
            break
        logging.warning('Post generation attempt %d/3 failed quality check (len=%d)',
                        attempt + 1, len(text) if text else 0)
        text = None
    if not text:
        logging.warning('Post generation failed after 3 attempts')
        return False
    lines = text.strip().split('\n', 1)
    title = lines[0].strip().strip('#').strip()[:200]
    body = lines[1].strip() if len(lines) > 1 else text
    if not is_quality(body, min_len=80):
        logging.warning('Post body failed quality check: %s...', body[:60])
        return False
    if len(title) < 3:
        title = f'Identity Prism — Day {day} update'
    result = api_post('/forum/posts', api_key, {
        'title': title,
        'body': body,
        'tags': ['progress-update', 'identity', 'ai'],
    })
    if result == RATE_LIMITED:
        logging.info('Rate limited — will retry post later')
        return False
    if result:
        post_id = result.get('post', {}).get('id')
        if post_id:
            state.setdefault('our_post_ids', []).append(post_id)
        logging.info('ACTION POST: %s', title[:80])
        save_state(state)
        return True
    return False

def action_comment(api_key, state):
    """Comment on ONE relevant forum post by another agent."""
    commented_posts = set(state.get('commented_post_ids', []))
    our_post_ids = set(state.get('our_post_ids', []))
    posts = api_get('/forum/posts', params={'sort': 'new', 'limit': 30})
    if not posts:
        return False
    post_list = posts if isinstance(posts, list) else posts.get('posts', [])
    for post in post_list:
        post_id = post.get('id')
        if not post_id or post_id in our_post_ids or post_id in commented_posts:
            continue
        tags = post.get('tags', [])
        title = (post.get('title') or '').lower()
        body = (post.get('body') or '')
        claim = post.get('agentClaim') or {}
        author = claim.get('xUsername') or post.get('agentName', 'unknown')
        relevant = any(t in tags for t in ['identity', 'ai', 'consumer', 'infra', 'defi']) or \
                   any(kw in title for kw in ['identity', 'reputation', 'wallet', 'nft', 'on-chain', 'soul', 'ai', 'agent'])
        if not relevant and random.random() > 0.4:
            continue
        prompt = f"""{PROJECT_CONTEXT}

A hackathon participant posted on the forum:
Author: @{author}
Title: {post.get('title', '')}
Body: {body[:600]}
Tags: {tags}

Write a brief, genuine comment (2-4 sentences). START your comment by addressing the author as @{author}.
Be helpful and relevant to their topic.
If their project could benefit from identity/reputation data, mention that naturally.
Do NOT be salesy or spammy. Be collegial — you're a fellow hackathon participant.
End with a brief invitation to check out and vote for Identity Prism (include the link {PROJECT_VOTE_LINK}).
Reply with ONLY the comment text (starting with @{author})."""
        comment = generate_text(prompt)
        if not comment or not is_quality(comment):
            continue
        result = api_post(f'/forum/posts/{post_id}/comments', api_key, {'body': comment})
        if result == RATE_LIMITED:
            logging.info('Rate limited — will retry comment later')
            return False
        if result:
            commented_posts.add(post_id)
            state['commented_post_ids'] = list(commented_posts)[-200:]
            cid = result.get('comment', {}).get('id')
            if cid:
                state.setdefault('our_comment_ids', []).append(cid)
            logging.info('ACTION COMMENT on %s (@%s): %s', post_id, author, comment[:80])
            save_state(state)
            return True
    return False

def action_reply(api_key, state):
    """Reply to ONE new comment on our forum posts. Returns False if nothing to reply to."""
    our_post_ids = state.get('our_post_ids', [])
    if not our_post_ids:
        data = api_get('/forum/me/posts', api_key, params={'sort': 'new', 'limit': 20})
        if data:
            post_list = data if isinstance(data, list) else data.get('posts', [])
            our_post_ids = [p['id'] for p in post_list if 'id' in p]
            state['our_post_ids'] = our_post_ids
    replied_comment_ids = set(state.get('replied_comment_ids', []))
    for post_id in our_post_ids:
        data = api_get(f'/forum/posts/{post_id}/comments', params={'sort': 'new', 'limit': 20})
        if not data:
            continue
        comment_list = data if isinstance(data, list) else data.get('comments', [])
        new_comments = [c for c in comment_list
                        if c.get('agentId') != state.get('agent_id')
                        and c.get('id') not in replied_comment_ids]
        for comment in new_comments:
            cclaim = comment.get('agentClaim') or {}
            cname = cclaim.get('xUsername') or comment.get('agentName', 'unknown')
            prompt = f"""{PROJECT_CONTEXT}

Someone replied to your forum post:
Their comment: {comment.get('body', '')[:600]}
Agent: @{cname}

Write a brief, friendly reply (2-3 sentences). START your reply by addressing them as @{cname}.
Be helpful and continue the conversation naturally.
End with a brief invitation to check out and vote for Identity Prism (include the link {PROJECT_VOTE_LINK}).
Reply with ONLY your response text (starting with @{cname})."""
            reply = generate_text(prompt)
            if not reply or not is_quality(reply):
                continue
            result = api_post(f'/forum/posts/{post_id}/comments', api_key, {'body': reply})
            if result == RATE_LIMITED:
                logging.info('Rate limited — will retry reply later')
                return False
            if result:
                replied_comment_ids.add(comment.get('id'))
                state['replied_comment_ids'] = list(replied_comment_ids)[-500:]
                logging.info('ACTION REPLY to @%s on post %s: %s', cname, post_id, reply[:80])
                save_state(state)
                return True
    return False

# ---------------------------------------------------------------------------
# Passive checks (GET-only, no rate limit concerns)
# ---------------------------------------------------------------------------

def check_status_and_polls(api_key, state):
    """Check agent status, announcements, polls."""
    data = api_get('/agents/status', api_key)
    if not data:
        return
    logging.info('Status: %s | Day %s | %s',
                 data.get('status', '?'),
                 data.get('hackathon', {}).get('currentDay', '?'),
                 data.get('hackathon', {}).get('timeRemainingFormatted', '?'))
    ann = data.get('announcement')
    if ann and ann != state.get('last_announcement'):
        logging.info('ANNOUNCEMENT: %s', ann)
        state['last_announcement'] = ann
    steps = data.get('nextSteps', [])
    if steps:
        logging.info('Next steps: %s', ', '.join(steps))
    if data.get('hasActivePoll'):
        handle_poll(api_key, state)
    save_state(state)

def handle_poll(api_key, state):
    """Fetch and respond to active poll."""
    data = api_get('/agents/polls/active', api_key)
    if not data or 'poll' not in data:
        return
    poll = data['poll']
    poll_id = poll.get('id')
    if poll_id and poll_id == state.get('last_poll_id'):
        return
    logging.info('Active poll: %s', poll.get('prompt', ''))
    schema = poll.get('responseSchema', {})
    props = schema.get('properties', {})
    required = schema.get('required', [])
    response = {}
    for field in required:
        fi = props.get(field, {})
        enums = fi.get('enum', [])
        if field == 'model':
            response[field] = 'gemini-2.5-flash' if 'gemini-2.5-flash' in enums else (enums[0] if enums else 'other')
            if response[field] == 'other':
                response['otherModel'] = 'gemini-2.5-flash'
        elif field == 'harness':
            response[field] = 'windsurf' if 'windsurf' in enums else ('cursor' if 'cursor' in enums else (enums[0] if enums else 'other'))
            if response[field] == 'other':
                response['otherHarness'] = 'windsurf'
        elif field == 'oversight':
            response[field] = 'occasional-checkins'
        elif enums:
            p = f"{PROJECT_CONTEXT}\nPoll: {poll.get('prompt','')}\nField: {field}\nOptions: {enums}\nPick the best. Reply ONLY the value."
            a = generate_text(p, max_tokens=50)
            response[field] = a.strip('"\'') if a and a.strip('"\'') in enums else enums[0]
        elif fi.get('type') == 'string':
            p = f"{PROJECT_CONTEXT}\nPoll: {poll.get('prompt','')}\nField: {field} (max {fi.get('maxLength',500)} chars)\nGive a thoughtful answer. Reply ONLY the text."
            a = generate_text(p, max_tokens=300)
            response[field] = (a or 'Identity Prism — on-chain identity visualization on Solana')[:500]
    result = api_post(f'/agents/polls/{poll_id}/response', api_key, {'response': response})
    if result:
        logging.info('Poll %s answered', poll_id)
        state['last_poll_id'] = poll_id
    save_state(state)

def check_leaderboard(api_key, state):
    data = api_get('/leaderboard', params={'limit': 50})
    if not data:
        return
    plist = data if isinstance(data, list) else data.get('projects', data.get('leaderboard', []))
    if isinstance(plist, list):
        for i, p in enumerate(plist):
            if p.get('slug') == 'identity-prism' or p.get('name') == 'Identity Prism':
                logging.info('Leaderboard: #%d (human: %d, agent: %d)',
                             i + 1, p.get('humanUpvotes', 0), p.get('agentUpvotes', 0))
                state['leaderboard_position'] = i + 1
                break
    save_state(state)

def cleanup_pending_deletes(api_key, state):
    pending = state.get('pending_deletes', [])
    if not pending:
        return
    still = []
    for cid in pending:
        r = requests.delete(f'{BASE_URL}/forum/comments/{cid}',
                            headers=hdrs(api_key), timeout=30)
        if r.status_code == 200:
            logging.info('Deleted old comment %s', cid)
        elif r.status_code == 429:
            still.append(cid)
            break
        time.sleep(2)
    state['pending_deletes'] = still
    save_state(state)

# ---------------------------------------------------------------------------
# Interval-based tasks
# ---------------------------------------------------------------------------

def browse_forum(api_key, state):
    """Browse new forum posts, upvote interesting ones, comment on relevant ones."""
    now = time.time()
    if now - state.get('last_forum_browse', 0) < FORUM_NEW_INTERVAL:
        return
    state['last_forum_browse'] = now
    commented_posts = set(state.get('commented_post_ids', []))
    our_post_ids = set(state.get('our_post_ids', []))
    posts = api_get('/forum/posts', params={'sort': 'new', 'limit': 20})
    if not posts:
        save_state(state)
        return
    post_list = posts if isinstance(posts, list) else posts.get('posts', [])
    comments_made = 0
    votes_made = 0
    for post in post_list:
        post_id = post.get('id')
        if not post_id or post_id in our_post_ids:
            continue
        # Vote
        if post_id not in state.get('voted_post_ids', []) and votes_made < MAX_VOTES_PER_CYCLE:
            result = api_post(f'/forum/posts/{post_id}/vote', api_key, {'value': 1})
            if result and result != RATE_LIMITED:
                votes_made += 1
                state.setdefault('voted_post_ids', []).append(post_id)
                logging.info('Upvoted post %s: %s', post_id, post.get('title', '')[:60])
                time.sleep(random.uniform(1, 3))
            elif result == RATE_LIMITED:
                break
        # Comment (max 1 per cycle to be safe)
        if post_id not in commented_posts and comments_made < 1:
            author = post.get('agentName', 'unknown')
            body = (post.get('body') or '')
            tags = post.get('tags', [])
            title_lower = (post.get('title') or '').lower()
            relevant = any(t in tags for t in ['identity', 'ai', 'consumer', 'infra', 'defi']) or \
                       any(kw in title_lower for kw in ['identity', 'reputation', 'wallet', 'nft', 'on-chain', 'soul', 'ai', 'agent'])
            if not relevant and random.random() > 0.4:
                continue
            prompt = f"""{PROJECT_CONTEXT}

A hackathon participant posted on the forum:
Author: @{author}
Title: {post.get('title', '')}
Body: {body[:600]}
Tags: {tags}

Write a brief, genuine comment (2-4 sentences). START your comment by addressing the author as @{author}.
Be helpful and relevant to their topic.
If their project could benefit from identity/reputation data, mention that naturally.
Do NOT be salesy or spammy. Be collegial — you're a fellow hackathon participant.
End with a brief invitation to check out and vote for Identity Prism (include the link {PROJECT_VOTE_LINK}).
Reply with ONLY the comment text (starting with @{author})."""
            comment = generate_text(prompt)
            if comment and is_quality(comment):
                result = api_post(f'/forum/posts/{post_id}/comments', api_key, {'body': comment})
                if result == RATE_LIMITED:
                    break
                if result:
                    comments_made += 1
                    commented_posts.add(post_id)
                    state['commented_post_ids'] = list(commented_posts)[-200:]
                    cid = result.get('comment', {}).get('id')
                    if cid:
                        state.setdefault('our_comment_ids', []).append(cid)
                        state['our_comment_ids'] = state['our_comment_ids'][-500:]
                    logging.info('Commented on post %s (@%s): %s', post_id, author, comment[:80])
                    time.sleep(random.uniform(3, 8))
    save_state(state)

def check_replies(api_key, state):
    """Check for new replies on our posts AND on posts where we commented."""
    now = time.time()
    if now - state.get('last_replies_check', 0) < FORUM_REPLIES_INTERVAL:
        return
    state['last_replies_check'] = now
    agent_id = state.get('agent_id')
    our_comment_ids = set(state.get('our_comment_ids', []))
    replied_ids = set(state.get('replied_comment_ids', []))

    # Collect all post IDs to check: our posts + posts we commented on
    our_post_ids = state.get('our_post_ids', [])
    if not our_post_ids:
        data = api_get('/forum/me/posts', api_key, params={'sort': 'new', 'limit': 20})
        if data:
            post_list = data if isinstance(data, list) else data.get('posts', [])
            our_post_ids = [p['id'] for p in post_list if 'id' in p]
            state['our_post_ids'] = our_post_ids
    commented_post_ids = state.get('commented_post_ids', [])
    all_post_ids = list(dict.fromkeys(our_post_ids + commented_post_ids))

    replied_this_cycle = False
    for post_id in all_post_ids:
        if replied_this_cycle:
            break
        data = api_get(f'/forum/posts/{post_id}/comments', params={'sort': 'new', 'limit': 30})
        if not data:
            continue
        comment_list = data if isinstance(data, list) else data.get('comments', [])

        # Find comments by others that we haven't replied to yet
        # For posts we commented on: only reply to comments that appear AFTER ours
        is_our_post = post_id in our_post_ids
        saw_our_comment = is_our_post  # on our posts, all comments are relevant
        for comment in comment_list:
            cid = comment.get('id')
            if comment.get('agentId') == agent_id or cid in our_comment_ids:
                saw_our_comment = True
                continue
            if not saw_our_comment:
                continue
            if cid in replied_ids:
                continue
            cclaim = comment.get('agentClaim') or {}
            cname = cclaim.get('xUsername') or comment.get('agentName', 'unknown')
            cbody = comment.get('body', '')
            if not cbody or len(cbody) < 5:
                continue
            context = 'your forum post' if is_our_post else 'a forum thread where you commented'
            prompt = f"""{PROJECT_CONTEXT}

Someone wrote in {context}:
Their comment: {cbody[:600]}
Agent: @{cname}

Write a brief, friendly reply (2-3 sentences). START your reply by addressing them as @{cname}.
Be helpful and continue the conversation naturally.
End with a brief invitation to check out and vote for Identity Prism (include the link {PROJECT_VOTE_LINK}).
Reply with ONLY your response text (starting with @{cname})."""
            reply = generate_text(prompt)
            if not reply or not is_quality(reply):
                continue
            result = api_post(f'/forum/posts/{post_id}/comments', api_key, {'body': reply})
            if result == RATE_LIMITED:
                save_state(state)
                return
            if result:
                replied_ids.add(cid)
                state['replied_comment_ids'] = list(replied_ids)[-500:]
                rcid = result.get('comment', {}).get('id')
                if rcid:
                    our_comment_ids.add(rcid)
                    state['our_comment_ids'] = list(our_comment_ids)[-500:]
                logging.info('Replied to @%s in post %s (%s)', cname, post_id,
                             'our post' if is_our_post else 'their post')
                replied_this_cycle = True
                time.sleep(random.uniform(2, 5))
            break
    save_state(state)

def vote_on_projects(api_key, state):
    """Browse and vote on projects."""
    now = time.time()
    if now - state.get('last_project_vote', 0) < VOTE_INTERVAL:
        return
    state['last_project_vote'] = now
    voted = set(state.get('voted_project_ids', []))
    data = api_get('/projects', params={'includeDrafts': 'true'})
    if not data:
        save_state(state)
        return
    project_list = data if isinstance(data, list) else data.get('projects', [])
    votes_cast = 0
    for project in project_list:
        pid = project.get('id')
        if not pid or pid in voted or pid == state.get('project_id'):
            continue
        if votes_cast >= MAX_VOTES_PER_CYCLE:
            break
        desc = (project.get('description') or '').lower()
        tags = project.get('tags', [])
        relevant = any(t in tags for t in ['identity', 'ai', 'consumer', 'infra']) or \
                   any(kw in desc for kw in ['identity', 'reputation', 'wallet', 'nft', 'on-chain'])
        if relevant or random.random() < 0.2:
            result = api_post(f'/projects/{pid}/vote', api_key)
            if result == RATE_LIMITED:
                break
            if result:
                voted.add(pid)
                votes_cast += 1
                logging.info('Voted for project %s: %s', pid, project.get('name', '')[:60])
                time.sleep(random.uniform(1, 3))
    state['voted_project_ids'] = list(voted)
    save_state(state)

def post_progress_update(api_key, state):
    """Post a progress update every ~24 hours."""
    now = time.time()
    if now - state.get('last_progress_post', 0) < PROGRESS_POST_INTERVAL:
        return
    action_post(api_key, state)
    state['last_progress_post'] = now
    save_state(state)

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

async def main():
    logging.info('Colosseum engagement bot starting')
    secrets = load_secrets()
    api_key = secrets['apiKey']
    state = load_state()
    state['agent_id'] = secrets.get('agent_id')
    state['project_id'] = secrets.get('project_id')
    state.setdefault('our_post_ids', [secrets.get('forum_post_id')])
    save_state(state)

    logging.info('Agent ID: %s | Project ID: %s', state['agent_id'], state['project_id'])

    while True:
        try:
            cleanup_pending_deletes(api_key, state)
            check_status_and_polls(api_key, state)
            check_leaderboard(api_key, state)
            browse_forum(api_key, state)
            check_replies(api_key, state)
            vote_on_projects(api_key, state)
            post_progress_update(api_key, state)
        except Exception as e:
            logging.error('Cycle error: %s', e, exc_info=True)

        sleep_time = CYCLE_SLEEP + random.uniform(-30, 30)
        logging.info('Sleeping %.0fs', sleep_time)
        await asyncio.sleep(sleep_time)

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
