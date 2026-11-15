const descriptions = {
  하: '첫 박자부터 천천히. 리듬과 친해지는 시간.',
  중: '조금 더 빠르게. 비트에 몸을 맡겨 봐.',
  상: '쉴 틈 없이 쏟아지는 비트. 한계에 도전해 봐.',
};

function getSelection() {
  return {
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
  const { players, difficulty } = getSelection();
  document.getElementById('summary').textContent = `${players}인 플레이 · 난이도 ${difficulty}`;
  document.getElementById('level-description').textContent = descriptions[difficulty];
  document.getElementById('key-guide').innerHTML = keyGuideHtml(players);
}

document.querySelectorAll('input[type="radio"]').forEach((input) => {
  input.addEventListener('change', updateSelection);
});

function startGame() {
  const { players, difficulty } = getSelection();
  if (RT.currentGame) RT.currentGame.destroy();
  try {
    RT.currentGame = new RT.Game({
      players,
      difficulty,
      onHome: () => {
        RT.currentGame = null;
        document.getElementById('start').focus();
      },
    });
    RT.currentGame.start();
  } catch (err) {
    console.error(err);
    alert('게임을 시작하지 못했습니다: ' + err.message);
  }
}

document.getElementById('start').addEventListener('click', startGame);
document.getElementById('pause-button').addEventListener('click', () => {
  if (RT.currentGame) RT.currentGame.pause();
});

// 브라우저가 이전 라디오 선택을 복원한 경우에도 표시를 맞춘다.
window.addEventListener('pageshow', updateSelection);
updateSelection();
