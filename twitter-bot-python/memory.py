"""SQLite-based agent memory for tracking posts, interactions, wallet scores, and news."""

import json
import logging
import sqlite3
import time


class AgentMemory:
    def __init__(self, db_path):
        self.db_path = db_path
        self._init_db()

    def _conn(self):
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        with self._conn() as conn:
            conn.executescript('''
                CREATE TABLE IF NOT EXISTS posts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tweet_id TEXT UNIQUE,
                    action_type TEXT NOT NULL,
                    content TEXT,
                    topic TEXT,
                    created_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS interactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_handle TEXT NOT NULL,
                    tweet_id TEXT,
                    our_reply_id TEXT,
                    interaction_type TEXT NOT NULL,
                    content TEXT,
                    created_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS wallet_scores (
                    address TEXT PRIMARY KEY,
                    score INTEGER,
                    tier TEXT,
                    badges TEXT,
                    first_seen REAL NOT NULL,
                    last_checked REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS news (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    link TEXT UNIQUE,
                    source TEXT,
                    summary TEXT,
                    used_in_post INTEGER DEFAULT 0,
                    fetched_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS reflections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT UNIQUE NOT NULL,
                    analysis TEXT,
                    strategy TEXT,
                    created_at REAL NOT NULL
                );
            ''')

    # ── Posts ──

    def record_post(self, tweet_id, action_type, content, topic=None):
        try:
            with self._conn() as conn:
                conn.execute(
                    'INSERT OR IGNORE INTO posts (tweet_id, action_type, content, topic, created_at) '
                    'VALUES (?, ?, ?, ?, ?)',
                    (tweet_id, action_type, content, topic, time.time()),
                )
        except Exception as exc:
            logging.warning('memory: record_post failed: %s', exc)

    def get_recent_posts(self, days=3, limit=20):
        cutoff = time.time() - days * 86400
        with self._conn() as conn:
            rows = conn.execute(
                'SELECT tweet_id, action_type, content, topic, created_at '
                'FROM posts WHERE created_at > ? ORDER BY created_at DESC LIMIT ?',
                (cutoff, limit),
            ).fetchall()
        return [
            {'tweet_id': r[0], 'action_type': r[1], 'content': r[2],
             'topic': r[3], 'created_at': r[4]}
            for r in rows
        ]

    def get_recent_topics(self, days=3):
        cutoff = time.time() - days * 86400
        with self._conn() as conn:
            rows = conn.execute(
                'SELECT DISTINCT topic FROM posts WHERE topic IS NOT NULL AND created_at > ?',
                (cutoff,),
            ).fetchall()
        return [r[0] for r in rows]

    # ── Interactions ──

    def record_interaction(self, user_handle, tweet_id, our_reply_id,
                           interaction_type, content):
        try:
            with self._conn() as conn:
                conn.execute(
                    'INSERT INTO interactions '
                    '(user_handle, tweet_id, our_reply_id, interaction_type, content, created_at) '
                    'VALUES (?, ?, ?, ?, ?, ?)',
                    (user_handle, tweet_id, our_reply_id, interaction_type,
                     content, time.time()),
                )
        except Exception as exc:
            logging.warning('memory: record_interaction failed: %s', exc)

    def get_interaction_count(self, user_handle, days=7):
        cutoff = time.time() - days * 86400
        with self._conn() as conn:
            row = conn.execute(
                'SELECT COUNT(*) FROM interactions '
                'WHERE user_handle = ? AND created_at > ?',
                (user_handle, cutoff),
            ).fetchone()
        return row[0] if row else 0

    # ── Wallet scores ──

    def record_wallet_score(self, address, score, tier, badges):
        now = time.time()
        badges_json = json.dumps(badges) if isinstance(badges, list) else (badges or '[]')
        try:
            with self._conn() as conn:
                conn.execute(
                    'INSERT INTO wallet_scores '
                    '(address, score, tier, badges, first_seen, last_checked) '
                    'VALUES (?, ?, ?, ?, ?, ?) '
                    'ON CONFLICT(address) DO UPDATE SET '
                    'score=excluded.score, tier=excluded.tier, '
                    'badges=excluded.badges, last_checked=excluded.last_checked',
                    (address, score, tier, badges_json, now, now),
                )
        except Exception as exc:
            logging.warning('memory: record_wallet_score failed: %s', exc)

    def get_wallet_score(self, address):
        with self._conn() as conn:
            row = conn.execute(
                'SELECT score, tier, badges, last_checked '
                'FROM wallet_scores WHERE address = ?',
                (address,),
            ).fetchone()
        if not row:
            return None
        return {
            'score': row[0], 'tier': row[1],
            'badges': json.loads(row[2] or '[]'), 'last_checked': row[3],
        }

    def get_total_wallets_scored(self):
        with self._conn() as conn:
            row = conn.execute('SELECT COUNT(*) FROM wallet_scores').fetchone()
        return row[0] if row else 0

    # ── News ──

    def record_news(self, title, link, source, summary=None):
        try:
            with self._conn() as conn:
                conn.execute(
                    'INSERT OR IGNORE INTO news (title, link, source, summary, fetched_at) '
                    'VALUES (?, ?, ?, ?, ?)',
                    (title, link, source, summary, time.time()),
                )
        except Exception as exc:
            logging.warning('memory: record_news failed: %s', exc)

    def get_unused_news(self, limit=5):
        cutoff = time.time() - 3 * 86400
        with self._conn() as conn:
            rows = conn.execute(
                'SELECT title, link, source, summary FROM news '
                'WHERE used_in_post = 0 AND fetched_at > ? '
                'ORDER BY fetched_at DESC LIMIT ?',
                (cutoff, limit),
            ).fetchall()
        return [
            {'title': r[0], 'link': r[1], 'source': r[2], 'summary': r[3]}
            for r in rows
        ]

    def mark_news_used(self, link):
        with self._conn() as conn:
            conn.execute(
                'UPDATE news SET used_in_post = 1 WHERE link = ?', (link,),
            )

    # ── Reflections ──

    def get_today_reflection(self, date_str):
        with self._conn() as conn:
            row = conn.execute(
                'SELECT analysis, strategy FROM reflections WHERE date = ?',
                (date_str,),
            ).fetchone()
        if not row:
            return None
        return {'analysis': row[0], 'strategy': row[1]}

    def save_reflection(self, date_str, analysis, strategy):
        try:
            with self._conn() as conn:
                conn.execute(
                    'INSERT INTO reflections (date, analysis, strategy, created_at) '
                    'VALUES (?, ?, ?, ?) '
                    'ON CONFLICT(date) DO UPDATE SET '
                    'analysis=excluded.analysis, strategy=excluded.strategy, '
                    'created_at=excluded.created_at',
                    (date_str, analysis, strategy, time.time()),
                )
        except Exception as exc:
            logging.warning('memory: save_reflection failed: %s', exc)

    # ── Cleanup ──

    def cleanup_old(self, days=30):
        cutoff = time.time() - days * 86400
        try:
            with self._conn() as conn:
                conn.execute('DELETE FROM news WHERE fetched_at < ?', (cutoff,))
                conn.execute(
                    'DELETE FROM interactions WHERE created_at < ?', (cutoff,),
                )
        except Exception as exc:
            logging.warning('memory: cleanup_old failed: %s', exc)
