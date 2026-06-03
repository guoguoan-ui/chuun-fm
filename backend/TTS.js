/**
 * TTS.js — 语音合成
 * 优先 edge-tts（免费男声），降级浏览器语音
 */
const { spawn } = require('child_process');
const path = require('path');

async function synthesize(text) {
  if (!text) return null;

  // 用 edge-tts（微软免费语音，干净男声）
  try {
    const result = await new Promise((resolve, reject) => {
      const proc = spawn('python3', [path.join(__dirname, 'tts_edge.py'), text]);
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => stdout += d);
      proc.stderr.on('data', d => stderr += d);
      proc.on('close', code => {
        if (code === 0) try { resolve(JSON.parse(stdout)); } catch(e) { reject(e); }
        else reject(new Error(stderr));
      });
      proc.on('error', reject);
    });
    if (result && result.url) return result.url;
  } catch (e) {
    console.log('[TTS] edge-tts 失败:', e.message);
  }

  return null;
}

module.exports = { synthesize };
