/*
 * 리듬타운 곡 데이터와 채보(노트) 생성.
 *
 * 곡 "달빛 장터"는 국악 힙합(조선팝) 스타일로 직접 만든 곡이다.
 * 악기 연주 이벤트(audio.js가 소리로 만든다)와 노트 채보를 같은 데이터에서 만들기 때문에
 * 노트는 항상 실제 소리가 나는 박자에 맞는다.
 *
 * 시간 단위: step = 16분음표. 한 마디 = 16 step.
 */
(function (root) {
  'use strict';
  const RT = (root.RT = root.RT || {});

  const BPM = 92;
  const BEAT = 60 / BPM;
  const SIXTEENTH = BEAT / 4;
  const STEPS_PER_BAR = 16;
  const SWING = 0.56; // 홀수 16분음표를 살짝 늦춰 힙합 그루브를 만든다.

  // 계면조 느낌의 D 단조 5음음계 (레 파 솔 라 도).
  const SCALE = [0, 3, 5, 7, 10];
  const ROOT_MIDI = 62; // D4

  function degToMidi(deg) {
    const octave = Math.floor(deg / 5);
    const index = ((deg % 5) + 5) % 5;
    return ROOT_MIDI + 12 * octave + SCALE[index];
  }

  function stepTime(step) {
    const pair = Math.floor(step / 2);
    const odd = step - pair * 2;
    return pair * 2 * SIXTEENTH + (odd ? SWING * 2 * SIXTEENTH : 0);
  }

  // 4마디 반복 화성: Dm - B♭ - C - Am (베이스 근음 MIDI)
  const BASS_ROOTS = [38, 34, 36, 33];

  // 가야금 리프 [step, 음계 번호, 길이(step), 꾸밈]
  // 꾸밈: v = 농현(떨기), b = 밀어올리기, d = 꺾기
  const GAYAGEUM_RIFF = [
    [[0, 5, 3], [3, 3, 3], [6, 4, 2], [8, 3, 3, 'v'], [11, 2, 3], [14, 3, 2]],
    [[0, 1, 3], [3, 2, 3], [6, 3, 2], [8, 2, 2], [10, 1, 2], [12, 0, 4, 'v']],
    [[0, 4, 3], [3, 2, 3], [6, 4, 2], [8, 5, 3, 'b'], [11, 4, 3], [14, 2, 2]],
    [[0, 3, 6, 'v'], [6, 2, 2], [8, 1, 2], [10, 0, 2], [12, -1, 2], [14, -2, 2]],
  ];

  // 대금 후렴 선율
  const DAEGEUM_CHORUS = [
    [[0, 7, 6], [6, 8, 4], [10, 7, 2], [12, 6, 4]],
    [[0, 5, 8, 'v'], [8, 6, 4], [12, 7, 4]],
    [[0, 9, 6], [6, 8, 2], [8, 7, 4], [12, 8, 4]],
    [[0, 8, 12, 'v'], [12, 7, 2], [14, 6, 2]],
  ];
  const DAEGEUM_CHORUS_LIFT = [[0, 8, 4], [4, 9, 4], [8, 10, 8, 'v']];
  const DAEGEUM_CHORUS_END = [[0, 7, 4], [4, 6, 4], [8, 5, 8, 'v']];

  // 간주(브레이크) 대금 독주
  const DAEGEUM_BREAK = [
    [[0, 5, 10, 'v'], [10, 6, 2, 'd'], [12, 7, 4]],
    [[0, 8, 6, 'b'], [6, 7, 2], [8, 6, 8, 'v']],
    [[0, 7, 4], [4, 8, 4], [8, 9, 4, 'd'], [12, 8, 4]],
    [[0, 7, 16, 'v']],
  ];

  // 장구 장단 (4/4에 맞춘 변형)
  const JANGGU_GROOVE = [[0, '덩'], [3, '덕'], [6, '쿵'], [8, '덕'], [11, '기덕'], [14, '쿵']];
  const JANGGU_BREAK = [[0, '덩'], [2, '덕'], [4, '쿵'], [6, '덕'], [8, '덩'], [10, '기덕'], [12, '쿵'], [14, '덕']];
  const JANGGU_FILL = [[0, '덩'], [3, '덕'], [6, '쿵'], [8, '덕'], [9, '덕'], [10, '쿵'], [11, '덕'], [12, '덩'], [13, '덕'], [14, '덩'], [15, '덕']];

  const SECTIONS = [
    { name: 'intro', label: '도입', from: 0, bars: 4 },
    { name: 'verse', label: '1절', from: 4, bars: 8 },
    { name: 'chorus', label: '후렴', from: 12, bars: 8 },
    { name: 'break', label: '대금 간주', from: 20, bars: 4 },
    { name: 'chorus2', label: '마지막 후렴', from: 24, bars: 8 },
    { name: 'ending', label: '맺음', from: 32, bars: 1 },
  ];
  const TOTAL_BARS = 33;

  function sectionOf(bar) {
    for (const s of SECTIONS) if (bar >= s.from && bar < s.from + s.bars) return s;
    return SECTIONS[SECTIONS.length - 1];
  }

  /*
   * 악기 이벤트 생성. 각 이벤트:
   *  { step, inst, vel, ...악기별 값, prio, lanes }
   * prio(채보 우선순위)가 있는 이벤트만 노트 후보가 된다.
   *  0 = 노트 아님, 1 = 상에서만, 2 = 중·상, 3 = 선율(가장 먼저 고름), 4 = 징(항상)
   */
  function buildEvents() {
    const ev = [];
    const add = (o) => ev.push(o);

    for (let bar = 0; bar < TOTAL_BARS; bar++) {
      const sec = sectionOf(bar);
      const base = bar * STEPS_PER_BAR;
      const loop = bar % 4; // 4마디 반복 안에서의 위치
      const inSec = bar - sec.from;
      const root = BASS_ROOTS[loop];
      const lastBarOfSection = inSec === sec.bars - 1;

      if (sec.name === 'ending') {
        add({ step: base, inst: 'jing', vel: 1, prio: 4, lanes: 'jing' });
        add({ step: base, inst: 'janggu', stroke: '덩', vel: 1, prio: 0 });
        add({ step: base, inst: 'kick', vel: 1, prio: 0 });
        add({ step: base, inst: 'bass', midi: 38, len: 16, vel: 1, prio: 0 });
        add({ step: base, inst: 'gayageum', midi: degToMidi(0), len: 16, orn: 'v', vel: 0.9, prio: 0 });
        add({ step: base, inst: 'gayageum', midi: degToMidi(5), len: 16, orn: 'v', vel: 0.6, prio: 0 });
        add({ step: base, inst: 'daegeum', midi: degToMidi(5), len: 14, orn: 'v', vel: 0.8, prio: 0 });
        continue;
      }

      // 징: 후렴과 간주가 시작할 때 크게 울린다.
      if (inSec === 0 && (sec.name === 'chorus' || sec.name === 'chorus2' || sec.name === 'break')) {
        add({ step: base, inst: 'jing', vel: 0.9, prio: 4, lanes: 'jing' });
      }

      // 가야금
      if (sec.name !== 'break') {
        const chorusLike = sec.name === 'chorus' || sec.name === 'chorus2';
        for (const [s, deg, len, orn] of GAYAGEUM_RIFF[loop]) {
          if (sec.name === 'intro' && inSec < 2 && s % 4 !== 0 && s !== 3 && s !== 11) continue;
          add({
            step: base + s,
            inst: 'gayageum',
            midi: degToMidi(chorusLike ? deg - 5 : deg),
            len,
            orn,
            vel: chorusLike ? 0.55 : sec.name === 'intro' ? 0.8 : 0.85,
            prio: chorusLike ? 2 : 3,
            lanes: 'melody',
            deg,
          });
        }
      }

      // 대금
      if (sec.name === 'chorus' || sec.name === 'chorus2') {
        let phrase = DAEGEUM_CHORUS[loop];
        if (loop === 3 && inSec >= 4) phrase = sec.name === 'chorus2' ? DAEGEUM_CHORUS_END : DAEGEUM_CHORUS_LIFT;
        for (const [s, deg, len, orn] of phrase) {
          add({ step: base + s, inst: 'daegeum', midi: degToMidi(deg), len, orn, vel: 0.85, prio: 3, lanes: 'daegeum', deg });
        }
      } else if (sec.name === 'break') {
        for (const [s, deg, len, orn] of DAEGEUM_BREAK[loop]) {
          add({ step: base + s, inst: 'daegeum', midi: degToMidi(deg), len, orn, vel: 0.95, prio: 3, lanes: 'daegeum', deg });
        }
      }

      // 베이스
      if (sec.name === 'break') {
        add({ step: base, inst: 'bass', midi: root, len: 15, vel: 0.7, prio: 0 });
      } else if (!(sec.name === 'intro' && inSec < 2)) {
        add({ step: base, inst: 'bass', midi: root, len: 5, vel: 1, prio: 0 });
        add({ step: base + 7, inst: 'bass', midi: root, len: 3, vel: 0.8, prio: 0 });
        add({ step: base + 10, inst: 'bass', midi: root, len: 4, vel: 0.9, prio: 0 });
        if (sec.name !== 'intro' && sec.name !== 'verse') add({ step: base + 14, inst: 'bass', midi: root + 12, len: 2, vel: 0.7, prio: 0 });
      }

      // 힙합 드럼 (도입 앞 2마디와 간주에서는 쉰다)
      const drums = sec.name !== 'break' && !(sec.name === 'intro' && inSec < 2);
      if (drums) {
        const kicks = loop === 3 ? [0, 7, 10, 13] : [0, 7, 10];
        for (const s of kicks) add({ step: base + s, inst: 'kick', vel: s === 0 ? 1 : 0.85, prio: s === 0 ? 2 : 1, lanes: 'kick' });
        for (const s of [4, 12]) add({ step: base + s, inst: 'snare', vel: 1, prio: 2, lanes: 'snare' });
        if (loop === 3) add({ step: base + 15, inst: 'snare', vel: 0.3, prio: 0 });
        const chorusLike = sec.name === 'chorus' || sec.name === 'chorus2';
        for (let s = 0; s < 16; s += chorusLike ? 1 : 2) {
          const accent = s % 4 === 2 ? 0.7 : s % 2 === 0 ? 0.5 : 0.3;
          add({ step: base + s, inst: 'hat', vel: accent, open: s === 14 && loop === 1, prio: 0 });
        }
      } else if (sec.name === 'break') {
        add({ step: base, inst: 'kick', vel: 0.8, prio: 0 });
      }

      // 장구
      let jang = JANGGU_GROOVE;
      if (sec.name === 'break') jang = JANGGU_BREAK;
      if (lastBarOfSection && sec.name !== 'intro') jang = JANGGU_FILL;
      if (sec.name === 'intro' && inSec === sec.bars - 1) jang = JANGGU_FILL;
      const jangVel = sec.name === 'intro' || sec.name === 'break' ? 0.9 : 0.6;
      for (const [s, stroke] of jang) {
        const strong = stroke === '덩';
        add({
          step: base + s,
          inst: 'janggu',
          stroke,
          vel: jangVel * (strong ? 1 : 0.85),
          prio: strong ? 2 : 1,
          lanes: stroke,
        });
      }

      // 꽹과리: 후렴에서만 살짝
      if (sec.name === 'chorus' || sec.name === 'chorus2') {
        for (const [s, v] of [[0, 0.9], [3, 0.35], [6, 0.35], [8, 0.7], [11, 0.35], [14, 0.35]]) {
          add({ step: base + s, inst: 'kkwaenggwari', vel: v, prio: 0 });
        }
      }
    }

    for (const e of ev) e.time = stepTime(e.step);
    ev.sort((a, b) => a.time - b.time);
    return ev;
  }

  // 난이도 설정
  const DIFFICULTY = {
    하: { grid: 4, minPrio: 2, minGap: 4, chords: false, scroll: 1.7, windows: [0.05, 0.095, 0.14] },
    중: { grid: 2, minPrio: 2, minGap: 2, chords: true, scroll: 1.3, windows: [0.042, 0.08, 0.12] },
    상: { grid: 1, minPrio: 1, minGap: 1, chords: true, scroll: 1.0, windows: [0.034, 0.066, 0.1] },
  };

  function melodyLane(deg, inst) {
    if (inst === 'daegeum') return deg <= 5 ? 0 : deg === 6 ? 1 : deg === 7 ? 2 : 3;
    return deg <= 1 ? 0 : deg === 2 ? 1 : deg === 3 ? 2 : 3;
  }

  // 이벤트 하나가 차지하는 레인들 (난이도에 따라 동시치기 여부가 다르다)
  function lanesFor(e, chords) {
    switch (e.lanes) {
      case 'melody':
      case 'daegeum':
        return [melodyLane(e.deg, e.inst)];
      case 'jing':
        return chords ? [0, 3] : [1];
      case '덩':
        return chords ? [0, 3] : [1];
      case '쿵':
        return [0];
      case '덕':
      case '기덕':
        return [3];
      case 'kick': // 짝수 마디는 왼쪽, 홀수 마디는 가운데
        return [Math.floor(e.step / STEPS_PER_BAR) % 2 === 0 ? 0 : 1];
      case 'snare': // 2박은 가운데, 4박은 오른쪽
        return [e.step % STEPS_PER_BAR === 4 ? 2 : 3];
      default:
        return [1];
    }
  }

  /* 채보 생성: step마다 가장 중요한 이벤트 하나를 골라 노트로 만든다. */
  function buildChart(difficulty) {
    const cfg = DIFFICULTY[difficulty];
    if (!cfg) throw new Error('알 수 없는 난이도: ' + difficulty);
    const events = buildEvents();
    const byStep = new Map();
    for (const e of events) {
      if (!e.prio || e.prio < cfg.minPrio) continue;
      if (e.step % cfg.grid !== 0) continue;
      const cur = byStep.get(e.step);
      // 같은 step이면 우선순위가 높은 것, 같으면 선율을 고른다.
      if (!cur || e.prio > cur.prio) byStep.set(e.step, e);
    }
    const steps = [...byStep.keys()].sort((a, b) => a - b);
    const notes = [];
    let lastStep = -Infinity;
    for (const step of steps) {
      const e = byStep.get(step);
      if (step - lastStep < cfg.minGap && e.prio < 4) continue;
      // 하: 도입부는 박마다 다 치지 않고 2박마다
      if (difficulty === '하' && step < 4 * STEPS_PER_BAR && step % 8 !== 0) continue;
      lastStep = step;
      let lanes = lanesFor(e, cfg.chords);
      // 중: 동시치기는 징과 후렴 첫 박만
      if (difficulty === '중' && lanes.length > 1 && e.prio < 4 && step % 32 !== 0) lanes = [lanes[0] === 0 ? 1 : lanes[0]];
      for (const lane of lanes) notes.push({ time: stepTime(step), step, lane, source: e.inst });
    }
    return notes;
  }

  const lastEvent = TOTAL_BARS * STEPS_PER_BAR;

  RT.song = {
    id: 'moonlight-market',
    title: '달빛 장터',
    subtitle: '국악 힙합 · 조선팝',
    bpm: BPM,
    beat: BEAT,
    stepsPerBar: STEPS_PER_BAR,
    totalBars: TOTAL_BARS,
    sections: SECTIONS,
    length: stepTime(lastEvent - STEPS_PER_BAR) + 4, // 마지막 징이 울리는 시간까지
    stepTime,
    degToMidi,
    buildEvents,
    buildChart,
    difficulty: DIFFICULTY,
    sectionAt(time) {
      const bar = Math.max(0, Math.floor(time / (BEAT * 4)));
      return sectionOf(Math.min(bar, TOTAL_BARS - 1));
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
