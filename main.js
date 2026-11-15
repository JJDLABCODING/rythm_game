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

function updateSelection() {
  const { players, difficulty } = getSelection();
  document.getElementById('summary').textContent = `${players}인 플레이 · 난이도 ${difficulty}`;
  document.getElementById('level-description').textContent = descriptions[difficulty];
}

document.querySelectorAll('input[type="radio"]').forEach((input) => {
  input.addEventListener('change', updateSelection);
});

document.getElementById('start').addEventListener('click', () => {
  const { players, difficulty } = getSelection();
  document.getElementById('ready-summary').textContent = `${players}인 플레이 · 난이도 ${difficulty}`;
  document.getElementById('ready').showModal();
});

// 브라우저가 이전 라디오 선택을 복원한 경우에도 표시를 맞춘다.
window.addEventListener('pageshow', updateSelection);
updateSelection();
