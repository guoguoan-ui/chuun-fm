/**
 * CHUUN FM 私人 AI 电台 - 主服务器
 * Express + WebSocket 双引擎
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---- 模块初始化 ----
const stateDB = require('./STATE.DB');
const router = require('./ROUTER');
const scheduler = require('./SCHEDULER');
const ai = require('./AI');
const tts = require('./TTS');
const netbase = require('./NETBASE');
const queue = require('./QUEUE');
queue.init();

// ---- 中间件 ----
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件：前端 PWA
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// TTS 音频缓存
app.use('/tts', express.static(path.join(__dirname, '..', 'tts_cache')));

// ---- WebSocket 连接管理 ----
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] 新客户端连接，当前 ${clients.size} 个`);
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] 客户端断开，当前 ${clients.size} 个`);
  });
});

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, timestamp: Date.now() });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// ---- RESTful API 路由 ----

// 当前播放状态
app.get('/api/now', (req, res) => {
  const current = queue.getCurrent();
  res.json(current || stateDB.getNowPlaying());
});

// 读取用户品味配置
app.get('/api/taste', (req, res) => {
  res.json(stateDB.getTaste());
});

// 今日播放计划
app.get('/api/plan/today', (req, res) => {
  res.json(stateDB.getTodayPlan());
});

// 播放列表
app.get('/api/queue', (req, res) => {
  res.json(stateDB.getQueue());
});

// 历史记录
app.get('/api/history', (req, res) => {
  res.json(stateDB.getHistory());
});

// 网易云搜索歌曲
app.get('/api/search', async (req, res) => {
  try {
    const keyword = req.query.q || '';
    const result = await netbase.search(keyword);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取歌曲播放地址
app.get('/api/song/url', async (req, res) => {
  try {
    const id = req.query.id;
    const url = await netbase.getSongUrl(id);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取用户歌单
app.get('/api/user/playlists', async (req, res) => {
  try {
    const playlists = await netbase.getUserPlaylists();
    res.json(playlists);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 个性化推荐
app.get('/api/recommend', async (req, res) => {
  try {
    const recs = await netbase.getPersonalized();
    res.json(recs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 歌词
app.get('/api/lyrics', async (req, res) => {
  try {
    const id = req.query.id;
    const lyrics = await netbase.getLyrics(id);
    res.json(lyrics);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 歌曲评论
app.get('/api/comments', async (req, res) => {
  try {
    const id = req.query.id;
    const page = parseInt(req.query.page) || 1;
    if (!id) return res.status(400).json({ error: '缺少歌曲ID' });
    const comments = await netbase.getSongComments(id, page);
    res.json(comments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- 网易云增强 API ----

// 用户音乐画像
app.get('/api/user/profile', async (req, res) => {
  try {
    const uid = req.query.uid || null;
    const profile = await netbase.generateUserProfile(uid);
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 每日推荐歌曲
app.get('/api/recommend/daily', async (req, res) => {
  try {
    const songs = await netbase.getDailyRecommend();
    res.json(songs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 歌单内曲目
app.get('/api/playlist/tracks', async (req, res) => {
  try {
    const id = req.query.id;
    const limit = parseInt(req.query.limit) || 50;
    const tracks = await netbase.getPlaylistTracks(id, limit);
    res.json(tracks);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 按标签分类搜索（独立/民谣/独立民谣等）
app.get('/api/search/genre', async (req, res) => {
  try {
    const genre = req.query.genre || '独立';
    const songs = await netbase.search(genre, 30);
    // 过滤匹配标签的歌曲
    const tagged = (songs || []).filter(s =>
      s.tags && s.tags.some(t => t.toLowerCase().includes(genre.toLowerCase()))
    );
    res.json(tagged.length > 0 ? tagged : songs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 检测歌曲标签
app.get('/api/song/tags', async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: '缺少 id' });
    const detail = await netbase.getSongDetail(id);
    if (detail) {
      res.json({ tags: detail.tags, genre: detail.genre });
    } else {
      // 获取失败时使用备用检测
      res.json({ tags: ['流行'], genre: '流行' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 智能推歌（按用户画像风格）
app.get('/api/recommend/smart', async (req, res) => {
  try {
    const profile = await netbase.generateUserProfile();
    const topGenres = profile.topGenres || ['独立', '民谣'];
    // 用 top 风格搜索歌曲
    const allSongs = [];
    for (const genre of topGenres.slice(0, 3)) {
      const songs = await netbase.search(genre, 10);
      allSongs.push(...(songs || []));
    }
    // 去重
    const seen = new Set();
    const unique = allSongs.filter(s => { const k = s.id; if (seen.has(k)) return false; seen.add(k); return true; });
    res.json({ songs: unique.slice(0, 20), profile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════
// SEENS 风格 API
// ═══════════════════════════════════════

// 下一首（自动补 URL）
app.post('/api/next', async (req, res) => {
  let next = queue.advance();
  // 如果没 URL 但还有下一首，尝试获取
  if (next && !next.url) {
    try {
      const url = await netbase.getSongUrl(next.id);
      if (url) next.url = url;
    } catch(e) {}
  }
  const upNext = queue.getUpNext();
  res.json({ nowPlaying: next, upNext, queueLength: queue.getQueue().length });
});

// 清空队列
app.post('/api/queue/clear', (req, res) => {
  queue.clear();
  res.json({ ok: true });
});

// 添加到队列
app.post('/api/queue/add', (req, res) => {
  const { songs } = req.body;
  if (songs && Array.isArray(songs)) {
    queue.addToQueue(songs);
    res.json({ ok: true, queueLength: queue.getQueue().length });
  } else {
    res.status(400).json({ error: '需要 songs 数组' });
  }
});

// 自动唤醒问候（个性化版）
app.get('/api/wake', async (req, res) => {
  try {
    const weather = await require('./CONTEXT').getWeatherSimple();
    const hour = new Date().getHours();

    // 判断时段
    let timeGreeting = 'morning';
    if (hour >= 12 && hour < 17) timeGreeting = 'afternoon';
    else if (hour >= 17 || hour < 5) timeGreeting = 'evening';

    // 尝试获取用户画像（如果已登录）
    let profile = null;
    try { profile = await netbase.generateUserProfile(); } catch(e) {}

    let greeting, searchKeyword;
    const now = new Date();
    // 用北京时间
    const beijing = new Date(now.toLocaleString('en-US', {timeZone:'Asia/Shanghai'}));
    const dateStr = (beijing.getMonth()+1)+'/'+beijing.getDate()+'/'+beijing.getFullYear();
    if (profile && profile.profileSummary) {
      greeting = 'Good ' + timeGreeting + ', Jiang Jiang. Today is ' + dateStr + '. ' + weather + ' I picked some songs based on your taste. How are you feeling today?';
      searchKeyword = '独立民谣';
    } else {
      greeting = 'Good ' + timeGreeting + ', Jiang Jiang. Today is ' + dateStr + '. ' + weather + ' I picked a few gentle songs for you. What mood are you in today?';
      searchKeyword = '独立民谣';
    }

    // 搜索推荐歌曲
    const songs = await netbase.search(searchKeyword, 5);
    const play = (songs || []).slice(0, 3).map(s => ({
      id: s.id, name: s.name, artists: s.artists, reason: '根据你的品味推荐',
    }));

    res.json({ say: greeting, play, weather, profile });
  } catch (e) {
    res.json({ say: '春春你好，今天天气不错，让我放首歌给你听吧。', play: [], profile: null });
  }
});

// 人格分析（根据音乐品味）
app.get('/api/personality', async (req, res) => {
  try {
    const profile = await netbase.generateUserProfile();
    if (!profile || !profile.profileSummary) {
      return res.json({ personality: '我还不太了解你的听歌习惯，请先绑定网易云账号吧。' });
    }

    // 根据标签生成人格描述
    const summary = profile.profileSummary;
    const genres = profile.topGenres || [];
    const artists = (profile.topArtists || []).slice(0, 5);

    let personality = '';
    if (summary.includes('独立') && summary.includes('民谣')) {
      personality = 'Jiang Jiang, from your music taste, I can tell you have a gentle and thoughtful soul. 独立民谣爱好者通常有着丰富的内心世界，容易被有故事感的歌词打动。你喜欢的那种叙事感，说明你是一个善于观察生活、对人情世故有自己理解的人。';
    } else if (summary.includes('独立')) {
      personality = 'Jiang Jiang, 你喜欢独立音乐，说明你是一个有自己审美主张的人。你不随大流，喜欢发掘别人还没发现的好东西。';
    } else if (summary.includes('民谣')) {
      personality = 'Jiang Jiang, 你喜欢民谣，说明你是一个感性且温暖的人。民谣的内敛和真诚和你很配。';
    } else {
      personality = 'Jiang Jiang, 你的音乐品味很多元。你不局限于一种风格，说明你开放、好奇，愿意尝试不同的事物。';
    }

    if (genres.includes('现实叙事')) {
      personality += ' 你偏爱有现实叙事感的歌曲，这意味着你是一个关注生活本真的人。你不喜欢粉饰太平，更欣赏那些直面人生的表达。';
    }

    res.json({
      personality,
      profile,
      topArtists: artists,
    });
  } catch (e) {
    res.json({ personality: '正在分析中...', profile: null });
  }
});

// 网易云登录
app.post('/api/netease/login', async (req, res) => {
  try {
    const { phone, password, uid } = req.body;
    if (phone && password) {
      const result = await netbase.loginPhone(phone, password);
      if (result.ok) {
        stateDB.setNeteaseConfig({ phone, password, type: 'phone' });
        res.json(result);
      } else {
        res.status(401).json(result);
      }
    } else if (uid) {
      stateDB.setNeteaseConfig({ uid, type: 'uid' });
      res.json({ ok: true, uid });
    } else {
      res.status(400).json({ error: '参数不完整' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// AI 对话/DJ 指令入口
app.post('/api/chat', async (req, res) => {
  try {
    const { message, mode = 'chat' } = req.body;

    // 如果当前有正在播放的歌曲，获取歌词和评论注入上下文
    const nowPlaying = stateDB.getNowPlaying();
    let lyricsContext = '';
    let commentsContext = '';
    if (nowPlaying && nowPlaying.song_id) {
      try {
        const lyrics = await netbase.getLyrics(nowPlaying.song_id);
        if (lyrics && lyrics.lrc) {
          // 取前 30 行歌词
          const lines = lyrics.lrc.split('\n').filter(l => l.trim()).slice(0, 30);
          lyricsContext = '当前歌曲《' + nowPlaying.name + '》歌词片段：\n' + lines.join('\n') + '\n';
        }
        const comments = await netbase.getSongComments(nowPlaying.song_id, 1, 5);
        if (comments && comments.hotComments && comments.hotComments.length) {
          commentsContext = '网易云热门评论：\n';
          comments.hotComments.forEach((c, i) => {
            commentsContext += (i + 1) + '. ' + c.user + '：' + c.content + '\n';
          });
        }
      } catch(e) {}
    }

    const context = await require('./CONTEXT').build({
      userInput: message,
      mode,
      history: stateDB.getRecentHistory(10),
      nowPlaying: nowPlaying,
      extraContext: lyricsContext + commentsContext,
    });

    const aiResult = await ai.chat(context);

    if (aiResult.play && aiResult.play.length > 0) {
      // 用真实搜索结果替换 AI 推荐的歌（修正歌名）
      const realSongs = [];
      for (const song of aiResult.play) {
        let found = null;
        // 先按 ID 查
        if (song.id && !song.id.toString().includes('-')) {
          const url = await netbase.getSongUrl(song.id);
          if (url) { found = { id: song.id, name: song.name, artists: song.artists, url, source: 'netease' }; }
        }
        // 按歌名搜
        if (!found && song.name) {
          const results = await netbase.search(song.name, 3);
          if (results && results.length > 0) {
            const hit = results.find(r => r.url) || results[0];
            found = { id: hit.id, name: hit.name, artists: hit.artists, url: hit.url || '', source: hit.source || 'netease' };
          }
        }
        if (found) realSongs.push(found);
      }
      if (realSongs.length > 0) {
        queue.setQueue(realSongs);
        stateDB.setQueue(realSongs);
        aiResult.play = realSongs;
      }
    }

    // 生成 TTS 音频 URL（SEENS 风格）
    if (aiResult.say) {
      try {
        const audioPath = await tts.synthesize(aiResult.say);
        if (audioPath) aiResult.ttsUrl = audioPath;
        aiResult.ttsAudio = audioPath;
      } catch (e) {
        console.warn('[TTS] 语音合成失败:', e.message);
      }
    }

    stateDB.addHistory({ role: 'user', content: message, timestamp: Date.now() });
    stateDB.addHistory({ role: 'ai', content: aiResult.say || JSON.stringify(aiResult), timestamp: Date.now() });

    broadcast('chat', aiResult);
    res.json(aiResult);
  } catch (e) {
    console.error('[Chat] 错误:', e);
    res.status(500).json({ error: e.message });
  }
});

// TTS 语音合成接口（免费 edge-tts 男声）
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: '缺少文本' });
    const audioPath = await tts.synthesize(text);
    if (audioPath) return res.json({ url: audioPath, source: 'edge' });
    res.json({ url: null, source: 'none' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 控制指令
app.post('/api/control', (req, res) => {
  const { action } = req.body;
  stateDB.setControl(action);
  broadcast('control', { action });
  res.json({ ok: true, action });
});

// ---- 心情分析 API（新增） ----
app.post('/api/mood/analyze', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.length < 1) {
      return res.json({ emotion: '平静', confidence: 0 });
    }

    // 简单 NLP 关键词分析
    const result = analyzeMood(text);

    // 存储心情记录
    stateDB.addMoodRecord(result.emotion, text);

    // 获取推荐曲风对应的歌曲
    try {
      const songs = await netbase.search(result.suggestedGenre, 5);
      result.suggestedSongs = (songs || []).slice(0, 3).map(s => s.name);
    } catch (e) {
      result.suggestedSongs = [];
    }

    // 广播心情结果
    broadcast('mood_analysis', result);

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function analyzeMood(text) {
  // 定义情绪关键词映射
  const moodMap = [
    { keywords: ['开心', '高兴', '快乐', '嗨', '兴奋', '愉悦', '爽', '棒', '好心情', 'happy', 'great', 'wonderful', 'amazing', 'joy', 'excited'], emotion: 'happy', genre: 'indie folk upbeat', energy: 'high' },
    { keywords: ['难过', '伤心', '哭', '悲伤', '泪', '想哭', '低落', '沮丧', 'sad', 'down', 'blue', 'upset', 'lonely', 'cry'], emotion: 'sad', genre: 'gentle folk', energy: 'low' },
    { keywords: ['累', '疲惫', '困', '没劲', '不想动', '疲劳', '虚', 'tired', 'exhausted', 'sleepy', 'drained'], emotion: 'tired', genre: 'ambient calm', energy: 'low' },
    { keywords: ['生气', '烦', '烦躁', '恼火', '愤怒', '不爽', '暴躁', 'angry', 'annoyed', 'frustrated'], emotion: 'calm', genre: 'indie rock', energy: 'high' },
    { keywords: ['放松', '惬意', '舒服', '悠闲', '自在', '安逸', '躺', 'relax', 'calm', 'peaceful', 'chill', 'serene'], emotion: 'peaceful', genre: 'ambient jazz', energy: 'low' },
    { keywords: ['浪漫', '恋爱', '心动', '想他', '想你', '甜甜', '甜蜜', 'romantic', 'love', 'sweet', 'heart'], emotion: 'romantic', genre: 'soft acoustic', energy: 'mid' },
    { keywords: ['热血', '奋斗', '加油', '拼', '燃', '努力', '冲', 'energetic', 'pump', 'workout', 'motivated'], emotion: 'energetic', genre: 'indie rock', energy: 'high' },
    { keywords: ['安静', '平静', '静', '发呆', '思考', '冥想', '放空', 'quiet', 'still', 'meditate', 'focus'], emotion: 'calm', genre: 'instrumental', energy: 'low' },
    { keywords: ['emo', '深夜', '失眠', '睡不着', '孤独', '寂寞', 'night', 'insomnia', 'alone'], emotion: 'melancholy', genre: 'night folk', energy: 'low' },
    { keywords: ['无聊', '没意思', '闷', '空虚', 'bored', 'restless'], emotion: 'reflective', genre: 'indie folk', energy: 'mid' },
    { keywords: ['爱', '感动', '温暖', '治愈', '温柔', '美好', 'grateful', 'touched', 'warm'], emotion: 'warm', genre: 'healing folk', energy: 'mid' },
    { keywords: ['运动', '跑步', '健身', '练', '动起来', 'run', 'gym', 'workout', 'sport'], emotion: 'energetic', genre: 'upbeat indie', energy: 'high' },
    { keywords: ['通勤', '路上', '地铁', '公交', '开车', 'commute', 'drive', 'travel', 'walk'], emotion: 'neutral', genre: 'commute mix', energy: 'mid' },
    { keywords: ['学习', '工作', '写代码', '看书', '专注', '效率', 'study', 'work', 'focus', 'code', 'reading'], emotion: 'focused', genre: 'focus ambient', energy: 'low' },
  ];

  const lower = text.toLowerCase();

  for (const entry of moodMap) {
    for (const kw of entry.keywords) {
      if (text.includes(kw) || lower.includes(kw.toLowerCase())) {
        return {
          emotion: entry.emotion,
          suggestedGenre: entry.genre,
          energy: entry.energy,
          confidence: 0.85,
          genreMatch: 'Curating ' + entry.genre + ' for you',
          timestamp: Date.now(),
        };
      }
    }
  }

  // 默认分析
  if (text.length > 5) {
    return {
      emotion: '平静',
      suggestedGenre: '轻音乐',
      energy: 'mid',
      confidence: 0.5,
      genreMatch: 'Curating a comfortable playlist for you',
      timestamp: Date.now(),
    };
  }

  return null;
}

// ---- 网易云绑定 API（新增） ----
app.post('/api/netease/bind', async (req, res) => {
  try {
    const { uid, type, phone, password } = req.body;
    if (type === 'uid' && uid) {
      stateDB.setNeteaseConfig({ uid, type: 'uid' });
      console.log(`[网易云] 绑定 UID: ${uid}`);
      return res.json({ ok: true, message: '绑定成功' });
    }
    if (type === 'phone' && phone && password) {
      stateDB.setNeteaseConfig({ phone, password, type: 'phone' });
      console.log(`[网易云] 手机号登录: ${phone}`);
      return res.json({ ok: true, message: '登录成功' });
    }
    res.status(400).json({ error: '参数不完整' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 网易云收藏歌曲
app.post('/api/netease/like', async (req, res) => {
  try {
    const { songId } = req.body;
    if (!songId) return res.status(400).json({ error: '缺少 songId' });
    // 网易云收藏歌曲（需要登录态，暂为模拟）
    console.log(`[网易云] 收藏歌曲: ${songId}`);
    res.json({ ok: true, message: '收藏成功' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取网易云绑定状态
app.get('/api/netease/status', (req, res) => {
  const config = stateDB.getNeteaseConfig();
  res.json({
    bound: !!(config?.uid || config?.phone),
    uid: config?.uid || null,
    phone: config?.phone ? config.phone.slice(0, 3) + '****' : null,
  });
});

// 心情历史
app.get('/api/mood/history', (req, res) => {
  res.json(stateDB.getMoodHistory());
});

// 手动触发晨间电台
app.post('/api/morning-show', async (req, res) => {
  try {
    await scheduler.runMorningShow();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取电台日程
app.get('/api/schedule', (req, res) => {
  res.json(scheduler.getSchedule());
});

// ---- 启动 ----
const PORT = process.env.PORT || 8080;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════╗
║       CHUUN FM · 私人 AI 电台        ║
║     http://localhost:${PORT}          ║
╚══════════════════════════════════════╝
  `);

  scheduler.init(broadcast);
  netbase.init().catch(e => console.warn('[网易云] 初始化:', e.message));
});
