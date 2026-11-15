/*
 * 리듬타운 게임 화면: 노트 그리기, 키 입력, 판정, 점수, 일시정지, 결과.
 * 판정 시각은 오디오 출력 시계(RT.audio.songTime)를 기준으로 계산한다.
 */
(function (root) {
  'use strict';
  const RT = (root.RT = root.RT || {});

  /* ---------- 설정 (판정 보정·타격음) ---------- */
  const SETTINGS_KEY = 'rhythmtown.settings';
  RT.settings = { offset: 0, hitSound: true };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (typeof saved.offset === 'number') RT.settings.offset = Math.max(-200, Math.min(200, saved.offset));
    if (typeof saved.hitSound === 'boolean') RT.settings.hitSound = saved.hitSound;
  } catch (_) { /* 저장소를 못 쓰면 기본값 */ }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(RT.settings)); } catch (_) { /* 무시 */ }
  }

  /* ---------- 상수 ---------- */
  // 1인: D F J K (또는 방향키), 2인: 1P A S D F / 2P J K L ; (또는 방향키)
  const KEYMAPS = {
    1: [[['KeyD', 'ArrowLeft'], ['KeyF', 'ArrowDown'], ['KeyJ', 'ArrowUp'], ['KeyK', 'ArrowRight']]],
    2: [
      [['KeyA'], ['KeyS'], ['KeyD'], ['KeyF']],
      [['KeyJ', 'ArrowLeft'], ['KeyK', 'ArrowDown'], ['KeyL', 'ArrowUp'], ['Semicolon', 'ArrowRight']],
    ],
  };
  const KEY_LABELS = { 1: [['D', 'F', 'J', 'K']], 2: [['A', 'S', 'D', 'F'], ['J', 'K', 'L', ';']] };
  RT.keyLabels = KEY_LABELS;

  // 오방색: 청·적·황·백
  const LANE_COLORS = ['#4d8bff', '#ff3b5c', '#ffc94a', '#fff1d6'];
  const LANE_NAMES = ['청', '적', '황', '백'];
  const PLAYER_COLORS = ['#3ef0c1', '#ff4f9a'];
  const FONT = "'Noto Sans KR', system-ui, sans-serif";
  const TITLE_FONT = "'Black Han Sans', 'Noto Sans KR', system-ui, sans-serif";

  // 판정 이름은 판소리 추임새에서 따왔다.
  const JUDGE = {
    perfect: { text: '얼쑤!', color: '#ffe066', weight: 1 },
    great: { text: '좋다!', color: '#4dd8ff', weight: 0.7 },
    good: { text: '잘한다', color: '#ff9f5a', weight: 0.4 },
    miss: { text: '어이쿠', color: '#9a93c4', weight: 0 },
  };
  const MILESTONES = { 20: '얼씨구!', 50: '좋구나!', 100: '지화자!', 150: '명창이로다!', 200: '얼씨구 절씨구!' };

  function rankOf(acc) {
    if (acc >= 0.95) return { name: '명창', letter: 'S' };
    if (acc >= 0.85) return { name: '고수', letter: 'A' };
    if (acc >= 0.7) return { name: '한량', letter: 'B' };
    return { name: '풋내기', letter: 'C' };
  }
  RT.rankOf = rankOf;

  /* ---------- 플레이어 (점수·판정) ---------- */
  class Player {
    constructor(index, notes, cfg) {
      this.index = index;
      this.cfg = cfg;
      this.total = notes.length;
      this.lanes = [[], [], [], []];
      for (const n of notes) this.lanes[n.lane].push({ ...n, judged: null });
      this.head = [0, 0, 0, 0]; // 아직 판정하지 않은 첫 노트
      this.drawFrom = [0, 0, 0, 0];
      this.pressed = [0, 0, 0, 0];
      this.flash = [-1, -1, -1, -1];
      this.bursts = [];
      this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
      this.sum = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.judgeShown = null;
      this.milestone = null;
      this.judgedCount = 0;
    }

    get score() {
      return this.total ? Math.round((1e6 * this.sum) / this.total) : 0;
    }

    get accuracy() {
      return this.judgedCount ? this.sum / this.judgedCount : 1;
    }

    advance(lane) {
      const arr = this.lanes[lane];
      while (this.head[lane] < arr.length && arr[this.head[lane]].judged) this.head[lane]++;
    }

    // 키를 누른 시각 t(곡 시간)로 판정한다. 너무 이르면 무시한다.
    press(lane, t, wallNow) {
      this.advance(lane);
      const note = this.lanes[lane][this.head[lane]];
      if (!note) return null;
      const dt = t - note.time;
      const [p, g, ok] = this.cfg.windows;
      if (Math.abs(dt) > ok) return null;
      const kind = Math.abs(dt) <= p ? 'perfect' : Math.abs(dt) <= g ? 'great' : 'good';
      this.apply(note, kind, dt, wallNow);
      this.flash[lane] = wallNow;
      this.bursts.push({ lane, at: wallNow, kind });
      return kind;
    }

    // 판정선을 지나간 노트는 놓친 것으로 처리한다.
    update(t, wallNow) {
      const ok = this.cfg.windows[2];
      for (let lane = 0; lane < 4; lane++) {
        this.advance(lane);
        const arr = this.lanes[lane];
        while (this.head[lane] < arr.length && t - arr[this.head[lane]].time > ok) {
          this.apply(arr[this.head[lane]], 'miss', 0, wallNow);
          this.advance(lane);
        }
      }
    }

    apply(note, kind, dt, wallNow) {
      note.judged = kind;
      this.counts[kind]++;
      this.judgedCount++;
      this.sum += JUDGE[kind].weight;
      if (kind === 'miss') {
        this.combo = 0;
      } else {
        this.combo++;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        if (MILESTONES[this.combo]) this.milestone = { text: MILESTONES[this.combo], at: wallNow };
      }
      let timing = '';
      if (kind === 'great' || kind === 'good') timing = dt < 0 ? '빠름' : '느림';
      this.judgeShown = { kind, at: wallNow, timing };
    }

    get done() {
      return this.judgedCount >= this.total;
    }
  }

  /* ---------- 게임 ---------- */
  class Game {
    constructor({ players, difficulty, onHome }) {
      this.playerCount = players;
      this.difficulty = difficulty;
      this.onHome = onHome;
      this.song = RT.song;
      this.cfg = this.song.difficulty[difficulty];
      this.el = document.getElementById('game');
      this.canvas = document.getElementById('game-canvas');
      this.ctx2d = this.canvas.getContext('2d');
      this.pauseEl = document.getElementById('pause-menu');
      this.resultEl = document.getElementById('result');
      this.state = 'idle';
      this.raf = 0;
      this.pointers = new Map();
      this.reducedMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.auto = /[?&]auto=1/.test(root.location.search); // 시연용 자동 연주

      this.onKeyDown = this.onKeyDown.bind(this);
      this.onKeyUp = this.onKeyUp.bind(this);
      this.onResize = this.onResize.bind(this);
      this.onVisibility = this.onVisibility.bind(this);
      this.onPointerDown = this.onPointerDown.bind(this);
      this.onPointerUp = this.onPointerUp.bind(this);
      this.frame = this.frame.bind(this);
    }

    start() {
      const audio = RT.audio;
      audio.ensure();
      const chart = this.song.buildChart(this.difficulty);
      this.lastNoteTime = chart.length ? chart[chart.length - 1].time : 0;
      this.endTime = Math.min(this.song.length, this.lastNoteTime + 2.8);
      this.players = [];
      for (let i = 0; i < this.playerCount; i++) this.players.push(new Player(i, chart, this.cfg));

      // 박 네 번으로 시작을 알린다 (하나·둘·셋·넷)
      const beat = this.song.beat;
      const events = this.song.buildEvents();
      for (let i = 4; i >= 1; i--) events.unshift({ time: -i * beat, inst: 'pak', vel: i === 4 ? 1 : 0.8 });
      events.sort((a, b) => a.time - b.time);
      audio.start(events, 4 * beat + 0.7);

      this.el.hidden = false;
      this.pauseEl.hidden = true;
      this.resultEl.hidden = true;
      document.body.classList.add('playing');
      this.onResize();
      root.addEventListener('keydown', this.onKeyDown);
      root.addEventListener('keyup', this.onKeyUp);
      root.addEventListener('resize', this.onResize);
      document.addEventListener('visibilitychange', this.onVisibility);
      root.addEventListener('blur', this.onVisibility);
      this.canvas.addEventListener('pointerdown', this.onPointerDown);
      root.addEventListener('pointerup', this.onPointerUp);
      root.addEventListener('pointercancel', this.onPointerUp);
      this.state = 'playing';
      this.raf = requestAnimationFrame(this.frame);
      this.canvas.focus({ preventScroll: true });
    }

    destroy() {
      RT.audio.stop();
      cancelAnimationFrame(this.raf);
      this.state = 'idle';
      root.removeEventListener('keydown', this.onKeyDown);
      root.removeEventListener('keyup', this.onKeyUp);
      root.removeEventListener('resize', this.onResize);
      document.removeEventListener('visibilitychange', this.onVisibility);
      root.removeEventListener('blur', this.onVisibility);
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
      root.removeEventListener('pointerup', this.onPointerUp);
      root.removeEventListener('pointercancel', this.onPointerUp);
      this.pauseEl.hidden = true;
      this.resultEl.hidden = true;
    }

    /* ----- 입력 ----- */

    lookup(code) {
      const maps = KEYMAPS[this.playerCount];
      for (let p = 0; p < maps.length; p++) {
        for (let lane = 0; lane < 4; lane++) if (maps[p][lane].includes(code)) return [p, lane];
      }
      return null;
    }

    onKeyDown(e) {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused' && e.code === 'Escape') this.resume();
        return;
      }
      if (this.state === 'finished') {
        if (e.code === 'KeyR') { e.preventDefault(); this.restart(); }
        return;
      }
      const hit = this.lookup(e.code);
      if (!hit) return;
      e.preventDefault();
      if (e.repeat || this.state !== 'playing') return;
      this.press(hit[0], hit[1], e.timeStamp);
    }

    onKeyUp(e) {
      const hit = this.lookup(e.code);
      if (hit && this.players) this.players[hit[0]].pressed[hit[1]] = 0;
    }

    press(p, lane, stamp) {
      const player = this.players[p];
      if (!player) return;
      const wall = performance.now();
      player.pressed[lane] = wall;
      const t = RT.audio.songTime(stamp && stamp > 0 ? stamp : wall);
      const kind = player.press(lane, t, wall);
      if (kind) RT.audio.hit(kind);
    }

    onPointerDown(e) {
      if (this.state !== 'playing') return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      this.fields.forEach((f, p) => {
        if (x >= f.x && x < f.x + f.w) {
          const lane = Math.min(3, Math.floor((x - f.x) / f.laneW));
          this.pointers.set(e.pointerId, [p, lane]);
          this.press(p, lane, e.timeStamp);
        }
      });
      e.preventDefault();
    }

    onPointerUp(e) {
      const hit = this.pointers.get(e.pointerId);
      if (hit && this.players) this.players[hit[0]].pressed[hit[1]] = 0;
      this.pointers.delete(e.pointerId);
    }

    onVisibility() {
      // 다른 탭·창으로 가면 자동으로 멈춘다.
      if ((document.hidden || !document.hasFocus()) && this.state === 'playing') this.pause();
    }

    /* ----- 일시정지·결과 ----- */

    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      RT.audio.pause();
      for (const pl of this.players) pl.pressed = [0, 0, 0, 0];
      this.renderPauseMenu();
      this.pauseEl.hidden = false;
      const first = this.pauseEl.querySelector('button');
      if (first) first.focus();
    }

    resume() {
      if (this.state !== 'paused') return;
      this.pauseEl.hidden = true;
      this.state = 'playing';
      RT.audio.resume();
      this.canvas.focus({ preventScroll: true });
    }

    restart() {
      const opts = { players: this.playerCount, difficulty: this.difficulty, onHome: this.onHome };
      this.destroy();
      RT.currentGame = new Game(opts);
      RT.currentGame.start();
    }

    home() {
      this.destroy();
      this.el.hidden = true;
      document.body.classList.remove('playing');
      if (this.onHome) this.onHome();
    }

    renderPauseMenu() {
      const s = RT.settings;
      this.pauseEl.innerHTML = `
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pause-title">
          <span class="eyebrow">PAUSED</span>
          <h2 id="pause-title">잠시 쉬어 가기</h2>
          <div class="menu-buttons">
            <button class="start" data-act="resume" type="button">계속하기 <span>▶</span></button>
            <button class="ghost" data-act="restart" type="button">처음부터 다시</button>
            <button class="ghost" data-act="home" type="button">시작 화면으로</button>
          </div>
          <div class="settings">
            <div class="setting-row">
              <span>판정 보정 <small>'느림'이 자주 나오면 −, '빠름'이 자주 나오면 +</small></span>
              <span class="stepper">
                <button type="button" data-act="off-" aria-label="판정 보정 줄이기">−</button>
                <output id="offset-value">${s.offset > 0 ? '+' : ''}${s.offset}ms</output>
                <button type="button" data-act="off+" aria-label="판정 보정 늘리기">+</button>
              </span>
            </div>
            <label class="setting-row"><span>타격음</span><input type="checkbox" data-act="hitsound" ${s.hitSound ? 'checked' : ''}></label>
          </div>
          <p class="hint">Esc 키로 계속하기</p>
        </div>`;
      this.pauseEl.querySelectorAll('[data-act]').forEach((el) => {
        const act = el.dataset.act;
        const handler = () => {
          if (act === 'resume') this.resume();
          else if (act === 'restart') this.restart();
          else if (act === 'home') this.home();
          else if (act === 'off-' || act === 'off+') {
            s.offset = Math.max(-200, Math.min(200, s.offset + (act === 'off+' ? 10 : -10)));
            this.pauseEl.querySelector('#offset-value').textContent = `${s.offset > 0 ? '+' : ''}${s.offset}ms`;
            saveSettings();
          } else if (act === 'hitsound') {
            s.hitSound = el.checked;
            saveSettings();
          }
        };
        el.addEventListener(el.type === 'checkbox' ? 'change' : 'click', handler);
      });
    }

    finish() {
      this.state = 'finished';
      RT.audio.stop();
      const cards = this.players.map((pl) => {
        const acc = pl.accuracy;
        const rank = rankOf(acc);
        const full = pl.counts.miss === 0 && pl.total > 0;
        const label = this.playerCount === 2 ? `${pl.index + 1}P` : 'PLAYER';
        return `
          <article class="result-card" style="--accent:${PLAYER_COLORS[pl.index]}">
            <div class="result-head"><span class="tag">${label}</span>${full ? '<span class="badge">완창! 풀콤보</span>' : ''}</div>
            <div class="rank"><b>${rank.letter}</b><span>${rank.name}</span></div>
            <div class="score">${pl.score.toLocaleString('ko-KR')}</div>
            <dl>
              <div><dt>정확도</dt><dd>${(acc * 100).toFixed(1)}%</dd></div>
              <div><dt>최대 연속</dt><dd>${pl.maxCombo}</dd></div>
              <div><dt style="color:${JUDGE.perfect.color}">얼쑤</dt><dd>${pl.counts.perfect}</dd></div>
              <div><dt style="color:${JUDGE.great.color}">좋다</dt><dd>${pl.counts.great}</dd></div>
              <div><dt style="color:${JUDGE.good.color}">잘한다</dt><dd>${pl.counts.good}</dd></div>
              <div><dt>어이쿠</dt><dd>${pl.counts.miss}</dd></div>
            </dl>
          </article>`;
      });
      let headline = '한 판 잘 놀았다!';
      if (this.playerCount === 2) {
        const [a, b] = this.players;
        headline = a.score === b.score ? '무승부! 둘 다 명콤비' : `${a.score > b.score ? 1 : 2}P 승리!`;
      }
      this.resultEl.innerHTML = `
        <div class="sheet wide" role="dialog" aria-modal="true" aria-labelledby="result-title">
          <span class="eyebrow">RESULT · ${this.song.title} · 난이도 ${this.difficulty}</span>
          <h2 id="result-title">${headline}</h2>
          <div class="result-cards">${cards.join('')}</div>
          <div class="menu-buttons row">
            <button class="start" data-act="restart" type="button">다시 하기 <span>↻</span></button>
            <button class="ghost" data-act="home" type="button">시작 화면으로</button>
          </div>
          <p class="hint">R 키로 다시 하기</p>
        </div>`;
      this.resultEl.querySelector('[data-act="restart"]').addEventListener('click', () => this.restart());
      this.resultEl.querySelector('[data-act="home"]').addEventListener('click', () => this.home());
      this.resultEl.hidden = false;
      this.resultEl.querySelector('button').focus();
    }

    /* ----- 화면 배치 ----- */

    onResize() {
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      const W = this.el.clientWidth || root.innerWidth;
      const H = this.el.clientHeight || root.innerHeight;
      this.W = W;
      this.H = H;
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this.canvas.style.width = W + 'px';
      this.canvas.style.height = H + 'px';
      this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

      const n = this.playerCount;
      const gap = n === 2 ? Math.min(64, W * 0.05) : 0;
      const fw = n === 1 ? Math.min(440, W - 32) : Math.min(400, (W - 32 - gap) / 2);
      const total = fw * n + gap * (n - 1);
      const x0 = (W - total) / 2;
      this.top = 70;
      this.hitY = H - Math.max(110, H * 0.17);
      this.fields = [];
      for (let i = 0; i < n; i++) {
        const x = x0 + i * (fw + gap);
        this.fields.push({ x, w: fw, laneW: fw / 4 });
      }
      this.bg = this.paintBackground(W, H, dpr);
    }

    // 밤하늘·달·한옥 지붕·홍등 배경 (창 크기가 바뀔 때만 다시 그린다)
    paintBackground(W, H, dpr) {
      const c = document.createElement('canvas');
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sky = g.createRadialGradient(W * 0.7, -H * 0.1, 0, W * 0.7, -H * 0.1, Math.max(W, H) * 1.1);
      sky.addColorStop(0, '#3a1f6e');
      sky.addColorStop(0.4, '#170f3a');
      sky.addColorStop(1, '#0a0820');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      // 별 (늘 같은 자리에 찍히도록 고정된 난수)
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 90; i++) {
        g.globalAlpha = 0.25 + rnd() * 0.6;
        g.fillStyle = '#fff6e0';
        g.fillRect(rnd() * W, rnd() * H * 0.6, rnd() < 0.15 ? 2 : 1.2, rnd() < 0.15 ? 2 : 1.2);
      }
      g.globalAlpha = 1;
      // 달
      const mx = W * 0.86;
      const my = H * 0.2;
      const mr = Math.min(W, H) * 0.08;
      const glow = g.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 4);
      glow.addColorStop(0, '#ffe7a044');
      glow.addColorStop(1, '#ffe7a000');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
      const moon = g.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
      moon.addColorStop(0, '#fffbe9');
      moon.addColorStop(0.5, '#ffeab0');
      moon.addColorStop(1, '#f4c96b');
      g.fillStyle = moon;
      g.beginPath();
      g.arc(mx, my, mr, 0, Math.PI * 2);
      g.fill();
      // 한옥 지붕 두 겹 (먼 집은 보라색, 가까운 집은 먹색 + 창호 불빛)
      const roof = new Path2D('M0 96C40 100 70 92 96 70L150 34H250L304 70C330 92 360 100 400 96C370 112 340 112 318 108H82C60 112 30 112 0 96ZM132 36Q200 18 268 36L272 44Q200 28 128 44ZM70 106H330V200H70Z');
      const house = (x, y, w, color, lit) => {
        const k = w / 400;
        g.save();
        g.translate(x, y);
        g.scale(k, k);
        g.fillStyle = color;
        g.fill(roof);
        g.fillRect(0, 199, 400, 400);
        if (lit) {
          g.shadowColor = '#ffb65c';
          g.shadowBlur = 14;
          g.fillStyle = '#ffb65c';
          for (const wx of [96, 171, 246]) g.fillRect(wx, 128, 58, 50);
          g.shadowBlur = 0;
          g.fillStyle = '#5b2a10';
          for (const wx of [96, 171, 246]) {
            for (let i = 1; i < 6; i++) g.fillRect(wx + i * 9.7, 128, 1.6, 50);
            for (let j = 1; j < 5; j++) g.fillRect(wx, 128 + j * 10, 58, 1.6);
          }
        }
        g.restore();
      };
      const base = H * 0.76;
      const unit = Math.max(260, W / 4.2);
      for (let i = -1, x = -unit * 0.3; x < W; i++, x += unit * 0.82) house(x, base - unit * 0.32 - (i % 2 ? 18 : 0), unit, '#241a63', false);
      for (let i = 0, x = -unit * 0.5; x < W; i++, x += unit * 1.15) house(x, base - unit * 0.18 + (i % 2 ? 26 : 0), unit * 1.1, '#07051a', true);
      // 아래쪽 안개
      const haze = g.createLinearGradient(0, H * 0.6, 0, H);
      haze.addColorStop(0, '#06051a00');
      haze.addColorStop(1, '#06051acc');
      g.fillStyle = haze;
      g.fillRect(0, H * 0.6, W, H * 0.4);
      // 홍등 줄 (판 바깥 양옆)
      g.strokeStyle = '#3a2c66';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-10, 60);
      g.quadraticCurveTo(W * 0.5, 150, W + 10, 56);
      g.stroke();
      const lantern = (x, y, r) => {
        g.fillStyle = '#4a3a70';
        g.fillRect(x - 0.75, y - r * 2.2, 1.5, r * 1.4);
        g.save();
        g.shadowColor = '#ff4a3d';
        g.shadowBlur = r * 1.6;
        const lg = g.createRadialGradient(x, y - r * 0.15, r * 0.1, x, y, r * 1.1);
        lg.addColorStop(0, '#ffe2a0');
        lg.addColorStop(0.35, '#ff8a4a');
        lg.addColorStop(0.65, '#ff4a3d');
        lg.addColorStop(1, '#9d1426');
        g.fillStyle = lg;
        g.beginPath();
        g.ellipse(x, y, r, r * 1.25, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
        g.fillStyle = '#2b1430';
        g.fillRect(x - r * 0.55, y - r * 1.3, r * 1.1, r * 0.22);
        g.fillRect(x - r * 0.55, y + r * 1.1, r * 1.1, r * 0.22);
      };
      const used = this.fields || [];
      for (const fx of [0.05, 0.14, 0.23, 0.77, 0.95]) {
        const x = W * fx;
        if (used.some((f) => x > f.x - 30 && x < f.x + f.w + 30)) continue; // 판 뒤에 숨는 홍등은 그리지 않는다
        const t = fx;
        const y = 60 + (150 - 60) * 4 * t * (1 - t) * 0.95 + 34;
        lantern(x, y, Math.max(14, Math.min(22, W * 0.014)));
      }
      return c;
    }

    /* ----- 매 프레임 ----- */

    frame(wall) {
      this.raf = requestAnimationFrame(this.frame);
      const now = RT.audio.songTime(performance.now());
      if (this.state === 'playing') {
        if (this.auto) this.autoPlay(now);
        for (const pl of this.players) pl.update(now, wall);
        if (now >= this.endTime) this.finish();
      }
      this.draw(now, wall);
    }

    autoPlay(now) {
      for (let p = 0; p < this.players.length; p++) {
        const pl = this.players[p];
        for (let lane = 0; lane < 4; lane++) {
          pl.advance(lane);
          const n = pl.lanes[lane][pl.head[lane]];
          if (n && now >= n.time) {
            const wall = performance.now();
            pl.press(lane, n.time + (p === 1 ? 0.04 : 0), wall);
            pl.pressed[lane] = wall;
            setTimeout(() => { pl.pressed[lane] = 0; }, 70);
            RT.audio.hit('perfect');
          }
        }
      }
    }

    draw(now, wall) {
      const g = this.ctx2d;
      const W = this.W;
      const H = this.H;
      g.clearRect(0, 0, W, H);
      g.drawImage(this.bg, 0, 0, W, H);
      this.drawTopBar(g, now);
      this.players.forEach((pl, i) => this.drawField(g, pl, this.fields[i], now, wall));
      this.drawCountdown(g, now);
    }

    drawTopBar(g, now) {
      const W = this.W;
      const sec = this.song.sectionAt(Math.max(0, now));
      g.fillStyle = '#0a0820d9';
      g.fillRect(0, 0, W, 52);
      g.fillStyle = '#fff4e6';
      g.font = `400 19px ${TITLE_FONT}`;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillText(`♬ ${this.song.title}`, 18, 26);
      const tw = g.measureText(`♬ ${this.song.title}`).width;
      g.font = `500 11px ${FONT}`;
      g.fillStyle = '#b3acd6';
      if (W > 520) g.fillText(`${this.song.subtitle} · ${sec.label}`, 30 + tw, 27);
      // 난이도 배지
      g.textAlign = 'right';
      g.font = `800 12px ${FONT}`;
      g.fillStyle = '#ffc94a';
      g.fillText(`난이도 ${this.difficulty}`, W - 70, 26);
      // 진행 막대
      const p = Math.max(0, Math.min(1, now / this.endTime));
      g.fillStyle = '#ffffff14';
      g.fillRect(0, 50, W, 2);
      const bar = g.createLinearGradient(0, 0, W, 0);
      bar.addColorStop(0, '#ff4f9a');
      bar.addColorStop(1, '#ffc94a');
      g.fillStyle = bar;
      g.fillRect(0, 50, W * p, 2);
    }

    drawField(g, pl, f, now, wall) {
      const { x, w, laneW } = f;
      const top = this.top;
      const hitY = this.hitY;
      const H = this.H;
      const scroll = this.cfg.scroll;
      const noteTop = top + 52; // 점수판 아래에서 노트가 나온다
      const span = hitY - noteTop;

      // 판 바탕
      g.fillStyle = '#0b0926d6';
      roundRect(g, x, top, w, H - top - 12, 14);
      g.fill();
      g.save();
      g.strokeStyle = hexA(PLAYER_COLORS[pl.index], 0.45);
      g.shadowColor = PLAYER_COLORS[pl.index];
      g.shadowBlur = 16;
      g.lineWidth = 1.2;
      g.stroke();
      g.restore();

      // 레인 구분선과 누를 때 빛
      for (let lane = 0; lane < 4; lane++) {
        const lx = x + lane * laneW;
        if (lane > 0) {
          g.fillStyle = '#ffffff0d';
          g.fillRect(lx, top + 8, 1, H - top - 28);
        }
        const pressed = pl.pressed[lane];
        const flashAge = (wall - pl.flash[lane]) / 1000;
        const glowAlpha = Math.max(pressed ? 0.35 : 0, flashAge < 0.18 ? 0.6 * (1 - flashAge / 0.18) : 0);
        if (glowAlpha > 0) {
          const grad = g.createLinearGradient(0, hitY, 0, hitY - span * 0.55);
          grad.addColorStop(0, hexA(LANE_COLORS[lane], glowAlpha));
          grad.addColorStop(1, hexA(LANE_COLORS[lane], 0));
          g.fillStyle = grad;
          g.fillRect(lx + 2, hitY - span * 0.55, laneW - 4, span * 0.55);
        }
      }

      // 판정선: 단청 무늬 띠
      const band = ['#2fbf8f', '#ff3b5c', '#ffc94a', '#4d8bff', '#fff1d6'];
      const seg = 10;
      for (let i = 0, sx = x + 6; sx < x + w - 6; i++, sx += seg) {
        g.fillStyle = band[i % band.length];
        g.fillRect(sx, hitY - 3, Math.min(seg - 2, x + w - 6 - sx), 6);
      }

      // 받침 원
      for (let lane = 0; lane < 4; lane++) {
        const cx = x + lane * laneW + laneW / 2;
        const r = Math.min(laneW * 0.34, 30);
        g.beginPath();
        g.arc(cx, hitY, r, 0, Math.PI * 2);
        g.fillStyle = pl.pressed[lane] ? hexA(LANE_COLORS[lane], 0.45) : '#0b0926e0';
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = hexA(LANE_COLORS[lane], pl.pressed[lane] ? 1 : 0.55);
        g.stroke();
        // 키 표시
        const label = KEY_LABELS[this.playerCount][pl.index][lane];
        g.fillStyle = pl.pressed[lane] ? '#ffffff' : '#d8dccf';
        g.font = `800 ${Math.round(Math.min(18, laneW * 0.22))}px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(label, cx, hitY + 1);
        g.font = `500 10px ${FONT}`;
        g.fillStyle = hexA(LANE_COLORS[lane], 0.7);
        g.fillText(LANE_NAMES[lane], cx, hitY + r + 16);
      }

      // 노트
      g.save();
      g.beginPath();
      g.rect(x, noteTop, w, H - noteTop);
      g.clip();
      const noteW = laneW * 0.78;
      const noteH = Math.max(14, Math.min(20, laneW * 0.2));
      for (let lane = 0; lane < 4; lane++) {
        const arr = pl.lanes[lane];
        while (pl.drawFrom[lane] < arr.length && arr[pl.drawFrom[lane]].time < now - 0.5) pl.drawFrom[lane]++;
        for (let i = pl.drawFrom[lane]; i < arr.length; i++) {
          const n = arr[i];
          const dt = n.time - now;
          if (dt > scroll) break;
          if (n.judged && n.judged !== 'miss') continue;
          const y = hitY - (dt / scroll) * span;
          if (y < noteTop - noteH) continue;
          const nx = x + lane * laneW + (laneW - noteW) / 2;
          g.globalAlpha = n.judged === 'miss' ? Math.max(0, 0.35 + dt) : 1;
          drawNote(g, nx, y - noteH / 2, noteW, noteH, LANE_COLORS[lane]);
          g.globalAlpha = 1;
        }
      }
      g.restore();

      // 타격 효과 (퍼지는 고리)
      pl.bursts = pl.bursts.filter((b) => wall - b.at < 320);
      for (const b of pl.bursts) {
        const age = (wall - b.at) / 320;
        const cx = x + b.lane * laneW + laneW / 2;
        const r = Math.min(laneW * 0.34, 30) * (1 + (this.reducedMotion ? 0.2 : 0.9) * age);
        g.beginPath();
        g.arc(cx, hitY, r, 0, Math.PI * 2);
        g.strokeStyle = hexA(b.kind === 'perfect' ? '#ffe066' : LANE_COLORS[b.lane], 1 - age);
        g.lineWidth = 3 * (1 - age) + 1;
        g.stroke();
      }

      // 점수판
      const pc = PLAYER_COLORS[pl.index];
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.font = `800 12px ${FONT}`;
      g.fillStyle = pc;
      g.fillText(this.playerCount === 2 ? `${pl.index + 1}P` : 'PLAYER', x + 14, top + 22);
      g.textAlign = 'right';
      g.font = `800 20px ${FONT}`;
      g.fillStyle = '#f4f5eb';
      g.fillText(String(pl.score).padStart(7, '0'), x + w - 14, top + 22);
      // 정확도 막대
      g.fillStyle = '#ffffff12';
      g.fillRect(x + 14, top + 38, w - 28, 3);
      g.fillStyle = pc;
      g.fillRect(x + 14, top + 38, (w - 28) * (pl.judgedCount / Math.max(1, pl.total)) * pl.accuracy, 3);

      // 연속(콤보)
      const midY = noteTop + span * 0.38;
      if (pl.combo >= 3) {
        g.textAlign = 'center';
        g.font = `400 ${Math.round(Math.min(68, w * 0.16))}px ${TITLE_FONT}`;
        g.fillStyle = '#fff4e633';
        g.fillText(pl.combo, x + w / 2, midY);
        g.font = `700 12px ${FONT}`;
        g.fillStyle = '#fff4e677';
        g.fillText('연속', x + w / 2, midY + 40);
      }

      // 판정 글자
      const j = pl.judgeShown;
      if (j && wall - j.at < 520) {
        const age = (wall - j.at) / 520;
        const pop = this.reducedMotion ? 1 : 1 + 0.25 * Math.max(0, 1 - age * 5);
        const info = JUDGE[j.kind];
        g.save();
        g.translate(x + w / 2, hitY - span * 0.24);
        g.scale(pop, pop);
        g.globalAlpha = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3;
        g.textAlign = 'center';
        g.font = `400 ${Math.round(Math.min(44, w * 0.11))}px ${TITLE_FONT}`;
        g.lineWidth = 6;
        g.strokeStyle = '#0a0820';
        g.strokeText(info.text, 0, 0);
        g.fillStyle = info.color;
        g.shadowColor = info.color;
        g.shadowBlur = 18;
        g.fillText(info.text, 0, 0);
        g.shadowBlur = 0;
        if (j.timing) {
          g.font = `700 12px ${FONT}`;
          g.fillStyle = j.timing === '빠름' ? '#7fd3ff' : '#ff9d7a';
          g.fillText(j.timing, 0, 28);
        }
        g.restore();
      }

      // 추임새 (연속 기록)
      const m = pl.milestone;
      if (m && wall - m.at < 1100) {
        const age = (wall - m.at) / 1100;
        g.save();
        g.globalAlpha = age < 0.75 ? 1 : 1 - (age - 0.75) / 0.25;
        g.textAlign = 'center';
        g.font = `400 ${Math.round(Math.min(36, w * 0.09))}px ${TITLE_FONT}`;
        g.fillStyle = '#fff';
        g.shadowColor = pc;
        g.shadowBlur = 20;
        g.fillText(m.text, x + w / 2, midY - 56 - (this.reducedMotion ? 0 : age * 18));
        g.restore();
      }
    }

    drawCountdown(g, now) {
      if (now >= 0.4 || this.state !== 'playing' && this.state !== 'paused') return;
      const beat = this.song.beat;
      const words = ['하나', '둘', '셋', '넷'];
      let text = '준비';
      if (now >= -4 * beat) {
        const i = Math.min(3, Math.floor((now + 4 * beat) / beat));
        text = now >= 0 ? '얼쑤!' : words[i];
      }
      g.save();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `400 ${Math.round(Math.min(84, this.W * 0.13))}px ${TITLE_FONT}`;
      g.lineWidth = 8;
      g.strokeStyle = '#0a0820';
      g.strokeText(text, this.W / 2, this.H * 0.36);
      g.fillStyle = '#fff';
      g.shadowColor = '#ff4f9a';
      g.shadowBlur = 28;
      g.fillText(text, this.W / 2, this.H * 0.36);
      g.shadowBlur = 0;
      if (now < -4 * beat + 0.2 || text === '하나') {
        g.font = `600 13px ${FONT}`;
        g.fillStyle = '#e3dcff';
        const keys = KEY_LABELS[this.playerCount].map((k, i) => (this.playerCount === 2 ? `${i + 1}P ` : '') + k.join(' ')).join('   ·   ');
        g.fillText(`${keys}   (Esc 일시정지)`, this.W / 2, this.H * 0.36 + 56);
      }
      g.restore();
    }
  }

  /* ---------- 그리기 도구 ---------- */
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // 네온 노트: 빛 번짐(shadowBlur)은 무거우므로 색·크기별로 한 번만 그려 두고 복사한다.
  const noteSprites = new Map();
  const GLOW = 12;
  function noteSprite(w, h, color) {
    const key = `${color}|${Math.round(w)}|${Math.round(h)}`;
    let c = noteSprites.get(key);
    if (c) return c;
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    c = document.createElement('canvas');
    c.width = Math.ceil((w + GLOW * 2) * dpr);
    c.height = Math.ceil((h + GLOW * 2) * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.shadowColor = color;
    g.shadowBlur = GLOW;
    roundRect(g, GLOW, GLOW, w, h, h / 2);
    g.fillStyle = color;
    g.fill();
    g.shadowBlur = 0;
    const shine = g.createLinearGradient(0, GLOW, 0, GLOW + h);
    shine.addColorStop(0, '#ffffffaa');
    shine.addColorStop(0.45, '#ffffff22');
    shine.addColorStop(1, '#00000033');
    g.fillStyle = shine;
    roundRect(g, GLOW, GLOW, w, h, h / 2);
    g.fill();
    g.fillStyle = '#ffffffcc';
    roundRect(g, GLOW + w * 0.18, GLOW + h * 0.42, w * 0.64, Math.max(2, h * 0.16), h * 0.08);
    g.fill();
    if (noteSprites.size > 64) noteSprites.clear();
    noteSprites.set(key, c);
    return c;
  }

  function drawNote(g, x, y, w, h, color) {
    g.drawImage(noteSprite(w, h, color), x - GLOW, y - GLOW, w + GLOW * 2, h + GLOW * 2);
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  }

  RT.Game = Game;
  RT.JUDGE = JUDGE;
})(typeof window !== 'undefined' ? window : globalThis);
