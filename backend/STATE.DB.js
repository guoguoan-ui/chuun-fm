/**
 * STATE.DB.js — 持久化记忆数据库 (SQLite)
 * 存储聊天记录、播放历史、心情记录、网易云绑定
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'chuun.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

// ---- 初始化表结构 ----
db.exec(`
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id TEXT,
    name TEXT,
    artists TEXT,
    url TEXT,
    reason TEXT,
    position INTEGER DEFAULT 0,
    played INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS now_playing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id TEXT,
    name TEXT,
    artists TEXT,
    url TEXT,
    started_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS mood_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emotion TEXT,
    text TEXT,
    suggested_genre TEXT,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS netease_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT,
    phone TEXT,
    password TEXT,
    type TEXT,
    bind_at INTEGER
  );
`);

// ---- 插入默认配置 ----
const defaultConfigs = {
  taste: loadConfigFile('taste.md'),
  routines: loadConfigFile('routines.md'),
  mood_rules: loadConfigFile('mood-rules.md'),
};

function loadConfigFile(filename) {
  const filepath = path.join(__dirname, 'config', filename);
  try { return fs.readFileSync(filepath, 'utf-8'); } catch { return '(未配置)'; }
}

const insertConfig = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultConfigs)) {
  insertConfig.run(key, value);
}

// ---- 公共 API ----

function getTaste() {
  const taste = db.prepare("SELECT value FROM config WHERE key = 'taste'").get();
  const routines = db.prepare("SELECT value FROM config WHERE key = 'routines'").get();
  const moodRules = db.prepare("SELECT value FROM config WHERE key = 'mood_rules'").get();
  return { taste: taste?.value || '', routines: routines?.value || '', moodRules: moodRules?.value || '' };
}

function updateTaste(type, content) {
  db.prepare('UPDATE config SET value = ? WHERE key = ?').run(content, type);
}

function addHistory(entry) {
  db.prepare('INSERT INTO history (role, content, timestamp) VALUES (?, ?, ?)').run(entry.role, entry.content, entry.timestamp);
}

function getRecentHistory(limit = 20) {
  return db.prepare('SELECT * FROM history ORDER BY id DESC LIMIT ?').all(limit).reverse();
}

function getHistory() {
  return db.prepare('SELECT * FROM history ORDER BY id DESC LIMIT 100').all();
}

function setQueue(songs) {
  db.prepare('DELETE FROM queue').run();
  const insert = db.prepare('INSERT INTO queue (song_id, name, artists, url, reason, position) VALUES (?, ?, ?, ?, ?, ?)');
  const tx = db.transaction((items) => {
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      insert.run(String(s.id || ''), s.name || '未知歌曲', JSON.stringify(s.artists || []), s.url || '', s.reason || '', i);
    }
  });
  tx(songs);
}

function getQueue() {
  return db.prepare('SELECT * FROM queue WHERE played = 0 ORDER BY position ASC').all().map(s => ({
    ...s, artists: JSON.parse(s.artists || '[]'),
  }));
}

function setNowPlaying(song) {
  db.prepare('DELETE FROM now_playing').run();
  db.prepare('INSERT INTO now_playing (song_id, name, artists, url, started_at) VALUES (?, ?, ?, ?, ?)')
    .run(String(song.id || ''), song.name || '未知歌曲', JSON.stringify(song.artists || []), song.url || '', Date.now());
}

function getNowPlaying() {
  const row = db.prepare('SELECT * FROM now_playing ORDER BY id DESC LIMIT 1').get();
  if (!row) return { name: '等待你的指令', artists: [] };
  return { ...row, artists: JSON.parse(row.artists || '[]') };
}

function setControl(action) {
  db.prepare("INSERT INTO config (key, value) VALUES ('last_control', ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(action, action);
}

function getTodayPlan() {
  const now = new Date();
  return {
    date: now.toISOString().split('T')[0],
    morningShow: now.getHours() < 7 ? '待播放' : '已播放',
    queue: getQueue(),
    weather: '',
    schedule: [],
  };
}

// ---- 心情记录 ----
function addMoodRecord(emotion, text) {
  db.prepare('INSERT INTO mood_records (emotion, text, suggested_genre, timestamp) VALUES (?, ?, ?, ?)')
    .run(emotion, text, '', Date.now());
}

function getMoodHistory(limit = 20) {
  return db.prepare('SELECT * FROM mood_records ORDER BY id DESC LIMIT ?').all(limit);
}

// ---- 网易云配置 ----
function setNeteaseConfig(config) {
  db.prepare('DELETE FROM netease_config').run();
  db.prepare('INSERT INTO netease_config (uid, phone, password, type, bind_at) VALUES (?, ?, ?, ?, ?)')
    .run(config.uid || '', config.phone || '', config.password || '', config.type || 'uid', Date.now());
}

function getNeteaseConfig() {
  return db.prepare('SELECT * FROM netease_config ORDER BY id DESC LIMIT 1').get() || null;
}

module.exports = {
  getTaste, updateTaste, addHistory, getRecentHistory, getHistory,
  setQueue, getQueue, setNowPlaying, getNowPlaying, setControl, getTodayPlan,
  addMoodRecord, getMoodHistory, setNeteaseConfig, getNeteaseConfig,
};
