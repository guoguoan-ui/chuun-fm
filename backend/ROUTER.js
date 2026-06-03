/**
 * ROUTER.js — 路由 & 意图分流
 * 区分简单播放指令和自然语言对话
 */
const ai = require('./AI');
const netbase = require('./NETBASE');
const stateDB = require('./STATE.DB');

// 简单指令关键词
const PLAY_COMMANDS = ['播放', '放歌', '听', '来一首', '来首', '唱'];

/**
 * 解析用户输入，分流到不同处理器
 * @param {string} text 用户输入
 * @returns {{ type: 'play'|'chat'|'control', intent: string, payload: any }}
 */
function parse(text) {
  const trimmed = text.trim();

  // 控制指令
  if (/^(暂停|停)/.test(trimmed)) return { type: 'control', intent: 'pause', payload: {} };
  if (/^(下一[首曲]|切歌|跳过)/.test(trimmed)) return { type: 'control', intent: 'next', payload: {} };
  if (/^(上一[首曲]|回放)/.test(trimmed)) return { type: 'control', intent: 'prev', payload: {} };
  if (/^(继续|播放|放)/.test(trimmed) && trimmed.length <= 4) return { type: 'control', intent: 'play', payload: {} };

  // 点歌指令
  const playMatch = trimmed.match(/^播放\s*(.+)/) || trimmed.match(/^来[一1]?[首曲]\s*(.+)/);
  if (playMatch) {
    return { type: 'play', intent: 'search_and_play', payload: { keyword: playMatch[1] } };
  }

  // 默认走 AI 对话
  return { type: 'chat', intent: 'ai_dialogue', payload: { text: trimmed } };
}

/**
 * 执行路由分发
 */
async function dispatch(message) {
  const parsed = parse(message);

  switch (parsed.type) {
    case 'play': {
      const { keyword } = parsed.payload;
      const results = await netbase.search(keyword);
      if (results && results.length > 0) {
        const song = results[0];
        const url = await netbase.getSongUrl(song.id);
        stateDB.setQueue([{ ...song, url }]);
        stateDB.setNowPlaying({ ...song, url });
        return {
          type: 'play',
          song,
          say: `好的，为你播放 ${song.name} — ${song.artists?.join(', ') || '未知歌手'}`,
        };
      }
      return { type: 'chat', say: '抱歉，没找到这首歌，换一首试试？' };
    }

    case 'control': {
      stateDB.setControl(parsed.intent);
      return { type: 'control', action: parsed.intent };
    }

    case 'chat': {
      // 走 AI 完整处理
      return null; // 由 server.js 的 chat 路由处理
    }
  }
}

module.exports = { parse, dispatch };
