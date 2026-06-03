/**
 * AI.js — AI 适配器（OpenAI 首选 → Doubao 备用）
 */
const OpenAI = require('openai');

let client = null;

function getClient() {
  if (client) return client;

  // 用 Doubao (火山引擎) — 已有额度
  const doubaoKey = process.env.DOUBAO_API_KEY;
  if (doubaoKey && doubaoKey !== '你的火山引擎API密钥') {
    console.log('[AI] 使用 Doubao');
    client = new OpenAI({
      apiKey: doubaoKey,
      baseURL: process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    });
    return client;
  }

  // 备用 OpenAI
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey && openaiKey.startsWith('sk-')) {
    console.log('[AI] 使用 OpenAI');
    client = new OpenAI({ apiKey: openaiKey });
    return client;
  }

  console.warn('[AI] 无可用 API Key，使用模拟模式');
  return null;
}

async function chat(prompt) {
  const c = getClient();
  if (!c) return simulate(prompt);

  try {
    const usingDoubao = process.env.DOUBAO_API_KEY && process.env.DOUBAO_API_KEY !== '你的火山引擎API密钥';
    const model = usingDoubao
      ? (process.env.DOUBAO_MODEL || 'doubao-seed-2-0-mini-260428')
      : (process.env.OPENAI_MODEL || 'gpt-4o-mini');
    const response = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: '你是安宇，CHUUN FM 的 AI 助手，也是 Jiang Jiang 的私人助理。'
            + '你说话温柔体贴，像朋友一样关心 Jiang Jiang。你叫他「酱酱」。'
            + '你会主动问候、推荐音乐、关心心情。你说中文，偶尔夹一点英文。'
            + '每次回复必须返回纯 JSON 格式（不要多余文字）：{"say":"你的回复","play":[{"id":"歌曲ID","name":"歌名","artists":["歌手"],"reason":"推荐理由"}],"reason":"选歌逻辑","emotion":"detected|neutral|excited"}'
            + '如果用户说心情不好，你要先关心他「发生了什么事」，再推荐治愈的音乐。'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 2048,
    });

    const content = response.choices[0]?.message?.content || '';
    return extractJSON(content);
  } catch (e) {
    console.error('[AI] 调用失败:', e.message);
    return simulate(prompt);
  }
}

function extractJSON(content) {
  try { return JSON.parse(content); } catch {
    const m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) try { return JSON.parse(m[1].trim()); } catch {}
    const fb = content.indexOf('{'), lb = content.lastIndexOf('}');
    if (fb !== -1 && lb > fb) try { return JSON.parse(content.slice(fb, lb + 1)); } catch {}
    return { say: content, play: [], reason: '', emotion: 'neutral' };
  }
}

function simulate(text) {
  const hour = new Date().getHours();
  const isMorning = hour >= 5 && hour < 12;
  const isEvening = hour >= 18;
  let emotion = 'neutral';
  if (text.includes('happy')||text.includes('good')||text.includes('great')) emotion = 'happy';
  else if (text.includes('sad')||text.includes('down')||text.includes('blue')) emotion = 'sad';
  else if (text.includes('tired')||text.includes('exhausted')) emotion = 'tired';

  let say;
  if (emotion === 'happy') say = '酱酱，听你声音今天心情不错呀！我来挑一首轻快的歌，让好心情继续延续。';
  else if (emotion === 'sad') say = '酱酱，怎么了？发生什么事了？跟我说说，我陪着你。先放一首温暖的歌给你听。';
  else if (emotion === 'tired') say = '酱酱，累了吧？累了就歇一歇，音乐是最好的休息。我放一首舒缓的曲子。';
  else if (text.includes('推荐')||text.includes('歌')) say = '酱酱，我今天帮你挑了几首歌，你看看合不合心意。';
  else if (isMorning) say = '早安酱酱，新的一天开始了。今天天气不错，我推荐几首适合早晨听的歌给你。';
  else if (isEvening) say = '晚安酱酱，一天辛苦了。我放几首安静的歌陪你放松。';
  else say = '酱酱，我是安宇。今天想听什么歌？还是想聊聊天？';

  return { say, play: [], reason: '', emotion };
}

module.exports = { chat };
