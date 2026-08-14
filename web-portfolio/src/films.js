// 필름 — NPC 가 쏘는 8프레임 무성 루프, 장마다 한 편.
//
// 규격: drawXxx(ctx, f, W, H), f=0..7, W=512, H=288. projector.js 가 빌드 때 시트 한 장으로 굽는다.
//
// ============================================================================
// v7 (2026-08-14) — 서사를 버리고 상태 네 장으로. 다섯 라운드의 재작성이 전부 실패한 뒤의 결론이다.
//
// 왜 서사를 버리는가 — 관객이 그렇게 보지 않기 때문이다.
//   영상 아래에는 그 장의 문장 전문이 글 패널로 같이 뜬다. 그 글을 읽는 데 15~20초가 걸리고
//   루프는 9.3초다. 글을 다 읽고 고개를 들면 임의의 프레임이 걸려 있다.
//   **곁에 글이 있는 루프 영상에는 시작점이 없다.** 시작점 없는 8프레임 서사는 정의상 판독 불가다.
//   이전 네 편은 관객이 절대 하지 않는 관람 방식(f0 부터 순서대로 보기)을 전제하고 설계됐다.
//
// 그리고 규칙 자체가 모순이었다.
//   02·03 의 뜻은 부재("해결하고 싶은 문제가 없었다")와 지각("보이기 시작했다")이다.
//   화면에 그린 것은 전부 "있는 것"으로 읽히므로 부재는 그릴 수 없고 — 폐기 목록(빈 작업대,
//   빈 바이스, 백지 이정표)이 그 벽의 기록이다 — 옆모습 실루엣에는 눈이 없고 고정 카메라는
//   시선 숏을 금지하므로 지각도 그릴 수 없다. 메우는 유일한 길이 사물 치환인데 그건 은유이고,
//   은유는 이미 기각된 항목이다. 이 모순 위에서는 여섯 번째 재작성도 같은 결과가 나온다.
//
// 그래서 판독을 편 안의 순서가 아니라 **편과 편 사이의 차이**로 옮긴다.
//   존을 걸어 지나가는 것 자체가 이미 컷이다. 8프레임 안에 또 서사를 넣는 것은 컷을 두 번 쓰는 것이다.
//   8프레임은 사건이 아니라 호흡이다 — 빛이 떨리고 늘어진 줄 끝이 흔들릴 뿐, 어느 프레임에서
//   봐도 같은 그림이 있다.
//
// 어휘는 01 이 이미 가르친 것만 쓴다: 화면 · 케이블 · 랙. 새 물건을 한 개도 도입하지 않는다.
//   망치·바이스·이정표·돌덩이·공장은 전부 폐기했다. 편마다 새 어휘를 발명하는 것이
//   "매번 고쳐도 안 되는" 원인이었다 — 관객은 9.3초 루프 앞에서 어휘를 네 번 배울 수 없다.
//
// 네 장은 같은 종이·같은 지면선·같은 카메라를 쓴다. 달라지는 것은 정확히 둘뿐이다:
//   ① 줄이 이어져 있는가(팽팽함) 늘어져 있는가 — 실루엣에서 가장 크게 읽히는 대비
//   ② 빛이 어디에 있는가 — 랙에 → 아무 데도 없음 → 사람에게 → 사람에게만
//
// 빛을 사람에게 옮기는 것이 이 판의 핵심이다. 이전 안에서 빛은 끝까지 물체의 것이었고,
//   그래서 네 편이 "켜짐 → 꺼짐 → 다시 켜짐"이 되어 24프레임을 보고도 순정보가 0 이었다
//   (되돌아온 이야기는 진행하지 않은 이야기와 화면상 구분되지 않는다).
//   빛이 사람에게 착지하면 01 의 끝(빛은 랙에)과 03 의 끝(빛은 그에게)이 더 이상 같지 않다.
//
// 축 문장의 동사가 "연결하는"이다. 케이블은 은유가 아니라 그 동사의 문자 그대로의 물건이고,
//   사용자의 실제 도메인(개발·인프라)의 물건이며, 01 이 이미 관객에게 가르쳐 놓은 물건이다.
// ============================================================================

import { PAL, setPalette, hash, paperBase, figure, screenUnit, cable, rack } from './projector.js'

// ---------- 종이 ----------
// 네 장이 같은 종이다. 편마다 그레이딩을 바꾸면 무성물에서는 "챕터"가 아니라 "다른 작품"으로 읽힌다
// (블라인드 실측: 네 편이 다른 감독 작품처럼 보인다는 지적). 달라지는 것은 빛뿐이다.
const BASE_PAL = {
  ink: '#2b2519', paper: '#f0e4c4', warm: '#c9761c', cool: '#5b6a70',
  vig: '43,37,25', vigA: 0.26, vigCY: 0.48, grain: 14,
  glow: '214,140,44', lit0: '#f7d79b', lit1: '#d68c2c',
}
const GOLD = '#d68c2c' // 사람에게 옮겨 가는 빛. 종이(#f0e4c4) 위에서 먹 다음으로 진한 값이라 실루엣이 산다.

// 프레임 길이(초) — 네 편 모두 총 9.3초. 등박이다: 이 편들에는 무거운 프레임이 없다.
// 어느 프레임에서 들어와도 같은 그림이어야 하므로 홀드라는 개념 자체가 없다.
export const FILM_DUR = [
  [1.2, 1.1, 1.2, 1.1, 1.2, 1.1, 1.2, 1.2],
  [1.2, 1.1, 1.2, 1.1, 1.2, 1.1, 1.2, 1.2],
  [1.2, 1.1, 1.2, 1.1, 1.2, 1.1, 1.2, 1.2],
  [1.2, 1.1, 1.2, 1.1, 1.2, 1.1, 1.2, 1.2],
]

// ---------- 공통 무대 ----------
// 네 장이 같은 자리를 쓴다. 관객이 존을 건너며 비교할 수 있으려면 무대가 상수여야 한다.
const GY = 0.8 // 지면선(H 비율)
const SCR_W = 96
const SCR_X = 240 // 화면은 네 장 모두 한 대, 같은 자리다. 대수가 바뀌면 '바뀐 것이 딱 하나'가 깨진다.
const HX = 96 // 사람도 네 장 모두 같은 자리(04 만 예외 — 그는 그때 사이로 들어간다)
const RACK_X = 372 // 랙 벽의 왼쪽 끝

function stage(ctx, f, W, H) {
  setPalette(BASE_PAL)
  paperBase(ctx, f, W, H)
  const gy = H * GY
  ctx.strokeStyle = PAL.ink
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(W * 0.05, gy)
  ctx.lineTo(W * 0.95, gy)
  ctx.stroke()
  return gy
}

// 꺼진 화면 — screenUnit 의 소등면은 PAL.paper 라 종이 위에서 오히려 밝게 뜬다.
// 반 톤 어둡게 깔아야 '꺼짐'이 '켜짐'보다 눈에 덜 띈다(01 에서 확인한 값).
function offScreen(ctx, x, gy, w) {
  const keep = PAL.paper
  setPalette({ paper: '#ddd0ab' })
  const u = screenUnit(ctx, x, gy, w, { lit: false })
  setPalette({ paper: keep })
  return u
}

// 랙 벽 — 01 의 그것. 네 장에 늘 같은 자리에 서 있고, 켜짐만 바뀐다.
function rackWall(ctx, gy, lit) {
  const xs = [0, 54, 104] // 폭 48 + 간격 — 셋째가 512 를 넘으면 벽이 잘려 '프레임 밖까지'가 아니라 '실수'로 보인다
  const hs = [116, 152, 132]
  if (!lit) { // 꺼진 벽은 표시등이 없다. rack() 은 늘 난색 점을 찍으므로 여기서는 직접 그린다.
    ctx.fillStyle = PAL.ink
    for (let i = 0; i < 3; i++) ctx.fillRect(RACK_X + xs[i], gy - hs[i], 48, hs[i])
    return
  }
  for (let i = 0; i < 3; i++) rack(ctx, RACK_X + xs[i], gy, 48, hs[i], i * 5 + 2)
}

// 늘어진 줄 — 한 끝은 손에, 다른 끝은 바닥에 닿아 아무 데도 안 꽂혀 있다.
// 팽팽함/늘어짐의 대비가 이 네 장의 유일한 서술어다. 늘어짐은 처짐 곡선으로만 성립하므로
// 중간점을 지면 가까이 떨어뜨리고, 끝에는 반드시 플러그를 달아 "꽂힐 물건"임을 못박는다.
function slackLine(ctx, x0, y0, x1, gy, seed, t) {
  // 가닥마다 처짐을 달리한다 — 같은 손에서 나온 줄들이 같은 곡선이면 셋이 한 가닥으로 뭉친다(실측).
  const sag = gy - 14 - seed * 11
  ctx.strokeStyle = PAL.ink
  ctx.lineWidth = 8 // 지면선(5)보다 굵어야 한다. 같은 굵기·같은 색이면 3.5m 투사에서 한 선으로 합쳐진다.
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.quadraticCurveTo((x0 + x1) / 2, gy - 2 + seed * 2, x1, sag)
  ctx.stroke()
  ctx.fillStyle = PAL.ink
  ctx.fillRect(x1 - 4, sag - 7, 22, 14) // 플러그 — 끝이 뭉툭해야 "빠져 있다"가 된다
}

// 팽팽한 줄 — 처짐이 거의 없다. 이 하나가 이 세계에서 "이어졌다"의 전부다.
function tautLine(ctx, x0, y0, x1, y1) {
  ctx.strokeStyle = PAL.ink
  ctx.lineWidth = 8
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + 5, x1, y1)
  ctx.stroke()
}

// 사람 — 종이색으로 한 겹 크게 깔아 테를 두른다. 네 장의 물건이 전부 같은 먹이라
// 테가 없으면 사람이 소품에 뭉친다(형태 감사: 8프레임 중 6프레임에서 인물 판독 실패).
function person(ctx, x, gy, lean, arm, lookUp) {
  const keep = PAL.ink
  setPalette({ ink: PAL.paper })
  figure(ctx, x, gy, 1.14, lean, arm, lookUp)
  setPalette({ ink: keep })
  figure(ctx, x, gy, 1, lean, arm, lookUp)
}

// 금색 사람 — 먹으로 한 겹 크게 깔고 그 위에 금색을 얹어 테두리를 만든다.
// 금색만으로는 종이와 붙어 3~4m 밖에서 실루엣이 녹는다.
function goldFigure(ctx, x, gy, lean, arm) {
  const p = PAL.ink
  setPalette({ ink: PAL.paper })
  figure(ctx, x, gy, 1.22, lean, arm)
  setPalette({ ink: p })
  figure(ctx, x, gy, 1.1, lean, arm)
  const keep = PAL.ink
  setPalette({ ink: GOLD })
  figure(ctx, x, gy, 1, lean, arm)
  setPalette({ ink: keep })
}

// 숨 — 8프레임이 사건을 지지 않으므로, 프레임 사이의 차이는 이것뿐이다.
// f 만의 함수라 어느 프레임에서 들어와도 같은 장면이고, 되감아도 같다.
function breath(f) {
  return 0.86 + 0.14 * Math.sin((f / 8) * Math.PI * 2)
}

// ==================== 01 시작 — 이어져 있다 ====================
// 그가 만든 화면 하나에서 줄이 나와 랙의 벽까지 팽팽하게 이어져 있다. 빛은 화면과 랙에 있고,
// 그는 아직 검정이다 — 세계가 켜져 있지 그가 켜져 있는 것이 아니다.
// "화면을 알게 되면 서버가, 서버를 알게 되면 그 환경이 궁금했다"의 순서는 글이 진다.
// 정지화에서 줄은 이미 이어진 상태로만 보이고, 인과의 방향은 그림이 질 수 없다.
export function drawStartScene(ctx, f, W, H) {
  const gy = stage(ctx, f, W, H)
  const b = breath(f)
  rackWall(ctx, gy, true)
  const u = screenUnit(ctx, SCR_X, gy, SCR_W, { lit: true })
  tautLine(ctx, u.x + u.w - 4, gy - 30, RACK_X + 8, gy - 92)
  person(ctx, HX, gy, 0, 0, 0.3) // 올려다본다 — 이 장에서 그는 보는 쪽이다
  ctx.fillStyle = `rgba(${PAL.glow},${0.16 * b})` // 켜진 것들이 바닥에 흘린 빛
  ctx.beginPath()
  ctx.moveTo(180, gy - 2)
  ctx.lineTo(240, gy - 40)
  ctx.lineTo(500, gy - 2)
  ctx.closePath()
  ctx.fill()
}

// ==================== 02 기술 — 안 이어져 있다 ====================
// 화면이 셋으로 늘었는데 전부 꺼져 있고, 그의 손에 쥔 줄 셋은 어디에도 꽂혀 있지 않다.
// 늘어진 세 가닥이 이 장의 전부다 — "익힌 기술은 제대로 활용하지 못한 채 희미해지는 일이 반복되었습니다".
// 이 장에는 난색이 한 점도 없다. 빛이 없는 것이 사고가 아니라 문장이 되도록, 랙까지 꺼 둔다.
// 늘어진 끝이 닿는 자리 — 셋 다 화면 발치(192~288)보다 앞이다. 겹치면 세 가닥이 한 뭉치가 된다.
const S2_END = [118, 168, 218]
export function drawGrowScene(ctx, f, W, H) {
  const gy = stage(ctx, f, W, H)
  rackWall(ctx, gy, false)
  offScreen(ctx, SCR_X, gy, SCR_W)
  const hx = HX
  const hy = gy - 40
  for (let i = 0; i < 3; i++) {
    // 끝이 프레임마다 아주 조금 흔들린다 — 아무 데도 안 꽂힌 줄만이 흔들릴 수 있다
    const sway = Math.sin((f / 8) * Math.PI * 2 + i * 2.1) * 5
    slackLine(ctx, hx + 8, hy, S2_END[i] + sway, gy, i, f)
  }
  person(ctx, hx, gy, 0.1, 1, 0) // 팔을 들어 줄을 쥐고 있다 — 쥐었다는 사실이 이 장의 유일한 행위다
}

// ==================== 03 문제 — 하나가 이어졌다 ====================
// 늘어져 있던 셋 중 하나만 화면에 꽂혀 팽팽하다. 그 화면 하나가 켜지고,
// 이 세계에서 처음으로 **그도 같이 켜진다.** 나머지 둘은 여전히 바닥에 늘어져 있다.
// 고친 것이 아니라 하나를 고른 것이다 — 랙은 아직 꺼져 있고, 켜진 것은 그 화면 하나뿐이다.
export function drawExperienceScene(ctx, f, W, H) {
  const gy = stage(ctx, f, W, H)
  const b = breath(f)
  rackWall(ctx, gy, false)
  const u = screenUnit(ctx, SCR_X, gy, SCR_W, { lit: true })
  const hx = HX
  const hy = gy - 40
  for (let i = 0; i < 2; i++) { // 아직 늘어진 둘
    const sway = Math.sin((f / 8) * Math.PI * 2 + i * 2.1) * 5
    slackLine(ctx, hx + 8, hy, S2_END[i] + sway, gy, i, f)
  }
  tautLine(ctx, hx + 10, hy - 4, u.x - 2, u.top + u.h * 0.55) // 꽂힌 하나 — 팽팽하다
  goldFigure(ctx, hx, gy, 0.06, 1)
  ctx.fillStyle = `rgba(${PAL.glow},${0.14 * b})`
  ctx.beginPath()
  ctx.moveTo(168, gy - 2)
  ctx.lineTo(240, gy - 38)
  ctx.lineTo(312, gy - 2)
  ctx.closePath()
  ctx.fill()
}

// ==================== 04 방향 — 팽팽한 한 줄을 들고 간다 ====================
// 그가 팽팽한 그 한 줄을 들고 랙의 벽 쪽으로 향해 서 있다. 벽이 켜진다.
// 두고 온 줄들은 왼쪽 바닥에 그대로 있다 — 버린 것이 아니라 지금 쓰지 않는 것이다.
// 그는 여전히 금색이고, 이 장에서 처음으로 빛이 그와 벽 양쪽에 있다.
export function drawDirectionScene(ctx, f, W, H) {
  const gy = stage(ctx, f, W, H)
  const b = breath(f)
  rackWall(ctx, gy, true)
  const u = screenUnit(ctx, SCR_X, gy, SCR_W, { lit: true })
  ctx.fillStyle = PAL.ink // 두고 온 두 가닥 — 손에서 떨어져 바닥에만 누워 있다
  for (let i = 0; i < 2; i++) {
    ctx.save()
    ctx.translate(60 + i * 26, gy - 8)
    ctx.rotate(-0.06 + i * 0.1)
    ctx.fillRect(0, 0, 62, 6)
    ctx.fillRect(58, -5, 20, 14)
    ctx.restore()
  }
  const hx = 318
  tautLine(ctx, u.x + u.w - 4, gy - 30, hx - 8, gy - 44) // 화면에서 그의 손으로
  tautLine(ctx, hx + 10, gy - 44, RACK_X + 6, gy - 96) // 그의 손에서 벽으로 — 그가 사이에 있다
  goldFigure(ctx, hx, gy, 0, 1)
  ctx.fillStyle = `rgba(${PAL.glow},${0.16 * b})`
  ctx.beginPath()
  ctx.moveTo(190, gy - 2)
  ctx.lineTo(318, gy - 46)
  ctx.lineTo(504, gy - 2)
  ctx.closePath()
  ctx.fill()
}

// 존 순서 그대로 — world.js 가 PROJ_SCENES[z] 가 있는 존에만 영사기를 세운다
export const PROJ_SCENES = [drawStartScene, drawGrowScene, drawExperienceScene, drawDirectionScene]
