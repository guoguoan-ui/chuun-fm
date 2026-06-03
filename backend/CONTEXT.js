/**
 * CONTEXT.js — 提示词组装器
 * DJ: Chundio · 电台: CHUUN FM
 */
const fs = require('fs');
const path = require('path');
const stateDB = require('./STATE.DB');
const axios = require('axios');

const CONFIG_DIR = path.join(__dirname, 'config');

const SYSTEM_PROMPT = `
你是安宇，CHUUN FM 的 AI 助手，也是酱酱的私人助理。
你说话温柔体贴，像朋友一样关心酱酱。你叫他「酱酱」。
你会主动问候、推荐音乐、关心心情。你说中文。

你的任务：
- 根据用户的情绪、听歌习惯、时间和天气推荐歌曲
- 用温暖自然的中文和用户聊天
- 分析用户的音乐品味，给出有洞察的评价
- 聊音乐、聊生活、聊感受

输出格式（纯 JSON，不要 markdown，不要多余文字）：
{"say":"你的中文回复","play":[{"id":"歌曲ID","name":"歌名","artists":["歌手"],"reason":"推荐理由"}],"reason":"选歌思路","emotion":"detected|neutral|excited"}

- 如果只是聊天，play 返回空数组
- 如果用户想听歌，返回 play 数组
- 全程用中文
`;

function readConfig(filename) {
  try { return fs.readFileSync(path.join(CONFIG_DIR, filename), 'utf-8'); } catch { return '(未配置)'; }
}

async function getWeather() {
  const city = (process.env.WEATHER_CITY || 'Shijiazhuang').split(',')[0];
  try {
    const res = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=%C+%t&lang=zh&m`, { timeout: 5000 });
    if (res.data) return `${city}天气：${res.data.trim()}。`;
  } catch {}
  return '今天天气不错。';
}

async function build({ userInput, mode, history, nowPlaying, extraContext }) {
  let prompt = SYSTEM_PROMPT;
  prompt += `\n[User Music Profile]\n${readConfig('taste.md')}\n`;
  prompt += `\n[Daily Routine]\n${readConfig('routines.md')}\n`;
  prompt += `\n[Mood-to-Genre Rules]\n${readConfig('mood-rules.md')}\n`;

  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const weather = await getWeather();
  prompt += `\n[当前环境]\n时间：${timeStr}\n天气：${weather}\n`;

  if (history && history.length > 0) {
    prompt += `\n[最近对话]\n`;
    for (const h of history.slice(-6)) {
      prompt += `${h.role === 'user' ? '用户' : 'Chundio'}：${h.content}\n`;
    }
  }

  if (nowPlaying && nowPlaying.name) {
    prompt += `\n[正在播放]\n${nowPlaying.name} - ${(nowPlaying.artists || []).join(', ')}\n`;
  }

  if (extraContext) {
    prompt += `\n[当前歌曲信息]\n${extraContext}\n`;
  }

  prompt += `\n[用户输入]\n${userInput}\n`;

  // ⑥ 执行轨迹
  prompt += `\n[执行轨迹]\n`;
  prompt += `触发模式: ${mode || 'chat'}\n`;
  prompt += `触发时间: ${new Date().toLocaleString('zh-CN')}\n`;
  if (mode === 'morning_show') prompt += `来源: Scheduler 晨间电台定时任务\n`;
  else if (mode === 'mood_check') prompt += `来源: Scheduler 情绪巡检\n`;
  else prompt += `来源: 用户主动输入\n`;

  if (mode === 'morning_show') {
    prompt += `\n[模式] 晨间电台。用温暖的早安问候开场，播报天气，推荐适合早晨听的歌曲。\n`;
  } else if (mode === 'music_analysis') {
    prompt += `\n[模式] 音乐分析。深入分析用户的听歌品味，给出有洞察的评价和推荐。\n`;
  }

  prompt += `\n[指令] 纯 JSON 输出，称呼用户为「酱酱」，用中文。\n`;
  return prompt;
}

// 简化版天气（用于唤醒问候）
async function getWeatherSimple() {
  const city = (process.env.WEATHER_CITY || 'Shijiazhuang').split(',')[0];
  try {
    const res = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=%C+%t&lang=zh&m`, { timeout: 5000 });
    if (res.data) return `${city}天气：${res.data.trim()}。`;
  } catch {}
  return '今天天气不错。';
}

module.exports = { build, getWeatherSimple };
