// 영사기 — 만남의 순간, 드론의 램프에서 기억이 재생된다.
//
// 서사(2026-08-13, 3인 협업 확정): NPC 가 영사기다. 안테나 발광구(#ffe9a0)가 램프이고,
// 로봇이 멈추면(talk-veil 소등 = 객석 소등) 꿀빛 원뿔이 뻗어 허공에 빛의 천이 걸린다.
// "누군가 물어봐 줄 때, 지난 시간은 이야기가 된다" — 면접이라는 행위의 번역.
// 스크린은 끝까지 무자막: 그림 = 과거(무슨 일이 있었나), 하단 유리 팝업 = 현재(그래서 뭘 알았나).
//
// 색: 존1 은 꿀빛(#ffd98a) — 성장 링·한계석 파편·등롱과 같은 난색 계열.
//   발광 청록(GLOW)은 마지막 미지 존 예약색이라 여기서 절대 쓰지 않는다.
// 비용: 열린 원뿔 2겹(additive, 정점색 감쇠) + 평면 1장 + 먼지 InstancedMesh 18개.
//   장면은 2048×576 스프라이트시트(4×2 프레임)를 빌드 때 한 번만 그리고, 재생은 tex.offset 두 값 대입뿐.
//   8fps 필름 스텝 + 24Hz 밝기 떨림 + 프레임 위브 — 전부 "완벽하지 않은 재생 = 사람의 기억"에 복무.
// 구동: main 의 talkF(대화 몰입 계수)를 update(k)로 그대로 받는다 — 점등·소등 이징이 공짜다.

import * as THREE from 'three'

export const PROJ_TINT = ['#ffd98a', '#ffe9b0', '#e9eef2', '#ffcf82'] // 존별 빔 색 — 존을 지날수록 식는다

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
function smooth01(u) {
  const x = Math.min(1, Math.max(0, u))
  return x * x * (3 - 2 * x)
}
function easeOutBack(t) {
  const c1 = 1.70158
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

// ---------- 빔 — 열린 원뿔, 정점색으로 알파 감쇠 (additive 에서 검정 = 투명) ----------

function beamGeo(len, r0, r1, tintHex, sx = 1, sy = 1) {
  // 원뿔이 아니라 사각뿔 — 끝 단면이 화면의 직사각형과 같아야 "화면에 빛을 쏘는" 그림이 된다
  const g = new THREE.CylinderGeometry(r0, r1, len, 4, 4, true)
  g.rotateY(Math.PI / 4) // 사각 단면의 면이 수평/수직을 향하게
  g.translate(0, -len / 2, 0) // 렌즈(좁은 끝)를 원점으로
  g.rotateX(-Math.PI / 2) // +z 로 뻗는다
  g.scale(sx, sy, 1) // 화면 비율(가로>세로)로 늘린다
  const p = g.attributes.position
  const col = new Float32Array(p.count * 3)
  const c = new THREE.Color(tintHex)
  for (let i = 0; i < p.count; i++) {
    const u = p.getZ(i) / len // 0=렌즈 → 1=스크린
    // 둘레 방향 밝기 얼룩 — 실제 영사광의 먼지 줄무늬. 완벽한 원뿔은 CG 로, 얼룩진 원뿔은 빛으로 읽힌다.
    const ang = Math.atan2(p.getY(i), p.getX(i))
    const streak = 0.62 + 0.76 * hash(Math.round((ang / Math.PI) * 9) * 3.7)
    const a = (0.12 + 0.88 * Math.pow(1 - u, 1.6)) * streak
    col[i * 3] = c.r * a
    col[i * 3 + 1] = c.g * a
    col[i * 3 + 2] = c.b * a
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

const beamMat = () =>
  new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide, // 림이 밝아지는 공짜 볼류메트릭 — "모자이크"의 진범은 ? 스프라이트 depthWrite 였다

    fog: false,
  })

// ---------- 장면 — 그림자극 「뒷면」 v2: 화면 → 버튼 → 줄 → 기계의 벽 → 그 안으로 ----------
// v1(블록 탑·실)은 추상이라 "무슨 의미인지 모르겠다"로 기각(2026-08-13 사용자 피드백).
// v2는 문자 그대로의 사물 연쇄다: 각 프레임은 앞 프레임에 사물 하나만 더하고,
// 관객은 상징이 아니라 '줄 하나'를 따라간다. "뒤가 더 컸다"는 말이 아니라 스케일 대비로 그린다 —
// f1에서 프레임 절반이던 화면이 f7에서 구석의 62px가 되고, 그 자리를 프레임 밖까지 이어지는 벽이 채운다.
// 색 규칙: 난색 발광 = "살아 있는 것"(화면면·기계 표시등·통로 속빛뿐) — 줌아웃해도 같은 물건임을 색이 보증한다.

const INK = '#2f2619'
const PAPER = '#f3e6c8'
const WARM = '#d98f2b'

function paperBase(ctx, f, W, H) {
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, W, H)
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.8)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(58,42,20,0.30)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, W, H)
  // 프레임별 스펙 — 프레임이 넘어갈 때마다 자리가 바뀌어 공짜 그레인 애니가 된다
  ctx.fillStyle = 'rgba(58,42,20,0.18)'
  for (let i = 0; i < 14; i++) ctx.fillRect(hash(f * 31 + i * 7.3) * W, hash(f * 17 + i * 3.1) * H, 2, 2)
}

function figure(ctx, x, gy, s, lean = 0, armUp = 0, lookUp = 0) {
  ctx.save()
  ctx.translate(x, gy)
  ctx.rotate(lean)
  ctx.scale(s, s)
  ctx.fillStyle = INK
  ctx.strokeStyle = INK
  ctx.lineCap = 'round'
  // 몸 — 아래가 넓은 실루엣
  ctx.beginPath()
  ctx.moveTo(-11, 0)
  ctx.quadraticCurveTo(-9, -40, 0, -44)
  ctx.quadraticCurveTo(9, -40, 11, 0)
  ctx.closePath()
  ctx.fill()
  // 머리 — lookUp 이면 살짝 뒤로 젖힌다
  ctx.beginPath()
  ctx.arc(lookUp * 5, -56 - lookUp * 2, 11, 0, Math.PI * 2)
  ctx.fill()
  // 팔 — armUp 이면 블록을 얹는 손
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(7, -34)
  ctx.lineTo(7 + 14 + armUp * 4, -34 - armUp * 26)
  ctx.stroke()
  ctx.restore()
}

function halo(ctx, cx, cy, r, a) {
  const g = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r)
  g.addColorStop(0, 'rgba(217,143,43,' + a + ')')
  g.addColorStop(1, 'rgba(217,143,43,0)')
  ctx.fillStyle = g
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// 화면 유닛 — 이 극의 '보이는 것'. 상단바+점 3개, 다리로 지면에 선다.
// 장면에서 난색으로 빛나는 면은 이 화면(과 f7 통로의 속빛)뿐 — 줌아웃해도 같은 물건임을 색이 보증한다.
function screenUnit(ctx, cx, gy, w, { lit = true, press = false } = {}) {
  const h = w * 0.62
  const bar = h * 0.2
  const legH = w * 0.16
  const top = gy - legH - h
  const x = cx - w / 2
  ctx.fillStyle = INK
  ctx.fillRect(cx - w * 0.05, gy - legH - 2, w * 0.1, legH + 2)
  ctx.fillRect(cx - w * 0.2, gy - Math.max(4, w * 0.04), w * 0.4, Math.max(4, w * 0.04))
  if (lit) halo(ctx, cx, top + h * 0.55, w * 0.95, 0.5)
  ctx.fillStyle = INK
  ctx.fillRect(x - w * 0.035, top - w * 0.035, w * 1.07, h + w * 0.07)
  if (lit) {
    const g = ctx.createLinearGradient(0, top + bar, 0, top + h)
    g.addColorStop(0, '#f7d9a0')
    g.addColorStop(1, '#e6b168')
    ctx.fillStyle = g
  } else ctx.fillStyle = PAPER
  ctx.fillRect(x, top + bar, w, h - bar)
  ctx.fillStyle = INK
  ctx.fillRect(x, top, w, bar)
  ctx.fillStyle = lit ? WARM : PAPER
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    ctx.arc(x + bar * 0.55 + i * bar * 0.75, top + bar / 2, Math.max(1.4, bar * 0.16), 0, Math.PI * 2)
    ctx.fill()
  }
  const bw = w * 0.4
  const bh = h * 0.22
  const by = top + bar + (h - bar - bh) / 2 + (press ? 3 : 0)
  ctx.fillStyle = INK
  roundRect(ctx, cx - bw / 2, by, bw, bh, bh / 2)
  ctx.fill()
  return { btn: { x: cx, y: by + bh / 2 }, top, h, x, w }
}

// 살짝 처지는 줄 — 팽팽한 직선(기하)이 아니라 늘어진 곡선(사물)이어야 전선으로 읽힌다
function cable(ctx, pts, lw = 5) {
  ctx.strokeStyle = INK
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    ctx.quadraticCurveTo((a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 9, b[0], b[1])
  }
  ctx.stroke()
}

// 기계 캐비닛 — 좁고 높은 몸통 + 규칙적인 표시등 2열(왼쪽 정렬·촘촘 = 건물 창문과 구별)
function rack(ctx, x, gy, w, h, seed) {
  ctx.fillStyle = INK
  ctx.fillRect(x, gy - h, w, h)
  ctx.fillStyle = WARM
  const step = 24
  const rows = Math.floor((h - 18) / step)
  for (let r = 0; r < rows; r++) {
    const ly = gy - h + 16 + r * step
    if (ly < 4 || hash(seed + r * 7.7) < 0.3) continue
    ctx.beginPath()
    ctx.arc(x + w * 0.22, ly, 3, 0, Math.PI * 2)
    ctx.fill()
    if (hash(seed + r * 3.3) > 0.45) {
      ctx.beginPath()
      ctx.arc(x + w * 0.45, ly, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// 캐비닛 사이 상부 연결선 — 서로 이어져 있어야 '한 덩어리의 세계'로 읽힌다
function link(ctx, x0, y0, x1, y1) {
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.quadraticCurveTo((x0 + x1) / 2, Math.min(y0, y1) - 14, x1, y1)
  ctx.stroke()
}

function heart(ctx, x, y, s) {
  ctx.fillStyle = WARM
  ctx.beginPath()
  ctx.moveTo(x, y + s * 0.85)
  ctx.bezierCurveTo(x - s * 1.15, y + s * 0.1, x - s * 0.62, y - s * 0.72, x, y - s * 0.2)
  ctx.bezierCurveTo(x + s * 0.62, y - s * 0.72, x + s * 1.15, y + s * 0.1, x, y + s * 0.85)
  ctx.fill()
  ctx.strokeStyle = INK // 먹선 테두리 — 밝은 배경에서 원거리 생존
  ctx.lineWidth = 3
  ctx.stroke()
}

export function drawScreenScene(ctx, f, W, H) {
  paperBase(ctx, f, W, H)
  const gy = H * 0.82
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(W * 0.06, gy)
  ctx.lineTo(W * 0.94, gy)
  ctx.stroke()

  if (f === 0) {
    // 1막 — 직접 만들고 있다: 꺼진 화면, 상단바 자리가 빈 슬롯(밝은 틈).
    // 발받침에 올라선 사람이 그 조각을 슬롯으로 밀어 넣는 중 — 완성형(f1)과 같은 실루엣이라 연속성이 산다.
    const cw = 170
    const ch = cw * 0.62
    const bar = ch * 0.2
    const cx = W * 0.6
    const legH = cw * 0.16
    const top = gy - legH - ch
    const x0 = cx - cw / 2
    ctx.fillStyle = INK
    ctx.fillRect(cx - cw * 0.05, gy - legH - 2, cw * 0.1, legH + 2)
    ctx.fillRect(cx - cw * 0.2, gy - 7, cw * 0.4, 7)
    ctx.fillRect(x0 - 6, top - 6, cw + 12, ch + 12)
    ctx.fillStyle = '#e7d6b2' // 꺼진 화면면 — 종이보다 반 톤 어둡게
    ctx.fillRect(x0, top + bar, cw, ch - bar)
    ctx.fillStyle = PAPER // 상단바가 빠진 빈 슬롯 = 밝은 틈
    ctx.fillRect(x0, top, cw, bar)
    ctx.fillStyle = INK
    roundRect(ctx, cx - cw * 0.2, top + bar + (ch - bar - ch * 0.22) / 2, cw * 0.4, ch * 0.22, ch * 0.11)
    ctx.fill()
    ctx.fillRect(W * 0.77, gy - 10, 36, 10) // 바닥의 남은 부품
    ctx.fillRect(W * 0.83, gy - 22, 24, 12)
    ctx.fillRect(W * 0.335, gy - 26, 56, 26) // 발받침
    figure(ctx, W * 0.385, gy - 26, 1, 0.08)
    ctx.save()
    ctx.translate(W * 0.385, gy - 26)
    ctx.rotate(0.08)
    ctx.strokeStyle = INK
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(7, -34)
    ctx.lineTo(34, -66)
    ctx.stroke()
    ctx.fillStyle = INK
    ctx.fillRect(28, -78, 52, 12) // 손끝의 상단바 조각 — 빈 슬롯과 같은 높이
    ctx.restore()
  } else if (f === 1) {
    // 1막 — 완성·점등: 물러서서 바라본다
    screenUnit(ctx, W * 0.6, gy, 170, { lit: true })
    figure(ctx, W * 0.3, gy, 1, 0, 0, 0.25)
  } else if (f === 2) {
    // 1막 절정 — 버튼을 누르자 반응한다: 팔이 버튼까지 닿고, 하트가 크게 뜬다
    const u = screenUnit(ctx, W * 0.6, gy, 170, { lit: true, press: true })
    figure(ctx, W * 0.47, gy, 1, 0.08)
    ctx.strokeStyle = INK
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.beginPath() // 어깨→버튼, 실제로 닿는 팔
    ctx.moveTo(W * 0.47 + 6, gy - 36)
    ctx.lineTo(u.btn.x - 12, u.btn.y)
    ctx.stroke()
    heart(ctx, W * 0.6, u.top - 34, 22)
    ctx.strokeStyle = INK
    ctx.lineWidth = 3.5
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI * 0.82 + (i / 5) * Math.PI * 0.64
      ctx.beginPath()
      ctx.moveTo(W * 0.6 + Math.cos(a) * 34, u.top - 30 + Math.sin(a) * 34)
      ctx.lineTo(W * 0.6 + Math.cos(a) * 46, u.top - 30 + Math.sin(a) * 46)
      ctx.stroke()
    }
  } else if (f === 3) {
    // 2막 — 발견: 화면 뒤에서 줄 하나가 프레임 밖으로. 몸을 기울이고 손끝이 줄을 가리킨다
    const u = screenUnit(ctx, W * 0.6, gy, 170, { lit: true })
    cable(ctx, [[u.x + u.w - 6, gy - 30], [W * 0.84, gy - 8], [W * 1.02, gy - 18]], 6)
    figure(ctx, W * 0.4, gy, 1, 0.14)
    ctx.strokeStyle = INK
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.beginPath() // 시선 유도 — 줄의 출발점을 가리키는 팔
    ctx.moveTo(W * 0.4 + 10, gy - 34)
    ctx.lineTo(W * 0.56, gy - 46)
    ctx.stroke()
  } else if (f === 4) {
    // 2막 — 따라간다: 화면은 왼쪽으로 작아지고, 줄이 길을 만든다
    const u = screenUnit(ctx, W * 0.14, gy, 110, { lit: true })
    cable(ctx, [[u.x + u.w, gy - 24], [W * 0.4, gy - 6], [W * 0.66, gy - 10], [W * 1.02, gy - 12]])
    figure(ctx, W * 0.52, gy, 0.95, -0.05)
  } else if (f === 5) {
    // 3막 — 줄의 끝: 사람보다 큰 기계 상자들이 나타난다
    const u = screenUnit(ctx, W * 0.11, gy, 84, { lit: true })
    cable(ctx, [[u.x + u.w, gy - 18], [W * 0.42, gy - 6], [W * 0.66, gy - 30]])
    rack(ctx, W * 0.66, gy, 58, 155, 3)
    rack(ctx, W * 0.8, gy, 62, 196, 8)
    link(ctx, W * 0.66 + 29, gy - 155, W * 0.8 + 31, gy - 196)
    figure(ctx, W * 0.44, gy, 0.88, -0.05, 0, 0.4)
  } else if (f === 6) {
    // 3막 — 벽: 상자들이 화면 위·오른쪽 밖까지 이어진다. 올려다보는 작은 실루엣
    const u = screenUnit(ctx, W * 0.09, gy, 62, { lit: true })
    cable(ctx, [[u.x + u.w, gy - 14], [W * 0.32, gy - 4], [W * 0.47, gy - 20]], 4)
    const xs = [0.46, 0.58, 0.7, 0.82, 0.94]
    const hs = [200, 262, 320, 276, 330]
    for (let i = 0; i < xs.length; i++) rack(ctx, W * xs[i], gy, 54, hs[i], i * 5 + 2)
    link(ctx, W * 0.46 + 27, gy - 200, W * 0.58 + 27, gy - 210)
    link(ctx, W * 0.58 + 27, gy - 150, W * 0.7 + 27, gy - 160)
    link(ctx, W * 0.7 + 27, gy - 100, W * 0.82 + 27, gy - 110)
    figure(ctx, W * 0.33, gy, 0.8, 0, 0, 1)
  } else {
    // 최종 홀드 — 벽 가운데가 통로처럼 열려 따뜻하게 빛나고, 실루엣이 그 안으로 걸어 들어간다.
    // 왼쪽 구석의 작은 화면 vs 프레임 밖까지 이어지는 벽 — 이 구도 자체가 "보이는 것 뒤가 더 컸습니다".
    const u = screenUnit(ctx, W * 0.09, gy, 62, { lit: true })
    const xs = [0.4, 0.52, 0.76, 0.88]
    const hs = [230, 300, 310, 250]
    const gx = W * 0.645
    const gl = ctx.createRadialGradient(gx, gy - 40, 8, gx, gy - 40, 150) // 통로의 속빛 — 랙보다 먼저
    gl.addColorStop(0, 'rgba(247,217,160,0.95)')
    gl.addColorStop(0.55, 'rgba(217,143,43,0.55)')
    gl.addColorStop(1, 'rgba(217,143,43,0)')
    ctx.fillStyle = gl
    ctx.fillRect(gx - 150, gy - 190, 300, 200)
    for (let i = 0; i < xs.length; i++) rack(ctx, W * xs[i], gy, 54, hs[i], i * 7 + 4)
    link(ctx, W * 0.4 + 27, gy - 230, W * 0.52 + 27, gy - 240)
    link(ctx, W * 0.76 + 27, gy - 248, W * 0.88 + 27, gy - 250)
    link(ctx, W * 0.52 + 27, gy - 120, W * 0.76 + 27, gy - 128)
    ctx.strokeStyle = INK // 통로 바닥의 원근선 — 안쪽으로 좁아지는 길
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(W * 0.52 + 54, gy)
    ctx.lineTo(gx - 10, gy - 52)
    ctx.moveTo(W * 0.76, gy)
    ctx.lineTo(gx + 10, gy - 52)
    ctx.stroke()
    cable(ctx, [[u.x + u.w, gy - 14], [W * 0.34, gy - 4], [W * 0.56, gy - 8]], 4)
    figure(ctx, gx, gy - 4, 0.82, -0.05, 0, 0.5) // 빛을 등지고 문턱에서 한 발 내딛는 뒷모습
  }
}

export const PROJ_SCENES = [drawScreenScene] // 존2~4 장면은 각 존 작업 때 추가

// ---------- 조립 ----------
// 프레임 스케줄(초) — 1막 만들다 0~2 / 2막 줄의 발견 3~4 / 3막 벽과 진입 5~7, 마지막 홀드 후 루프
const FRAME_DUR = [0.9, 0.8, 1.1, 1.0, 0.8, 0.9, 1.0, 2.8]
const CYCLE = FRAME_DUR.reduce((a, b) => a + b, 0)
const HOLD_START = CYCLE - FRAME_DUR[7] // fast() 가 점프하는 지점 — 성급한 손님은 결말부터 본다

export function buildProjector({ tint = PROJ_TINT[0], drawScene = drawScreenScene, side = -1, zone = 0 }) {
  const group = new THREE.Group() // 호출자가 NPC 자리에 position 만 잡는다 (NPC 보빙과 분리된 루트)
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

  // 렌즈(NPC 안테나 높이)와 스크린(바다 쪽 허공) — 같은 그룹의 자식이라 상대 방향이 불변.
  // 스크린 높이 3.3: 하단 유리 대화창(블러)과 겹치면 화면 아래가 씻겨 보인다 — 낮은 창에서도 겹치지 않는 높이.
  const lens = new THREE.Vector3(0, 1.05, 0)
  const scrPos = new THREE.Vector3(side * 1.4, 3.3, -2.4) // 렌즈 쪽으로 당겨 빔이 화면에 '닿아서' 끝난다

  // 스프라이트시트 — 빌드 때 한 번만 그린다. 재생은 offset 두 값 대입뿐.
  const COLS = 4
  const ROWS = 2
  const FW = 512
  const FH = 288
  const cv = document.createElement('canvas')
  cv.width = COLS * FW
  cv.height = ROWS * FH
  const ctx = cv.getContext('2d')
  for (let f = 0; f < COLS * ROWS; f++) {
    ctx.save()
    ctx.translate((f % COLS) * FW, Math.floor(f / COLS) * FH)
    ctx.beginPath()
    ctx.rect(0, 0, FW, FH)
    ctx.clip()
    drawScene(ctx, f, FW, FH)
    ctx.restore()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = false
  tex.minFilter = THREE.LinearFilter
  tex.repeat.set(1 / COLS, 1 / ROWS)
  const scrMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    toneMapped: false, // 소등된 씬에서 유일하게 빛나는 면으로 남는다
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  })
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.25), scrMat)
  screen.position.copy(scrPos)
  screen.rotation.y = -side * 0.28 // 화면이 관객(카메라) 쪽으로 살짝 돈다
  screen.renderOrder = 3

  // 빔 = 렌즈에서 화면 네 모서리를 '정확히' 잇는 사각뿔(스로우 프러스텀).
  // 끝면이 곧 영상이다 — 조준 근사가 아니라 화면 모서리 좌표로 직접 짓는다.
  const eul = new THREE.Euler(0, -side * 0.28, 0) // 화면과 같은 회전
  const mkFar = (mw, mh) =>
    [[-mw, -mh], [mw, -mh], [mw, mh], [-mw, mh]].map(([x, y]) =>
      new THREE.Vector3(x, y, 0).applyEuler(eul).add(scrPos).sub(lens)
    )
  function throwGeo(farPts, tintHex) {
    const c = new THREE.Color(tintHex)
    const nearPts = farPts.map((f) => f.clone().multiplyScalar(0.03)) // 렌즈의 작은 사각
    const pos = []
    const col = []
    const push = (v, a) => {
      pos.push(v.x, v.y, v.z)
      col.push(c.r * a, c.g * a, c.b * a)
    }
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      const quad = [nearPts[i], farPts[i], farPts[j], nearPts[i], farPts[j], nearPts[j]]
      const alphas = [0.9, 0.12, 0.12, 0.9, 0.12, 0.9] // 렌즈 쪽 밝고 화면 쪽 옅게
      quad.forEach((v, qi) => push(v, alphas[qi]))
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    return g
  }
  // 퍼지는 영사광 — 최초 버전 그대로(사용자 확정: "맨 처음처럼 빔 쏘는 게 자연스러웠어")
  // 끝 반경을 화면 반높이(~1.1)보다 넓게 — 빛이 화면을 감싸며 닿아야 "이 빛이 이 화면을 그린다"로 읽힌다
  // 속겹 = 화면(2.0×1.125)에 꼭 맞고, 겉겹 = 살짝 크게 번지는 흐릿한 테
  const SHELLS = [
    { mw: 2.3, mh: 1.35, op: 0.1 },
    { mw: 2.0, mh: 1.125, op: 0.38 },
  ]
  const beams = SHELLS.map((sh) => {
    const b = new THREE.Mesh(throwGeo(mkFar(sh.mw, sh.mh), tint), beamMat())
    b.position.copy(lens) // 정점이 렌즈 기준 상대좌표라, scale 이 렌즈에서 자라는 발사가 된다
    b.renderOrder = 2
    return b
  })

  // 시전 오브 — 발사 전 렌즈(안테나)에 빛이 모인다. NPC 가 스킬을 캐스팅하는 손이다.
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 12, 10),
    new THREE.MeshBasicMaterial({
      color: tint,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
  )
  orb.position.copy(lens)
  orb.renderOrder = 2

  // 빔 속 먼지 — 야외 상영의 정취. 렌즈에서 스크린으로 천천히 흘러간다.
  const DUST_N = 18
  const dust = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.016, 0),
    new THREE.MeshBasicMaterial({
      color: tint,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
    DUST_N
  )
  dust.renderOrder = 2
  const dm = new THREE.Matrix4()
  const dv = new THREE.Vector3()

  group.add(...beams, orb, dust, screen)
  group.visible = false

  let sceneT = reduce ? HOLD_START : 0
  let playing = false

  function update(k, t, dt) {
    const on = k > 0.01
    if (group.visible !== on) group.visible = on
    if (!on) {
      if (!reduce && sceneT !== 0 && !playing) sceneT = 0 // 완전히 꺼진 뒤에만 처음으로 되감는다
      playing = false
      return
    }
    // 시전 페이즈 — k 하나에서 전부 파생(결정적, 역재생 가능):
    // 예열(빛이 모임) → 수축(anticipation) → 발사(빔이 순간 뻗음+오버슈트) → 임팩트 플래시 → 결상
    const chargeK = smooth01(k / 0.38)
    const anti = smooth01((k - 0.38) / 0.05)
    const s = Math.min(1, Math.max(0, (k - 0.43) / 0.3)) // 발사를 두 배 느리게 — 빛이 뻗는 게 눈에 보여야 시전이다
    const flash = Math.exp(-Math.pow((k - 0.73) / 0.03, 2)) // 스크린 도착 섬광 (역재생 땐 코드 뽑는 스파크)
    const scrK = smooth01((k - 0.55) / 0.32) // 결상 시작을 앞으로 — 빔이 뻗는 중에 화면이 함께 올라온다 (속도는 동일)
    // 필름 — 24Hz 밝기 스텝 + 첫 순간의 램프 워밍업 떨림
    const flick = 0.86 + 0.14 * hash(Math.floor(t * 24) * 7.7)
    // 오브 — 예열 동안 부풀며 펄스, 발사 직전 움츠러들고(수축), 발사와 함께 빛을 빔에 내어준다
    const pulse = 1 + 0.12 * Math.sin(t * 14) * chargeK
    orb.scale.setScalar(Math.max(0.001, (0.25 + 1.15 * chargeK) * (1 - 0.45 * anti) * pulse))
    orb.material.opacity = Math.max(0.9 * chargeK * (1 - 0.7 * Math.min(1, s * 3)), 0.35 * flick * scrK)
    // 빔 — 렌즈에서 스크린까지 순간 뻗는다. easeOutBack 이 팁을 1.1 까지 밀었다 되돌린다(공짜 임팩트).
    const shoot = s <= 0 ? 0 : easeOutBack(s)
    // 영사광은 상영 내내 유지 — 렌즈에서 화면 모서리까지 피라미드째 자라며 발사된다.
    const rayK = Math.min(1, s * 3) * flick
    beams.forEach((b, bi) => {
      b.scale.setScalar(Math.max(0.001, shoot))
      b.material.opacity = SHELLS[bi].op * rayK + (bi === SHELLS.length - 1 ? 0.15 * flash : 0)
    })
    // 장면 재생 — 스크린이 맺힌 동안만 시간이 흐른다
    if (scrK > 0.5 && !reduce) {
      sceneT += dt
      playing = true
    }
    const cyc = sceneT % CYCLE
    let acc = 0
    let fr = 0
    for (let i = 0; i < FRAME_DUR.length; i++) {
      acc += FRAME_DUR[i]
      if (cyc < acc) {
        fr = i
        break
      }
    }
    // 프레임 위브 — 서브픽셀 흔들림, 완벽하지 않은 재생이 사람의 기억이다
    const wx = (hash(Math.floor(t * 6) * 3.1) - 0.5) * 0.0016
    const wy = (hash(Math.floor(t * 6) * 5.7) - 0.5) * 0.0016
    tex.offset.set((fr % COLS) / COLS + wx, 1 - (Math.floor(fr / COLS) + 1) / ROWS + wy)
    scrMat.opacity = scrK * (0.85 + 0.15 * flick) + 0.6 * flash
    // 빛의 천이 아래에서 위로 펼쳐진다
    const rise = 0.25 + 0.75 * easeOutBack(Math.min(1, scrK))
    screen.scale.set(1, Math.max(0.001, rise), 1)
    // 먼지 — 결상 후 은은한 빛 티끌만 (빔이 사라진 자리의 잔광)
    dust.material.opacity = 0.3 * scrK
    for (let i = 0; i < DUST_N; i++) {
      const s1 = hash(i * 17.3)
      const frac = (s1 + t * 0.05 * (0.7 + 0.6 * hash(i * 7.7))) % 1
      dv.lerpVectors(lens, scrPos, frac)
      const spread = 0.08 + frac * 0.9
      dv.x += (hash(i * 3.1 + Math.floor(frac * 2)) - 0.5) * spread
      dv.y += (hash(i * 5.9) - 0.5) * spread
      dm.makeScale(1, 1, 1).setPosition(dv)
      dust.setMatrixAt(i, dm)
    }
    dust.instanceMatrix.needsUpdate = true
  }

  // 성급한 첫 입력 — 처음부터 다시가 아니라 결말로 빨리감기 (영사기다운 존중)
  function fast() {
    sceneT = HOLD_START
  }

  return { group, update, fast, zone }
}
