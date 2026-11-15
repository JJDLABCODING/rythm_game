/*
 * 곡 목록. 음원 곡(js/songs/*.js, tools/analyze_song.py 가 만든 것)과 합성곡(js/song.js)을
 * 게임이 똑같이 다룰 수 있는 모양으로 묶는다.
 *
 * 곡 하나가 갖는 것: id, title, subtitle, length, bpm, beat, firstBeat, difficulty,
 *   buildEvents() — 합성 악기 연주 이벤트(음원 곡은 없음)
 *   buildChart(난이도) — [{time, lane}]
 *   beatPhase(time) — 박 안에서의 위치 0~1 (화면의 박자 번쩍임용)
 *   sectionAt(time) — {label}
 *   audio, audioDelay — 음원 곡만: mp3 주소와 앞쪽 인코더 지연(초)
 */
(function (root) {
  'use strict';
  const RT = (root.RT = root.RT || {});

  function fileSong(d) {
    const tempo = d.tempo && d.tempo.length ? d.tempo : [{ from: 0, to: d.length, bpm: d.bpm, firstBeat: d.firstBeat }];
    const segAt = (t) => tempo.reduce((cur, tp) => (t >= tp.from ? tp : cur), tempo[0]);
    const first = tempo[0];
    return {
      id: d.id,
      kind: 'audio',
      title: d.title,
      subtitle: d.subtitle,
      audio: d.audio,
      audioDelay: d.audioDelay || 0,
      bpm: first.bpm,
      beat: 60 / first.bpm,
      firstBeat: first.firstBeat,
      length: d.length,
      difficulty: RT.DIFFICULTY,
      noteCounts: Object.fromEntries(Object.entries(d.charts).map(([k, v]) => [k, v.length])),
      buildEvents() {
        return [];
      },
      buildChart(difficulty) {
        const rows = d.charts[difficulty];
        if (!rows) throw new Error('알 수 없는 난이도: ' + difficulty);
        return rows.map(([time, lane]) => ({ time, lane }));
      },
      beatPhase(time) {
        const tp = segAt(time);
        const beat = 60 / tp.bpm;
        return ((((time - tp.firstBeat) / beat) % 1) + 1) % 1;
      },
      sectionAt(time) {
        let label = d.sections && d.sections.length ? d.sections[0].label : `${first.bpm} BPM`;
        for (const s of d.sections || []) if (time >= s.from) label = s.label;
        return { label };
      },
    };
  }

  const list = (RT.songData || []).map(fileSong);
  if (RT.song) {
    RT.song.noteCounts = Object.fromEntries(['하', '중', '상'].map((k) => [k, RT.song.buildChart(k).length]));
    list.push(RT.song);
  }
  RT.songs = list;
  RT.getSong = (id) => list.find((s) => s.id === id) || list[0];
})(typeof window !== 'undefined' ? window : globalThis);
