#!/usr/bin/env python3
"""타격음(북·장구·드럼) 만들기: python3 tools/make_hits.py <내려받을 폴더>

공개 저작물(CC0) 녹음 음원을 내려받아 게임용 한 방 소리로 다듬는다.
  - VCSL (Versilian Community Sample Library, CC0) https://github.com/sgossner/VCSL
  - Stargate 샘플 팩 (CC0, Freesound·Fugue State Audio·Karoryfer 소리 모음) https://github.com/stargatedaw/stargate-sample-pack
결과: audio/hits/<id>.wav (모노 16비트) — 소리 목록은 js/hits.js 에 손으로 적는다.

다듬기: 시작 앞 무음을 잘라 누르는 순간 바로 소리가 나게 하고, 꼬리를 정해진 길이에서 부드럽게 줄이고,
처음 0.15초 크기(RMS)를 맞춰 소리마다 크기가 비슷하게 한다.
장구는 공개 녹음을 찾지 못해 프레임 북·림샷을 섞어 비슷한 소리를 만든다.
numpy 가 필요하다.
"""
import os
import struct
import sys
import urllib.parse
import urllib.request

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'audio', 'hits')

SG = 'https://raw.githubusercontent.com/stargatedaw/stargate-sample-pack/main/stargate-sample-pack/'
VC = 'https://raw.githubusercontent.com/sgossner/VCSL/master/Membranophones/Struck Membranophones/'

# 내려받을 원본: 이름 → 주소
SOURCES = {
    'vc_bd1_v7': VC + 'Bass Drum 1/BDrumNew_hit_v7_rr1_Sum.wav',
    'vc_frameL_v3': VC + 'Frame Drum/HDrumL_Hit_v3_rr1_Sum.wav',
    'vc_frameS_muted': VC + 'Frame Drum/HDrumS_HitMuted_v3_rr1_Sum.wav',
    'vc_tomL_v4': VC + 'Tom 2/Mallet/TomL_HitM_v4_rr1_Mid.wav',
    'med_drum20': SG + 'karoryfer/percussion/medieval_drum_20.wav',
    'frame16': SG + 'karoryfer/percussion/frame_drum_16.wav',
    'tom_szp18': SG + 'karoryfer/toms/tom_Szpaderski_18.wav',
    'tom_rmif22': SG + 'karoryfer/toms/tom_RMIF_22.wav',
    'kick_sdb': SG + 'fugue-state-audio/drums/kicks/sdbkit-kick.wav',
    'kick_x0x1': SG + 'fugue-state-audio/drums/kicks/x0xproc1-kick.wav',
    'kick_dvbeats': SG + 'freesound/drums/kick/347166__dvbeats__kick-drum-1.wav',
    'kick_szp_damp': SG + 'karoryfer/kicks/kick_Szpaderski_24_dampened.wav',
    'snare_sdb': SG + 'fugue-state-audio/drums/snares/sdbkit-snare.wav',
    'snare_x0x1': SG + 'fugue-state-audio/drums/snares/x0xproc1-snare.wav',
    'snare_tape5': SG + 'freesound/drums/snare/212233__alexthegr81__tapesnare-5.wav',
    'snare_ai20': SG + 'freesound/drums/snare/387186__alexiero-1__ai-snare-20.wav',
    'clap_hiphop': SG + 'freesound/drums/clap/448221__toxicfilmzsrsounds__hip-hop-clap.wav',
    'clap_synth': SG + 'fugue-state-audio/drums/claps/synthkit-clap.wav',
    'clap_dist': SG + 'fugue-state-audio/drums/claps/distkit-clap.wav',
    'hat_x0x1': SG + 'fugue-state-audio/drums/hihats/x0xproc1-hatclsd.wav',
    'hat_sdb': SG + 'fugue-state-audio/drums/hihats/sdbkit-hatclsd.wav',
    'rim_se1': SG + 'freesound/drums/rimshot/511382__pjhedman__se1-rim.wav',
    'rim_x0x2': SG + 'fugue-state-audio/drums/percussion/x0xproc2-rimshot.wav',
}

# 만들 소리: id → (섞을 원본 [(이름, 배율)], 최대 길이(초), 크기 배율)
HITS = {
    'buk_big': ([('vc_bd1_v7', 1)], 0.9, 1.15),
    'buk_old': ([('med_drum20', 1)], 0.8, 1),
    'buk_low': ([('tom_rmif22', 1)], 0.9, 1),
    'buk_tom': ([('tom_szp18', 1)], 0.7, 1),
    'buk_mallet': ([('vc_tomL_v4', 1)], 0.6, 1),
    'buk_frame': ([('frame16', 1)], 0.7, 1),
    'janggu_kung': ([('vc_frameL_v3', 1)], 0.6, 1),
    'janggu_deok': ([('vc_frameS_muted', 1), ('rim_se1', 0.45)], 0.35, 0.95),
    'janggu_deong': ([('vc_frameL_v3', 1), ('vc_frameS_muted', 0.8), ('rim_se1', 0.35)], 0.6, 1),
    'kick_sdb': ([('kick_sdb', 1)], 0.4, 1.1),
    'kick_808': ([('kick_x0x1', 1)], 0.45, 1.1),
    'kick_punch': ([('kick_dvbeats', 1)], 0.3, 1.1),
    'kick_live': ([('kick_szp_damp', 1)], 0.35, 1.1),
    'snare_sdb': ([('snare_sdb', 1)], 0.3, 1),
    'snare_bright': ([('snare_x0x1', 1)], 0.35, 0.9),
    'snare_tape': ([('snare_tape5', 1)], 0.2, 1),
    'snare_crisp': ([('snare_ai20', 1)], 0.3, 0.85),
    'clap_hiphop': ([('clap_hiphop', 1)], 0.12, 1),
    'clap_synth': ([('clap_synth', 1)], 0.25, 1),
    'clap_dist': ([('clap_dist', 1)], 0.22, 1),
    'hat_tight': ([('hat_x0x1', 1)], 0.15, 0.7),
    'hat_bright': ([('hat_sdb', 1)], 0.12, 0.65),
    'rim_wood': ([('rim_se1', 1)], 0.15, 0.9),
    'rim_808': ([('rim_x0x2', 1)], 0.08, 0.9),
}
TARGET_RMS = 0.2


def read_wav(path):
    b = open(path, 'rb').read()
    if b[:4] != b'RIFF' or b[8:12] != b'WAVE':
        raise ValueError(f'WAV 파일이 아님: {path}')
    i, fmt, data = 12, None, None
    while i + 8 <= len(b):
        cid = b[i:i + 4]
        size = struct.unpack('<I', b[i + 4:i + 8])[0]
        body = b[i + 8:i + 8 + size]
        if cid == b'fmt ':
            fmt = body
        elif cid == b'data':
            data = body
        i += 8 + size + (size & 1)
    tag, ch, sr, _, align, bits = struct.unpack('<HHIIHH', fmt[:16])
    if tag == 0xFFFE:
        tag = struct.unpack('<H', fmt[24:26])[0]
    data = data[:len(data) // align * align]
    if tag == 3:
        x = np.frombuffer(data, '<f4' if bits == 32 else '<f8').astype(np.float64)
    elif bits == 16:
        x = np.frombuffer(data, '<i2') / 32768.0
    elif bits == 24:
        a = np.frombuffer(data, np.uint8).reshape(-1, 3).astype(np.int32)
        v = a[:, 0] | (a[:, 1] << 8) | (a[:, 2] << 16)
        x = np.where(v >= 1 << 23, v - (1 << 24), v) / 8388608.0
    elif bits == 32:
        x = np.frombuffer(data, '<i4') / 2147483648.0
    else:
        raise ValueError(f'지원하지 않는 형식: {bits}비트')
    return x.reshape(-1, ch).mean(axis=1), sr


def write_wav(path, x, sr):
    q = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2').tobytes()
    head = b'RIFF' + struct.pack('<I', 36 + len(q)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, sr, sr * 2, 2, 16)
    with open(path, 'wb') as f:
        f.write(head + b'data' + struct.pack('<I', len(q)) + q)


def resample(x, sr, to):
    if sr == to:
        return x
    n = int(round(len(x) * to / sr))
    return np.interp(np.arange(n) * sr / to, np.arange(len(x)), x)


def trimmed(x, sr):
    """앞 무음을 잘라 소리가 바로 시작하게 한다(1ms 여유)."""
    peak = np.abs(x).max()
    on = int(np.argmax(np.abs(x) > peak * 0.03))
    return x[max(0, on - sr // 1000):]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src_dir = sys.argv[1]
    os.makedirs(src_dir, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    for name, url in SOURCES.items():
        path = os.path.join(src_dir, name + '.wav')
        if not os.path.exists(path):
            print('내려받기', name)
            urllib.request.urlretrieve(urllib.parse.quote(url, safe=':/'), path)
    sr = 44100
    for hid, (parts, max_len, gain) in HITS.items():
        mix = None
        for name, level in parts:
            x, r = read_wav(os.path.join(src_dir, name + '.wav'))
            x = trimmed(resample(x, r, sr), sr) * level
            if mix is None:
                mix = x
            else:
                n = max(len(mix), len(x))
                mix = np.pad(mix, (0, n - len(mix))) + np.pad(x, (0, n - len(x)))
        x = mix[:int(max_len * sr)]
        fade = min(len(x), int(0.04 * sr))
        x[-fade:] *= np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
        rms = np.sqrt(np.mean(x[:int(0.15 * sr)] ** 2))
        x = x * (TARGET_RMS / max(rms, 1e-6)) * gain
        peak = np.abs(x).max()
        if peak > 0.97:
            x *= 0.97 / peak
        write_wav(os.path.join(OUT, hid + '.wav'), x, sr)
        print(f'{hid:14s} {len(x) / sr:.2f}초  최대 {np.abs(x).max():.2f}')


if __name__ == '__main__':
    main()
