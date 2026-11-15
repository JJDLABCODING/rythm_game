"""브라우저 실행 검사 (선택): python3 tests/browser_smoke.py [스크린샷 폴더]

Playwright(파이썬)와 Chrome이 있어야 한다. index.html을 file:// 로 열어
1) 1인·하: 실제 키 입력 이벤트를 노트 시각에 보내 판정이 되는지,
2) Esc 일시정지·계속하기,
3) 2인·상 자동 연주(?auto=1)로 곡 끝까지 진행 후 결과 화면,
4) 곡 전체를 오프라인으로 합성해 소리 크기(클리핑·무음)를 확인한다.
"""
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / 'index.html').as_uri()
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None

# 페이지 안에서 노트 시각에 맞춰 키 이벤트를 보내는 스크립트
PRESS_NOTES = """
(count) => new Promise((resolve) => {
  const game = RT.currentGame;
  const pl = game.players[0];
  const codes = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
  const all = pl.lanes.flat().sort((a, b) => a.time - b.time).slice(0, count);
  let i = 0;
  const errors = [];
  function tick() {
    const now = RT.audio.songTime(performance.now());
    while (i < all.length && now >= all[i].time - 0.004) {
      const n = all[i++];
      const code = codes[n.lane];
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      errors.push(Math.round((now - n.time) * 1000));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })), 40);
    }
    if (i < all.length) requestAnimationFrame(tick);
    else setTimeout(() => resolve({ counts: pl.counts, combo: pl.combo, offsetsMs: errors }), 300);
  }
  requestAnimationFrame(tick);
})
"""

RENDER_SONG = """
async () => {
  const sr = 22050;
  const len = RT.song.length + 1;
  const off = new OfflineAudioContext(2, Math.ceil(sr * len), sr);
  const eng = Object.create(Object.getPrototypeOf(RT.audio));
  eng.ksCache = new Map();
  eng.ctx = off;
  eng.build();
  eng.run = off.createGain(); eng.run.connect(eng.master);
  eng.runVerb = off.createGain(); eng.runVerb.connect(eng.reverb);
  for (const e of RT.song.buildEvents()) eng.play(e, e.time + 0.2);
  const buf = await off.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0, nan = 0;
  const win = Math.floor(sr * RT.song.beat * 16); // 4마디
  const rms = [];
  let acc = 0, n = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (!isFinite(v)) { nan++; continue; }
    peak = Math.max(peak, Math.abs(v));
    acc += v * v; n++;
    if (n === win) { rms.push(+Math.sqrt(acc / n).toFixed(3)); acc = 0; n = 0; }
  }
  return { peak: +peak.toFixed(3), nan, rmsPer4Bars: rms };
}
"""


def shot(page, name):
    if OUT:
        OUT.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(OUT / f'{name}.png'))


def main():
    problems = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path='/usr/bin/google-chrome',
            args=['--autoplay-policy=no-user-gesture-required'],
        )
        page = browser.new_page(viewport={'width': 1280, 'height': 760})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        # 1) 1인·하 키 입력 판정
        page.goto(URL)
        shot(page, '01-start')
        page.click('label:has(input[name="players"][value="1"])')
        page.click('label:has(input[value="하"])')
        page.click('#start')
        page.wait_for_timeout(1200)
        shot(page, '02-countdown')
        state = page.evaluate('() => [RT.currentGame.state, RT.audio.ctx.state]')
        print('시작 상태:', state)
        if state != ['playing', 'running']:
            problems.append(f'게임이 시작되지 않음: {state}')
        res = page.evaluate(PRESS_NOTES, 10)
        print('키 입력 10개 판정:', res['counts'], '연속', res['combo'], '누른 시각 오차(ms):', res['offsetsMs'])
        hits = res['counts']['perfect'] + res['counts']['great'] + res['counts']['good']
        if hits < 9:
            problems.append(f'정확히 누른 키가 판정되지 않음: {res["counts"]}')
        shot(page, '03-play-1p')

        # 2) 일시정지
        page.keyboard.press('Escape')
        page.wait_for_timeout(300)
        paused = page.evaluate('() => [RT.currentGame.state, RT.audio.ctx.state, !document.getElementById("pause-menu").hidden]')
        t1 = page.evaluate('() => RT.audio.songTime(performance.now())')
        page.wait_for_timeout(700)
        t2 = page.evaluate('() => RT.audio.songTime(performance.now())')
        shot(page, '04-pause')
        print('일시정지:', paused, '멈춘 동안 시간 변화', round(t2 - t1, 3))
        if paused != ['paused', 'suspended', True] or abs(t2 - t1) > 0.01:
            problems.append(f'일시정지 이상: {paused}, {t2 - t1}')
        page.keyboard.press('Escape')
        page.wait_for_timeout(500)
        if page.evaluate('() => RT.currentGame.state') != 'playing':
            problems.append('Esc로 계속하기 실패')
        page.click('#pause-button')
        page.click('text=시작 화면으로')
        page.wait_for_timeout(300)
        if not page.is_visible('#start'):
            problems.append('시작 화면으로 돌아가지 못함')

        # 3) 2인·상 자동 연주로 끝까지
        page.goto(URL + '?auto=1')
        page.click('label:has(input[name="players"][value="2"])')
        page.click('label:has(input[value="상"])')
        page.click('#start')
        page.wait_for_timeout(40000)
        shot(page, '05-play-2p-chorus')
        end = time.time() + 70
        while time.time() < end and page.evaluate('() => RT.currentGame.state') != 'finished':
            page.wait_for_timeout(1000)
        final = page.evaluate('() => RT.currentGame.players.map(p => ({score: p.score, counts: p.counts, maxCombo: p.maxCombo, total: p.total}))')
        print('2인 자동 연주 결과:', final)
        shot(page, '06-result-2p')
        if not page.is_visible('#result'):
            problems.append('결과 화면이 나오지 않음')
        for pl in final:
            if pl['counts']['miss'] > 0:
                problems.append(f'자동 연주인데 놓친 노트가 있음: {pl}')

        # 4) 곡 전체 합성
        mix = page.evaluate(RENDER_SONG)
        print('합성 결과: 최대', mix['peak'], 'NaN', mix['nan'], '4마디별 RMS', mix['rmsPer4Bars'])
        if mix['nan'] or mix['peak'] >= 1.0:
            problems.append(f'소리 이상(클리핑 또는 NaN): {mix["peak"]}, {mix["nan"]}')
        if min(mix['rmsPer4Bars'][:8]) < 0.01:
            problems.append('곡 중간에 거의 무음인 구간이 있음')

        if errors:
            problems.append('브라우저 오류: ' + ' | '.join(errors))
        browser.close()

    if problems:
        print('\n문제:')
        for pr in problems:
            print(' -', pr)
        sys.exit(1)
    print('\n브라우저 검사 통과')


if __name__ == '__main__':
    main()
