const descriptions = {
  하: '첫 박자부터 천천히. 리듬과 친해지는 시간.',
  중: '조금 더 빠르게. 비트에 몸을 맡겨 봐.',
  상: '쉴 틈 없이 쏟아지는 비트. 한계에 도전해 봐.',
};
const SONG_KEY = 'rhythmtown.song';

function fmtTime(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 곡 카드: RT.songs 에서 만든다 (곡을 추가하면 자동으로 늘어난다)
function renderSongs() {
  let saved = null;
  try { saved = localStorage.getItem(SONG_KEY); } catch (_) { /* 저장소 없음 */ }
  const current = RT.getSong(saved).id;
  document.getElementById('song-options').innerHTML = RT.songs
    .map((song) => {
      const tag = song.kind === 'audio' ? '원곡' : '합성곡';
      return `<label class="choice"><input type="radio" name="song" value="${escapeHtml(song.id)}"${song.id === current ? ' checked' : ''}>
        <span class="choice-body"><span class="song-tag">${tag}</span><strong>${escapeHtml(song.title)}</strong>
        <small>${Math.round(song.bpm)} BPM · ${fmtTime(song.length)}</small><span class="check" aria-hidden="true">✓</span></span></label>`;
    })
    .join('');
}

function getSelection() {
  return {
    songId: document.querySelector('input[name="song"]:checked').value,
    players: Number(document.querySelector('input[name="players"]:checked').value),
    difficulty: document.querySelector('input[name="difficulty"]:checked').value,
  };
}

function keyGuideHtml(players) {
  const keys = (list) => list.map((k) => `<kbd>${k}</kbd>`).join('');
  if (players === 2) {
    return `<span><b>1P</b>${keys(RT.keyLabels[2][0])}</span><span><b>2P</b>${keys(RT.keyLabels[2][1])}<small>또는 방향키</small></span>`;
  }
  return `<span><b>조작</b>${keys(RT.keyLabels[1][0])}<small>또는 방향키 · 화면 터치</small></span>`;
}

function updateSelection() {
  const { songId, players, difficulty } = getSelection();
  const song = RT.getSong(songId);
  // 큰 네온 제목과 곡 정보를 고른 곡으로 바꾼다
  const words = song.title.split(' ');
  const title = document.getElementById('title');
  title.querySelector('.w1').textContent = words[0];
  title.querySelector('.w2').textContent = words.slice(1).join(' ') || '';
  title.classList.toggle('long', words.slice(1).join(' ').length > 3 || words[0].length > 3);
  document.getElementById('title-en').textContent = song.kind === 'audio' ? 'JOSEON HIP-HOP' : 'MOONLIGHT MARKET';
  document.getElementById('title-kind').textContent = song.kind === 'audio' ? '· 원곡' : '· 조선팝';
  document.getElementById('info-bpm').textContent = `${Math.round(song.bpm)} BPM`;
  document.getElementById('info-len').textContent = fmtTime(song.length);
  document.getElementById('info-kind').textContent = song.kind === 'audio' ? '원곡' : '합성곡';
  document.title = `리듬타운 · ${song.title}`;

  document.getElementById('summary').textContent = `${song.title} · ${players}인 · 난이도 ${difficulty}`;
  const count = song.noteCounts ? song.noteCounts[difficulty] : null;
  document.getElementById('level-description').textContent = descriptions[difficulty] + (count ? ` (노트 ${count}개)` : '');
  document.getElementById('key-guide').innerHTML = keyGuideHtml(players);
  if (song.audio) RT.audio.prefetch(song.audio).catch(() => {});
  try { localStorage.setItem(SONG_KEY, song.id); } catch (_) { /* 저장소 없음 */ }
}

function showError(message) {
  let el = document.querySelector('.load-error');
  if (!el) {
    el = document.createElement('p');
    el.className = 'load-error';
    el.setAttribute('role', 'alert');
    document.getElementById('start').after(el);
  }
  el.textContent = message;
}

let starting = false;
async function startGame() {
  if (starting) return;
  const { songId, players, difficulty } = getSelection();
  const song = RT.getSong(songId);
  const button = document.getElementById('start');
  const label = button.querySelector('.start-text');
  starting = true;
  const old = document.querySelector('.load-error');
  if (old) old.remove();
  try {
    RT.audio.ensure(); // 버튼을 누른 순간에 소리를 켠다 (휴대폰 정책)
    let buffer = null;
    if (song.audio) {
      button.classList.add('loading');
      label.textContent = '음원 불러오는 중…';
      buffer = await RT.audio.loadBuffer(song.audio);
    }
    if (RT.currentGame) RT.currentGame.destroy();
    RT.currentGame = new RT.Game({
      players,
      difficulty,
      song,
      buffer,
      onHome: () => {
        RT.currentGame = null;
        document.getElementById('start').focus();
      },
    });
    RT.currentGame.start();
  } catch (err) {
    console.error(err);
    const local = location.protocol === 'file:';
    showError(local
      ? '파일로 직접 열면 원곡 음원을 불러올 수 없습니다. 웹 서버로 열거나 합성곡 「달빛 장터」를 골라 주세요.'
      : `음원을 불러오지 못했습니다: ${err.message}`);
  } finally {
    starting = false;
    button.classList.remove('loading');
    label.textContent = '무대 열기';
  }
}

renderSongs();
document.getElementById('song-options').addEventListener('change', updateSelection);
document.querySelectorAll('input[name="players"], input[name="difficulty"]').forEach((input) => {
  input.addEventListener('change', updateSelection);
});
document.getElementById('start').addEventListener('click', startGame);
document.getElementById('pause-button').addEventListener('click', () => {
  if (RT.currentGame) RT.currentGame.pause();
});

// 브라우저가 이전 라디오 선택을 복원한 경우에도 표시를 맞춘다.
window.addEventListener('pageshow', updateSelection);
updateSelection();
