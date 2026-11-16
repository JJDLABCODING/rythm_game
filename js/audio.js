/*
 * 리듬타운 소리 엔진 (Web Audio API).
 * 녹음 파일 없이 국악기(가야금·대금·장구·꽹과리·징·박)와 힙합 드럼·베이스를 직접 합성한다.
 * 게임 시계도 여기서 제공한다: 오디오 출력 시각을 기준으로 해야 노트와 소리가 어긋나지 않는다.
 */
(function (root) {
  'use strict';
  const RT = (root.RT = root.RT || {});

  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.run = null; // 이번 판 음악 버스 (정지하면 통째로 끊는다)
      this.timer = null;
      this.queue = [];
      this.qi = 0;
      this.t0 = 0;
      this.ksCache = new Map();
      this.lastClock = 0;
      this.files = new Map(); // 주소 → 내려받은 음원(ArrayBuffer) 약속
      this.decoded = new Map(); // 주소 → 풀어 둔 AudioBuffer 약속
      this.source = null;
    }

    /* ---------- 음원 파일 ---------- */

    // 곡을 고르면 미리 내려받아 둔다(소리 풀기는 AudioContext 가 생긴 뒤에).
    prefetch(url) {
      if (!this.files.has(url)) {
        const p = fetch(url).then((r) => {
          if (!r.ok) throw new Error(`음원을 받지 못했습니다 (${r.status})`);
          return r.arrayBuffer();
        });
        p.catch(() => this.files.delete(url));
        this.files.set(url, p);
      }
      return this.files.get(url);
    }

    async loadBuffer(url) {
      const ctx = this.ensure();
      if (!this.decoded.has(url)) {
        const p = this.prefetch(url).then((data) => ctx.decodeAudioData(data.slice(0)));
        p.catch(() => this.decoded.delete(url));
        this.decoded.set(url, p);
      }
      return this.decoded.get(url);
    }

    ensure() {
      if (!this.ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) throw new Error('이 브라우저는 Web Audio를 지원하지 않습니다.');
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.build();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    build() {
      const ctx = this.ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 3;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      // 마지막 단: 순간적으로 튀는 소리를 눌러 찢어지지 않게 한다.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.1;
      this.master = ctx.createGain();
      this.master.gain.value = 0.62;
      this.master.connect(comp).connect(limiter).connect(ctx.destination);

      this.sfx = ctx.createGain();
      this.sfx.gain.value = 0.5;
      this.sfx.connect(this.master);

      // 공간감: 짧게 만든 잔향
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeImpulse(2.4, 2.6);
      this.reverbReturn = ctx.createGain();
      this.reverbReturn.gain.value = 0.32;
      this.reverb.connect(this.reverbReturn).connect(this.master);

      // 흰 잡음 2초
      const n = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }

    makeImpulse(seconds, decay) {
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      return buf;
    }

    /* ---------- 게임 시계 ---------- */

    // 지금 스피커에서 나오고 있는 곡의 위치(초). perfNow = performance.now() 또는 event.timeStamp
    songTime(perfNow) {
      const ctx = this.ctx;
      if (!ctx) return 0;
      if (ctx.state !== 'running') return this.lastClock;
      let t;
      if (ctx.getOutputTimestamp) {
        const ts = ctx.getOutputTimestamp();
        if (ts.contextTime > 0 && ts.performanceTime > 0) t = ts.contextTime + (perfNow - ts.performanceTime) / 1000;
      }
      const latency = Math.min(0.3, (ctx.baseLatency || 0) + (ctx.outputLatency || 0));
      if (t === undefined || !isFinite(t) || Math.abs(t - (ctx.currentTime - latency)) > 0.25) t = ctx.currentTime - latency;
      const song = t - this.t0 + (RT.settings ? RT.settings.offset : 0) / 1000;
      this.lastClock = song;
      return song;
    }

    /* ---------- 곡 재생 ---------- */

    // events: 합성 악기·박 소리, delay: 지금부터 곡 0초까지(초)
    // file: { buffer, skip } — 음원 곡이면 곡 0초에 맞춰 재생한다(skip = mp3 앞 인코더 지연)
    start(events, delay, file) {
      this.stop();
      const ctx = this.ensure();
      this.run = ctx.createGain();
      this.run.gain.value = 1;
      this.run.connect(this.master);
      this.runVerb = ctx.createGain();
      this.runVerb.connect(this.reverb);
      this.queue = events;
      this.qi = 0;
      this.t0 = ctx.currentTime + delay;
      if (file && file.buffer) {
        const src = ctx.createBufferSource();
        src.buffer = file.buffer;
        src.connect(this.run);
        src.start(this.t0, file.skip || 0);
        this.source = src;
      }
      this.timer = setInterval(() => this.pump(), 25);
      this.pump();
      return this.t0;
    }

    pump() {
      const ctx = this.ctx;
      if (!ctx || !this.run) return;
      const horizon = ctx.currentTime + 0.2;
      while (this.qi < this.queue.length && this.t0 + this.queue[this.qi].time < horizon) {
        const e = this.queue[this.qi++];
        const at = Math.max(ctx.currentTime, this.t0 + e.time);
        try {
          this.play(e, at);
        } catch (err) {
          console.error(err);
        }
      }
    }

    stop() {
      clearInterval(this.timer);
      this.timer = null;
      if (this.source) {
        const src = this.source;
        this.source = null;
        setTimeout(() => {
          try { src.stop(); } catch (_) { /* 이미 끝남 */ }
        }, 120);
      }
      if (this.run && this.ctx) {
        const now = this.ctx.currentTime;
        const run = this.run;
        const verb = this.runVerb;
        run.gain.cancelScheduledValues(now);
        run.gain.setValueAtTime(run.gain.value, now);
        run.gain.linearRampToValueAtTime(0, now + 0.08);
        setTimeout(() => {
          run.disconnect();
          verb.disconnect();
        }, 200);
      }
      this.run = null;
    }

    pause() {
      if (this.ctx && this.ctx.state === 'running') return this.ctx.suspend();
      return Promise.resolve();
    }

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') return this.ctx.resume();
      return Promise.resolve();
    }

    play(e, t) {
      switch (e.inst) {
        case 'kick': return this.kick(t, e.vel);
        case 'snare': return this.snare(t, e.vel);
        case 'hat': return this.hat(t, e.vel, e.open);
        case 'bass': return this.bass(t, e.midi, this.dur(e.len), e.vel);
        case 'janggu': return this.janggu(t, e.stroke, e.vel);
        case 'gayageum': return this.gayageum(t, e.midi, this.dur(e.len), e.orn, e.vel);
        case 'daegeum': return this.daegeum(t, e.midi, this.dur(e.len), e.orn, e.vel);
        case 'kkwaenggwari': return this.kkwaenggwari(t, e.vel);
        case 'jing': return this.jing(t, e.vel);
        case 'pak': return this.pak(t, e.vel, this.run);
        default: return undefined;
      }
    }

    dur(steps) {
      return (steps || 1) * (RT.song ? RT.song.beat / 4 : 0.16);
    }

    /* ---------- 공통 부품 ---------- */

    env(t, peak, attack, decay, out) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      g.connect(out || this.run);
      return g;
    }

    noiseSrc(t, length) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      s.start(t, Math.random() * 1.5);
      s.stop(t + length);
      return s;
    }

    osc(type, freq, t, length) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.start(t);
      o.stop(t + length);
      return o;
    }

    filter(type, freq, q) {
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      if (q !== undefined) f.Q.value = q;
      return f;
    }

    /* ---------- 힙합 드럼·베이스 ---------- */

    kick(t, v) {
      const o = this.osc('sine', 150, t, 0.5);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
      o.connect(this.env(t, 0.95 * v, 0.003, 0.42));
      const click = this.noiseSrc(t, 0.02);
      click.connect(this.filter('highpass', 2500)).connect(this.env(t, 0.12 * v, 0.001, 0.015));
    }

    snare(t, v) {
      const n = this.noiseSrc(t, 0.3);
      const out = this.env(t, 0.42 * v, 0.002, 0.2);
      n.connect(this.filter('bandpass', 1900, 0.7)).connect(out);
      const send = this.env(t, 0.12 * v, 0.002, 0.25, this.runVerb);
      n.connect(send);
      const o = this.osc('triangle', 200, t, 0.15);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.1);
      o.connect(this.env(t, 0.32 * v, 0.002, 0.1));
    }

    hat(t, v, open) {
      const len = open ? 0.22 : 0.045;
      this.noiseSrc(t, len + 0.05)
        .connect(this.filter('highpass', 7200))
        .connect(this.env(t, 0.13 * v, 0.001, len));
    }

    bass(t, midi, length, v) {
      const f = midiToFreq(midi);
      const lp = this.filter('lowpass', 900, 3);
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(220, t + Math.min(0.4, length));
      const g = this.ctx.createGain();
      const end = t + length + 0.08;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.42 * v, t + 0.012);
      g.gain.setValueAtTime(0.42 * v, Math.max(t + 0.02, end - 0.08));
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      lp.connect(g).connect(this.run);
      this.osc('sawtooth', f, t, length + 0.1).connect(lp);
      const sub = this.osc('sine', f, t, length + 0.1);
      const sg = this.ctx.createGain();
      sg.gain.value = 0.9;
      sub.connect(sg).connect(g);
    }

    /* ---------- 장구 ---------- */

    janggu(t, stroke, v) {
      if (stroke === '덩') {
        this.kung(t, v);
        this.deok(t, v);
      } else if (stroke === '쿵') {
        this.kung(t, v);
      } else if (stroke === '기덕') {
        this.deok(t - 0.055, v * 0.45);
        this.deok(t, v);
      } else {
        this.deok(t, v);
      }
    }

    // 궁편(왼쪽 북면): 낮고 둥근 소리
    kung(t, v) {
      const o = this.osc('sine', 118, t, 0.5);
      o.frequency.exponentialRampToValueAtTime(86, t + 0.25);
      o.connect(this.env(t, 0.5 * v, 0.004, 0.38));
      this.noiseSrc(t, 0.08).connect(this.filter('lowpass', 500)).connect(this.env(t, 0.25 * v, 0.002, 0.06));
    }

    // 채편(오른쪽 북면, 열채): 맑고 날카로운 소리
    deok(t, v) {
      if (t < this.ctx.currentTime) t = this.ctx.currentTime;
      this.noiseSrc(t, 0.1).connect(this.filter('bandpass', 3400, 1.4)).connect(this.env(t, 0.5 * v, 0.001, 0.05));
      const o = this.osc('triangle', 560, t, 0.15);
      o.frequency.exponentialRampToValueAtTime(470, t + 0.08);
      o.connect(this.env(t, 0.22 * v, 0.001, 0.08));
      const body = this.osc('sine', 330, t, 0.2);
      body.connect(this.env(t, 0.16 * v, 0.001, 0.12));
    }

    /* ---------- 가야금 (줄 뜯는 소리: Karplus-Strong 합성) ---------- */

    ksBuffer(midi) {
      if (this.ksCache.has(midi)) return this.ksCache.get(midi);
      const ctx = this.ctx;
      const sr = ctx.sampleRate;
      const freq = midiToFreq(midi);
      const period = Math.max(2, Math.round(sr / freq));
      const len = Math.floor(sr * 2.4);
      const buf = ctx.createBuffer(1, len, sr);
      const y = buf.getChannelData(0);
      let prev = 0;
      for (let i = 0; i < period; i++) {
        const r = Math.random() * 2 - 1;
        prev = prev * 0.45 + r * 0.55; // 손가락으로 뜯은 부드러운 시작
        y[i] = prev;
      }
      const decay = 0.9965 - Math.max(0, midi - 60) * 0.00012;
      for (let i = period; i < len; i++) {
        const a = y[i - period];
        const b = i - period - 1 >= 0 ? y[i - period - 1] : 0;
        y[i] = 0.5 * (a + b) * decay;
      }
      let peak = 0;
      for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(y[i]));
      if (peak > 0) for (let i = 0; i < len; i++) y[i] /= peak;
      const item = { buf, rate: (freq * period) / sr };
      this.ksCache.set(midi, item);
      return item;
    }

    gayageum(t, midi, length, orn, v) {
      const ctx = this.ctx;
      const { buf, rate } = this.ksBuffer(midi);
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.setValueAtTime(rate, t);
      if (orn === 'b') {
        s.playbackRate.setValueAtTime(rate * 0.94, t);
        s.playbackRate.linearRampToValueAtTime(rate, t + 0.12);
      } else if (orn === 'd') {
        s.playbackRate.linearRampToValueAtTime(rate * 1.06, t + 0.08);
        s.playbackRate.linearRampToValueAtTime(rate * 0.97, t + 0.22);
      }
      if (orn === 'v') {
        // 농현: 왼손으로 줄을 눌렀다 놓으며 떠는 소리
        const lfo = this.osc('sine', 5.2, t, length + 0.8);
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(0, t + 0.12);
        depth.gain.linearRampToValueAtTime(rate * 0.022, t + Math.max(0.3, length));
        lfo.connect(depth).connect(s.playbackRate);
      }
      const body = this.filter('peaking', 900, 1.1);
      body.gain.value = 5;
      const lp = this.filter('lowpass', 4200);
      const g = ctx.createGain();
      const end = t + length + 0.6;
      g.gain.setValueAtTime(0.5 * v, t);
      g.gain.setValueAtTime(0.5 * v, t + length);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      s.connect(body).connect(lp).connect(g);
      g.connect(this.run);
      const send = ctx.createGain();
      send.gain.value = 0.35;
      g.connect(send).connect(this.runVerb);
      s.start(t);
      s.stop(end + 0.05);
    }

    /* ---------- 대금 (가로로 부는 대나무 피리) ---------- */

    daegeum(t, midi, length, orn, v) {
      const ctx = this.ctx;
      const f = midiToFreq(midi);
      const end = t + length;
      const release = 0.18;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.13 * v, t + 0.09);
      g.gain.setValueAtTime(0.13 * v, Math.max(t + 0.1, end - 0.02));
      g.gain.exponentialRampToValueAtTime(0.0001, end + release);
      g.connect(this.run);
      const send = ctx.createGain();
      send.gain.value = 0.7;
      g.connect(send).connect(this.runVerb);

      const tone = this.filter('lowpass', 3200, 0.5);
      tone.connect(g);
      const oscs = [
        [this.osc('sine', f, t, length + 0.3), 1],
        [this.osc('triangle', f, t, length + 0.3), 0.35],
        [this.osc('sine', f * 2, t, length + 0.3), 0.12],
      ];
      // 청 울림: 대금 특유의 '지잉' 하는 떨림
      const buzz = this.osc('sawtooth', f, t, length + 0.3);
      const buzzBand = this.filter('bandpass', 2600, 1.5);
      const buzzGain = ctx.createGain();
      buzzGain.gain.value = 0.05;
      buzz.connect(buzzBand).connect(buzzGain).connect(tone);
      oscs.push([buzz, 0]);

      // 숨소리
      const breath = this.noiseSrc(t, length + 0.3);
      const bb = this.filter('bandpass', f * 2, 2.5);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.5, t);
      bg.gain.exponentialRampToValueAtTime(0.12, t + 0.25);
      breath.connect(bb).connect(bg).connect(tone);

      // 음 높이 꾸밈 (cent 단위)
      const lfo = this.osc('sine', 5, t, length + 0.3);
      const depth = ctx.createGain();
      const vib = orn === 'v' ? 32 : 10;
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(0, t + Math.min(0.25, length * 0.4));
      depth.gain.linearRampToValueAtTime(vib, end);
      lfo.connect(depth);

      for (const [o, level] of oscs) {
        if (level > 0) {
          const og = ctx.createGain();
          og.gain.value = level;
          o.connect(og).connect(tone);
        }
        depth.connect(o.detune);
        if (orn === 'b') {
          o.detune.setValueAtTime(-90, t);
          o.detune.linearRampToValueAtTime(0, t + 0.16);
        } else if (orn === 'd') {
          o.detune.setValueAtTime(0, t);
          o.detune.linearRampToValueAtTime(70, t + 0.09);
          o.detune.linearRampToValueAtTime(-40, t + 0.24);
          o.detune.linearRampToValueAtTime(0, t + 0.34);
        }
      }
    }

    /* ---------- 꽹과리·징·박 ---------- */

    kkwaenggwari(t, v) {
      const ctx = this.ctx;
      const band = this.filter('bandpass', 2700, 0.8);
      const out = this.env(t, 0.06 * v, 0.001, v > 0.6 ? 0.22 : 0.09);
      band.connect(out);
      for (const f of [1270, 1830, 2640, 3190]) {
        const o = this.osc('square', f, t, 0.3);
        const g = ctx.createGain();
        g.gain.value = 0.25;
        o.connect(g).connect(band);
      }
    }

    jing(t, v) {
      const ctx = this.ctx;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.36 * v, t + 0.04);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
      const lp = this.filter('lowpass', 1400);
      lp.connect(out).connect(this.run);
      const send = ctx.createGain();
      send.gain.value = 0.6;
      out.connect(send).connect(this.runVerb);
      // 낮은 울림 + 살짝 어긋난 배음이 '우웅' 하는 맥놀이를 만든다
      for (const [ratio, level] of [[1, 1], [1.004, 0.7], [2.02, 0.35], [2.98, 0.18], [4.1, 0.08]]) {
        const o = this.osc('sine', 96 * ratio * 0.985, t, 4.3);
        o.frequency.linearRampToValueAtTime(96 * ratio, t + 0.5);
        const g = ctx.createGain();
        g.gain.value = level;
        o.connect(g).connect(lp);
      }
      this.noiseSrc(t, 0.1).connect(this.filter('lowpass', 600)).connect(this.env(t, 0.2 * v, 0.002, 0.08, out));
    }

    // 박: 나무판을 맞부딪는 소리. 국악에서 시작과 끝을 알린다.
    pak(t, v, out) {
      const dest = out || this.sfx;
      this.noiseSrc(t, 0.06).connect(this.filter('bandpass', 1500, 2)).connect(this.env(t, 0.5 * v, 0.001, 0.035, dest));
      for (const f of [820, 1340]) {
        this.osc('sine', f, t, 0.1).connect(this.env(t, 0.3 * v, 0.001, 0.05, dest));
      }
    }

    /* ---------- 플레이어 타격음 (북·장구, 삑사리) ---------- */

    // 레인마다 다른 타악기: 청 = 큰북 '둥', 적 = 장구 '덩', 황 = 장구 '덕', 백 = 손뼉(힙합 스네어)
    // kind: 판정. 정확할수록 크고 묵직하게(얼쑤 1.0 · 좋다 0.62 · 잘한다 0.4)
    hit(kind, lane) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      if (RT.settings && !RT.settings.hitSound) return;
      const t = this.ctx.currentTime;
      const v = kind === 'perfect' ? 1 : kind === 'great' ? 0.62 : 0.4;
      const out = this.drumBus();
      switch (lane) {
        case 0: this.drumBuk(t, v, out); break;
        case 1: this.drumDeong(t, v, out); break;
        case 2: this.drumDeok(t, v, out); break;
        default: this.drumClap(t, v, out); break;
      }
      // 얼쑤: 묵직한 저음과 잔향을 더해 '쾅' 하고 울리게 한다
      if (kind === 'perfect') {
        const o = this.osc('sine', 72, t, 0.3);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
        o.connect(this.env(t, 0.5, 0.002, 0.22, out));
        this.noiseSrc(t, 0.12).connect(this.filter('bandpass', 2200, 0.8)).connect(this.env(t, 0.12, 0.001, 0.09, this.reverb));
      }
    }

    // 박자를 놓친 입력: 피리가 갈라지듯 '삐익' 하는 삑사리 + 힘없이 빗맞은 북
    miss(lane) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      if (RT.settings && !RT.settings.hitSound) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const out = this.drumBus();
      const base = [1480, 1320, 1660, 1240][lane || 0] * (0.97 + Math.random() * 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.012);
      g.gain.setValueAtTime(0.16, t + 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      const band = this.filter('bandpass', base * 1.3, 2.2);
      band.connect(g).connect(out);
      // 음이 올라가다 갑자기 꺾여 떨어지는 소리
      const o1 = this.osc('square', base, t, 0.3);
      o1.frequency.linearRampToValueAtTime(base * 1.12, t + 0.06);
      o1.frequency.setValueAtTime(base * 0.71, t + 0.075);
      o1.frequency.exponentialRampToValueAtTime(base * 0.55, t + 0.25);
      const o2 = this.osc('sawtooth', base * 1.06, t, 0.3); // 살짝 어긋난 음이 거슬리는 맥놀이를 만든다
      o2.frequency.linearRampToValueAtTime(base * 1.2, t + 0.06);
      o2.frequency.setValueAtTime(base * 0.77, t + 0.075);
      o2.frequency.exponentialRampToValueAtTime(base * 0.6, t + 0.25);
      const wob = this.osc('sine', 31, t, 0.3);
      const wd = ctx.createGain();
      wd.gain.value = 60;
      wob.connect(wd);
      wd.connect(o1.frequency);
      wd.connect(o2.frequency);
      for (const [o, lv] of [[o1, 0.5], [o2, 0.35]]) {
        const og = ctx.createGain();
        og.gain.value = lv;
        o.connect(og).connect(band);
      }
      // 빗맞은 북: 짧고 탁한 소리
      const thud = this.osc('sine', 140, t, 0.1);
      thud.frequency.exponentialRampToValueAtTime(90, t + 0.06);
      thud.connect(this.env(t, 0.18, 0.002, 0.05, out));
    }

    drumBus() {
      if (!this.drums) {
        this.drums = this.ctx.createGain();
        this.drums.gain.value = 1.5;
        this.drums.connect(this.master);
      }
      return this.drums;
    }

    // 큰북(소리북·모둠북): 낮고 깊게 '둥'
    drumBuk(t, v, out) {
      const o = this.osc('sine', 128, t, 0.6);
      o.frequency.exponentialRampToValueAtTime(64, t + 0.2);
      o.connect(this.env(t, 0.85 * v, 0.002, 0.42 + 0.15 * v, out));
      const o2 = this.osc('triangle', 210, t, 0.2);
      o2.frequency.exponentialRampToValueAtTime(120, t + 0.08);
      o2.connect(this.env(t, 0.22 * v, 0.001, 0.08, out));
      // 북채가 가죽에 닿는 소리
      this.noiseSrc(t, 0.05).connect(this.filter('bandpass', 900, 1.2)).connect(this.env(t, 0.35 * v, 0.001, 0.03, out));
      this.noiseSrc(t, 0.2).connect(this.filter('lowpass', 400)).connect(this.env(t, 0.12 * v, 0.002, 0.12, this.reverb));
    }

    // 장구 덩: 궁편과 채편을 함께
    drumDeong(t, v, out) {
      const o = this.osc('sine', 112, t, 0.45);
      o.frequency.exponentialRampToValueAtTime(80, t + 0.22);
      o.connect(this.env(t, 0.6 * v, 0.003, 0.34, out));
      this.drumDeok(t, v * 0.85, out);
    }

    // 장구 덕(채편): 맑고 '딱' 하는 소리
    drumDeok(t, v, out) {
      this.noiseSrc(t, 0.1).connect(this.filter('bandpass', 3200, 1.3)).connect(this.env(t, 0.9 * v, 0.001, 0.05, out));
      const o = this.osc('triangle', 600, t, 0.15);
      o.frequency.exponentialRampToValueAtTime(470, t + 0.07);
      o.connect(this.env(t, 0.5 * v, 0.001, 0.08, out));
      this.osc('sine', 330, t, 0.2).connect(this.env(t, 0.32 * v, 0.001, 0.12, out));
      this.noiseSrc(t, 0.12).connect(this.filter('bandpass', 3000, 1)).connect(this.env(t, 0.12 * v, 0.001, 0.08, this.reverb));
    }

    // 손뼉(클랩): 여러 손이 조금씩 어긋나 치는 소리
    drumClap(t, v, out) {
      const band = this.filter('bandpass', 1500, 0.9);
      band.connect(out);
      for (const [d, lv] of [[0, 0.5], [0.011, 0.45], [0.022, 0.6]]) {
        this.noiseSrc(t + d, 0.03).connect(this.env(t + d, lv * v, 0.001, 0.012, band));
      }
      this.noiseSrc(t + 0.022, 0.25).connect(this.env(t + 0.022, 0.55 * v, 0.002, 0.14, band));
      this.noiseSrc(t, 0.2).connect(this.filter('bandpass', 1800, 0.7)).connect(this.env(t, 0.14 * v, 0.002, 0.15, this.reverb));
      const o = this.osc('triangle', 190, t, 0.1);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.06);
      o.connect(this.env(t, 0.2 * v, 0.001, 0.06, out));
    }
  }

  RT.audio = new AudioEngine();
  RT.midiToFreq = midiToFreq;
})(typeof window !== 'undefined' ? window : globalThis);
