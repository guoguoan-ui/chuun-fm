/**
 * SCHEDULER.js — 定时节律调度
 * 晨间自动开播、情绪巡检
 */
const cron = require('node-cron');
const context = require('./CONTEXT');
const ai = require('./AI');
const tts = require('./TTS');
const stateDB = require('./STATE.DB');

let broadcastFn = null;

const schedule = {
  morningShow: '0 7 * * *',   // 每天 7:00 晨间电台
  moodCheck: '0 */2 * * *',   // 每 2 小时情绪巡检
};

function init(broadcast) {
  broadcastFn = broadcast;

  // 晨间电台
  cron.schedule(schedule.morningShow, async () => {
    console.log('[调度] ⏰ 晨间电台启动');
    await runMorningShow();
  });

  // 情绪巡检
  cron.schedule(schedule.moodCheck, async () => {
    console.log('[调度] 🔄 情绪巡检');
    await moodCheck();
  });

  console.log('[调度] 定时任务已注册');
  console.log(`   ├─ 晨间电台: ${schedule.morningShow}`);
  console.log(`   └─ 情绪巡检: ${schedule.moodCheck}`);
}

async function runMorningShow() {
  try {
    const prompt = await context.build({
      userInput: '早上好，开始今天的晨间电台吧！',
      mode: 'morning_show',
      history: stateDB.getRecentHistory(5),
      nowPlaying: stateDB.getNowPlaying(),
    });

    const result = await ai.chat(prompt);

    // 生成 TTS 播报
    if (result.say) {
      try {
        const audio = await tts.synthesize(result.say);
        result.ttsAudio = audio;
      } catch (e) {
        console.warn('[晨间电台] TTS 失败:', e.message);
      }
    }

    // 更新播放队列
    if (result.play && result.play.length > 0) {
      stateDB.setQueue(result.play);
    }

    // 存入历史
    stateDB.addHistory({
      role: 'system',
      content: `【晨间电台】${result.say}`,
      timestamp: Date.now(),
    });

    // 广播
    if (broadcastFn) {
      broadcastFn('morning_show', result);
    }

    console.log('[晨间电台] ✅ 完成');
    return result;
  } catch (e) {
    console.error('[晨间电台] 失败:', e);
  }
}

async function moodCheck() {
  // 简单实现：检查是否有用户交互，如果没有则跳过
  // 未来可以加入更复杂的情绪检测逻辑
  console.log('[情绪巡检] ✅ 完成（暂无操作）');
}

function getSchedule() {
  return schedule;
}

module.exports = { init, runMorningShow, getSchedule, moodCheck };
