/*
 * 타격음 목록 (북·장구·드럼). 녹음 파일은 audio/hits/<id>.wav (tools/make_hits.py 로 만든다).
 * 출처: VCSL, Stargate 샘플 팩 — 둘 다 CC0(공개 저작물)이라 출처 표시 없이 쓸 수 있다.
 * 장구는 공개 녹음이 없어 프레임 북·림샷을 섞어 만들었다.
 * 녹음 파일을 못 읽으면(file:// 로 열었을 때 등) synth 에 적힌 합성 소리로 대신 낸다.
 */
(function (root) {
  'use strict';
  const RT = (root.RT = root.RT || {});

  RT.HIT_GROUPS = [
    { id: 'buk', name: '북', desc: '가죽을 크게 울리는 소리' },
    { id: 'janggu', name: '장구', desc: '궁편 쿵 · 채편 덕 · 둘 다 덩' },
    { id: 'drum', name: '드럼', desc: '힙합 비트용 킥·스네어·클랩·하이햇' },
  ];

  // synth: 합성 소리 이름(audio.js synthHit) — 녹음 파일 대신 쓰거나 처음부터 합성 소리인 것
  // gain: 음악 속에서 잘 들리도록 소리마다 더하는 크기 배율(없으면 1)
  RT.HITS = [
    { id: 'buk_big', group: 'buk', name: '큰북', note: '묵직하고 깊게 둥', synth: 'buk' },
    { id: 'buk_old', group: 'buk', name: '옛날 북', note: '나무통 북, 거칠게', synth: 'buk' },
    { id: 'buk_low', group: 'buk', name: '낮은 북', note: '길게 울리는 둥', synth: 'buk' },
    { id: 'buk_tom', group: 'buk', name: '중간 북', note: '탄탄한 통', synth: 'buk' },
    { id: 'buk_mallet', group: 'buk', name: '방망이 북', note: '부드러운 채로 둥', synth: 'buk' },
    { id: 'buk_frame', group: 'buk', name: '손북', note: '얇은 테 북', synth: 'buk' },
    { id: 'janggu_kung', gain: 1.2, group: 'janggu', name: '장구 쿵', note: '궁편(왼쪽)', synth: 'kung' },
    { id: 'janggu_deok', gain: 1.8, group: 'janggu', name: '장구 덕', note: '채편(오른쪽)', synth: 'deok' },
    { id: 'janggu_deong', gain: 1.25, group: 'janggu', name: '장구 덩', note: '양쪽 함께', synth: 'deong' },
    { id: 'synth_deok', group: 'janggu', name: '합성 덕', note: '전자음으로 만든 덕', synth: 'deok', synthOnly: true },
    { id: 'synth_deong', group: 'janggu', name: '합성 덩', note: '전자음으로 만든 덩', synth: 'deong', synthOnly: true },
    { id: 'kick_sdb', group: 'drum', name: '킥 1', note: '단단한 힙합 킥', synth: 'kick' },
    { id: 'kick_808', group: 'drum', name: '킥 2 (808)', note: '길게 깔리는 저음', synth: 'kick' },
    { id: 'kick_punch', group: 'drum', name: '킥 3', note: '짧고 펀치감', synth: 'kick' },
    { id: 'kick_live', group: 'drum', name: '킥 4 (실제 드럼)', note: '드럼 세트 킥', synth: 'kick' },
    { id: 'snare_sdb', group: 'drum', name: '스네어 1', note: '두툼한 힙합 스네어', synth: 'clap' },
    { id: 'snare_bright', group: 'drum', name: '스네어 2', note: '밝고 길게', synth: 'clap' },
    { id: 'snare_tape', group: 'drum', name: '스네어 3', note: '짧은 테이프 질감', synth: 'clap' },
    { id: 'snare_crisp', group: 'drum', name: '스네어 4', note: '쨍한 고음', synth: 'clap' },
    { id: 'clap_hiphop', group: 'drum', name: '클랩 1', note: '짧은 힙합 손뼉', synth: 'clap' },
    { id: 'clap_synth', group: 'drum', name: '클랩 2', note: '넓게 퍼지는 손뼉', synth: 'clap' },
    { id: 'clap_dist', group: 'drum', name: '클랩 3', note: '거친 손뼉', synth: 'clap' },
    { id: 'hat_tight', group: 'drum', name: '하이햇 1', note: '칙', synth: 'hat' },
    { id: 'hat_bright', group: 'drum', name: '하이햇 2', note: '찰랑', synth: 'hat' },
    { id: 'rim_wood', gain: 1.4, group: 'drum', name: '림샷 1', note: '나무 딱', synth: 'deok' },
    { id: 'rim_808', gain: 1.3, group: 'drum', name: '림샷 2', note: '전자 딱', synth: 'deok' },
    { id: 'synth_buk', group: 'drum', name: '합성 큰북', note: '처음 쓰던 합성 북', synth: 'buk', synthOnly: true },
    { id: 'synth_clap', group: 'drum', name: '합성 손뼉', note: '처음 쓰던 합성 손뼉', synth: 'clap', synthOnly: true },
  ];
  RT.HIT_BY_ID = Object.fromEntries(RT.HITS.map((h) => [h.id, h]));

  // 레인(청·적·황·백)마다 [주 소리, 겹칠 소리] — 겹칠 소리는 없어도 된다
  RT.HIT_PRESETS = [
    { id: 'mix', name: '북 + 드럼 섞음', desc: '국악 힙합에 어울리게 (기본)', kit: [['buk_big', 'kick_sdb'], ['janggu_deong'], ['janggu_deok'], ['snare_sdb', 'clap_hiphop']] },
    { id: 'gugak', name: '국악 북·장구', desc: '북과 장구만', kit: [['buk_big'], ['janggu_kung'], ['janggu_deok'], ['janggu_deong']] },
    { id: 'drum', name: '힙합 드럼', desc: '킥·스네어·하이햇·클랩', kit: [['kick_sdb'], ['snare_sdb'], ['hat_tight'], ['clap_hiphop']] },
  ];
  RT.DEFAULT_HIT_KIT = RT.HIT_PRESETS[0].kit;

  // 저장된 값이 이상하면 기본값으로 바꾼다
  RT.cleanHitKit = function (kit) {
    if (!Array.isArray(kit) || kit.length !== 4) return RT.DEFAULT_HIT_KIT.map((l) => l.slice());
    return kit.map((lane, i) => {
      const ids = (Array.isArray(lane) ? lane : []).filter((id) => RT.HIT_BY_ID[id]).slice(0, 2);
      return ids.length ? ids : RT.DEFAULT_HIT_KIT[i].slice();
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
