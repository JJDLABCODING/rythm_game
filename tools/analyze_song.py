"""음원 파일(WAV)을 분석해 박자(BPM·첫 박)와 난이도별 채보를 만들고, 웹용 mp3로 변환한다.

    python3 tools/analyze_song.py <입력.wav> <곡 id> --title "제목" --subtitle "부제" [--segments "0=100,96.6=110"]

  --start/--end: 파일의 일부만 한 곡으로 쓴다(초). 여러 곡이 이어 붙은 파일을 나눌 때 쓴다.
                 자른 곳은 0.01초 동안 소리를 줄여 '틱' 소리를 막는다.
  --segments: 템포가 바뀌는 곡(여러 곡을 이어 붙인 파일 등)은 "시작초=BPM" 을 쉼표로 나열한다.
              각 구간 안에서 템포(±0.3)와 첫 박을 다시 찾는다. 없으면 곡 전체를 한 템포로 본다.

필요한 파이썬 패키지: numpy, lameenc (pip install numpy lameenc)
결과:
  audio/<곡 id>.mp3       웹에서 재생할 음원
  js/songs/<곡 id>.js     곡 정보와 난이도별 노트(시각·레인)

방법(요약)
  1) 짧은 구간마다 주파수를 나눠(저음=킥, 중음=스네어·장구, 고음=하이햇) 소리가 새로 시작하는 세기(onset)를 잰다.
  2) onset 세기의 자기상관으로 템포를 찾고, 구간 전체에서 박이 가장 잘 맞는 위치(첫 박)를 찾은 뒤
     8분음표 격자로 몇 ms 단위까지 다시 맞춘다. (각 구간은 일정한 템포라고 가정한다)
  3) 16분음표 격자마다 세기를 모아, 난이도별 목표 밀도에 맞게 센 소리부터 노트로 고른다.
     하=박마다, 중=8분음표, 상=16분음표·동시치기. 노트 사이 최소 간격을 지킨다.
  4) 저음은 왼쪽, 고음은 오른쪽 레인에 두되 같은 레인이 너무 이어지지 않게 섞는다.
"""
import argparse
import json
import math
import pathlib
import sys
import wave

import numpy as np

HOP = 512
WIN = 2048


def read_wav(path):
    with wave.open(str(path), 'rb') as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        width = w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width != 2:
        sys.exit('16비트 WAV만 지원합니다.')
    data = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
    data = data.reshape(-1, ch)
    return sr, data


def onset_bands(mono, sr):
    n = 1 + (len(mono) - WIN) // HOP
    window = np.hanning(WIN).astype(np.float32)
    freqs = np.fft.rfftfreq(WIN, 1 / sr)
    bands = {'low': (30, 160), 'mid': (160, 2500), 'high': (5000, 15000), 'all': (30, 15000)}
    masks = {k: (freqs >= lo) & (freqs < hi) for k, (lo, hi) in bands.items()}
    prev = None
    flux = {k: np.zeros(n, dtype=np.float32) for k in bands}
    energy = np.zeros(n, dtype=np.float32)
    centroid = np.zeros(n, dtype=np.float32)
    for i in range(n):
        frame = mono[i * HOP:i * HOP + WIN] * window
        mag = np.abs(np.fft.rfft(frame))
        logm = np.log1p(mag * 10)
        energy[i] = float(np.sqrt(np.mean(frame ** 2)))
        s = mag[masks['all']].sum()
        centroid[i] = float((mag[masks['all']] * freqs[masks['all']]).sum() / s) if s > 0 else 0
        if prev is not None:
            d = np.maximum(logm - prev, 0)
            for k, m in masks.items():
                flux[k][i] = d[m].sum()
        prev = logm
    for k in flux:  # 대역마다 크기를 맞춘다
        v = flux[k]
        flux[k] = v / (np.percentile(v, 99) + 1e-9)
    return flux, energy, centroid


def find_tempo(env, fps, lo=70, hi=180, prefer=(85, 135)):
    env = env - env.mean()
    ac = np.correlate(env, env, mode='full')[len(env) - 1:]
    best = None
    for bpm10 in range(lo * 10, hi * 10 + 1):
        bpm = bpm10 / 10
        lag = 60 * fps / bpm
        a = np.interp(lag, np.arange(len(ac)), ac)
        a += 0.5 * np.interp(lag * 2, np.arange(len(ac)), ac)
        a *= 1.15 if prefer[0] <= bpm <= prefer[1] else 1.0
        if best is None or a > best[0]:
            best = (a, bpm)
    return best[1]


def comb_score(env, period, phase):
    idx = np.arange(phase, len(env) - 1, period)
    return float(np.interp(idx, np.arange(len(env)), env).sum())


def refine(env, fps, bpm, span=1.5):
    """bpm 주변을 촘촘히 훑어 가장 잘 맞는 템포와 첫 박 위치(프레임)를 찾는다."""
    best = None
    for b in np.arange(bpm - span, bpm + span + 0.0001, 0.01):
        period = 60 * fps / b
        for ph in np.arange(0, period, 0.5):
            s = comb_score(env, period, ph)
            if best is None or s > best[0]:
                best = (s, b, ph)
    return best[1], best[2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('wav')
    ap.add_argument('song_id')
    ap.add_argument('--title', required=True)
    ap.add_argument('--subtitle', default='')
    ap.add_argument('--segments', default=None, help='템포 구간: "시작초=BPM,시작초=BPM"')
    ap.add_argument('--kbps', type=int, default=160)
    ap.add_argument('--start', type=float, default=0.0, help='이 시각(초)부터 자른다')
    ap.add_argument('--end', type=float, default=None, help='이 시각(초)까지 자른다')
    args = ap.parse_args()

    root = pathlib.Path(__file__).resolve().parent.parent
    sr, data = read_wav(args.wav)
    a = int(args.start * sr)
    b = int(args.end * sr) if args.end else len(data)
    data = data[a:b].copy()
    fade = int(0.01 * sr)
    ramp = np.linspace(0, 1, fade, dtype=np.float32)[:, None]
    if a > 0:
        data[:fade] *= ramp
    if args.end:
        data[-fade:] *= ramp[::-1]
    mono = data.mean(axis=1)
    duration = len(mono) / sr
    fps = sr / HOP
    print(f'길이 {duration:.2f}초 (원본 {args.start:.2f}초부터), {sr}Hz, {data.shape[1]}채널')

    flux, energy, centroid = onset_bands(mono, sr)
    env = flux['low'] * 1.0 + flux['mid'] * 0.8 + flux['high'] * 0.4
    if args.segments:
        segs = [(float(x.split('=')[0]), float(x.split('=')[1])) for x in args.segments.split(',')]
    else:
        segs = [(0.0, find_tempo(env, fps))]
    segs.sort()
    tempo = []  # [{from, to, bpm, firstBeat}]
    for k, (start, bpm0) in enumerate(segs):
        end = segs[k + 1][0] if k + 1 < len(segs) else duration
        a_f, b_f = int(start * fps), int(end * fps)
        part = env[a_f:b_f]
        bpm, ph = refine(part, fps, bpm0, span=0.3 if args.segments else 1.5)
        period = 60 * fps / bpm
        beat_sec = 60 / bpm
        first = start + ph / fps
        # 8분음표 격자로 몇 ms 단위까지 다시 맞춘다
        best = None
        for off in np.arange(-0.03, 0.0301, 0.001):
            idx = np.arange((first + off) * fps, b_f - 1, period / 2)
            sc = float(np.interp(idx, np.arange(len(env)), env).sum())
            if best is None or sc > best[0]:
                best = (sc, off)
        first += best[1]
        # 마디 첫 박: 네 박 중 킥(저음)이 가장 센 자리
        beats = np.arange(first * fps, b_f - 1, period)
        low_at = np.interp(beats, np.arange(len(env)), flux['low'])
        bar_off = int(np.argmax([low_at[j::4].sum() for j in range(4)]))
        first += bar_off * beat_sec
        while first - 4 * beat_sec >= start - 0.02:
            first -= 4 * beat_sec
        tempo.append({'from': round(start, 3), 'to': round(end, 3), 'bpm': round(bpm, 3), 'firstBeat': round(first, 4)})
        print(f'구간 {start:7.2f}~{end:7.2f}초: {bpm:.2f} BPM, 첫 마디 {first:.3f}초 (미세 보정 {best[1] * 1000:+.0f}ms)')

    # 16분음표 격자 (구간마다 따로)
    t_list, seg_of, step_in_bar = [], [], []
    for k, tp in enumerate(tempo):
        step = 60 / tp['bpm'] / 4
        i = 0
        while True:
            t = tp['firstBeat'] + i * step
            if t >= tp['to'] - 0.05:
                break
            if t >= tp['from'] - 0.01:
                t_list.append(t)
                seg_of.append(k)
                step_in_bar.append(i % 16)
            i += 1
    t_steps = np.array(t_list)
    n_steps = len(t_steps)
    sib = np.array(step_in_bar)
    seg_of = np.array(seg_of)
    bar_id = np.cumsum((sib == 0).astype(int))  # 전체 마디 번호
    first_beat = tempo[0]['firstBeat']
    bpm = tempo[0]['bpm']
    beat_sec = 60 / bpm
    frames = t_steps * fps
    step_sec = float(np.median(np.diff(t_steps)))

    def peak(band):
        out = np.zeros(n_steps, dtype=np.float32)
        for i, f in enumerate(frames):
            a = max(0, int(f) - 2)
            b = min(len(band), int(f) + 3)
            out[i] = band[a:b].max() if b > a else 0
        return out

    low = peak(flux['low'])
    mid = peak(flux['mid'])
    high = peak(flux['high'])
    cen = np.interp(frames, np.arange(len(centroid)), centroid)
    # 곡의 크기(마디별 RMS): 조용한 구간은 노트를 줄인다
    loud = np.interp(frames, np.arange(len(energy)), energy)
    n_bars = int(bar_id.max()) + 1
    bar_loud = np.array([loud[bar_id == b].mean() if (bar_id == b).any() else 0 for b in range(n_bars)])
    bar_loud = bar_loud / (np.percentile(bar_loud, 90) + 1e-9)
    step_loud = bar_loud[bar_id]

    # 세기를 주변 8초 기준으로 다시 맞춘다(곡 크기가 변해도 고르게)
    def local_norm(v):
        w = int(8 / step_sec)
        out = np.zeros_like(v)
        for i in range(len(v)):
            a, b = max(0, i - w), min(len(v), i + w)
            out[i] = v[i] / (np.percentile(v[a:b], 85) + 1e-6)
        return out

    lowN, midN, highN = local_norm(low), local_norm(mid), local_norm(high)
    strength = np.maximum.reduce([lowN, midN * 0.95, highN * 0.55])

    pos_weight = np.array([1.0 if s % 4 == 0 else 0.8 if s % 2 == 0 else 0.62 for s in sib])
    score = strength * pos_weight * np.clip(step_loud, 0.25, 1.2)

    cfgs = {
        '하': {'grid': 4, 'gap': 4, 'nps': 1.35, 'chord': False},
        '중': {'grid': 2, 'gap': 2, 'nps': 2.3, 'chord': True},
        '상': {'grid': 1, 'gap': 1, 'nps': 4.0, 'chord': True},
    }
    play_len = duration - first_beat
    # 곡이 바뀌는 무음 구간 등 거의 소리가 없는 곳에는 노트를 두지 않는다
    quiet = step_loud < 0.2
    charts = {}
    for name, c in cfgs.items():
        target = int(c['nps'] * play_len)
        cand = [i for i in range(n_steps) if sib[i] % c['grid'] == 0 and t_steps[i] > 0.6 and t_steps[i] < duration - 0.5 and strength[i] > 0.35 and not quiet[i]]
        cand.sort(key=lambda i: -score[i])
        chosen = set()
        for i in cand:
            if len(chosen) >= target:
                break
            if any((i + d) in chosen and seg_of[i + d] == seg_of[i] for d in range(-c['gap'] + 1, c['gap']) if 0 <= i + d < n_steps):
                continue
            chosen.add(i)
        steps = sorted(chosen)
        # 레인: 소리 높낮이(밝기) 순위를 32개씩 묶어 네 레인에 고르게 나눈다.
        # 낮은 소리(킥)일수록 왼쪽, 밝은 소리(하이햇·꽹과리)일수록 오른쪽 — 높낮이 흐름은 그대로 남는다.
        feat = np.array([math.log(max(cen[i], 50)) + 0.6 * (highN[i] - lowN[i]) for i in steps])
        lanes = np.zeros(len(steps), dtype=int)
        block = 32
        for s0 in range(0, len(steps), block):
            part = feat[s0:s0 + block]
            order = np.argsort(np.argsort(part))
            lanes[s0:s0 + block] = np.minimum(3, (order * 4) // max(1, len(part)))
        notes = []
        last_lane = -1
        run = 0
        limit = 2 if name == '하' else 3
        for k, i in enumerate(steps):
            lane = int(lanes[k])
            # 같은 레인이 너무 이어지지 않게 옆으로 옮긴다
            if lane == last_lane:
                run += 1
                if run >= limit:
                    lane = lane + 1 if lane < 3 else lane - 1
                    run = 0
            else:
                run = 0
            last_lane = lane
            notes.append([round(float(t_steps[i]), 4), lane])
            # 동시치기: 박 위에서 저음과 중음이 함께 아주 셀 때
            if c['chord'] and sib[i] % 4 == 0 and lowN[i] > 1.05 and midN[i] > 1.05 and (name == '상' or (sib[i] == 0 and bar_id[i] % 2 == 0)):
                other = 3 - lane if 3 - lane != lane else (lane + 2) % 4
                notes.append([round(float(t_steps[i]), 4), other])
        charts[name] = notes
        print(f'{name}: 노트 {len(notes)}개, 초당 {len(notes) / play_len:.2f}개, 레인 {[sum(1 for n in notes if n[1] == l) for l in range(4)]}')

    # 구간 이름(마디 크기로 대략): 조용하면 '쉬어가기', 크면 '후렴'
    # 구간 이름: 템포 구간(곡) 단위
    if len(tempo) > 1:
        sections = [{'from': tp['from'], 'label': f"{k + 1}곡 · {tp['bpm']:g} BPM"} for k, tp in enumerate(tempo)]
    else:
        sections = [{'from': 0, 'label': f"{tempo[0]['bpm']:g} BPM"}]

    # mp3 변환
    import lameenc
    enc = lameenc.Encoder()
    enc.set_bit_rate(args.kbps)
    enc.set_in_sample_rate(sr)
    enc.set_channels(data.shape[1])
    enc.set_quality(2)
    pcm = (np.clip(data, -1, 1) * 32767).astype('<i2').tobytes()
    mp3 = enc.encode(pcm) + enc.flush()
    out_audio = root / 'audio' / f'{args.song_id}.mp3'
    out_audio.parent.mkdir(exist_ok=True)
    out_audio.write_bytes(mp3)
    print(f'mp3 {len(mp3) / 1e6:.1f}MB -> {out_audio.relative_to(root)}')

    song = {
        'id': args.song_id,
        'title': args.title,
        'subtitle': args.subtitle,
        'audio': f'audio/{args.song_id}.mp3',
        # LAME 인코더가 mp3 앞에 넣는 지연(1105샘플). 재생할 때 이만큼 건너뛰어야 노트와 맞는다.
        # (Chrome 에서 원본 WAV 와 비교해 23.0ms 로 확인)
        'audioDelay': round(1105 / sr, 5),
        'bpm': round(bpm, 3),
        'firstBeat': round(first_beat, 4),
        'tempo': tempo,
        'length': round(duration, 3),
        'sections': sections,
        'charts': charts,
    }
    out_js = root / 'js' / 'songs' / f'{args.song_id}.js'
    out_js.parent.mkdir(exist_ok=True)
    out_js.write_text(
        '// tools/analyze_song.py 가 만든 파일입니다. 직접 고치지 말고 다시 생성하세요.\n'
        '(function (root) {\n  const RT = (root.RT = root.RT || {});\n  RT.songData = RT.songData || [];\n'
        f'  RT.songData.push({json.dumps(song, ensure_ascii=False, separators=(",", ":"))});\n'
        "})(typeof window !== 'undefined' ? window : globalThis);\n",
        encoding='utf-8')
    print(f'채보 -> {out_js.relative_to(root)}')


if __name__ == '__main__':
    main()
