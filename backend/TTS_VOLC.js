/**
 * TTS_VOLC.js — 火山引擎 TTS 2.0 语音合成
 * 温柔治愈女声，自然不机械
 */
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'tts_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

/**
 * 火山 TTS 合成
 * @param {string} text - 要合成的文本
 * @returns {Promise<string|null>} - 音频文件路径
 */
async function synthesize(text, voice = 'BV001_streaming') {
  if (!text) return null;

  const appid = process.env.VOLC_APP_ID;
  const token = process.env.VOLC_ACCESS_TOKEN;

  // 没配火山 TTS 就用浏览器语音
  if (!appid || !token) {
    console.log('[TTS] 未配置火山 TTS，使用浏览器语音');
    return null;
  }

  const reqid = crypto.randomUUID();

  try {
    const response = await axios.post(
      'https://openspeech.bytedance.com/api/v1/tts',
      {
        app: { appid, token, cluster: 'volcano_tts' },
        user: { uid: 'chun' },
        audio: {
          voice_type: voice,
          encoding: 'mp3',
          speed_ratio: 1.0,
          volume_ratio: 1.0,
          pitch_ratio: 1.0,
        },
        request: {
          reqid,
          text,
          text_type: 'plain',
          operation: 'query',
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer; access_token=' + token,
        },
        responseType: 'arraybuffer',
        timeout: 15000,
      }
    );

    // 火山返回的是 audio/mpeg 二进制
    const filename = `tts_${reqid}.mp3`;
    const filepath = path.join(CACHE_DIR, filename);
    fs.writeFileSync(filepath, response.data);
    console.log('[TTS] 火山合成成功:', filename);
    return '/tts/' + filename;
  } catch (e) {
    console.error('[TTS] 火山合成失败:', e.message);
    return null;
  }
}

module.exports = { synthesize };
