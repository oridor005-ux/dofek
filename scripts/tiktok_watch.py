"""מעקב אוטומטי אחרי ערוצי טיקטוק.

כל חצי שעה: לכל ערוץ ב-config.json (tiktokChannels) מושך את הסרטונים האחרונים,
מתמלל סרטונים חדשים (Whisper בעברית) ושומר ב-data/videos.json + data/transcripts/.
Claude עובר על התמלולים כל 3 שעות ובודק טענות עובדתיות.
"""
import json, os, re, sys, glob, tempfile, time, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from transcribe import run, log, try_subs, try_whisper  # noqa: E402

CFG = json.load(open(os.path.join(ROOT, 'config.json'), encoding='utf-8'))
VID = os.path.join(ROOT, 'data', 'videos.json')
OUT = os.path.join(ROOT, 'data', 'transcripts')
PER_CHANNEL = int(os.environ.get('PER_CHANNEL', '3'))     # כמה סרטונים אחרונים לבדוק בכל ערוץ
MAX_NEW = int(os.environ.get('MAX_NEW', '10'))              # מקסימום תמלולים בריצה
MAX_AGE_DAYS = 4


def list_channel(handle):
    url = f'https://www.tiktok.com/@{handle.lstrip("@")}'
    code, out = run(['yt-dlp', '--flat-playlist', '--playlist-end', str(PER_CHANNEL), '--print',
                     '%(id)s|||%(url)s|||%(title)s|||%(timestamp)s', url], timeout=180)
    vids = []
    for l in out.splitlines():
        p = l.split('|||')
        if len(p) == 4 and p[0].isdigit():
            vids.append({'id': p[0], 'url': p[1] if p[1].startswith('http') else f'{url}/video/{p[0]}', 'title': p[2], 'ts': p[3]})
    if not vids:
        log('  list failed:', out[-400:])
    return vids


def main(test=False):
    channels = os.environ['TEST_CHANNELS'].split() if os.environ.get('TEST_CHANNELS') else CFG.get('tiktokChannels', [])
    data = json.load(open(VID, encoding='utf-8')) if os.path.exists(VID) else {'items': []}
    seen = {v['id'] for v in data['items']}
    os.makedirs(OUT, exist_ok=True)
    done = 0
    for ch in channels:
        handle = ch['handle'] if isinstance(ch, dict) else ch
        log('channel', handle)
        for v in list_channel(handle):
            if v['id'] in seen or done >= MAX_NEW:
                continue
            try:
                if v['ts'] not in ('NA', '', 'None') and time.time() - float(v['ts']) > MAX_AGE_DAYS * 86400:
                    seen.add(v['id']); continue
            except ValueError:
                pass
            with tempfile.TemporaryDirectory() as tmp:
                text, how = try_whisper(v['url'], tmp)
            item = {'id': v['id'], 'channel': handle, 'name': ch.get('name', handle) if isinstance(ch, dict) else handle,
                    'url': v['url'], 'caption': v['title'][:500], 'posted': v['ts'],
                    'found': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'status': 'new'}
            if text:
                path = os.path.join(OUT, f"tt-{v['id']}.txt")
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(f"מקור: {v['url']}\nערוץ: @{handle}\nכיתוב: {v['title']}\nשיטה: {how} — תמלול אוטומטי, ייתכנו שגיאות\n\n{text[:40000]}")
                item['transcript'] = f"data/transcripts/tt-{v['id']}.txt"
                log('  ✓', v['id'], how, len(text))
                if test:
                    log(text[:800])
            else:
                item['status'] = 'no-speech' if how == 'no-speech' else 'failed'
                log('  ✗', v['id'], (how or '')[-200:])
            data['items'].append(item); seen.add(v['id']); done += 1
    data['items'] = data['items'][-400:]
    with open(VID, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1); f.write('\n')
    log('new videos:', done)


if __name__ == '__main__':
    main(test='--test' in sys.argv)
