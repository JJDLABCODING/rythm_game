/*
 * 타격음 시험실: 레인(청·적·황·백)마다 북·장구·드럼 소리를 고르고 직접 쳐 본다.
 * 고른 소리는 RT.settings.hitKit 에 저장되어 게임에 바로 쓰인다.
 */
(function (root) {
  'use strict';
  const RT = (root.RT = root.RT || {});

  const LANES = [
    { name: '청', color: '#2f8bff', keys: ['KeyD', 'ArrowLeft'], label: 'D' },
    { name: '적', color: '#ff3355', keys: ['KeyF', 'ArrowDown'], label: 'F' },
    { name: '황', color: '#ffe14d', keys: ['KeyJ', 'ArrowUp'], label: 'J' },
    { name: '백', color: '#f4f0ff', keys: ['KeyK', 'ArrowRight'], label: 'K' },
  ];
  const KINDS = [
    { id: 'perfect', name: '얼쑤', desc: '딱 맞게', key: '1' },
    { id: 'great', name: '좋다', desc: '조금 어긋남', key: '2' },
    { id: 'good', name: '잘한다', desc: '많이 어긋남', key: '3' },
    { id: 'miss', name: '삑사리', desc: '박자 틀림', key: '4' },
  ];

  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  class SoundLab {
    constructor() {
      this.el = document.getElementById('sound-lab');
      this.kind = 'perfect';
      this.music = false;
      this.onKey = this.onKey.bind(this);
    }

    open() {
      RT.audio.ensure(); // 버튼을 누른 순간에 소리를 켠다
      RT.audio.loadHits(RT.HITS.map((h) => h.id));
      this.render();
      this.el.hidden = false;
      document.body.classList.add('in-lab');
      root.addEventListener('keydown', this.onKey);
      root.scrollTo(0, 0);
      this.el.querySelector('.lab-close').focus();
    }

    close() {
      this.setMusic(false);
      root.removeEventListener('keydown', this.onKey);
      this.el.hidden = true;
      document.body.classList.remove('in-lab');
      const btn = document.getElementById('open-lab');
      if (btn) btn.focus();
    }

    get kit() {
      return RT.settings.hitKit;
    }

    save() {
      RT.settings.hitKit = RT.cleanHitKit(RT.settings.hitKit);
      if (RT.saveSettings) RT.saveSettings();
    }

    options(selected, allowNone) {
      let html = allowNone ? `<option value=""${selected ? '' : ' selected'}>겹칠 소리 없음</option>` : '';
      for (const g of RT.HIT_GROUPS) {
        html += `<optgroup label="${esc(g.name)}">`;
        for (const h of RT.HITS.filter((x) => x.group === g.id)) {
          html += `<option value="${h.id}"${h.id === selected ? ' selected' : ''}>${esc(h.name)} — ${esc(h.note)}</option>`;
        }
        html += '</optgroup>';
      }
      return html;
    }

    currentPreset() {
      const now = JSON.stringify(this.kit);
      const p = RT.HIT_PRESETS.find((x) => JSON.stringify(x.kit) === now);
      return p ? p.id : null;
    }

    render() {
      const preset = this.currentPreset();
      this.el.innerHTML = `
        <div class="lab-inner">
          <header class="lab-head">
            <div>
              <span class="eyebrow">SOUND LAB</span>
              <h2 id="lab-title">타격음 시험실</h2>
              <p>레인마다 북·장구·드럼 소리를 골라 직접 쳐 보세요. 고른 소리는 <b>게임에 바로</b> 쓰입니다.</p>
            </div>
            <button class="ghost lab-close" type="button">시작 화면으로</button>
          </header>

          <div class="lab-bar">
            <div class="lab-kinds" role="radiogroup" aria-label="판정 (정확할수록 크게)">
              ${KINDS.map((k) => `<button type="button" role="radio" class="kind kind-${k.id}" data-kind="${k.id}" aria-checked="${k.id === this.kind}"><b>${k.name}</b><small>${k.desc} · ${k.key}</small></button>`).join('')}
            </div>
            <button type="button" class="ghost lab-music" aria-pressed="${this.music}">${this.music ? '■ 음악 끄기' : '♬ 달빛 장터 같이 틀기'}</button>
          </div>

          <div class="lab-presets" aria-label="추천 묶음">
            ${RT.HIT_PRESETS.map((p) => `<button type="button" class="preset${p.id === preset ? ' on' : ''}" data-preset="${p.id}"><b>${esc(p.name)}</b><small>${esc(p.desc)}</small></button>`).join('')}
          </div>

          <div class="lab-pads">
            ${LANES.map((l, i) => `
              <div class="pad-card" style="--c:${l.color}">
                <button type="button" class="pad" data-lane="${i}" aria-label="${l.name} 레인 치기 (${l.label} 키)"><kbd>${l.label}</kbd><span>${l.name}</span></button>
                <label><span>소리</span><select data-lane="${i}" data-slot="0">${this.options(this.kit[i][0], false)}</select></label>
                <label><span>겹칠 소리</span><select data-lane="${i}" data-slot="1">${this.options(this.kit[i][1] || '', true)}</select></label>
              </div>`).join('')}
          </div>

          <section class="lab-library" aria-label="소리 모음">
            ${RT.HIT_GROUPS.map((g) => `
              <div class="lib-group">
                <h3>${esc(g.name)} <small>${esc(g.desc)}</small></h3>
                <div class="chips">
                  ${RT.HITS.filter((h) => h.group === g.id).map((h) => `<button type="button" class="chip" data-hit="${h.id}">${esc(h.name)}<small>${esc(h.note)}</small></button>`).join('')}
                </div>
              </div>`).join('')}
          </section>
          <p class="lab-credit">키보드: D F J K(또는 방향키)로 치기, 1~4로 판정 바꾸기. 녹음 소리 출처: VCSL·Stargate 샘플 팩(CC0 공개 저작물). 장구는 공개 녹음이 없어 손북과 림샷을 섞어 만든 소리입니다.</p>
        </div>`;

      this.el.querySelector('.lab-close').addEventListener('click', () => this.close());
      this.el.querySelector('.lab-music').addEventListener('click', () => this.setMusic(!this.music));
      this.el.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => this.setKind(b.dataset.kind)));
      this.el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
        const p = RT.HIT_PRESETS.find((x) => x.id === b.dataset.preset);
        RT.settings.hitKit = p.kit.map((l) => l.slice());
        this.save();
        this.render();
      }));
      this.el.querySelectorAll('.pad').forEach((b) => b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.strike(Number(b.dataset.lane));
      }));
      this.el.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => {
        const lane = Number(s.dataset.lane);
        const slot = Number(s.dataset.slot);
        const ids = this.kit[lane].slice();
        if (slot === 0) ids[0] = s.value;
        else if (s.value) ids[1] = s.value;
        else ids.length = 1;
        RT.settings.hitKit[lane] = ids;
        this.save();
        this.el.querySelectorAll('.preset').forEach((b) => b.classList.toggle('on', b.dataset.preset === this.currentPreset()));
        this.strike(lane);
      }));
      this.el.querySelectorAll('[data-hit]').forEach((b) => b.addEventListener('click', () => {
        RT.audio.ensure();
        RT.audio.playHit(b.dataset.hit, 1);
        this.pop(b, 'perfect');
      }));
    }

    setKind(kind) {
      this.kind = kind;
      this.el.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === kind)));
    }

    setMusic(on) {
      this.music = on;
      const audio = RT.audio;
      if (on) {
        audio.ensure();
        audio.start(RT.song.buildEvents(), 0.15);
      } else if (audio.run) {
        audio.stop();
      }
      const b = this.el.querySelector('.lab-music');
      if (b) {
        b.setAttribute('aria-pressed', String(on));
        b.textContent = on ? '■ 음악 끄기' : '♬ 달빛 장터 같이 틀기';
      }
    }

    strike(lane) {
      const audio = RT.audio;
      audio.ensure();
      if (this.kind === 'miss') audio.miss(lane);
      else audio.hit(this.kind, lane);
      const pad = this.el.querySelector(`.pad[data-lane="${lane}"]`);
      if (pad) this.pop(pad, this.kind);
    }

    // 눌린 효과: 클래스를 뺐다가 다시 넣어 애니메이션을 처음부터 돌린다
    pop(el, kind) {
      el.classList.remove('hit-perfect', 'hit-great', 'hit-good', 'hit-miss');
      void el.offsetWidth;
      el.classList.add(`hit-${kind}`);
    }

    onKey(e) {
      if (e.target && e.target.tagName === 'SELECT') return;
      if (e.code === 'Escape') {
        e.preventDefault();
        this.close();
        return;
      }
      const k = KINDS.find((x) => e.key === x.key);
      if (k) {
        this.setKind(k.id);
        return;
      }
      const lane = LANES.findIndex((l) => l.keys.includes(e.code));
      if (lane < 0) return;
      e.preventDefault();
      if (!e.repeat) this.strike(lane);
    }
  }

  RT.SoundLab = SoundLab;
})(typeof window !== 'undefined' ? window : globalThis);
