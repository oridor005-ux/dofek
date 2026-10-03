"""תמלול סרטונים לבקשות בדיקה.

לכל בקשה ממתינה עם קישור (יוטיוב / טיקטוק / אינסטגרם / X / פייסבוק ועוד):
1. מנסה כתוביות קיימות (מהיר).
2. אם אין — מוריד רק את השמע ומתמלל עם Whisper.
התמלול נשמר ב-data/transcripts/<id>.txt, ו-Claude קורא אותו בסבב הבא.
"""
import json, os, re, subprocess, sys, glob, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQ = os.path.join(ROOT, 'data', 'requests.json')
OUT = os.path.join(ROOT, 'data', 'transcripts')
MAX_SECONDS = int(os.environ.get('MAX_SECONDS', '1500'))  # עד 25 דקות
MODEL = os.environ.get('WHISPER_MODEL', 'small')
VIDEO_HOSTS = re.compile(r'(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com|t\.me|vimeo\.com|kan\.org\.il|mako\.co\.il|13tv\.co\.il|now14\.co\.il|i24news|reshet)', re.I)


def log(*a):
    print(*a, flush=True)


def pending(data):
    return [r for r in data.get('items', [])
            if r.get('status', 'pending') == 'pending' and r.get('link') and VIDEO_HOSTS.search(r['link'])
            and r.get('transcriptStatus') not in ('ok',) and r.get('transcriptTries', 0) < 3]


EXTRA = ['--extractor-args', 'youtube:player_client=tv_embedded,web_embedded,mweb,default', '--impersonate', 'chrome']


def run(cmd, timeout=900):
    if cmd and cmd[0] == 'yt-dlp':
        cmd = cmd[:1] + EXTRA + cmd[1:]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def clean_vtt(text):
    lines, last = [], ''
    for l in text.splitlines():
        l = l.strip()
        if not l or '-->' in l or l.startswith(('WEBVTT', 'Kind:', 'Language:', 'NOTE')) or l.isdigit():
            continue
        l = re.sub(r'<[^>]+>', '', l)
        if l != last:
            lines.append(l)
        last = l
    return '\n'.join(lines)


def try_subs(url, tmp):
    code, out = run(['yt-dlp', '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', 'he,iw,en,ar',
                     '--sub-format', 'vtt', '--no-playlist', '-o', os.path.join(tmp, 'subs.%(ext)s'), url], timeout=180)
    files = sorted(glob.glob(os.path.join(tmp, 'subs*.vtt')), key=lambda f: (0 if re.search(r'\.(he|iw)\.', f) else 1))
    if files:
        with open(files[0], encoding='utf-8', errors='ignore') as f:
            t = clean_vtt(f.read())
        if len(t) > 40:
            return t, 'subtitles'
    return None, out[-400:]


def to_sec(at):
    try:
        p = [int(x) for x in str(at).strip().split(':')]
        return p[0] * 60 if len(p) == 1 else p[-2] * 60 + p[-1] + (p[0] * 3600 if len(p) == 3 else 0)
    except Exception:
        return None


def try_whisper(url, tmp, at=None):
    t = to_sec(at) if at else None
    rng = ['--download-sections', f'*{max(0, t - 60)}-{t + 300}'] if t is not None else ['--match-filter', f'duration < {MAX_SECONDS}']
    code, out = run(['yt-dlp', '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '7',
                     '--no-playlist', *rng, '-o', os.path.join(tmp, 'audio.%(ext)s'), url], timeout=900)
    audio = glob.glob(os.path.join(tmp, 'audio.*'))
    if not audio:
        return None, out[-500:]
    from faster_whisper import WhisperModel
    model = WhisperModel(MODEL, device='cpu', compute_type='int8')
    segs, info = model.transcribe(audio[0], vad_filter=True, beam_size=1)
    parts, off = [], (max(0, t - 60) if t is not None else 0)
    for s in segs:
        m, sec = divmod(int(s.start) + off, 60)
        parts.append(f'[{m:02d}:{sec:02d}] {s.text.strip()}')
    if not parts:
        return None, 'no-speech'
    return '\n'.join(parts), f'whisper-{MODEL} ({info.language})'


def meta(url):
    code, out = run(['yt-dlp', '--skip-download', '--no-playlist', '--print', '%(title)s|||%(uploader)s|||%(upload_date)s|||%(duration)s', url], timeout=120)
    line = out.strip().splitlines()[-1] if code == 0 and out.strip() else ''
    p = line.split('|||')
    return {'title': p[0], 'uploader': p[1], 'date': p[2], 'duration': p[3]} if len(p) == 4 else {}


def main():
    with open(REQ, encoding='utf-8') as f:
        data = json.load(f)
    todo = pending(data)
    if not todo:
        log('no videos to transcribe')
        return
    os.makedirs(OUT, exist_ok=True)
    for r in todo[:3]:
        url = r['link']
        log('transcribing', r['id'], url)
        r['transcriptTries'] = r.get('transcriptTries', 0) + 1
        with tempfile.TemporaryDirectory() as tmp:
            try:
                info = meta(url)
                text, how = (None, '') if r.get('at') else try_subs(url, tmp)
                if not text:
                    text, how = try_whisper(url, tmp, r.get('at'))
                if text:
                    head = f"מקור: {url}\nכותרת: {info.get('title','')}\nמעלה: {info.get('uploader','')}\nתאריך: {info.get('date','')}\nשיטה: {how} — תמלול אוטומטי, ייתכנו שגיאות\n\n"
                    with open(os.path.join(OUT, r['id'] + '.txt'), 'w', encoding='utf-8') as f:
                        f.write(head + text[:60000])
                    r['transcriptStatus'] = 'ok'
                    r['transcript'] = f"data/transcripts/{r['id']}.txt"
                    r['videoMeta'] = info
                    log('  ok via', how, len(text), 'chars')
                else:
                    reason = 'login' if re.search(r'login|sign in|cookies|confirm you', how or '', re.I) else 'no-speech' if how == 'no-speech' else 'too-long' if 'does not pass filter' in (how or '') else 'download'
                    r['transcriptStatus'] = f'failed:{reason}'
                    log('  failed:', (how or '')[-300:])
            except Exception as e:
                r['transcriptStatus'] = 'failed:error'
                log('  error:', e)
    with open(REQ, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')


def test(url):
    at = None
    if '@@' in url:
        url, at = url.split('@@')
    with tempfile.TemporaryDirectory() as tmp:
        log('meta:', meta(url))
        text, how = (None, '') if at else try_subs(url, tmp)
        if not text:
            text, how = try_whisper(url, tmp, at)
        log('RESULT:', 'OK' if text else 'FAILED', '|', (how or '')[-600:])
        if text:
            log(text[:1500])


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--test':
        for u in sys.argv[2:]:
            log('=' * 20, u)
            try: test(u)
            except Exception as e: log('error', e)
    else:
        main()
