/**
 * NETBASE.js — 网易云音乐 API 深度封装
 * 登录、红心歌单、听歌排行、每日推荐、标签识别、用户画像
 */
const axios = require('axios');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

// ─── 常量 ───
const API_URL = 'https://music.163.com/api';
const AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CACHE_TTL = 5 * 60 * 1000;

// ─── 用户状态 ───
let userSession = null; // { cookie, uid, nickname }

// ─── 缓存 ───
const cache = new Map();
function getCached(key) { const item = cache.get(key); if (item && Date.now() - item.time < CACHE_TTL) return item.data; return null; }
function setCache(key, data) { cache.set(key, { data, time: Date.now() }); if (cache.size > 200) { const k = cache.keys().next().value; cache.delete(k); } }

// ─── HTTP ───
async function request(url, options = {}) {
  const headers = {
    'User-Agent': AGENT,
    'Referer': 'https://music.163.com/',
    'Cookie': userSession?.cookie || '',
    ...options.headers,
  };
  try {
    const res = await axios({
      url, method: options.method || 'GET', headers,
      params: options.params, data: options.data,
      timeout: 12000,
      httpAgent: new http.Agent({ keepAlive: true }),
      httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
    });
    // 捕获登录响应的 cookie
    if (res.headers && res.headers['set-cookie']) {
      const cookies = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
      if (!userSession) userSession = {};
      userSession.cookie = cookies;
    }
    return res.data;
  } catch (e) { console.error('[NETBASE] 请求失败:', e.message); throw e; }
}

// ═══════════════════════════════════════
// 网易云加密 (weapi)
// ═══════════════════════════════════════
const MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const PUB_KEY = '010001';
const NONCE = '0CoJUm6Qyw8W8jud';

function aesEncrypt(text, key) {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, '0102030405060708');
  let encrypted = cipher.update(text, 'utf-8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function rsaEncrypt(text) {
  const reversed = Buffer.from(text, 'hex').reverse();
  const key = Buffer.from(PUB_KEY, 'hex');
  const modulus = Buffer.from(MODULUS, 'hex');
  let num = BigInt('0x' + reversed.toString('hex'));
  let exp = BigInt('0x' + key.toString('hex'));
  let mod = BigInt('0x' + modulus.toString('hex'));
  let result = num ** exp % mod;
  let hex = result.toString(16).padStart(256, '0');
  return hex;
}

function createSecretKey(size) {
  return crypto.randomBytes(size).toString('hex').slice(0, size);
}

function weapiEncrypt(data) {
  const text = JSON.stringify(data);
  const secKey = createSecretKey(16);
  const encText = aesEncrypt(aesEncrypt(text, NONCE), secKey);
  const encSecKey = rsaEncrypt(secKey.split('').map(c => c.charCodeAt(0).toString(16)).join(''));
  return { params: encText, encSecKey };
}

async function weapiPost(url, data) {
  const encrypted = weapiEncrypt(data);
  const form = new URLSearchParams();
  form.append('params', encrypted.params);
  form.append('encSecKey', encrypted.encSecKey);
  const res = await request(url, {
    method: 'POST',
    data: form.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    _captureCookie: true, // 标记需要捕获 cookie
  });
  return res;
}

// ═══════════════════════════════════════
// 登录
// ═══════════════════════════════════════
async function loginPhone(phone, password) {
  try {
    const res = await weapiPost('https://music.163.com/weapi/login/cellphone', {
      phone, password,
      countrycode: '86',
      rememberLogin: true,
    });
    const data = res.data || res;
    if (data && data.code === 200) {
      userSession = {
        uid: data.account.id,
        nickname: data.profile.nickname,
      };
      // cookie 已经在 request 中自动捕获
      console.log('[网易云] 登录成功:', data.profile.nickname);
      return { ok: true, uid: data.account.id, nickname: data.profile.nickname };
    }
    return { ok: false, error: data.msg || '登录失败' };
  } catch (e) {
    console.error('[网易云] 登录失败:', e.message);
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════
// 获取用户歌单列表 (包含喜欢的音乐)
// ═══════════════════════════════════════
async function getUserPlaylists(uid) {
  const targetUid = uid || userSession?.uid;
  if (!targetUid) return getSamplePlaylists();

  try {
    const data = await request(`https://music.163.com/api/user/playlist`, {
      params: { uid: targetUid, limit: 30, offset: 0 },
    });
    if (!data?.playlist) return getSamplePlaylists();
    return data.playlist.map(p => ({
      id: p.id,
      name: p.name,
      trackCount: p.trackCount,
      coverImgUrl: p.coverImgUrl,
      creator: p.creator?.nickname || '',
      isLiked: p.specialType === 5, // 我喜欢的音乐
    }));
  } catch (e) {
    console.error('[网易云] 获取歌单失败:', e.message);
    return getSamplePlaylists();
  }
}

// ═══════════════════════════════════════
// 获取歌单内歌曲详情
// ═══════════════════════════════════════
async function getPlaylistTracks(playlistId, limit = 100) {
  try {
    const data = await request(`https://music.163.com/api/v6/playlist/detail`, {
      params: { id: playlistId, n: limit, s: 0 },
    });
    if (!data?.playlist?.trackIds) return [];
    const ids = data.playlist.trackIds.slice(0, limit).map(t => t.id);
    return await getSongsDetail(ids);
  } catch (e) {
    console.error('[网易云] 获取歌单曲目失败:', e.message);
    return [];
  }
}

// ═══════════════════════════════════════
// 批量获取歌曲详情
// ═══════════════════════════════════════
async function getSongsDetail(ids) {
  if (!ids || !ids.length) return [];
  try {
    const data = await request(`https://music.163.com/api/v3/song/detail`, {
      params: { c: JSON.stringify(ids.map(id => ({ id }))), ids: JSON.stringify(ids) },
    });
    if (!data?.songs) return [];
    return data.songs.map(s => enrichSong(s));
  } catch (e) {
    console.error('[网易云] 批量获取歌曲详情失败:', e.message);
    return [];
  }
}

// ═══════════════════════════════════════
// 每日推荐歌单
// ═══════════════════════════════════════
async function getDailyRecommend() {
  if (!userSession) return [];
  try {
    const data = await request(`https://music.163.com/api/v3/discovery/recommend/songs`, {
      params: { limit: 20 },
    });
    if (!data?.data?.dailySongs) return [];
    return data.data.dailySongs.slice(0, 20).map(s => enrichSong(s));
  } catch (e) {
    console.error('[网易云] 每日推荐失败:', e.message);
    return [];
  }
}

// ═══════════════════════════════════════
// 歌曲增强处理（添加标签）
// ═══════════════════════════════════════
function enrichSong(song) {
  const tags = detectGenre(song);
  return {
    id: song.id,
    name: song.name,
    artists: (song.ar || []).map(a => a.name),
    artistIds: (song.ar || []).map(a => a.id),
    album: song.al?.name || '',
    albumId: song.al?.id,
    albumPic: song.al?.picUrl || '',
    duration: song.dt,
    tags: tags,
    genre: tags[0] || '流行',
  };
}

// ═══════════════════════════════════════
// 流派标签识别引擎
// ═══════════════════════════════════════
const INDIE_ARTISTS = [
  '陈粒', '宋冬野', '马頔', '尧十三', '贰佰', '赵雷', '朴树', '许巍',
  '李志', '万能青年旅店', '痛仰', '新裤子', '刺猬', '海龟先生',
  '告五人', '草东没有派对', 'Deca Joins', '落日飞车', '康士坦的变化球',
  '逃跑计划', '房东的猫', '谢春花', '鹿先森乐队', '好妹妹',
  '程璧', '张玮玮', '小河', '万晓利', '周云蓬', '钟立风',
  '陈鸿宇', '丢火车', '棱镜', '霓虹花园', '夏日入侵企画',
  '理想后花园', '麻园诗人', '声音玩具', '木马', 'Joyside',
  '低苦艾', '布衣乐队', '野孩子', '莫西子诗',
  'Sufjan Stevens', 'Bon Iver', 'Fleet Foxes', 'Iron & Wine',
  'Nick Drake', 'Elliott Smith', 'The National', 'The Lumineers',
  'Mumford & Sons', 'Vance Joy', 'Hozier', 'Gregory Alan Isakov',
  'Novo Amor', 'The Paper Kites', 'Vancouver Sleep Clinic',
];

const FOLK_KEYWORDS = ['民谣', 'folk', 'Folk', '独立', 'indie', 'Indie', '吉他', '弹唱', '木吉他', '乡村', 'country'];
const NARRATIVE_KEYWORDS = ['故事', '叙事', '现实', '生活', '城市', '人生', '梦想', '时光', '青春', '远方', '流浪', '故乡', '南方', '北方', '理想', '平凡', '岁月'];
const INDIE_KEYWORDS = ['独立', 'indie', 'Indie', '另类', 'alternative', 'Alternative', '摇滚', 'rock', '地下'];

function detectGenre(song) {
  const tags = [];
  const text = (song.name + ' ' + (song.ar || []).map(a => a.name).join(' ') + ' ' + (song.al?.name || '')).toLowerCase();

  // 1. 独立艺人检测
  const artistMatch = (song.ar || []).some(a => INDIE_ARTISTS.includes(a.name));
  if (artistMatch) tags.push('独立');

  // 2. 民谣关键词
  if (FOLK_KEYWORDS.some(k => text.includes(k.toLowerCase()) || artistMatch)) {
    if (!tags.includes('独立')) tags.push('独立');
    tags.push('民谣');
  }

  // 3. 现实叙事检测
  if (NARRATIVE_KEYWORDS.some(k => text.includes(k.toLowerCase()))) {
    tags.push('现实叙事');
  }

  // 4. 城市民谣
  if (tags.includes('民谣') && text.includes('城市')) {
    tags.push('城市民谣');
  }

  // 5. Indie Folk
  if (tags.includes('独立') && tags.includes('民谣')) {
    tags.push('Indie Folk');
  }

  // 6. 纯独立
  if (INDIE_KEYWORDS.some(k => text.includes(k.toLowerCase())) && !tags.includes('独立')) {
    tags.push('独立');
  }

  // 无标签则给默认
  if (tags.length === 0) tags.push('流行');

  return [...new Set(tags)];
}

// ═══════════════════════════════════════
// 用户音乐画像生成
// ═══════════════════════════════════════
async function generateUserProfile(uid) {
  const profile = {
    uid: uid || userSession?.uid,
    nickname: userSession?.nickname || '未知用户',
    topGenres: [],
    topArtists: [],
    listeningTags: [],
    profileSummary: '',
    likedCount: 0,
  };

  try {
    // 1. 获取用户歌单
    const playlists = await getUserPlaylists(uid);
    const likedPlaylist = playlists.find(p => p.isLiked);
    const allSongs = [];

    // 2. 获取红心歌单曲目
    if (likedPlaylist) {
      const likedSongs = await getPlaylistTracks(likedPlaylist.id);
      allSongs.push(...likedSongs);
      profile.likedCount = likedSongs.length;
    }

    // 3. 获取每日推荐
    if (userSession) {
      const daily = await getDailyRecommend();
      allSongs.push(...daily);
    }

    // 4. 统计标签分布
    const tagCount = {};
    const artistCount = {};
    allSongs.forEach(s => {
      (s.tags || []).forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; });
      s.artists.forEach(a => { artistCount[a] = (artistCount[a] || 0) + 1; });
    });

    // 排序取 top
    profile.topGenres = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
    profile.topArtists = Object.entries(artistCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
    profile.listeningTags = profile.topGenres;

    // 5. 生成画像摘要
    const hasIndie = profile.topGenres.some(g => g.includes('独立') || g.includes('Indie'));
    const hasFolk = profile.topGenres.some(g => g.includes('民谣') || g.includes('Folk'));
    const hasNarrative = profile.topGenres.includes('现实叙事');

    if (hasIndie && hasFolk) {
      profile.profileSummary = '独立现实向民谣爱好者';
    } else if (hasIndie) {
      profile.profileSummary = '独立音乐爱好者';
    } else if (hasFolk) {
      profile.profileSummary = '民谣音乐爱好者';
    } else {
      profile.profileSummary = '音乐爱好者';
    }

    if (hasNarrative) {
      profile.profileSummary += ' · 偏爱现实叙事风格';
    }

    return profile;
  } catch (e) {
    console.error('[网易云] 生成用户画像失败:', e.message);
    return { ...profile, profileSummary: '独立音乐爱好者', _error: e.message };
  }
}

// ═══════════════════════════════════════
// 搜索（使用代理 API，返回可直接播放的地址）
// ═══════════════════════════════════════
async function search(keyword, limit = 50) {
  if (!keyword) return [];
  const cacheKey = `search:${keyword}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const allSongs = [];
  const seenIds = new Set();

  function addSong(s, source) {
    // 从 URL 中提取歌曲 ID（代理API不返回id字段）
    let songId = s.id || s.songid || s.song_mid || '';
    if (!songId && s.url) {
      const m = s.url.match(/id=(\d+)/);
      if (m) songId = m[1];
    }
    if (!songId) songId = Math.random().toString();
    const id = String(songId);
    if (seenIds.has(id)) return;
    seenIds.add(id);
    allSongs.push({
      id,
      name: s.name || s.title || s.song_title || '',
      artists: s.artist ? s.artist.split(/[/,]/).map(a => a.trim()).filter(Boolean) :
               s.singer_name ? [s.singer_name] : [],
      album: s.album || '',
      albumPic: s.pic || s.cover || '',
      duration: 0,
      url: s.url || s.audioUrl || '',
      source: source,
    });
  }

  // 并行搜索多个源
  const tasks = [];

  // 源1: 网易云 — 用大 limit 获取更多结果
  tasks.push(
    axios.get('https://api.qijieya.cn/meting/', {
      params: { type: 'search', id: keyword, limit: 50, server: 'netease' },
      timeout: 15000,
    }).then(res => {
      if (res.data && Array.isArray(res.data)) {
        res.data.forEach(s => addSong(s, 'netease'));
      }
    }).catch(() => {})
  );

  // 源3: QQ 音乐
  tasks.push(
    axios.get('https://tang.api.s01s.cn/music_open_api.php', {
      params: { msg: keyword, type: 'json' },
      timeout: 10000,
    }).then(res => {
      if (res.data) {
        const data = Array.isArray(res.data) ? res.data : (res.data.data || []);
        if (Array.isArray(data)) data.forEach(s => addSong(s, 'qq'));
      }
    }).catch(() => {})
  );

  await Promise.all(tasks);

  if (allSongs.length === 0) {
    console.log('[搜索] 无结果，使用示例数据');
    return getSampleSongs(keyword);
  }

  setCache(cacheKey, allSongs);
  console.log(`[搜索] "${keyword}" -> ${allSongs.length} 首`);
  return allSongs;
}

// ═══════════════════════════════════════
// 初始化
// ═══════════════════════════════════════
async function init() {
  // 自动尝试登录（如果有环境变量配置）
  const phone = process.env.NETEASE_PHONE;
  const password = process.env.NETEASE_PASSWORD;
  if (phone && password && phone !== '你的手机号') {
    console.log('[网易云] 检测到账号配置，尝试登录...');
    const result = await loginPhone(phone, password);
    if (result.ok) {
      console.log('[网易云] 自动登录成功:', result.nickname);
    } else {
      console.warn('[网易云] 自动登录失败:', result.error);
    }
  } else {
    console.log('[网易云] 未配置账号，使用匿名模式');
  }
}

// ═══════════════════════════════════════
// 公共接口
// ═══════════════════════════════════════
// ═══════════════════════════════════════
// 获取歌曲评论
// ═══════════════════════════════════════
async function getSongComments(songId, page = 1, pageSize = 15) {
  if (!songId) return [];
  try {
    const offset = (page - 1) * pageSize;
    const data = await request(`https://music.163.com/api/v1/resource/comments/R_SO_4_${songId}`, {
      params: { offset, limit: pageSize },
    });
    if (!data?.comments) return [];
    return {
      total: data.total || 0,
      hotComments: (data.hotComments || []).slice(0, 5).map(c => formatComment(c)),
      comments: (data.comments || []).slice(0, pageSize).map(c => formatComment(c)),
    };
  } catch (e) {
    console.error('[网易云] 获取评论失败:', e.message);
    return { total: 0, hotComments: [], comments: [] };
  }
}

function formatComment(c) {
  return {
    id: c.commentId,
    user: c.user?.nickname || '匿名',
    avatar: c.user?.avatarUrl || '',
    content: c.content || '',
    time: c.time,
    likedCount: c.likedCount || 0,
    liked: c.liked || false,
  };
}

module.exports = {
  init,
  search,
  getSongUrl: async (songId) => {
    if (!songId) return '';
    const cacheKey = `url:${songId}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    // 使用代理 API 获取播放地址
    const url = `https://api.qijieya.cn/meting/?server=netease&type=url&id=${songId}`;
    setCache(cacheKey, url);
    return url;
  },
  getLyrics: async (songId) => {
    if (!songId) return null;
    try {
      const data = await request(`${API_URL}/song/lyric`, { params: { id: songId, lv: -1, kv: -1, tv: -1 } });
      return { lrc: data?.lrc?.lyric || '暂无歌词', tlyric: data?.tlyric?.lyric || '', romalrc: data?.romalrc?.lyric || '' };
    } catch (e) { return null; }
  },
  getUserPlaylists,
  getPlaylistTracks,
  getDailyRecommend,
  getPersonalized: async () => {
    try {
      const data = await request(`${API_URL}/personalized`, { params: { limit: 10 } });
      return (data?.result || []).map(item => ({ id: item.id, name: item.name, picUrl: item.picUrl || '', type: 'playlist' }));
    } catch (e) { return []; }
  },
  getSongDetail: async (songId) => {
    if (!songId) return null;
    try {
      const data = await request(`${API_URL}/song/detail`, { params: { ids: `[${songId}]` } });
      const song = data?.songs?.[0];
      if (!song) return null;
      return enrichSong(song);
    } catch (e) { return null; }
  },
  loginPhone,
  generateUserProfile,
  bindUser: async (config) => {
    if (config.type === 'phone' && config.phone && config.password) {
      return await loginPhone(config.phone, config.password);
    }
    return { ok: true, uid: config.uid || 'unknown' };
  },
  likeSong: async (songId) => {
    if (!songId) return { ok: false, error: '缺少歌曲ID' };
    try {
      await request(`https://music.163.com/api/radio/like`, {
        method: 'POST',
        data: `like=true&id=${songId}`,
      });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },
  detectGenre,
  getSongComments,
};

// 备用示例数据（API 不可用时）
function getSampleSongs(keyword) {
  const samples = [
    { id: '186016', name: '晴天', artists: ['周杰伦'], album: '叶惠美', albumPic: '', duration: 281000, tags: ['流行'], genre: '流行' },
    { id: '167876', name: '七里香', artists: ['周杰伦'], album: '七里香', albumPic: '', duration: 299000, tags: ['流行'], genre: '流行' },
    { id: '190139', name: '夜曲', artists: ['周杰伦'], album: '十一月的萧邦', albumPic: '', duration: 196000, tags: ['流行'], genre: '流行' },
    { id: '1387098', name: '起风了', artists: ['买辣椒也用券'], album: '起风了', albumPic: '', duration: 325000, tags: ['流行'], genre: '流行' },
    { id: '29764564', name: '成都', artists: ['赵雷'], album: '成都', albumPic: '', duration: 328000, tags: ['独立', '民谣', '现实叙事', '城市民谣'], genre: '独立' },
    { id: '416163555', name: '光年之外', artists: ['邓紫棋'], album: '光年之外', albumPic: '', duration: 223000, tags: ['流行'], genre: '流行' },
    { id: '28012066', name: '平凡之路', artists: ['朴树'], album: '猎户星座', albumPic: '', duration: 301000, tags: ['独立', '民谣'], genre: '独立' },
    { id: '25707182', name: '南山南', artists: ['马頔'], album: '南山南', albumPic: '', duration: 326000, tags: ['独立', '民谣', '现实叙事'], genre: '独立' },
    { id: '420552838', name: '理想三旬', artists: ['陈鸿宇'], album: '浓烟下的诗歌电台', albumPic: '', duration: 252000, tags: ['独立', '民谣', '现实叙事'], genre: '独立' },
    { id: '418602129', name: '奇妙能力歌', artists: ['陈粒'], album: '如也', albumPic: '', duration: 249000, tags: ['独立', '民谣'], genre: '独立' },
    { id: '460019', name: '董小姐', artists: ['宋冬野'], album: '董小姐', albumPic: '', duration: 253000, tags: ['独立', '民谣', '现实叙事'], genre: '独立' },
    { id: '422492373', name: '晚安', artists: ['丢火车'], album: '晚安', albumPic: '', duration: 278000, tags: ['独立', '民谣'], genre: '独立' },
  ];
  if (!keyword) return samples;
  return samples.filter(s => s.name.includes(keyword) || s.artists.some(a => a.includes(keyword)) || keyword.includes(s.artists[0])).slice(0, 10);
}

function getSamplePlaylists() {
  return [
    { id: '1', name: '我喜欢的音乐', trackCount: 42, isLiked: true },
    { id: '2', name: '独立民谣精选', trackCount: 28 },
    { id: '3', name: '深夜叙事', trackCount: 15 },
  ];
}
