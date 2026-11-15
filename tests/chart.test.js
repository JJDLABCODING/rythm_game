// 채보 검사: node tests/chart.test.js
// 노트가 실제 소리가 나는 박자에 있는지, 난이도별 밀도·간격·레인이 올바른지 확인한다.
'use strict';
const path = require('path');
const assert = require('assert');
require(path.join(__dirname, '..', 'js', 'song.js'));
const song = globalThis.RT.song;

const events = song.buildEvents();
const soundTimes = new Set(events.map((e) => e.time.toFixed(6)));
const stats = {};

for (const d of ['하', '중', '상']) {
  const cfg = song.difficulty[d];
  const notes = song.buildChart(d);
  assert(notes.length > 50, `${d}: 노트가 너무 적다 (${notes.length})`);
  let prevStep = -Infinity;
  const seen = new Set();
  for (const n of notes) {
    assert(n.lane >= 0 && n.lane <= 3, `${d}: 레인 범위 밖 ${n.lane}`);
    assert(n.time >= 0 && n.time < song.length, `${d}: 곡 길이 밖 노트 ${n.time}`);
    assert(soundTimes.has(n.time.toFixed(6)), `${d}: 소리가 없는 시각에 노트 ${n.time}`);
    assert(n.step >= prevStep, `${d}: 노트 순서가 섞임`);
    const key = `${n.step}:${n.lane}`;
    assert(!seen.has(key), `${d}: 같은 시각·같은 레인 노트 중복 ${key}`);
    seen.add(key);
    if (n.step !== prevStep) {
      const gap = n.step - prevStep;
      const isJing = n.source === 'jing';
      assert(gap >= cfg.minGap || isJing, `${d}: 노트 간격이 너무 좁음 step ${n.step} (간격 ${gap})`);
      assert(n.step % cfg.grid === 0, `${d}: 격자 밖 노트 step ${n.step}`);
    }
    prevStep = n.step;
  }
  if (!cfg.chords) {
    const steps = notes.map((n) => n.step);
    assert.strictEqual(new Set(steps).size, steps.length, `${d}: 동시치기가 없어야 함`);
  }
  const lanes = [0, 0, 0, 0];
  for (const n of notes) lanes[n.lane]++;
  assert(lanes.every((c) => c >= notes.length * 0.1), `${d}: 레인이 한쪽으로 치우침 ${lanes}`);
  stats[d] = { notes: notes.length, nps: +(notes.length / song.length).toFixed(2), lanes: lanes.join('/') };
}

assert(stats['하'].notes < stats['중'].notes && stats['중'].notes < stats['상'].notes, '난이도가 오를수록 노트가 많아야 함');
const [ph, gh, oh] = song.difficulty['하'].windows;
const [ps, gs, os] = song.difficulty['상'].windows;
assert(ps < ph && gs < gh && os < oh, '상 판정 범위가 하보다 좁아야 함');

console.log(`곡: ${song.title} (${song.bpm} BPM, ${song.length.toFixed(1)}초, 소리 이벤트 ${events.length}개)`);
console.table(stats);
console.log('채보 검사 통과');
