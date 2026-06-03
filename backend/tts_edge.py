#!/usr/bin/env python3
""" edge-tts 语音合成，免费男声 """
import asyncio, sys, json, os, uuid
import edge_tts

CACHE_DIR = os.path.join(os.path.dirname(__file__), '..', 'tts_cache')
os.makedirs(CACHE_DIR, exist_ok=True)

VOICE = 'zh-CN-YunjianNeural'  # 稳重男声

async def synthesize(text):
    filename = f"tts_{uuid.uuid4().hex}.mp3"
    filepath = os.path.join(CACHE_DIR, filename)
    tts = edge_tts.Communicate(text, VOICE, rate='-5%')
    await tts.save(filepath)
    return f"/tts/{filename}"

if __name__ == '__main__':
    text = sys.argv[1] if len(sys.argv) > 1 else '你好'
    result = asyncio.run(synthesize(text))
    print(json.dumps({"url": result}))
