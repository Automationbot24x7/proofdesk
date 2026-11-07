#!/usr/bin/env python3
"""Builds the Proofdesk demo video from captured scenes, the end card, narration and music.
Run in WSL/Linux with ffmpeg:  python3 tools/video/build.py
In:  video/cap/s1..s9/{list.txt,f*.jpg}, video/endcard.png, video/vo/s1..s10.wav, video/music.mp3,
     video/durations.json (written by tools/video/capture.mjs), video/fonts/Inter-SemiBold.ttf
Out: assets/video/proofdesk-demo.mp4 (1920x1080, 30 fps, H.264 + AAC)
"""
import json, os, subprocess, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
T = 'video/tmp'
shutil.rmtree(T, ignore_errors=True)
os.makedirs(T)
os.makedirs('assets/video', exist_ok=True)
FONT = 'video/fonts/Inter-SemiBold.ttf'
D = json.load(open('video/durations.json'))
N = len(D)

CAPTIONS = {
    's1': 'An unchecked help desk repeats whatever its documents say',
    's2': 'Proofdesk  ·  every source screened, every answer checked',
    's3': 'Checkpoint 1  ·  one Clocked Pipeline call per document',
    's4': 'Guard quarantines  ·  Inspect withholds  ·  Protect masks',
    's5': 'Compare + Extract retire the outdated policy',
    's6': 'Checkpoint 2  ·  Rerank  ·  Fill  ·  Verify',
    's7': 'Decide routes to the IT desk or the People Team',
    's8': 'Protect masks the question  ·  Guard blocks manipulation',
    's9': 'What each Clocked call changed, with request and response',
}


def run(*args):
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *args], check=True)


def esc(t):
    return t.replace('\\', '\\\\').replace(':', '\\:').replace("'", '’').replace(',', '\\,')


def caption(s):
    if s not in CAPTIONS:
        return ''
    return (f",drawbox=x=0:y=ih-92:w=iw:h=92:color=0x0a0f1f@0.86:t=fill,"
            f"drawbox=x=0:y=ih-92:w=iw:h=2:color=0x3446d4@0.9:t=fill,"
            f"drawtext=fontfile={FONT}:text='{esc(CAPTIONS[s])}':fontsize=36:fontcolor=0xf2f4fb:x=(w-tw)/2:y=h-62")


ENC = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '21', '-r', '30']
FIT = 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1'


def dur(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True, check=True).stdout.strip()
    return float(out)


def screen(s, d, out):
    run('-f', 'concat', '-safe', '0', '-i', f'video/cap/{s}/list.txt', '-t', str(d),
        '-vf', f'{FIT}{caption(s)}', '-fps_mode', 'cfr', *ENC, out)  # cfr keeps long holds; the fps filter drops the first


def still(img, d, out, s):
    frames = int(d * 30)
    run('-loop', '1', '-i', img, '-t', str(d),
        '-vf', f"scale=3840:2160,zoompan=z='1+0.04*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1920x1080:fps=30,setsar=1{caption(s)}",
        *ENC, out)


parts = []
for i in range(1, N):
    s = f's{i}'
    screen(s, D[s], f'{T}/{s}.mp4')
    parts.append(f'{T}/{s}.mp4')
still('video/endcard.png', D[f's{N}'], f'{T}/s{N}.mp4', f's{N}')
parts.append(f'{T}/s{N}.mp4')

# Picture: short crossfades between scenes
XF = 0.35
durs = [dur(p) for p in parts]
inputs, chain, last = [], '', '[0:v]'
for p in parts:
    inputs += ['-i', p]
for i in range(1, len(parts)):
    off = sum(durs[:i]) - i * XF
    out = f'[x{i}]'
    chain += f'{last}[{i}:v]xfade=transition=fade:duration={XF}:offset={off:.3f}{out};'
    last = out
run(*inputs, '-filter_complex', chain.rstrip(';'), '-map', last, *ENC, f'{T}/video.mp4')

# Narration: each line padded to its scene length, minus the crossfade overlap, so voice and picture stay aligned
auds = []
for i in range(1, N + 1):
    s = f's{i}'
    a = f'{T}/{s}.wav'
    trim = XF if i < N else 0
    run('-i', f'video/vo/{s}.wav', '-af', 'adelay=180:all=1,apad', '-t', f'{D[s] - trim:.3f}', '-ar', '48000', '-ac', '2', a)
    auds.append(a)
with open(f'{T}/a.txt', 'w') as f:
    f.writelines(f"file '{os.path.basename(a)}'\n" for a in auds)
run('-f', 'concat', '-safe', '0', '-i', f'{T}/a.txt', '-c:a', 'pcm_s16le', f'{T}/voice.wav')

vd = dur(f'{T}/video.mp4')
run('-stream_loop', '-1', '-i', 'video/music.mp3', '-t', f'{vd:.3f}',
    '-af', f'volume=0.12,afade=t=in:st=0:d=1.5,afade=t=out:st={vd - 3.5:.3f}:d=3.5', '-ar', '48000', '-ac', '2', f'{T}/music.wav')
run('-i', f'{T}/voice.wav', '-i', f'{T}/music.wav', '-filter_complex',
    '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[a]', '-map', '[a]', '-t', f'{vd:.3f}', f'{T}/audio.wav')
run('-i', f'{T}/video.mp4', '-i', f'{T}/audio.wav', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-shortest', 'assets/video/proofdesk-demo.mp4')
print(f'built assets/video/proofdesk-demo.mp4 ({vd:.1f}s)')
