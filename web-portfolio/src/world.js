// 해안 데이터로드 — 바다를 낀 길. 걷는 사람은 원점에 고정, 세계가 +z 로 흘러 지나간다.
//
// 존 넷은 색이 아니라 "땅과 물의 관계"로 나뉜다.
//   1 모래 위에 놓인 널판   2 땅을 깎아 쌓은 돌계단   3 물 사이를 지나는 흙둑   4 물 위에 낸 부교
// 전제가 하나 무너질 때마다 막고 있던 지형이 열리고, 물이 가까워지고, 안개가 물러난다.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { buildProjector, PROJ_TINT, PROJ_SCENES } from './projector.js'

export const INTRO_LEN = 26
export const ZONE_LEN = 60
export const OUTRO_LEN = 30

// NPC 색만 존마다 다르다 — 소품 팔레트를 존 채널로 쓰면 3% 밖에 못 바꾼다
const NPC_COLORS = ['#9fc4d8', '#a8b8c0', '#8fc8c0', '#e8b088']

const GLOW = '#3fd4e0' // 닿지 못하는 곳(광장 너머)에만 쓰는 발광색
const CORAL = '#ff8a66'

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// 존별 해의 수평 방향 — main.js SUN_POS 의 (x, z) 를 그대로 옮겨 적는다. 해를 옮기면 여기도 옮긴다.
// 접지 그림자(가짜 얼룩)는 미리 구워 두는 인스턴스라 진짜 그림자처럼 매 프레임 광원을 못 따라간다.
const SUN_XZ = [[-5.4, -9.6], [-5.6, -10.3], [1, -1], [-14, -8]]
// 그림자가 뻗는 방향(정규화) — 해의 반대편이다. d(길 위 거리)로 존을 골라 쓴다.
function shadowDirAt(d) {
  const z = Math.min(SUN_XZ.length - 1, Math.max(0, Math.floor((d - INTRO_LEN) / ZONE_LEN)))
  const [lx, lz] = SUN_XZ[z]
  const len = Math.hypot(lx, lz) || 1
  return [-lx / len, -lz / len]
}

function smooth01(u) {
  const x = Math.min(1, Math.max(0, u))
  return x * x * (3 - 2 * x)
}

function easeOutBack(t) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...extra })
}

function glowMat(color = GLOW, intensity = 1.2) {
  return std(color, { emissive: color, emissiveIntensity: intensity })
}

function shadowed(obj) {
  obj.traverse((c) => { if (c.isMesh) c.castShadow = true })
  return obj
}

// 정점색 AO — 아래쪽·가장자리를 눌러 굽는다. 로우폴리에서 형태는 면 사이 명도 계단이 만든다.
// 흰색 기준으로 구우면 InstancedMesh 의 setColorAt 톤과 곱해져 분업이 된다.
function bakeAO(geo, o = {}) {
  const { gradH = 0.5, strength = 0.4, upBoost = 0.12, edge = 0, crevice = 0, creviceR = 0.2 } = o
  if (!geo.attributes.normal) geo.computeVertexNormals()
  geo.computeBoundingBox()
  const bb = geo.boundingBox
  const y0 = o.floorY ?? bb.min.y
  const pos = geo.attributes.position
  const nr = geo.attributes.normal
  const hx = Math.max(1e-4, (bb.max.x - bb.min.x) / 2)
  const hz = Math.max(1e-4, (bb.max.z - bb.min.z) / 2)
  const out = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const h = Math.min(1, Math.max(0, (pos.getY(i) - y0) / gradH))
    let v = 1 - strength * Math.pow(1 - h, 1.6)
    v *= 1 + upBoost * Math.max(0, nr.getY(i)) // 위를 향한 면을 밝게 — 베벨 없이 모서리가 선다
    if (edge) {
      const e = Math.max(Math.abs(pos.getX(i)) / hx, Math.abs(pos.getZ(i)) / hz)
      v *= 1 - edge * smooth01((e - 0.72) / 0.28)
    }
    if (crevice) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i))
      v *= 1 - crevice * (1 - Math.min(1, r / creviceR))
    }
    out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = v
  }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3))
  return geo
}

function paint(geo, hex) {
  const c = new THREE.Color(hex)
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3)
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

// ---------- 돌 ----------
// 정다면체를 눌러 놓으면 실루엣이 타원이라 사탕으로 보인다.
// 반경 노이즈로 면 크기를 흩고, 바닥을 평평하게 자르고, 파단면 하나를 낸다 —
// 실루엣에 직선이 하나 생기는 순간 사탕이 돌이 된다.
function rockGeometry(v) {
  const g = new THREE.IcosahedronGeometry(0.5, 1)
  const sc = [[1, 0.62, 0.8], [0.88, 0.74, 1], [1, 0.54, 0.66]][v]
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * sc[0]
    let y = p.getY(i) * sc[1]
    let z = p.getZ(i) * sc[2]
    // 좌표에서 뽑은 노이즈라 같은 자리의 정점은 같은 값을 받는다 — 면이 갈라지지 않는다
    const key = Math.round(x * 90) * 73 + Math.round(y * 90) * 31 + Math.round(z * 90) * 17
    const n = 1 + (hash(key + v * 211) - 0.5) * 0.34
    x *= n; y *= n; z *= n
    if (y < -0.07) y = -0.07               // 바닥면 — 접지가 점이 아니라 면이 된다
    if (z > 0.3 - v * 0.04) z = 0.3 - v * 0.04 // 파단면 하나
    p.setXYZ(i, x, y, z)
  }
  g.computeVertexNormals()
  return g
}

// ---------- 풀 ----------

// 떡잎 한 장. 원판을 물방울로 좁히고 중심 능선을 세워 통통하게.
// 능선이 얕으면 잎면 법선이 지면과 같아져 명암이 사라진다 — 능선비 23% 가 하한이다.
function cotyledon(len, halfW, crease) {
  const g = new THREE.CircleGeometry(0.5, 7)
  g.rotateX(-Math.PI / 2)
  g.translate(0, 0, 0.5)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const z = Math.max(0, p.getZ(i))
    p.setX(i, p.getX(i) * 2 * halfW * 1.34 * Math.pow(z, 0.42))
    p.setZ(i, z * len)
    p.setY(i, -Math.abs(p.getX(i)) * (crease / halfW) * 0.9) // 가운데가 솟고 양옆이 처진다
  }
  p.setY(0, crease)
  let tip = 1
  for (let i = 2; i < p.count; i++) if (p.getZ(i) > p.getZ(tip)) tip = i
  p.setY(tip, -crease * 0.4)
  return g
}

// 새싹 — 떡잎 두 장. 잎이 줄기보다 크고, 가로가 세로보다 넓고, 끝이 둥글다.
function sproutGeometry() {
  const H = 0.16
  const stem = new THREE.CylinderGeometry(0.03, 0.048, H, 4, 1, true)
  stem.translate(0, H / 2, 0)
  stem.rotateY(Math.PI / 4)
  const a = cotyledon(0.24, 0.082, 0.048)
  a.rotateX(-1.0) // 57° — 잎면이 해를 비스듬히 받아야 명암이 생긴다
  a.translate(0, H, 0)
  const b = cotyledon(0.22, 0.076, 0.045)
  b.rotateX(-0.93)
  b.rotateY(Math.PI - 0.14) // 정확한 180°를 피한다
  b.translate(0, H, 0)
  return mergeGeometries([stem, a, b], false)
}

// 풀포기 — 0.35m 새싹과 1.5m 프롭 사이가 비어 근경이 한 겹으로 무너진다. 그 사이를 메운다.
function tuftGeometry() {
  const parts = []
  for (let k = 0; k < 6; k++) {
    const h = 0.5 + hash(k * 3.1) * 0.28
    const b = new THREE.CylinderGeometry(0.005, 0.026, h, 3, 1, true)
    b.translate(0, h / 2, 0)
    b.rotateX((hash(k * 5.3) - 0.5) * 0.62)
    b.rotateZ((hash(k * 7.7) - 0.5) * 0.62)
    b.rotateY(k * 1.21 + hash(k) * 0.5)
    b.translate((hash(k * 11.3) - 0.5) * 0.14, 0, (hash(k * 13.9) - 0.5) * 0.14)
    parts.push(b)
  }
  return mergeGeometries(parts, false)
}

// ---------- 꽃 ----------
// 수평 원판은 눈높이 3.1m·거리 20m 에서 세로 1px 로 무너진다. 꽃잎을 세워야 꽃이 된다.
function flowerHeadGeometry() {
  const parts = []
  for (let k = 0; k < 6; k++) {
    const pet = new THREE.PlaneGeometry(0.075, 0.135, 1, 2)
    pet.rotateX(-Math.PI / 2)
    pet.translate(0, 0, 0.0675)
    const p = pet.attributes.position
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getZ(i) - 0.0675) < 0.001) p.setY(i, 0.018) // 가운데 행을 밀어 휜다
    }
    pet.rotateX(-0.908) // 수평에서 52° — 여섯 장의 방위가 달라 해 하나에 여섯 단 명암이 진다
    pet.translate(0, 0, 0.02)
    pet.rotateY((k / 6) * Math.PI * 2 + 0.2)
    parts.push(paint(pet.toNonIndexed(), '#ffffff'))
  }
  const bead = new THREE.IcosahedronGeometry(0.03, 0)
  bead.scale(1, 0.75, 1)
  bead.translate(0, 0.014, 0)
  parts.push(paint(bead.toNonIndexed(), '#ffd98a'))
  const cup = new THREE.CylinderGeometry(0.02, 0.03, 0.05, 5)
  cup.translate(0, -0.035, 0)
  parts.push(paint(cup.toNonIndexed(), '#ffffff'))
  const g = mergeGeometries(parts, false)
  g.translate(0, 0.42, 0)
  return g
}

function flowerStemGeometry() {
  const stem = new THREE.CylinderGeometry(0.009, 0.017, 0.42, 5, 3, true)
  stem.translate(0, 0.21, 0)
  const p = stem.attributes.position
  for (let i = 0; i < p.count; i++) {
    // 직선 줄기는 꽂아 놓은 막대로 읽힌다
    p.setX(i, p.getX(i) + 0.055 * Math.pow(p.getY(i) / 0.42, 2))
  }
  // 잎은 새싹 떡잎과 실루엣이 달라야 한다 — 피침형 3.5:1
  const l1 = cotyledon(0.13, 0.037, 0.03)
  l1.rotateX(-0.785)
  l1.rotateY(1.4)
  l1.translate(0.01, 0.1, 0)
  const l2 = cotyledon(0.115, 0.033, 0.027)
  l2.rotateX(-0.72)
  l2.rotateY(-1.35)
  l2.translate(0.02, 0.2, 0)
  return mergeGeometries([stem, l1, l2], false)
}

// ---------- 존별 배경 소품 ----------

function pine(color, s) {
  // 원기둥+구 = 사탕나무. 3단 콘을 어긋나게 쌓고 아래 단을 어둡게 — 실루엣과 공짜 AO.
  const parts = []
  const trunk = new THREE.CylinderGeometry(0.055 * s, 0.115 * s, 1.15 * s, 5)
  trunk.translate(0, 0.575 * s, 0)
  paint(trunk, '#8a6f52')
  parts.push(trunk.toNonIndexed())
  const R = [0.95, 0.72, 0.46]
  const H = [0.9, 0.78, 0.62]
  const Y = [1.25, 1.85, 2.35]
  const L = [-0.1, 0, 0.09]
  const base = new THREE.Color(color)
  for (let i = 0; i < 3; i++) {
    const c = new THREE.ConeGeometry(R[i] * s, H[i] * s, 6)
    c.rotateY(0.42 * i + hash(s * 17 + i) * 0.3)
    c.scale(1, 1, 0.86 + hash(s * 3 + i) * 0.3)
    c.translate(0, Y[i] * s, 0)
    paint(c, '#' + base.clone().offsetHSL(0, 0, L[i]).getHexString())
    parts.push(c.toNonIndexed())
  }
  const mesh = new THREE.Mesh(
    mergeGeometries(parts, false),
    std('#ffffff', { vertexColors: true })
  )
  mesh.rotation.z = (hash(s * 31) - 0.5) * 0.2 // 완전한 수직은 스탬프다
  const g = new THREE.Group()
  g.add(mesh)
  return g
}

function deadBush(_c, s) {
  // 마른 덤불 — 가지 6개를 원점에서 방사. 황무지의 "마른 것".
  const parts = []
  for (let k = 0; k < 6; k++) {
    const h = (0.5 + hash(k * 3.7) * 0.3) * s
    const b = new THREE.CylinderGeometry(0.012 * s, 0.025 * s, h, 3)
    b.translate(0, h / 2, 0)
    b.rotateZ(0.95 + hash(k * 5.1) * 0.45)
    b.rotateY(k * 1.05 + hash(k) * 0.4)
    paint(b, '#8a7250')
    parts.push(b.toNonIndexed())
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts, false), std('#ffffff', { vertexColors: true }))
  mesh.scale.y = 0.62
  const g = new THREE.Group()
  g.add(mesh)
  return g
}

function bush(color, s) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 * s, 1), std(color))
  m.scale.set(1, 0.68, 1)
  m.position.y = 0.34 * s
  const g = new THREE.Group()
  g.add(m)
  return g
}

// ---------- 존1 소품 — 여름 바닷가 ----------
// 우산소나무·둥근 덤불·바위·빛기둥은 육지의 실루엣이라, 바다 옆에 서면 여기가 어디인지 지운다.
// 그 다음에 놓아 본 어촌 세간(어망 건조대·통발·계류 말뚝·유목 더미)은 실루엣은 해안이었지만
// 정서가 쓸쓸한 폐어항이었다. 게다가 서 있는 막대기류(말뚝·기둥)는 멀리서 "그냥 꽂힌 작대기"로만
// 읽혀 전부 걷어냈다 — 존1은 여정의 산뜻한 출발이고, 그 감정의 이름은 한여름 바닷가다.
//
// 색 — 바다(#38b0cc)·모래(#eee2c4)와 한 팔레트다. 볕에 마른 흰색을 바탕으로 코랄·파스텔 하늘·
// 민트를 악센트로만 쓴다. SF 예약색 #3fd4e0(발광 청록)은 존1에 한 점도 없다.
const SUN_WHITE = '#f9f5ea'
const CORAL_S = '#ef8168'  // 파라솔·튜브·배 — 여름의 주색
const SKY_S = '#8ecbdf'    // 파스텔 하늘 — 물과 같은 계열이되 채도가 낮아 발광으로 안 읽힌다
const MINT_S = '#95d9c1'
const SAND_S = ['#f0e4c6', '#e5d6b0'] // 모래성·조개무지용 — 바닥 모래보다 반 톤 진하다
const DRIFT = ['#dbd5c5', '#cac4b4', '#e4dfd2', '#bcb7a9'] // 표백 유목 — 노·손잡이 같은 잔부재용
// 콘크리트는 모래(#eee2c4)보다 확실히 어두워야 한다 — 밝게 두면 흰 파편으로 흩어져 보인다
const CONCRETE = ['#a9ada6', '#979c96']

// 해안 소품은 부품이 많다. 하나로 용접해 소품 하나가 드로우콜 하나를 넘지 않게 한다.
function piece(geo, hex) {
  paint(geo, hex)
  return geo.toNonIndexed()
}
function weld(parts) {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(mergeGeometries(parts, false), std('#ffffff', { vertexColors: true, roughness: 0.88 })))
  return g
}

// 뒤집힌 목선 — 해변에 올려 둔 배는 물이 고이지 않게 엎어 둔다.
// 용골 능선 하나가 이 덩어리를 모래둔덕이 아니라 배로 만든다.
function beachedBoat(_c, s) {
  const parts = []
  const L = 2.7 * s
  const R = 0.5 * s
  const HY = 0.92 // 납작하면 배가 아니라 벤치다 — 처음엔 0.6 이었고, 실제로 벤치로 읽혔다
  const taper = (z) => 1 - Math.pow(Math.abs(z) / (L / 2), 2.3) * 0.97 // 양 끝은 뾰족하게
  const hull = new THREE.CylinderGeometry(R, R, L, 7)
  hull.rotateX(Math.PI / 2)
  const hp = hull.attributes.position
  for (let i = 0; i < hp.count; i++) {
    const t = taper(hp.getZ(i))
    hp.setXYZ(i, hp.getX(i) * t, Math.max(0, hp.getY(i) * t * HY), hp.getZ(i))
  }
  hull.computeVertexNormals()
  // 도색한 조각배. 표백 회백은 모래에 묻혔고 타르 회색은 폐선으로 읽혔다 —
  // 여름 바닷가에 엎어 둔 배는 색이 남아 있다.
  parts.push(piece(hull, '#e0755a'))
  // 용골 — 등뼈는 끊기지 않은 한 줄이어야 한다. 토막으로 나눴더니 벤치 살대가 됐다.
  const keel = new THREE.BoxGeometry(0.13 * s, 0.17 * s, L * 0.86, 1, 1, 8)
  const kp = keel.attributes.position
  for (let i = 0; i < kp.count; i++) {
    const t = taper(kp.getZ(i))
    kp.setXYZ(i, kp.getX(i) * (0.35 + 0.65 * t), kp.getY(i) * (0.45 + 0.55 * t) + R * t * HY, kp.getZ(i))
  }
  keel.computeVertexNormals()
  parts.push(piece(keel, SUN_WHITE))
  // 세워 둔 노 — 수직 하나가 붙어야 멀리서도 배로 걸린다
  const oar = new THREE.CylinderGeometry(0.035 * s, 0.05 * s, 1.7 * s, 5)
  oar.translate(0, 0.85 * s, 0)
  oar.rotateZ(-0.6)
  oar.translate(0.62 * s, 0, -0.35 * s)
  parts.push(piece(oar, DRIFT[0]))
  const g = weld(parts)
  g.rotation.y = 0.25 + hash(s * 7.1) * 0.7 // 물가와 나란한 배는 없다
  return g
}

// 조개 흩어진 모래 언덕 — 파도가 밀어 올린 것을 아이가 한 줌 모아 둔 자리.
function shellMound(_c, s) {
  const parts = []
  const mound = new THREE.ConeGeometry(0.86 * s, 0.42 * s, 9)
  mound.translate(0, 0.21 * s, 0)
  parts.push(piece(mound, SAND_S[0]))
  for (let k = 0; k < 14; k++) {
    const a = hash(k * 3.1 + s) * 6.28
    const r = (0.1 + hash(k * 5.3 + s) * 0.88) * s
    const sh = new THREE.ConeGeometry(0.11 * s, 0.05 * s, 6)
    sh.rotateZ((hash(k * 7.7 + s) - 0.5) * 1.0)
    sh.rotateY(a)
    sh.translate(Math.cos(a) * r, 0.42 * s * Math.max(0, 1 - r / (0.86 * s)) + 0.02 * s, Math.sin(a) * r)
    parts.push(piece(sh, k % 3 === 0 ? '#f6c9bc' : SUN_WHITE))
  }
  return weld(parts)
}

// 소품 크기 길들이기 — 배치 루프의 tier 는 0.5~2.1 을 뿌리는데, 파라솔이 1m 였다가 4.4m 가 되면
// 같은 물건으로 안 보인다. 사람이 쓰는 물건은 크기가 곧 정체라 폭을 좁혀 받는다.
const humanScale = (s) => 0.92 + s * 0.26

// 비치 파라솔 — 여름의 표지. 줄무늬 캐노피가 이 장면의 계절을 혼자 정한다.
// 캐노피는 ConetGeometry 를 thetaLength 로 여덟 조각 내어 한 조각씩 색을 바꿔 굽는다.
// 파라솔 배색 — 자리마다 다른 천. 해변에 같은 파라솔만 늘어서면 대여점 창고가 된다.
// 초록 계열은 뺐다 — 백사장 위에서 초록 천은 여름이 아니라 들판으로 읽힌다
const PARASOL_STRIPE = ['#f4c84a', '#b39ddb', '#f08a7a']
let parasolSeq = 0

function beachParasol(_c, s0, stripeOverride) {
  const s = humanScale(s0)
  const parts = []
  const R = 1.15 * s
  const CH = 0.5 * s
  const TOP = 2.05 * s
  const wedges = 8
  const stripe = stripeOverride ?? PARASOL_STRIPE[parasolSeq++ % PARASOL_STRIPE.length]
  for (let k = 0; k < wedges; k++) {
    // 밑면을 막는다(openEnded=false). 뚫린 원뿔은 그림자 맵에서 통째로 사라진다 —
    // three 는 그림자를 뒷면으로 굽는데(renderReverseSided), 홑겹 껍질은 해 쪽에서 볼 뒷면이 없다.
    // 그래서 지금까지 캐노피는 그림자를 못 만들고 밑단 테두리(토러스)만 남아 모래에 링이 그려졌다.
    const w = new THREE.ConeGeometry(R, CH, 1, 1, false, (k * Math.PI * 2) / wedges, (Math.PI * 2) / wedges)
    w.translate(0, TOP - CH / 2, 0)
    parts.push(piece(w, k % 2 ? SUN_WHITE : stripe))
  }
  // 천 가장자리 테 — 원뿔만 있으면 고깔이다. 밑단에 두께가 생겨야 천으로 읽힌다.
  const rim = new THREE.TorusGeometry(R, 0.045 * s, 4, 16)
  rim.rotateX(Math.PI / 2)
  rim.translate(0, TOP - CH, 0)
  parts.push(piece(rim, SUN_WHITE))
  // 꼭지와 대 — 대는 캐노피 아래에만 있어 "꽂힌 작대기"로 따로 읽히지 않는다
  const finial = new THREE.SphereGeometry(0.075 * s, 6, 5)
  finial.translate(0, TOP + 0.045 * s, 0)
  parts.push(piece(finial, SUN_WHITE))
  const pole = new THREE.CylinderGeometry(0.035 * s, 0.045 * s, TOP, 6)
  pole.translate(0, TOP / 2, 0)
  parts.push(piece(pole, '#e8e0cc'))
  // 돗자리 — 파라솔 밑이 비면 자리가 아니라 버섯이다
  const mat = new THREE.BoxGeometry(1.5 * s, 0.035 * s, 1.05 * s)
  mat.rotateY(0.4)
  mat.translate(0.5 * s, 0.018 * s, 0.35 * s)
  parts.push(piece(mat, SUN_WHITE))
  for (let k = 0; k < 3; k++) {
    const st = new THREE.BoxGeometry(1.5 * s, 0.04 * s, 0.17 * s)
    st.translate(0, 0, (-0.3 + k * 0.3) * s)
    st.rotateY(0.4)
    st.translate(0.5 * s, 0.02 * s, 0.35 * s)
    parts.push(piece(st, k === 1 ? CORAL_S : SKY_S))
  }
  // 아이스박스 — 뚜껑 색이 달라야 상자가 아니라 아이스박스다
  const box = new THREE.BoxGeometry(0.5 * s, 0.3 * s, 0.36 * s)
  box.translate(-0.72 * s, 0.15 * s, 0.5 * s)
  parts.push(piece(box, SUN_WHITE))
  const lid = new THREE.BoxGeometry(0.54 * s, 0.09 * s, 0.4 * s)
  lid.translate(-0.72 * s, 0.33 * s, 0.5 * s)
  parts.push(piece(lid, SKY_S))
  const g = weld(parts)
  g.rotation.y = hash(s0 * 9.1) * 2.6
  // 파라솔은 늘 조금 기울어 있다 — 수직이면 조형물이 된다
  g.rotation.z = 0.06 + hash(s0 * 4.3) * 0.07
  return g
}

// 튜브와 비치볼 — 굴러다니는 원형들. 도넛과 공은 실루엣만으로 정체가 끝난다.
function beachToys(_c, s0) {
  const s = humanScale(s0)
  const parts = []
  // 눕힌 튜브 — 반쪽씩 색을 바꿔 감아 놓은 물놀이 튜브
  for (const arc of [0, Math.PI]) {
    const half = new THREE.TorusGeometry(0.46 * s, 0.16 * s, 5, 9, Math.PI)
    half.rotateZ(arc)
    half.rotateX(Math.PI / 2)
    half.translate(0, 0.16 * s, 0)
    parts.push(piece(half, arc ? SUN_WHITE : CORAL_S))
  }
  // 세워 기대 놓은 튜브 — 수평만 있으면 납작해 보인다
  for (const arc of [0, Math.PI]) {
    const half = new THREE.TorusGeometry(0.42 * s, 0.15 * s, 5, 9, Math.PI)
    half.rotateZ(arc)
    half.rotateY(0.5)
    half.rotateZ(0.3)
    half.translate(0.95 * s, 0.42 * s, -0.35 * s)
    parts.push(piece(half, arc ? SUN_WHITE : SKY_S))
  }
  // 비치볼 — 세 쪽으로 나눠 감은 패널
  for (let k = 0; k < 3; k++) {
    const panel = new THREE.SphereGeometry(0.26 * s, 5, 5, (k * Math.PI * 2) / 3, (Math.PI * 2) / 3)
    panel.translate(-0.75 * s, 0.26 * s, 0.45 * s)
    parts.push(piece(panel, [SUN_WHITE, CORAL_S, MINT_S][k]))
  }
  // 뒤집힌 모래놀이 양동이
  const pail = new THREE.CylinderGeometry(0.17 * s, 0.21 * s, 0.28 * s, 8)
  pail.translate(0.2 * s, 0.14 * s, 0.75 * s)
  parts.push(piece(pail, MINT_S))
  const handle = new THREE.TorusGeometry(0.19 * s, 0.02 * s, 4, 8, Math.PI)
  handle.rotateY(Math.PI / 2)
  handle.translate(0.2 * s, 0.28 * s, 0.75 * s)
  parts.push(piece(handle, SUN_WHITE))
  const g = weld(parts)
  g.rotation.y = hash(s0 * 3.7) * 3.0
  return g
}

// 모래성 — 아무도 없는 해변이 아니라 방금까지 누가 있던 해변이 된다.
function sandCastle(_c, s0) {
  const s = humanScale(s0) * 0.85
  const parts = []
  const towers = [[0, 0, 0.34, 0.62], [0.52, 0.3, 0.26, 0.46], [-0.42, 0.36, 0.24, 0.42]]
  for (let k = 0; k < towers.length; k++) {
    const [tx, tz, r, h] = towers[k]
    const body = new THREE.CylinderGeometry(r * 0.88 * s, r * s, h * s, 8)
    body.translate(tx * s, (h / 2) * s, tz * s)
    parts.push(piece(body, SAND_S[k % 2]))
    const roof = new THREE.ConeGeometry(r * 1.05 * s, 0.3 * s, 8)
    roof.translate(tx * s, (h + 0.15) * s, tz * s)
    parts.push(piece(roof, SAND_S[(k + 1) % 2]))
  }
  // 성벽 — 탑만 있으면 두꺼비집이다
  const wall = new THREE.BoxGeometry(0.95 * s, 0.24 * s, 0.2 * s)
  wall.translate(0.26 * s, 0.12 * s, 0.16 * s)
  parts.push(piece(wall, SAND_S[1]))
  // 깃발 — 꼭대기 코랄 삼각형 하나가 멀리서도 걸린다
  const staff = new THREE.CylinderGeometry(0.014 * s, 0.014 * s, 0.34 * s, 4)
  staff.translate(0, 1.05 * s, 0)
  parts.push(piece(staff, SUN_WHITE))
  const flag = new THREE.ConeGeometry(0.13 * s, 0.2 * s, 3)
  flag.scale(1, 1, 0.05)
  flag.rotateZ(Math.PI / 2)
  flag.translate(0.1 * s, 1.15 * s, 0)
  parts.push(piece(flag, CORAL_S))
  // 조개 몇 개 박아 둔 자리
  for (let k = 0; k < 5; k++) {
    const a = hash(k * 5.1 + s0) * 6.28
    const sh = new THREE.ConeGeometry(0.075 * s, 0.04 * s, 6)
    sh.rotateZ((hash(k * 7.3 + s0) - 0.5) * 0.8)
    sh.translate(Math.cos(a) * 0.85 * s, 0.02 * s, Math.sin(a) * 0.85 * s)
    parts.push(piece(sh, k % 2 ? SUN_WHITE : '#f6c9bc'))
  }
  const g = weld(parts)
  g.rotation.y = hash(s0 * 6.3) * 3.0
  return g
}

// ---------- 물가 쪽 소품 — 비탈과 수면 위 ----------

// 테트라포드 — 비탈을 덮은 콘크리트. 이 물건 하나가 "여기는 해안이다"를 통째로 말한다.
function tetrapods(_c, s) {
  const parts = []
  const dirs = [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0.943, -0.333, 0),
    new THREE.Vector3(-0.471, -0.333, 0.816),
    new THREE.Vector3(-0.471, -0.333, -0.816),
  ]
  const up = new THREE.Vector3(0, 1, 0)
  const q = new THREE.Quaternion()
  const m = new THREE.Matrix4()
  // 둘이 서로 기대어 맞물린 한 덩어리 — 떨어져 놓이면 낱개 조각이고, 겹쳐야 방파제가 된다.
  // 뒤엣것은 앞엣것에 반쯤 올라타 기울고(rz), 밑동은 아래로 내려 모래·물에 박힌다.
  const lay = [[0, -0.22, 0, 0, 0.1], [1.15, 0.16, 0.62, 1.9, -0.26]]
  for (let p = 0; p < lay.length; p++) {
    const [ox, oy, oz, ry, rz] = lay[p]
    for (let k = 0; k < 4; k++) {
      // 다리는 굵되 길어야 한다 — 짧고 굵으면 덩어리, 가늘면 나뭇가지가 된다.
      // 위로 뻗은 다리 하나가 이 물건의 이름표라, 눕히면 아무것도 아닌 콘크리트 조각이 된다.
      const leg = new THREE.CylinderGeometry(0.2 * s, 0.38 * s, 0.98 * s, 6)
      leg.translate(0, 0.44 * s, 0)
      q.setFromUnitVectors(up, dirs[k])
      leg.applyMatrix4(m.makeRotationFromQuaternion(q))
      leg.rotateY(ry)
      leg.rotateZ(rz)
      leg.translate(ox * s, (0.56 + oy) * s, oz * s)
      parts.push(piece(leg, CONCRETE[(k + p) % 2]))
    }
  }
  return weld(parts)
}

function post(_c, s) {
  const g = new THREE.Group()
  const h = 1.5 * s
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.095 * s, h, 6), std('#a8825a'))
  bar.position.y = h / 2
  g.add(bar)
  return g
}

function reed(_c, s) {
  const g = new THREE.Group()
  for (let k = 0; k < 5; k++) {
    const h = (1.1 + hash(k * 3.3) * 0.7) * s
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * s, 0.03 * s, h, 4), std('#a8bc8a'))
    b.position.set((hash(k * 5.1) - 0.5) * 0.35 * s, h / 2, (hash(k * 7.3) - 0.5) * 0.35 * s)
    b.rotation.z = (hash(k * 9.7) - 0.5) * 0.3
    g.add(b)
  }
  return g
}

function saltPile(_c, s) {
  const g = new THREE.Group()
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9 * s, 1.1 * s, 8), std('#f6f2e6'))
  cone.position.y = 0.55 * s
  g.add(cone)
  return g
}

// 등대 — 여정에서 처음으로 하늘을 가리는 수직물. 마지막 존에만 선다.
function lighthouse() {
  const g = new THREE.Group()
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.28, 0.6, 12), std('#d8d2c4'))
  base.position.y = 0.3
  g.add(base)
  // 몸통 — 단 사이가 연속으로 좁아져야 계단탑이 아니라 등대가 된다
  const H = 1.9
  const bandScale = [1.15, 0.7, 1.4, 0.85, 1.0] // 균등 밴드는 가짜다
  let y = 0.6
  let r0 = 0.86
  for (let i = 0; i < 5; i++) {
    const h = H * bandScale[i] * 0.82
    const r1 = r0 - 0.088
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 12), std(i % 2 ? '#f0ece4' : '#e8a184', { roughness: 0.55 }))
    seg.position.y = y + h / 2
    g.add(seg)
    y += h
    // 코니스 링 — 단 경계가 색띠가 아니라 구조가 된다
    if (i < 4) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r1 + 0.06, r1 + 0.06, 0.09, 12), std('#d8d2c4'))
      ring.position.y = y + 0.045
      g.add(ring)
      y += 0.09
    }
    r0 = r1
  }
  // 갤러리 난간 — 이 하나가 등대를 등대로 만든다
  const gallery = new THREE.Mesh(new THREE.TorusGeometry(r0 + 0.18, 0.035, 6, 18), std('#5c666e', { roughness: 0.5 }))
  gallery.rotation.x = Math.PI / 2
  gallery.position.y = y + 0.25
  g.add(gallery)
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(r0 + 0.02, r0 + 0.08, 0.14, 10), std('#5c666e'))
  lampBase.position.y = y + 0.07
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.6, 8), glowMat('#fff3c4', 1.6))
  glass.position.y = y + 0.48
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.46, 8), std('#5c666e'))
  roof.position.y = y + 1.0
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), std('#5c666e'))
  tip.position.y = y + 1.26
  g.add(lampBase, glass, roof, tip)
  return g
}

// ---------- NPC (길에서 질문하는 동글이 드론) ----------

function questionSprite() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 96px "IBM Plex Sans KR", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(20,60,80,0.45)'
  ctx.shadowBlur = 12
  ctx.fillText('?', 64, 68)
  const tex = new THREE.CanvasTexture(cv)
  // depthWrite false — 투명해진 판이 depth 를 쓰면 뒤의 영사광에 사각 구멍을 낸다("모자이크"의 진범)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }))
  sp.scale.set(0.7, 0.7, 1)
  return sp
}

function buildNpc(color) {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), std(color))
  body.scale.set(1, 0.9, 1)
  body.position.y = 0.5
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), std('#22303a'))
  const eyeR = eyeL.clone()
  eyeL.position.set(-0.14, 0.58, 0.37)
  eyeR.position.set(0.14, 0.58, 0.37)
  const antenna = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), std('#ffe9a0', { emissive: '#ffd27a', emissiveIntensity: 0.8 }))
  antenna.position.y = 1.0
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 20), std('#cbbaa0'))
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.1
  g.add(body, eyeL, eyeR, antenna, ring)
  return g
}

// ---------- 세계 조립 ----------

export function buildWorld(scene, chapterCount, premises = []) {
  const TOTAL = INTRO_LEN + chapterCount * ZONE_LEN + OUTRO_LEN
  const group = new THREE.Group()
  scene.add(group)

  const seat = new THREE.Object3D()
  const props = []
  const npcs = []
  const projectors = [] // 만남의 영사기 — main 이 talkF 로 구동한다
  const contactSpots = [] // { x, d, r } — 그림자 카메라 밖에서도 물체가 땅을 누르게 한다

  // ----- 걸음의 높이 -----
  // 존마다 낙차가 다르다. 균일한 0.6m 는 경사 2.9°라 아무도 못 느낀다.
  // 세 번째 존에서 크게 떨어지고, 거기서 바다가 눈높이로 올라온다.
  const DROPS = [1.0, 1.6, 3.2, 1.0]
  const gateOf = (z) => INTRO_LEN + z * ZONE_LEN + ZONE_LEN * 0.8
  function trackY(d) {
    let y = 0
    for (let z = 0; z < chapterCount; z++) {
      y -= (DROPS[z] ?? 1) * smooth01((d - gateOf(z)) / 9)
    }
    // 두 번째 존은 계단이다 — 걸음이 층으로 나뉘어야 "쌓아 만든 길"로 읽힌다
    for (let k = 0; k < 4; k++) {
      y -= 0.16 * smooth01((d - (INTRO_LEN + ZONE_LEN + 10 + k * 9)) / 1.1)
    }
    return y
  }

  // 존 안에서의 위치를 0~1 로. 사건 구간은 0.68~0.95 다.
  function zoneU(d) {
    return (d - INTRO_LEN) / ZONE_LEN
  }
  function byZone(arr, d) {
    const u = zoneU(d)
    const i = Math.max(0, Math.min(chapterCount - 1, Math.floor(u)))
    const j = Math.min(chapterCount - 1, i + 1)
    // 능선 전이는 게이트(u=0.8) 뒤에서 시작 — 통과 전에 다음 존 지형이 문 밖으로 새면 안 된다
    return arr[i] + (arr[j] - arr[i]) * smooth01((u - i - 0.82) / 0.15)
  }
  const zoneOf = (d) => Math.max(0, Math.min(chapterCount - 1, Math.floor(zoneU(d))))
  const zoneY = (z) => trackY(INTRO_LEN + z * ZONE_LEN + 12)

  // 위요감 — 존1은 사구 벽이 오른쪽을 막고, 존이 바뀔 때마다 열린다.
  // 수평선 높이가 250m 동안 34%±1% 로 얼어 있던 게 "다 똑같다"의 기계적 원인이었다.
  const RIDGE_H = [1.2, 7.2, 0.4, 0.4] // 산뜻은 트이고, 황무지는 사구가 막고, 도시는 건물이 막는다
  const RIDGE_X = [12, 6.8, 26, 30] // 존2 틈 뒤로 하늘이 보여야 틈이 읽힌다
  // 물이 드는 만큼 길 옆이 파인다 — 염전(존3)과 석호(존4)가 여기서 나온다
  function basinAt(d) {
    return 0.55 * smooth01((d - (INTRO_LEN + 3 * ZONE_LEN - 14)) / 18)
  }

  // 안개도 같은 계단을 탄다 — 전제가 무너질 때마다 보이는 세계가 실제로 넓어진다.
  // 열림은 문을 "지난 뒤"에 시작한다 — 통과 전에는 안개 커튼이 다음 세계를 가리고,
  // 유일한 미리보기는 포탈 안쪽 막뿐이어야 문을 지나는 일이 사건이 된다.
  const FOG_FAR = [78, 88, 100, 118, 136] // 존1 78 — 구역 분리 이전의 트인 시야(Fog(22, 78))
  function fogFarAt(d) {
    let v = FOG_FAR[0]
    for (let z = 0; z < chapterCount; z++) {
      v += (FOG_FAR[Math.min(z + 1, 4)] - FOG_FAR[Math.min(z, 4)]) * smooth01((d - gateOf(z) - 1) / 6)
    }
    // 게이트 앞 커튼 조임 — 다가설수록 안개가 문 바로 뒤까지 조여들어, 문 밖 어디로도
    // 다음 존이 안 보인다. 커튼 거리는 카메라(로봇 뒤 8.8m) 기준 문 평면+4m 이고,
    // 하한 24 는 안개 near(22)보다 위 — far<near 는 안개가 깨진다. 통과하면 6m 에 걸쳐 풀린다.
    for (let z = 0; z < chapterCount; z++) {
      const ahead = gateOf(z) - d
      const mix = Math.max(smooth01((ahead - 12) / 16), smooth01((-ahead - 0.5) / 5.5))
      if (mix >= 1) continue
      const curtain = Math.max(24, ahead + 12.8)
      const vc = Math.min(v, curtain)
      v = vc + (v - vc) * mix
    }
    return v
  }
  // 하늘도 계단으로. 연속 보간이면 화면당 색차가 감지 문턱 아래라 예산만 태운다.
  // 안개와 같은 이유로 문 너머에서 물든다 — 통과 전 다음 존 하늘은 막 안에만 있다.
  function skyPhaseAt(d) {
    let v = 0
    for (let z = 0; z < chapterCount; z++) {
      v += (1 / chapterCount) * smooth01((d - gateOf(z) - 1) / 6)
    }
    return Math.min(1, v * 0.92 + (d / TOTAL) * 0.08)
  }

  // ----- 땅과 길의 색 -----
  function groundLife(d) {
    // 인생의 모험 — 산뜻한 출발(풀), 황무지(없음), 도시(없음), 잔잔함(다시 풀), 미지
    // 존1 0.03 — 구역 분리 이전의 해안엔 풀이 아예 없었다. 비어 있어야 하늘·물·땅이 한 톤으로 묶인다.
    const LIFE = [0.03, 0.06, 0.03, 0.5, 0.9]
    let v = LIFE[0]
    for (let z = 0; z < chapterCount; z++) {
      v += (LIFE[Math.min(z + 1, 4)] - LIFE[Math.min(z, 4)]) * smooth01((d - gateOf(z)) / 7)
    }
    return v
  }
  // 존1 은 구역 분리 이전의 '푸른 해안'(#cfe0cb) — 채도 있는 초록은 목가적 들판이 되어 바다와 따로 논다
  const GROUND_TONE = ['#cfe0cb', '#e6d2a4', '#b4b8b4', '#c2d4b0', '#9caf9a'].map((c) => new THREE.Color(c))
  // 전이는 매끈한 lerp 가 아니라 디더 — 다음 존의 땅이 다각형 조각으로 침범해 온다.
  // 시작은 게이트 3m 뒤 — 문턱 앞 땅색까지 바뀌면 안개 커튼 안쪽(근접 미포그 영역)에서 다음 존이 샌다.
  function groundColorAt(out, d, x = 0) {
    out.copy(GROUND_TONE[0])
    for (let z = 0; z < chapterCount; z++) {
      const t = smooth01((d - gateOf(z) - 3) / 9)
      if (t > 0.12 && t < 0.88) {
        const cell = Math.floor(x / 3.1) * 71 + Math.floor(d / 3.0) * 37
        if (hash(cell) < t) out.copy(GROUND_TONE[Math.min(z + 1, 4)])
      } else {
        out.lerp(GROUND_TONE[Math.min(z + 1, 4)], t)
      }
    }
    return out
  }

  // ----- 지형 -----
  const SEA_Y = trackY(TOTAL) - 0.35
  const SHORE_X0 = -1.3
  const SHORE_X1 = -13
  const LAND_X1 = 150

  function displacedPlane(x0, x1, color, heightAt, xSegs, colorAt) {
    const zFrom = 60
    const zTo = -(TOTAL + 90)
    const zSegs = 150 // 세로로 잘게 썰면 삼각형이 띠가 되어 면이 아니라 줄무늬로 셰이딩된다
    const geo = new THREE.PlaneGeometry(Math.abs(x1 - x0), zFrom - zTo, xSegs, zSegs)
    // 대각 뒤집기 — 같은 방향 삼각분할이 만드는 골지 줄무늬를 없앤다
    {
      const idx = geo.index.array
      for (let j = 0, c = 0; j < zSegs; j++) {
        for (let i = 0; i < xSegs; i++, c += 6) {
          if ((i + j) % 2) continue
          const a = idx[c], b = idx[c + 1], d0 = idx[c + 2], cc = idx[c + 4]
          idx[c] = a; idx[c + 1] = b; idx[c + 2] = cc
          idx[c + 3] = a; idx[c + 4] = cc; idx[c + 5] = d0
        }
      }
      geo.index.needsUpdate = true
    }
    geo.rotateX(-Math.PI / 2)
    const cx = (x0 + x1) / 2
    const cz = (zFrom + zTo) / 2
    const pos = geo.attributes.position
    const col = colorAt ? new Float32Array(pos.count * 3) : null
    const tmp = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx
      const z = pos.getZ(i) + cz
      pos.setXYZ(i, x, heightAt(x, -z), z)
      if (col) {
        colorAt(tmp, x, -z)
        tmp.toArray(col, i * 3)
      }
    }
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, std(color, col ? { vertexColors: true } : {}))
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }

  // 해안 — 바다는 첫 장면의 것이다. 물의 문을 지나면 물가는 뒤에 남는다.
  // 문(gateOf(0)) 앞 20m 에 걸쳐 닫혀서, 통과하는 순간에는 이미 땅이다 — 다음 존에 바다가 남아 있으면
  // "다른 세계로 건너왔다"가 무너진다. 닫히는 과정은 접근 중의 안개 커튼이 대부분 가린다.
  const seaCloseAt = gateOf(0) - 4
  function seaGone(d) {
    return smooth01((d - seaCloseAt) / 9)
  }
  // 백사장 — 구역 분리 이전 색·경사(#eee2c4, (t-0.3)/0.7). 길 옆은 평평하다 바깥에서 물로 떨어진다.
  // 물가 소품을 이 비탈 위에 정확히 앉히려면 높이식을 이름 붙여 공유해야 한다.
  function shoreH(x, d) {
    const t = (x - SHORE_X0) / (SHORE_X1 - SHORE_X0)
    const top = trackY(d) - 0.05
    const shore = top + (SEA_Y - 0.3 - top) * smooth01((t - 0.3) / 0.7)
    // 존1 너머에서는 해변이 올라와 평지가 된다
    return shore + (top - shore) * seaGone(d)
  }
  displacedPlane(SHORE_X0, SHORE_X1, '#eee2c4', shoreH, 14)

  // 왼편 먼 땅 — 존1에서는 바다 밑에 잠겨 있다가, 바다가 끝나면 떠오른다
  displacedPlane(SHORE_X1, -70, '#ffffff', (x, d) => {
    const sunk = SEA_Y - 1.2
    const risen = trackY(d) - 0.05 + Math.sin(d * 0.041 + 2.2) * 1.2 * smooth01((Math.abs(x) - 18) / 16)
    return sunk + (risen - sunk) * seaGone(d)
  }, 16, (out, x, d) => {
    groundColorAt(out, d, x)
    out.offsetHSL(0, 0, (hash(Math.floor(x / 3.1) * 91 + Math.floor(d / 3.0) * 57) - 0.5) * 0.045)
  })

  // 육지 — 길 옆은 평평하고, 바깥에서 능선이 솟는다. 능선 높이가 존 채널이다.
  function landH(x, d) {
    const off = Math.abs(x) - SHORE_X0
    const base = trackY(d) - 0.05
    // 존1 은 구역 분리 이전의 완만한 구릉뿐 — 능선·셀노이즈·메사가 붙으면 해안이 산악지가 된다
    const z1 = 1 - smooth01((d - (gateOf(0) - 12)) / 16)
    if (z1 > 0.98) {
      const far = smooth01((off - 16) / 26)
      return base + (Math.sin(d * 0.037) * 1.1 + Math.cos(d * 0.021 + 1.7) * 0.7) * far
    }
    let y = base
    y -= basinAt(d) * (1 - smooth01((off - 2.6) / 9)) // 길 옆이 파여 물이 든다
    y += byZone(RIDGE_H, d) * smooth01((off - byZone(RIDGE_X, d)) / 9) * (1 - z1)
    const far = smooth01((off - 26) / 30)
    y += (Math.sin(d * 0.037) * 1.3 + Math.cos(d * 0.021 + 1.7) * 0.9) * far
    // 셀 노이즈 — 3m 셀마다 높이가 달라야 인접 면 법선이 벌어져 각이 보인다. 길 옆 3m 는 평평하게.
    const fac = smooth01((off - 3.0) / 4)
    const cell = Math.floor(x / 3.1) * 91 + Math.floor(d / 3.0) * 57
    y += (hash(cell) - 0.5) * 0.85 * fac * (0.4 + 0.6 * far) * (1 - z1)
    // 원경 메사화 — 먼 능선이 계단 층으로 앉는다
    y = y + (Math.round(y / 0.9) * 0.9 - y) * smooth01((far - 0.5) / 0.35) * (1 - z1)
    return y
  }
  displacedPlane(SHORE_X0, LAND_X1, '#ffffff', landH, 48, (out, x, d) => {
    groundColorAt(out, d, x)
    out.offsetHSL(0, 0, (hash(Math.floor(x / 3.1) * 91 + Math.floor(d / 3.0) * 57) - 0.5) * 0.045)
  })

  // 바다 — 해수면 고정. 파도 진폭이 1px 미만이라 색 밴드로 보였다. 3배로 키운다.
  const oceanGeo = new THREE.PlaneGeometry(110, 170, 22, 26)
  // 물빛 — 존이 나뉘기 전의 밝은 청록빛 파랑(#38b0cc)으로 되돌린다. 어두운 청록은 첫 장면을 가라앉힌다.
  // 불투명 — 0.94 였을 때 바다 밑 1.2m 에 잠긴 땅이 비쳐 물빛에 초록 얼룩이 번졌다
  const ocean = new THREE.Mesh(oceanGeo, std('#38b0cc', { flatShading: true }))
  ocean.rotation.x = -Math.PI / 2
  // 첫 장면의 바다 — 물의 문 너머에는 아예 수면이 없다 (d -63 ~ +107 만 덮는다)
  ocean.position.set(-60, SEA_Y, -22)
  group.add(ocean)
  const oceanBase = oceanGeo.attributes.position.array.slice()

  const foams = []
  ;[[-0.5, 0], [-2.6, 2.1]].forEach(([offset, phase]) => {
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 115),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5 })
    )
    foam.rotation.x = -Math.PI / 2
    // 물가 선을 따라가는 띠 — 물이 닫힌 뒤(문 이후)까지 남으면 마른 땅 위의 흰 줄이 된다
    foam.position.set(SHORE_X1, SEA_Y + 0.05, -22)
    group.add(foam)
    foams.push({ mesh: foam, offset, phase })
  })



  // 석호 — 마지막 존은 길 양옆이 전부 물이다. 부교가 뜨려면 수면이 길보다 낮아야 한다.
  const lagoonGeo = new THREE.PlaneGeometry(30, ZONE_LEN + 76, 12, 46)
  {
    const lp = lagoonGeo.attributes.position
    const lc = new Float32Array(lp.count * 3)
    const cEdge = new THREE.Color('#9fc6ae')
    const cDeep = new THREE.Color('#5f8f8a')
    const lt = new THREE.Color()
    for (let i = 0; i < lp.count; i++) {
      const u = Math.min(1, Math.abs(lp.getX(i)) / 13)
      lt.copy(cDeep).lerp(cEdge, Math.pow(u, 1.6))
      lt.toArray(lc, i * 3)
    }
    lagoonGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3))
  }
  const lagoon = new THREE.Mesh(
    lagoonGeo,
    std('#ffffff', { vertexColors: true, transparent: true, opacity: 0.72, flatShading: true })
  )
  lagoon.rotation.x = -Math.PI / 2
  lagoon.position.set(2, zoneY(3) - 0.3, -(INTRO_LEN + 3 * ZONE_LEN + 34))
  group.add(lagoon)
  const lagoonBase = lagoonGeo.attributes.position.array.slice()

  // ----- 길 -----
  // 존마다 형태가 다르다. 색만 바꾸면 20% 다.
  const _rc = new THREE.Color()
  const _gc = new THREE.Color()

  function skirt(len, dCenter, halfW) {
    const zs = Math.max(2, Math.ceil(len / 4))
    const sg = new THREE.PlaneGeometry(halfW * 2 + 3.2, len, 8, zs)
    sg.rotateX(-Math.PI / 2)
    const sp = sg.attributes.position
    const scol = new Float32Array(sp.count * 3)
    for (let i = 0; i < sp.count; i++) {
      const d = dCenter - sp.getZ(i)
      const w = 1 - smooth01((Math.abs(sp.getX(i)) - halfW) / 0.9)
      groundColorAt(_gc, d)
      _rc.copy(_gc).offsetHSL(0, 0.04, -0.13)
      _gc.lerp(_rc, w).toArray(scol, i * 3)
      sp.setY(i, trackY(d) - trackY(dCenter) + 0.012)
    }
    sg.setAttribute('color', new THREE.BufferAttribute(scol, 3))
    const m = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true }))
    m.position.set(0, trackY(dCenter), -dCenter)
    m.receiveShadow = true
    group.add(m)
  }

  // 떠다니는 빛 입자 — 바닷바람에 실린 모트. 세계 그룹이 아니라 씬에 붙여
  // 걸음에 맞춰 순환시킨다(그룹에 넣으면 지형 하강만큼 떠올라 하늘로 사라진다).
  const MOTES = 90
  const moteGeo = new THREE.BufferGeometry()
  const motePos = new Float32Array(MOTES * 3)
  for (let k = 0; k < MOTES; k++) {
    motePos[k * 3] = -22 + hash(k * 1.7) * 40
    motePos[k * 3 + 1] = 0.4 + hash(k * 3.1) * 4
    motePos[k * 3 + 2] = 20 - hash(k * 5.3) * 120
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3))
  const moteBase = motePos.slice()
  const motes = new THREE.Points(
    moteGeo,
    new THREE.PointsMaterial({
      size: 0.09,
      color: '#bff0f6',
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  )
  scene.add(motes)

  // 존1 — 여름 해수욕장 데크.
  //
  // 판을 진행 방향과 직각으로 깔되 이음매는 손가락 하나 폭까지 좁힌다. 처음엔 틈을 넓게 두고
  // 양옆에 둥근 굄목을 깔았더니 침목+레일, 곧 철길로 읽혔다 — 해안의 길이 철길이 되면 끝이다.
  // 가장자리는 그래서 널 위에 겹쳐 대는 납작한 갓널(rub board)로 잡는다. 같은 나무·같은 두께라
  // 레일이 아니라 마감으로 읽히면서도, 끊기지 않아 눈을 길 끝까지 데려간다.
  //
  // 색 — 표백 회백만으로 깔았더니 차분하다 못해 계절이 사라졌다. 볕에 마른 흰 판재를 바탕으로,
  // 다시 칠한 판을 파스텔 하늘·민트·코랄로 드문드문 섞고 갓널을 하늘색으로 칠한다.
  // 물놀이장 데크의 도색은 원래 이렇게 군데군데 남는다 — 균일한 도색은 새 시설이지 해수욕장이 아니다.
  const DECK = ['#f8f4ea', '#f0ebdc', '#fcf9f1', '#e8e2d1'] // 볕에 마른 흰 판재
  // 도색 판은 소품보다 반 톤 옅게 — 같은 채도면 길이 소품보다 먼저 눈에 띄어 안전 표지가 된다
  const DECK_PAINT = ['#a5d2e2', '#a8dcc8', '#f3ab95']
  const boardGeo = bakeAO(new THREE.BoxGeometry(1, 0.075, 0.4), { gradH: 0.075, strength: 0.26, upBoost: 0.22, edge: 0.05 })
  const trimGeo = bakeAO(new THREE.BoxGeometry(0.24, 0.055, 1), { gradH: 0.055, strength: 0.24, upBoost: 0.2 })
  const chipGeo = bakeAO(new THREE.ConeGeometry(0.09, 0.05, 5), { gradH: 0.05, strength: 0.3, upBoost: 0.25 })

  function pathBoardwalk(len, dCenter, opts = {}) {
    const d0 = dCenter - len / 2
    const j = opts.pristine ? 0.3 : 1 // 인트로의 길은 아직 모래에 먹히지 않았다
    const step = 0.43
    const n = Math.floor(len / step)

    const boards = new THREE.InstancedMesh(boardGeo, std('#ffffff', { vertexColors: true, roughness: 0.92 }), n)
    const tone = new THREE.Color()
    for (let k = 0; k < n; k++) {
      const d = d0 + k * step + step / 2
      const sunk = hash(k * 31) < 0.18 * j ? 1 : 0 // 모래가 되찾아 간 판 — 내려앉고 더 기운다
      const w = 2.62 - hash(k * 7.7) * 0.24 * j
      seat.position.set((hash(k * 13) - 0.5) * 0.1 * j, trackY(d) + 0.042 - sunk * 0.035, -d)
      seat.rotation.set(
        (hash(k * 11) - 0.5) * 0.04 * j,
        (hash(k * 17) - 0.5) * 0.05 * j,
        (hash(k * 19) - 0.5) * (0.025 + sunk * 0.05) * j
      )
      seat.scale.set(w, 1, 0.96 + hash(k * 23) * 0.08)
      seat.updateMatrix()
      boards.setMatrixAt(k, seat.matrix)
      // 널마다 다른 나무여야 널이다. 여섯 장에 한 장꼴로 도색 판이 섞여 리듬이 생긴다 —
      // 두 장에 한 장이면 줄무늬 벽지가 되고, 하나도 없으면 계절이 없다.
      const painted = hash(k * 41) < 0.16
      tone.set(painted ? DECK_PAINT[Math.floor(hash(k * 3.3) * 3)] : DECK[Math.floor(hash(k * 3.3) * 4)])
      tone.offsetHSL(0, 0, (hash(k * 5.9) - 0.5) * (painted ? 0.05 : 0.055))
      if (sunk) tone.offsetHSL(0, 0, -0.05)
      boards.setColorAt(k, tone)
    }
    boards.frustumCulled = false
    boards.receiveShadow = true
    boards.castShadow = true
    group.add(boards)

    // 갓널 — 널 위에 겹쳐 대는 납작한 마감재. 널 끝이 톱니로 삐져나온 자리를 눌러 준다.
    // 하늘색 도색이라 바다와 한 계열로 묶이고, 발광이 아니라 페인트라 SF 청록과 섞이지 않는다.
    const trims = new THREE.InstancedMesh(trimGeo, std(SKY_S, { roughness: 0.9 }), 2)
    ;[-1.24, 1.24].forEach((x, i) => {
      seat.position.set(x, trackY(dCenter) + 0.098, -dCenter)
      seat.rotation.set(0, 0, 0)
      seat.scale.set(1, 1, len)
      seat.updateMatrix()
      trims.setMatrixAt(i, seat.matrix)
    })
    trims.frustumCulled = false
    trims.castShadow = true
    group.add(trims)

    // 조개·자갈 갓 — 길과 모래가 맞닿는 선을 흐린다. 발광 띠 대신 여기에 반짝임을 둔다.
    const CHIP = [SUN_WHITE, '#f6c9bc', '#dfe7dd', '#e2d9c0'].map((c) => new THREE.Color(c))
    const chips = new THREE.InstancedMesh(chipGeo, std('#ffffff', { vertexColors: true }), Math.floor(len * 3))
    for (let k = 0; k < chips.count; k++) {
      const d = d0 + hash(k * 2.1) * len
      const side = k % 2 ? 1 : -1
      const x = side * (1.28 + Math.pow(hash(k * 4.3), 1.6) * 0.85)
      seat.position.set(x, trackY(d) + 0.012, -d)
      seat.rotation.set((hash(k * 6.1) - 0.5) * 0.7, hash(k * 8.7) * 3.1, (hash(k * 10.3) - 0.5) * 0.7)
      const sc = 0.5 + hash(k * 12.9) * 0.8
      seat.scale.set(sc, sc * 0.7, sc)
      seat.updateMatrix()
      chips.setMatrixAt(k, seat.matrix)
      chips.setColorAt(k, CHIP[Math.floor(hash(k * 14.7) * 4)])
    }
    chips.frustumCulled = false
    group.add(chips)

    // (여기 있던 바다 쪽 말뚝 열은 걷어냈다 — 서 있는 막대기는 멀리서 정체가 안 잡히고,
    //  길 옆에 줄지어 서면 다시 철길 울타리로 읽힌다.)

    skirt(len, dCenter, 1.35)

    // 모래 혓바닥 — 맨발이 실어 나른 모래가 널 위에 흩어진다. 인트로 제외.
    const tn = opts.pristine ? 0 : 6
    if (tn) {
      const tongues = new THREE.InstancedMesh(new THREE.CircleGeometry(1.6, 7), std('#e9dcbc'), tn)
      for (let k = 0; k < tn; k++) {
        const d = d0 + (k + 0.6) * (len / (tn + 0.6))
        seat.position.set((hash(k * 3.3) - 0.5) * 1.2, trackY(d) + 0.088, -d)
        seat.rotation.set(-Math.PI / 2, 0, hash(k * 5.1) * 3.1)
        seat.scale.set(1, 0.42 + hash(k * 7.9) * 0.24, 1)
        seat.updateMatrix()
        tongues.setMatrixAt(k, seat.matrix)
      }
      tongues.frustumCulled = false
      group.add(tongues)
    }

  }

  // 존2 — 땅을 깎아 쌓은 판석 계단. 폭이 중간에서 잘록해진다(직선인 길에 곡률을 대신한다).
  function pathStone(len, dCenter) {
    const d0 = dCenter - len / 2
    const rows = Math.floor(len / 0.72)
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.09, 1), std('#ffffff'), rows * 4)
    const tone = ['#cfc7b4', '#c3bba8', '#d8d0bd', '#b6ae9d'].map((c) => new THREE.Color(c))
    let n = 0
    for (let r = 0; r < rows; r++) {
      const d = d0 + r * 0.72 + 0.36
      const w = 2.9 - 0.75 * Math.sin((Math.PI * (d - d0)) / len)
      let x = -w / 2
      for (let c = 0; c < 4 && x < w / 2 - 0.2; c++) {
        const sw = Math.min(0.5 + hash(r * 3.1 + c) * 0.42, w / 2 - x)
        seat.position.set(x + sw / 2, trackY(d) + 0.045 + (hash(r * 7 + c) - 0.5) * 0.02, -d)
        seat.rotation.set(0, (hash(r * 11 + c) - 0.5) * 0.09, 0)
        seat.scale.set(sw - 0.06, 1, 0.66)
        seat.updateMatrix()
        mesh.setMatrixAt(n, seat.matrix)
        mesh.setColorAt(n, tone[Math.floor(hash(r * 13 + c) * 4)])
        n++
        x += sw
      }
    }
    mesh.count = n
    mesh.frustumCulled = false
    mesh.receiveShadow = true
    group.add(mesh)
    skirt(len, dCenter, 1.5)
    // 단 코 — 계단이 눈에 보여야 걸음이 층으로 읽힌다
    for (let k = 0; k < 4; k++) {
      const at = INTRO_LEN + ZONE_LEN + 10 + k * 9
      if (at < d0 || at > d0 + len) continue
      const riser = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.22, 0.34), std('#b9b2a4'))
      riser.position.set(0, trackY(at + 1.2) + 0.11, -(at + 0.6))
      riser.receiveShadow = true
      group.add(riser)
    }
  }

  // 존3 — 회색 보도. 규칙적인 이음매·연석 — 도시의 정확함이 여기서는 외로움이다.
  function pathBund(len, dCenter) {
    const d0 = dCenter - len / 2
    const slabs = Math.floor(len / 1.2)
    const slabGeo = bakeAO(new THREE.BoxGeometry(2.2, 0.07, 1.12), { gradH: 0.07, strength: 0.22, upBoost: 0.16, edge: 0.09 })
    const mesh = new THREE.InstancedMesh(slabGeo, std('#ffffff', { vertexColors: true }), slabs)
    const tone = ['#c2c6c8', '#b6babc', '#cdd0d1'].map((c) => new THREE.Color(c))
    for (let k = 0; k < slabs; k++) {
      const d = d0 + k * 1.2 + 0.6
      seat.position.set(0, trackY(d) + 0.035, -d)
      seat.rotation.set(0, 0, 0)
      seat.scale.set(1, 1, 1)
      seat.updateMatrix()
      mesh.setMatrixAt(k, seat.matrix)
      mesh.setColorAt(k, tone[k % 3])
    }
    mesh.frustumCulled = false
    mesh.receiveShadow = true
    group.add(mesh)
    const curbN = Math.floor(len / 1.2) * 2
    const curb = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.12, 1.18), std('#9aa0a2'), curbN)
    let cbn = 0
    for (const cx of [-1.16, 1.16]) {
      for (let k = 0; k < curbN / 2; k++) {
        const d = d0 + k * 1.2 + 0.6
        seat.position.set(cx, trackY(d) + 0.05 + (hash(k * 7 + cx) - 0.5) * 0.016, -d)
        seat.rotation.set(0, 0, 0)
        seat.scale.set(1, 1, 1)
        seat.updateMatrix()
        curb.setMatrixAt(cbn++, seat.matrix)
      }
    }
    curb.count = cbn
    curb.frustumCulled = false
    curb.receiveShadow = true
    group.add(curb)
    skirt(len, dCenter, 1.25)
  }

  // 존4 — 물 위에 낸 부교. 판재가 진행 방향과 나란하고, 난간은 바다쪽 한 줄뿐이다.
  function pathFloat(len, dCenter) {
    const d0 = dCenter - len / 2
    for (let k = 0; k < 6; k++) {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.07, len),
        std(k % 2 ? '#a98b6a' : '#96795b')
      )
      plank.position.set(-1.2 + 0.4 * k + 0.2, trackY(dCenter) + 0.035, -dCenter)
      plank.receiveShadow = true
      group.add(plank)
    }
    const beams = Math.floor(len / 3)
    const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 0.09, 0.16), std('#6f7a80'), beams)
    for (let k = 0; k < beams; k++) {
      const d = d0 + k * 3 + 1.5
      seat.position.set(0, trackY(d) - 0.02, -d)
      seat.rotation.set(0, 0, 0)
      seat.scale.set(1, 1, 1)
      seat.updateMatrix()
      bm.setMatrixAt(k, seat.matrix)
    }
    bm.frustumCulled = false
    group.add(bm)
    // 말뚝과 난간 — 비대칭이 이 길의 서명이다
    const posts = Math.floor(len / 3)
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.055, 0.78, 5), std('#8a7358'), posts * 2)
    let pn2 = 0
    for (let k = 0; k < posts; k++) {
      const d = d0 + k * 3 + 1.5
      seat.position.set(-1.15, trackY(d) + 0.42, -d)
      seat.rotation.set(0, 0, 0)
      seat.scale.set(1, 1, 1)
      seat.updateMatrix()
      pm.setMatrixAt(pn2++, seat.matrix)
      // 물 속 지지 말뚝
      seat.position.set(-1.15, trackY(d) - 0.55, -d)
      seat.scale.set(1, 1.6, 1)
      seat.updateMatrix()
      pm.setMatrixAt(pn2++, seat.matrix)
    }
    pm.count = pn2
    pm.frustumCulled = false
    group.add(pm)
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 5), std('#cbbaa0'))
    rope.rotation.x = Math.PI / 2
    rope.position.set(-1.15, trackY(dCenter) + 0.74, -dCenter)
    group.add(rope)
    // 등롱 — 갓과 걸이가 있어야 등이다. 발광은 몸통만.
    const lanterns = Math.floor(len / 4.5)
    const lampFrame = []
    const framePost = new THREE.CylinderGeometry(0.022, 0.028, 0.52, 5)
    framePost.translate(0, 0.26, 0)
    paint(framePost, '#6b5540')
    lampFrame.push(framePost.toNonIndexed())
    const hook = new THREE.BoxGeometry(0.2, 0.022, 0.022)
    hook.translate(-0.1, 0.5, 0)
    paint(hook, '#6b5540')
    lampFrame.push(hook.toNonIndexed())
    const cap = new THREE.ConeGeometry(0.17, 0.1, 6)
    cap.translate(-0.19, 0.46, 0)
    paint(cap, '#6b5540')
    lampFrame.push(cap.toNonIndexed())
    const frameGeo = mergeGeometries(lampFrame, false)
    const frames = new THREE.InstancedMesh(frameGeo, std('#ffffff', { vertexColors: true }), lanterns)
    const bodies = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.115, 0.135, 0.22, 6),
      std('#ffcf82', { emissive: '#ffbe6a', emissiveIntensity: 0.85 }),
      lanterns
    )
    for (let k = 0; k < lanterns; k++) {
      const d = d0 + k * 4.5 + 1.2
      seat.position.set(-1.15, trackY(d) + 0.78, -d)
      seat.rotation.set(0, 0, 0)
      seat.scale.set(1, 1, 1)
      seat.updateMatrix()
      frames.setMatrixAt(k, seat.matrix)
      seat.position.set(-1.34, trackY(d) + 1.1, -d)
      seat.updateMatrix()
      bodies.setMatrixAt(k, seat.matrix)
    }
    frames.frustumCulled = false
    bodies.frustumCulled = false
    group.add(frames, bodies)
  }

  const PATHS = [pathBoardwalk, pathStone, pathBund, pathFloat]

  function addProp(obj, dist, contactR = 1.0) {
    obj.scale.setScalar(0.001)
    shadowed(obj)
    group.add(obj)
    props.push({ obj, dist, born: 0 })
    if (contactR > 0) contactSpots.push({ x: obj.position.x, d: dist, r: contactR })
  }

  // ----- 인트로 — 아직 전제를 하나도 의심하지 않은, 흠 없는 새 길 -----
  pathBoardwalk(33, 9.5, { pristine: true })

  // ----- 존 -----
  const SCENERY = [
    [beachParasol, beachToys, sandCastle, beachParasol, beachedBoat, shellMound], // 존1 — 여름 바닷가
    [deadBush, post, deadBush], // 존2 — 황무지, 마른 것들
    [post, post],          // 존3 — 도시 (건물·가로등은 따로 선다)
    [reed, reed],          // 존4 — 물가 갈대뿐, 잔잔함은 비움이다
  ]

  for (let z = 0; z < chapterCount; z++) {
    const zoneStart = INTRO_LEN + z * ZONE_LEN
    const stripLen = ZONE_LEN * 0.8
    const stripCenter = zoneStart + ZONE_LEN * 0.4
    PATHS[z % PATHS.length](stripLen, stripCenter)

    // 끊긴 구간 — 발판 재료가 다음 존의 재료다. 전이가 여기서 문장이 된다.
    const stepFrom = gateOf(z) - 2
    let sd = stepFrom
    for (let k = 0; k < 10 && sd < zoneStart + ZONE_LEN * 1.02; k++) {
      const x = (hash(z * 41 + k) - 0.5) * 2.2
      let stone
      if (z === 0) {
        stone = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.14, 0.34), std('#cac4b4')) // 뜯겨 나온 보드워크 널판
      } else if (z === 1) {
        stone = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.18, 0.72), std('#c3bba8')) // 굴러떨어진 석재
      } else if (z === 2) {
        stone = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.42, 0.14, 7), std('#c9c2b0')) // 소금 낀 돌
      } else {
        stone = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.5, 0.3, 10), std('#d9c9ae')) // 뜬 통
      }
      stone.position.set(x, trackY(sd) - 0.02, -sd)
      stone.rotation.y = hash(z * 17 + k) * 1.2
      stone.rotation.z = (hash(z * 23 + k) - 0.5) * 0.1
      stone.receiveShadow = true
      stone.castShadow = true
      group.add(stone)
      contactSpots.push({ x, d: sd, r: 0.72 })
      sd += 2.4 + hash(z * 61 + k) * 1.6
    }

    // NPC — 존 초입, 읽기 구간의 시작점
    const npcDist = zoneStart + 18
    const npc = buildNpc(NPC_COLORS[z % NPC_COLORS.length])
    const nside = z === 3 ? 1 : -1
    npc.position.set(nside * 2.0, trackY(npcDist), -npcDist)
    npc.rotation.y = nside > 0 ? -0.9 : 0.9
    shadowed(npc)
    const mark = questionSprite()
    mark.position.y = 1.55
    npc.add(mark)
    group.add(npc)
    npcs.push({
      group: npc,
      mark,
      dist: npcDist,
      baseY: trackY(npcDist),
      baseRot: npc.rotation.y,
      castRot: Math.atan2(nside * 1.6, -2.8), // 시전 자세 — 스크린(허공)을 향해 돌아선 각
      wasNear: false,
      excite: 0,
    })

    // 영사기 — 필름이 있는 존마다. NPC 보빙과 분리된 루트에 두어 스크린이 흔들리지 않는다.
    // 상영은 존1의 문법이 기준이다(2026-08-14) — 멈춤·소등·빔·한 번에 표시가 네 장 모두 같다.
    if (PROJ_SCENES[z]) {
      const proj = buildProjector({ tint: PROJ_TINT[z], drawScene: PROJ_SCENES[z], side: nside, zone: z })
      proj.group.position.set(nside * 2.0, trackY(npcDist), -npcDist)
      group.add(proj.group)
      projectors.push(proj)
    }

    // 배경 소품 — 읽기 구간(존+4~+43)에는 |x|<5 에 아무것도 두지 않는다.
    // 큰 것을 멀리 두면 천천히 지나가 읽기를 방해하지 않으면서 세계를 바꾼다.
    const factories = SCENERY[z % SCENERY.length]
    for (let i = 0; i < 6; i++) {
      const n = z * 100 + i
      const d = zoneStart + 6 + (i / 6) * (ZONE_LEN - 10) + hash(n * 5) * 3
      const reading = d > zoneStart + 4 && d < zoneStart + 43
      // 다음 존이 다가오면 그 존의 소품이 먼저 넘어와 있다
      const inv = smooth01((d - (zoneStart + ZONE_LEN * 0.62)) / (ZONE_LEN * 0.3))
      const pool = hash(n * 3.7) < inv ? SCENERY[Math.min(z + 1, SCENERY.length - 1)] : factories
      const factory = pool[Math.floor(hash(n) * pool.length)]
      const tier = hash(n * 7)
      const size = tier < 0.17 ? 1.7 + hash(n * 11) * 0.4 : tier < 0.83 ? 1.0 + hash(n * 11) * 0.3 : 0.5 + hash(n * 11) * 0.2
      // 존1 소품은 스스로 표백 회백 팔레트를 굽는다 — tint 는 넘어온 다음 존 소품용으로만 남는다
      const tint = z === 0 ? DRIFT[Math.floor(hash(n * 3) * DRIFT.length)] : '#b8c8a8'
      const obj = factory(tint, size)
      const px = (reading ? 7.5 : 3.4) + hash(n * 13) * 6.5
      obj.position.set(px, landH(px, d), -d)
      addProp(obj, d)
    }
  }

  // ----- 존1 왼쪽(물가) 모래턱 -----
  // 오른쪽(육지) 소품 루프는 |x|>3.4 에만 놓아서, 화면 왼쪽 절반이 내내 맨 모래였다.
  //
  // 수면 위에는 아무것도 두지 않는다. 등부표와 먼 돛단배를 띄워 봤지만 거리가 멀어 형태가 뭉개지고
  // 크기 기준이 없어 "배인지 뭔지" 애매했다 — 애매한 물체보다 빈 바다가 낫다.
  // 모래턱에는 테트라포드(형태가 한눈에 끝나는 물건)와, 읽기 구간 밖에는 여름 소품을 둔다.
  {
    // [팩토리, x, d, 크기, 모래에 박는 깊이, 기울기]
    // 읽기 구간(d 30~69)에는 |x|<5 를 비운다 — 파라솔·튜브는 그 앞(모래턱), 테트라포드는 그 바깥.
    // 테트라포드는 처음에 x=-4 / 크기 1.15 로 뒀다가 근경을 통째로 가리는 콘크리트 덩어리가 됐다.
    // 물턱 아래로 밀어 내리고 반으로 줄이면 여름 백사장을 두른 호안 라인으로만 읽힌다.
    // 테트라포드는 x·d·크기·기울기를 흩는다 — 같은 간격으로 놓이면 사람이 세운 울타리가 되고,
    // 파도가 굴려 놓은 것으로 보이려면 줄이 흔들려야 한다. 밑동은 깊게(sink) 박아 물·모래에 잠긴다.
    const SEASIDE = [
      // (바다 쪽 파라솔은 걷어냈다 — 시작점 오른편의 빨간 것 하나가 첫 색을 다 맡는다)
      [beachToys, -4.3, 28, 1.05, 0, 0, 0],
      [tetrapods, -6.2, 33, 0.78, 0.42, 0.14, 0.5],
      [tetrapods, -7.4, 44.5, 0.68, 0.5, -0.1, 2.2],
      [tetrapods, -6.5, 51, 0.86, 0.38, 0.2, 1.1],
      [tetrapods, -7.9, 64, 0.72, 0.46, -0.16, 3.4],
    ]
    for (const [factory, sx, sd, size, sink, tilt, spin] of SEASIDE) {
      const obj = factory(SUN_WHITE, size)
      obj.position.set(sx, shoreH(sx, sd) - sink * size, -sd)
      if (tilt) obj.rotation.z = tilt
      if (spin) obj.rotation.y = spin
      addProp(obj, sd, 0.5)
    }

    // 시작점 오른편의 빨간 파라솔 — 출발선에서 눈이 처음 붙는 자리다.
    // 길 왼쪽은 바다가 다 가져가니, 첫 색은 오른쪽에 하나만 세워 둔다.
    const startParasol = beachParasol(SUN_WHITE, 1.15, '#e2452f')
    startParasol.position.set(7.4, groundY(13, 7.4), -13)
    startParasol.rotation.y = 0.6
    addProp(startParasol, 13, 0.6)
  }

  // ----- 경계 — 전제가 무너지는 자리 -----
  // 일차원(기둥 2개+판때기)의 원인은 둘이었다: 카메라가 부재를 뚫었고, 드로우콜이 아까워 얇게 눌렀다.
  // 해법: 카메라 통로(x -3.0~-1.2, y 2.3~3.9)를 비우는 2열 구성 + 안 움직이는 부재는 전부 하나로 용접.
  function premiseTexture(text, W = 512, H = 256) {
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#e9dfc8'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(90, 74, 52, 0.5)'
    ctx.lineWidth = Math.max(3, H * 0.02)
    const M = W * 0.035
    ctx.strokeRect(M, M, W - M * 2, H - M * 2)
    ctx.fillStyle = '#4a3c2c'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let size = H * 0.22
    ctx.font = `700 ${size}px "IBM Plex Sans KR", sans-serif`
    while (ctx.measureText(text).width > W * 0.86 && size > H * 0.1) {
      size -= 2
      ctx.font = `700 ${size}px "IBM Plex Sans KR", sans-serif`
    }
    if (ctx.measureText(text).width > W * 0.86) {
      const mid = Math.ceil(text.length / 2)
      let cut2 = text.lastIndexOf(' ', mid)
      if (cut2 < 4) cut2 = mid
      ctx.fillText(text.slice(0, cut2), W / 2, H * 0.375)
      ctx.fillText(text.slice(cut2 + (text[cut2] === ' ' ? 1 : 0)), W / 2, H * 0.633)
    } else {
      ctx.fillText(text, W / 2, H / 2)
    }
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  // 부재 하나 — 색을 정점에 굽고 병합 가능한 형태로
  const _mc = new THREE.Color()
  function memb(geo, hex, ao) {
    if (ao) bakeAO(geo, ao)
    const g = geo.index ? geo.toNonIndexed() : geo
    _mc.set(hex)
    const n = g.attributes.position.count
    const src = g.attributes.color
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const v = src ? src.getX(i) : 1
      arr[i * 3] = _mc.r * v
      arr[i * 3 + 1] = _mc.g * v
      arr[i * 3 + 2] = _mc.b * v
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    return g
  }
  const GB = (w, h, d) => new THREE.BoxGeometry(w, h, d)
  const GC = (rt, rb, h, seg) => new THREE.CylinderGeometry(rt, rb, h, seg)
  function gat(g, x, y, z, rx = 0, ry = 0, rz = 0) {
    if (rz) g.rotateZ(rz)
    if (rx) g.rotateX(rx)
    if (ry) g.rotateY(ry)
    g.translate(x, y, z)
    return g
  }
  function weld(parts, rough = 0.9) {
    const m = new THREE.Mesh(
      mergeGeometries(parts, false),
      std('#ffffff', { vertexColors: true, roughness: rough })
    )
    m.castShadow = true
    m.receiveShadow = true
    return m
  }
  function premisePlate(text, w, h, W, H) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      std('#ffffff', { roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 })
    )
    m.material.map = premiseTexture(text, W, H)
    return m
  }
  const gateAnims = []

  // ── 경계 1~4 — 다음 세계로 넘어가는 포탈 ──
  // 길 위에 선 발광 링. 색은 다음 존의 테마색, 안쪽 막에는 다음 존의 하늘이 비친다 —
  // 통과가 "다음 세계로 넘어가는 사건"으로 읽히되, 로봇은 멈추지 않는다.
  // 성장(스케일·Lv·불꽃)은 main 이 walked 의 순수 함수로 계산한다 — 여기서는 상태를 만들지 않는다(역스크롤 멱등).
  function teaserTexture(text, tintHex, W = 512, H = 176) {
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const ctx = cv.getContext('2d')
    const tint = new THREE.Color(tintHex)
    // 바탕은 다음 존 테마색을 어둡게 누른 판 — 원색 면적이 크면 예고가 아니라 광고판이 된다
    ctx.fillStyle = tint.clone().multiplyScalar(0.24).getStyle()
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = tint.clone().lerp(new THREE.Color('#ffffff'), 0.3).getStyle()
    ctx.lineWidth = Math.max(3, H * 0.03)
    const M = W * 0.03
    ctx.strokeRect(M, M, W - M * 2, H - M * 2)
    ctx.fillStyle = '#f2ead8'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let size = H * 0.3
    ctx.font = `600 ${size}px "IBM Plex Sans KR", sans-serif`
    while (ctx.measureText(text).width > W * 0.78 && size > H * 0.14) {
      size -= 2
      ctx.font = `600 ${size}px "IBM Plex Sans KR", sans-serif`
    }
    ctx.fillText(text, W / 2, H * 0.52)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    // 커서가 앉을 자리 — 문장 끝 바로 뒤(0~1 정규화). 점멸은 캔버스가 아니라 발광 바 메시가 맡는다.
    return {
      tex,
      cursorU: Math.min(0.95, (W / 2 + ctx.measureText(text).width / 2 + size * 0.28) / W),
      sizeV: size / H,
    }
  }

  // 다음 존의 하늘 — main.js SKY/SKY_TOP 의 존 키와 같은 값(포탈 막 전용 사본).
  // 막에 다음 존의 하늘이 비쳐야 "저 너머는 다른 세계"가 문 하나로 읽힌다.
  const NEXT_SKY = [
    ['#c2ad84', '#eeddc0'], // 문1 너머 — 사막의 먼지 낀 하늘
    ['#8d97a2', '#c6cacd'], // 문2 너머 — 잿빛 도시
    ['#e8987c', '#ffd2b0'], // 문3 너머 — 낮게 가라앉은 노을
    ['#6f5a92', '#b98098'], // 문4 너머 — 황혼 (SF 청록은 부두 포털의 예약색, 여기 못 쓴다)
  ]
  function portalSkyTexture(idx, overrideSky) {
    // overrideSky — 존별 예외용 [top, bot]. 물의 문은 사막 하늘 대신 제 물빛을 막에 채운다.
    const [topHex, botHex] = overrideSky || NEXT_SKY[Math.min(idx, NEXT_SKY.length - 1)]
    const cv = document.createElement('canvas')
    cv.width = cv.height = 256
    const ctx = cv.getContext('2d')
    // 채도를 반 단 올린다 — 반투명 막 너머로 안개 낀 원경이 비쳐 색이 반쯤 씻겨 나가기 때문
    const top = new THREE.Color(topHex).offsetHSL(0, 0.12, -0.02)
    const bot = new THREE.Color(botHex).offsetHSL(0, 0.12, 0)
    // 세로 그라데이션 — 위는 다음 존의 상공, 지평선에서 밝아졌다가 발치는 어둡게(땅의 예감)
    const sky = ctx.createLinearGradient(0, 0, 0, 256)
    sky.addColorStop(0, top.getStyle())
    sky.addColorStop(0.6, bot.getStyle())
    sky.addColorStop(0.76, bot.clone().lerp(new THREE.Color('#ffffff'), 0.28).getStyle())
    sky.addColorStop(1, bot.clone().multiplyScalar(0.5).getStyle())
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, 256, 256)
    // 지평선의 해무리 — 저 세계에도 광원이 있다는 한 점
    const glow = ctx.createRadialGradient(128, 170, 4, 128, 170, 84)
    glow.addColorStop(0, 'rgba(255,244,224,0.5)')
    glow.addColorStop(1, 'rgba(255,244,224,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, 256, 256)
    // 가장자리 알파 페더 — 막이 링 안쪽으로 스며들 듯 붙는다
    const mask = ctx.createRadialGradient(128, 128, 56, 128, 128, 128)
    mask.addColorStop(0, 'rgba(0,0,0,1)')
    mask.addColorStop(0.8, 'rgba(0,0,0,0.92)')
    mask.addColorStop(1, 'rgba(0,0,0,0.45)')
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = mask
    ctx.fillRect(0, 0, 256, 256)
    ctx.globalCompositeOperation = 'source-over'
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }
  // 빛 웅덩이 텍스처 — 흰 방사 그라데이션 하나를 공유하고, 색은 재질이 입힌다
  const poolTex = (() => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 128
    const ctx = cv.getContext('2d')
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.55, 'rgba(255,255,255,0.32)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(cv)
  })()

  // 다음 질문 예고판 — 게이트 너머 길가에 다음 전제의 앞 절반만.
  // 문장이 끝나기 전에 끊겨야 예고다 — 나머지는 걸어가서 듣는다. 마지막 존은 다음이 없어 생략.
  function gateTeaser(next, g) {
    if (!next?.premise) return null
    const teaser = next.premise.slice(0, Math.ceil(next.premise.length * 0.45)) + '…'
    const nextTint = new THREE.Color(next.themeColor ?? '#ffffff')
    const { tex, cursorU, sizeV } = teaserTexture(teaser, next.themeColor ?? '#ffffff')
    const pd = g + 4.5
    const pw = 1.7
    const phh = 0.6
    const holder = new THREE.Group()
    // 포탈 옆 — 문틀(반폭 ~2.4)과 겹치면 예고판이 문에 먹힌다. 문을 나서면 오른쪽에 서 있다.
    holder.position.set(3.3, trackY(pd), -pd)
    holder.rotation.y = -0.3 // 살짝 길 쪽으로 — 정면 판은 걷는 이가 아니라 카메라를 향한 광고가 된다
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.05, 6), std('#8a7358'))
    stake.position.y = 0.52
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(pw, phh),
      std('#ffffff', { map: tex, transparent: true, opacity: 0.85, roughness: 0.7, side: THREE.DoubleSide })
    )
    board.position.y = 1.18
    // 깜빡이는 커서 — 다음 질문이 아직 적히는 중이라는 신호
    const cursor = new THREE.Mesh(
      new THREE.PlaneGeometry(0.035, phh * sizeV),
      new THREE.MeshBasicMaterial({
        color: nextTint.clone().lerp(new THREE.Color('#ffffff'), 0.55),
        transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    )
    cursor.position.set((cursorU - 0.5) * pw, -0.01, 0.012)
    board.add(cursor)
    holder.add(stake, board)
    shadowed(holder)
    group.add(holder)
    contactSpots.push({ x: 3.3, d: pd, r: 0.4 })
    return cursor
  }

  function gatePortal(idx) {
    const g = gateOf(idx)
    const next = premises[idx + 1]
    // 문 색 = 다음 존의 테마색 — "저 색의 세계로 넘어간다"가 문 하나로 읽힌다.
    // 마지막 문은 다음 존이 없다 — 너머는 황혼이므로 노을색으로 마감(SF 청록 침범 금지).
    const tint = new THREE.Color(next?.themeColor ?? '#C2410C')
    // 채도를 올리고 1 을 넘겨 굽는다 — ACES 상단 압축이 파스텔을 화이트로 밀어내므로,
    // HDR 로 넣어야 톤매핑 후에도 "그 존의 색"이 남는다.
    // 문2(도시 강청)만 색상을 남색 쪽으로 — 밝힌 강청은 SF 예약 청록과 헷갈린다.
    const hueNudge = [0, 0.035, 0, 0][idx] ?? 0
    const bright = tint.clone().offsetHSL(hueNudge, 0.25, 0.08).multiplyScalar(1.5)
    const haloCol = tint.clone().offsetHSL(hueNudge, 0.3, 0.02).multiplyScalar(1.2)
    const root = new THREE.Group()
    root.position.set(0, trackY(g), -g)
    group.add(root)

    // 서 있는 링 — 중심(1.55)을 반지름(2.0)보다 낮게. 아래 호는 땅에 묻혀
    // 문이 땅에서 자라난 형태가 되고, 로봇(|x|<0.4)이 튜브를 뚫지 않고 통과한다.
    // 최대 |x|=2.0 은 카메라 통과선(x≈-2.1)보다 안쪽 — 카메라도 부재를 뚫지 않는다.
    const R = 2.0
    const CY = 1.55
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.07, 10, 56),
      new THREE.MeshBasicMaterial({ color: bright, transparent: true, opacity: 0.85, fog: false })
    )
    ring.position.y = CY
    // 후광 — 본체가 형태를, 후광이 밝기를 맡는다. 통과 순간 이쪽이 터진다.
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.21, 8, 56),
      new THREE.MeshBasicMaterial({ color: haloCol, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    )
    halo.position.y = CY
    // 막 — 다음 존의 하늘이 어른거리는 반투명 필름. 지금 존의 하늘과 색이 달라야 문이다.
    const membrane = new THREE.Mesh(
      new THREE.CircleGeometry(R - 0.05, 48),
      new THREE.MeshBasicMaterial({ map: portalSkyTexture(idx), transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, fog: false })
    )
    membrane.position.y = CY
    // 메아리 링 — 같은 고리가 2.6m 너머에 한 겹 더. 걸으면 시차로 벌어져 문이 부피를 갖는다.
    const echo = new THREE.Mesh(
      ring.geometry,
      new THREE.MeshBasicMaterial({ color: haloCol, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    )
    echo.position.set(0, CY + 0.15, -2.6)
    echo.scale.setScalar(1.18)
    root.add(ring, halo, membrane, echo)

    // 막 일렁임 준비 — 둘레 정점의 기준 반경·각도를 재 둔다. 원판 정점은 중심 하나와
    // 둘레뿐이라, 실루엣을 물결치게 하는 쪽이 면을 구기는 것보다 싸고 잘 보인다.
    const memPos = membrane.geometry.attributes.position
    const memBase = []
    for (let i = 0; i < memPos.count; i++) {
      memBase.push([Math.hypot(memPos.getX(i), memPos.getY(i)), Math.atan2(memPos.getY(i), memPos.getX(i))])
    }
    membrane.material.map.center.set(0.5, 0.5) // 회전 축을 중심으로 — 막 안의 하늘이 제자리서 인다

    // 끊긴 이중 호 — 매끈한 원환 하나는 도형이지 문이 아니다. 길이가 다른 호 조각 두 겹이
    // 서로 반대로 돈다. 균등 분할을 피한 비대칭이 이 세계 수공예의 서명이다.
    const arcAt = (r, tube, arc, rz) => gat(new THREE.TorusGeometry(r, tube, 6, 22, arc), 0, 0, 0, 0, 0, rz)
    const arcsIn = new THREE.Mesh(
      mergeGeometries([arcAt(R + 0.2, 0.042, 1.7, 0.45), arcAt(R + 0.2, 0.042, 1.05, 2.85)], false),
      new THREE.MeshBasicMaterial({ color: bright, transparent: true, opacity: 0.4, fog: false })
    )
    const arcsOut = new THREE.Mesh(
      mergeGeometries([arcAt(R + 0.38, 0.026, 2.1, 1.7), arcAt(R + 0.38, 0.026, 0.75, 4.9)], false),
      new THREE.MeshBasicMaterial({ color: haloCol, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    )
    arcsIn.position.y = CY
    arcsOut.position.y = CY
    root.add(arcsIn, arcsOut)

    // 부유 룬돌 — 발치 돌과 같은 계열의 새김돌이 문가에 떠 있다. 문이 돌을 띄우고 있어야
    // 빛의 고리가 홀로그램이 아니라 힘이 된다. 아래 호는 땅속이라 위쪽 반원에만 띄우고,
    // 카메라 통과선(좌상단, 각도 2.1~3.0rad)은 비워 둔다 — 카메라가 돌을 뚫으면 안 된다.
    const RUNE_N = 6
    const runes = new THREE.InstancedMesh(
      bakeAO(new THREE.BoxGeometry(0.15, 0.24, 0.05), { gradH: 0.24, strength: 0.32, upBoost: 0.15 }),
      std('#ffffff', { vertexColors: true, emissive: tint, emissiveIntensity: 0.2 }),
      RUNE_N
    )
    runes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    runes.frustumCulled = false
    const RUNE_A = [-0.35, 0.45, 1.1, 1.7, 3.3, 3.62] // 균등 배치를 피한 손맛 — 3.9 는 땅에 묻혀 뺐다
    const runeSeed = []
    const runeTone = new THREE.Color()
    for (let i = 0; i < RUNE_N; i++) {
      runeSeed.push({
        a: RUNE_A[i] + idx * 0.1,
        rad: 2.15 + hash(i * 4.7 + idx * 13) * 0.2,
        ph: hash(i * 9.3 + idx) * 6.28,
        tilt: (hash(i * 6.1 + idx * 7) - 0.5) * 0.5,
        sz: 0.75 + hash(i * 3.7 + idx * 3) * 0.5,
      })
      runeTone.set(['#b0a48e', '#9c9080', '#a49884'][i % 3])
      runes.setColorAt(i, runeTone)
    }
    root.add(runes)

    // 빛 웅덩이 — 문이 바닥에 흘리는 빛. 문 앞쪽에 둔다(문 뒤는 땅이 꺼져 내려가 뜬다).
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(2.0, 24),
      new THREE.MeshBasicMaterial({ map: poolTex, color: tint, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    )
    pool.rotation.x = -Math.PI / 2
    pool.position.set(0, 0.05, 0.8)
    root.add(pool)

    // 부유 파편 — 링 평면을 도는 잔조각. 다음 세계의 부스러기가 문가에 흩어져 있다.
    const SHARD_N = 10
    const shards = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.075, 0),
      new THREE.MeshBasicMaterial({ color: bright, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      SHARD_N
    )
    shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    shards.frustumCulled = false
    root.add(shards)
    const shardSeed = []
    for (let i = 0; i < SHARD_N; i++) {
      shardSeed.push({
        a0: (i / SHARD_N) * Math.PI * 2 + idx * 0.7,
        rad: 2.3 + hash(i * 3.1 + idx * 17) * 0.55,
        sp: 0.1 + hash(i * 5.7 + idx) * 0.12,
        sz: 0.7 + hash(i * 7.3 + idx) * 0.8,
        wob: hash(i * 9.1 + idx) * 6.28,
      })
    }

    // 발치 돌 받침 — 링이 땅에서 솟는 자리를 돌이 문다. 빛만 있으면 홀로그램, 돌이 있어야 구조물이다.
    const stones = weld([
      memb(gat(GB(0.52, 0.4, 0.46), -1.36, 0.18, 0.1, 0, 0.3), '#b0a48e'),
      memb(gat(GB(0.34, 0.62, 0.3), -1.24, 0.28, -0.14, 0, -0.2), '#9c9080'),
      memb(gat(GB(0.5, 0.34, 0.44), 1.34, 0.15, -0.06, 0, -0.35), '#b0a48e'),
      memb(gat(GB(0.3, 0.56, 0.28), 1.25, 0.26, 0.12, 0, 0.25), '#a49884'),
    ])
    root.add(stones)
    contactSpots.push({ x: -1.3, d: g, r: 0.55 }, { x: 1.3, d: g, r: 0.55 })

    const cursor = gateTeaser(next, g)

    gateAnims.push((walked, t) => {
      const near = g - walked
      // 멀면 안개 속에서 서서히 깨어나고, 지나간 뒤에도 잠시 서 있다 — 뒤돌아봐도 문은 그대로다
      const vis = (1 - smooth01((near - 26) / 20)) * (1 - smooth01((-near - 16) / 8))
      root.visible = vis > 0.01
      if (root.visible) {
        const approach = 1 - smooth01((near - 4) / 20) // 다가설수록 문이 밝아진다
        const breath = 0.5 + 0.5 * Math.sin(t * 1.7 + idx * 2.1)
        const pass = Math.max(0, 1 - Math.abs(near) / 3) // 통과 순간 — main 의 성장 링과 같은 자리에서 겹친다
        const core = Math.max(0, 1 - Math.abs(near) / 1.2) // 막을 실제로 찢고 지나는 반 박자
        // 지나고 나면 빠르게 스러진다 — 카메라(로봇 뒤 8.8m)가 문틀에 닿기 전에.
        // 안 그러면 화면을 가로지르는 거대한 호가 몇 걸음이나 남는다. walked 의 순수 함수라 되감아도 성립.
        const linger = 1 - 0.9 * smooth01((-near - 1.5) / 4.5)
        ring.material.opacity = (0.5 + 0.35 * approach + 0.05 * breath) * vis * linger
        halo.material.opacity = (0.08 + 0.3 * approach * (0.55 + 0.45 * breath) + 0.55 * pass) * vis * linger
        // 몸이 닿는 순간 막이 걷힌다 — 로봇을 가로지르는 절단면을 남기지 않는 방법이기도 하다
        membrane.material.opacity = (0.42 + 0.4 * approach + 0.08 * breath) * (1 - 0.8 * core) * vis * linger
        // 막 일렁임 — 둘레가 수면처럼 넘실대고, 안의 하늘은 좌우로 인다. t 만의 파형이라 되감아도 같다.
        for (let i = 1; i < memPos.count; i++) {
          const [r0, a0] = memBase[i]
          const w = 1 + 0.06 * Math.sin(a0 * 3 + t * 1.5 + idx * 2.1) + 0.032 * Math.sin(a0 * 5 - t * 2.3)
          memPos.setXY(i, Math.cos(a0) * r0 * w, Math.sin(a0) * r0 * w)
        }
        memPos.needsUpdate = true
        membrane.material.map.rotation = 0.1 * Math.sin(t * 0.55 + idx * 1.7)
        // 이중 호 — 반대 방향의 느린 회전. 통과 순간 안쪽 호가 같이 밝아진다.
        arcsIn.rotation.z = t * 0.1 + idx * 1.3
        arcsOut.rotation.z = -t * 0.07 + idx * 2.2
        arcsIn.material.opacity = (0.14 + 0.3 * approach * (0.7 + 0.3 * breath) + 0.25 * pass) * vis * linger
        arcsOut.material.opacity = (0.08 + 0.2 * approach + 0.15 * pass) * vis * linger
        // 룬돌 — 제 각도 언저리에서 느리게 떠돈다. 다가서면 새김이 문 색으로 달아오른다.
        runes.material.emissiveIntensity = 0.1 + 0.35 * approach + 0.5 * pass
        for (let i = 0; i < RUNE_N; i++) {
          const rs = runeSeed[i]
          const a = rs.a + Math.sin(t * 0.4 + rs.ph) * 0.05
          seat.position.set(
            Math.cos(a) * rs.rad,
            CY + Math.sin(a) * rs.rad + Math.sin(t * 0.8 + rs.ph * 2) * 0.06,
            0.12 * Math.sin(rs.ph)
          )
          seat.rotation.set(0, Math.sin(t * 0.45 + rs.ph) * 0.35, rs.tilt + Math.sin(t * 0.65 + rs.ph) * 0.08)
          seat.scale.setScalar(rs.sz)
          seat.updateMatrix()
          runes.setMatrixAt(i, seat.matrix)
        }
        runes.instanceMatrix.needsUpdate = true
        pool.material.opacity = (0.1 + 0.26 * approach + 0.5 * pass) * vis
        const pop = 1 + 0.05 * pass
        ring.scale.setScalar(pop)
        membrane.scale.setScalar(pop)
        halo.scale.setScalar(1 + 0.025 * breath + 0.12 * pass)
        echo.material.opacity = (0.05 + 0.16 * approach + 0.2 * pass) * vis * linger
        shards.material.opacity = (0.2 + 0.45 * approach) * vis * linger
        for (let i = 0; i < SHARD_N; i++) {
          const sd = shardSeed[i]
          const a = sd.a0 + t * sd.sp
          seat.position.set(
            Math.cos(a) * sd.rad,
            CY + Math.sin(a) * sd.rad * 0.9,
            Math.sin(t * 0.7 + sd.wob) * 0.18
          )
          seat.rotation.set(t * 0.8 + i, t * 0.6 + i * 2.1, 0)
          seat.scale.setScalar(sd.sz)
          seat.updateMatrix()
          shards.setMatrixAt(i, seat.matrix)
        }
        shards.instanceMatrix.needsUpdate = true
      }
      if (cursor) cursor.material.opacity = (t % 1.06) < 0.55 ? 0.9 : 0.05
    })
  }
  // ── 경계 1 전용 — 물의 문. 산뜻한 출발의 세계는 빛의 링이 아니라 물이 문을 연다. ──
  // 좌우에서 솟은 두 갈래 물결이 마루에서 어긋나게 만나 아치가 되고, 마루에서 물보라가 흩날린다.
  // 링 계열(이중 호·룬돌)은 존2~4 의 것 — 존1은 이 세계의 재료(바다)가 그대로 문이 된다.
  function gateWavePortal() {
    const g = gateOf(0)
    const next = premises[1]
    const root = new THREE.Group()
    root.position.set(0, trackY(g), -g)
    group.add(root)

    const UP = new THREE.Vector3(0, 1, 0)
    const DEEP = new THREE.Color('#1a5fb4')
    const LIT = new THREE.Color('#7fb8e8')
    // 물결 팔 하나 — 굵기가 잦아드는 원기둥 사슬. 곧은 튜브가 아니라 손으로 구부린 물줄기.
    // lift·hook 으로 좌우 높이와 말림을 다르게 — 대칭 아치는 기계고, 어긋난 아치가 파도다.
    function armParts(side, lift, hook) {
      const P = [
        [2.42, 0.02, 0], [2.34, 0.85, 0.05], [2.1, 1.7, -0.06], [1.66, 2.45, 0.05],
        [1.0, 3.0, -0.04], [0.3, 3.3 * lift, 0.05], [-0.32, 3.42 * lift, 0], [-hook, 3.22 * lift, -0.05],
      ].map(([x, y, z]) => new THREE.Vector3(side * x, y, z))
      const parts = []
      const col = new THREE.Color()
      for (let i = 0; i < P.length - 1; i++) {
        const u0 = i / (P.length - 1)
        const dir = new THREE.Vector3().subVectors(P[i + 1], P[i])
        const len = dir.length()
        const r = (u) => 0.36 * (1 - 0.76 * u)
        const seg = new THREE.CylinderGeometry(r((i + 1) / (P.length - 1)), r(u0), len, 6, 1, true)
        seg.translate(0, len / 2, 0)
        seg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()))
        seg.translate(P[i].x, P[i].y, P[i].z)
        // 발치는 깊은 물, 마루로 갈수록 빛이 통과한 물 — 파도 단면의 명도 계단.
        // 지수 1.8 — 아래 2/3 가 확실히 깊은 물이어야 유리 세공이 아니라 바닷물이다.
        col.copy(DEEP).lerp(LIT, Math.pow(u0, 1.8))
        parts.push(paint(seg.toNonIndexed(), '#' + col.getHexString()))
      }
      // 마루 물거품 — 부서지기 직전의 흰 살. 꼭대기 세 덩이가 실루엣을 깬다.
      for (let k = 0; k < 3; k++) {
        const p = P[P.length - 1 - k]
        const f = new THREE.IcosahedronGeometry(0.17 - k * 0.035, 0)
        f.translate(p.x + (hash(k * 7.1 + side) - 0.5) * 0.1, p.y + 0.12, p.z)
        parts.push(paint(f.toNonIndexed(), '#eaf3fc'))
      }
      // 발치 물더미 — 물이 끌려 올라간 자리가 부풀어야 팔이 땅에서 "솟는다"
      const mound = new THREE.IcosahedronGeometry(0.62, 0)
      mound.scale(1.25, 0.5, 1.1)
      mound.translate(side * 2.35, 0.06, 0)
      parts.push(paint(mound.toNonIndexed(), '#3a7cc9'))
      return parts
    }
    const arms = new THREE.Mesh(
      mergeGeometries([...armParts(1, 1, 0.85), ...armParts(-1, 0.94, 0.55)], false),
      // fog:false — 문은 안개 커튼 너머에서도 그 존의 색으로 서 있어야 한다(링과 같은 규칙)
      std('#ffffff', {
        vertexColors: true, roughness: 0.35, transparent: true, opacity: 0.92,
        emissive: '#a6ccf2', emissiveIntensity: 0.1, fog: false,
      })
    )
    root.add(arms)
    const armsBase = arms.geometry.attributes.position.array.slice()

    // 막 — 다음 존의 하늘. 아치 개구부(폭 ~3.6)에 맞춘 원판, 형태만 물의 문에 통합된다.
    const membrane = new THREE.Mesh(
      new THREE.CircleGeometry(1.75, 48),
      // 존1 예외 — 막도 물빛. 깊은 파랑에서 밝은 물빛으로, 물의 문 안쪽은 물속이다.
      new THREE.MeshBasicMaterial({ map: portalSkyTexture(0, ['#1a5fb4', '#7fb8e8']), transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, fog: false })
    )
    membrane.position.y = 1.65
    membrane.material.map.center.set(0.5, 0.5)
    root.add(membrane)
    const memPos = membrane.geometry.attributes.position
    const memBase = []
    for (let i = 0; i < memPos.count; i++) {
      memBase.push([Math.hypot(memPos.getX(i), memPos.getY(i)), Math.atan2(memPos.getY(i), memPos.getX(i))])
    }

    // 물보라 — 마루에서 바깥으로 튀어 포물선을 그리는 물방울. 링의 궤도 파편과 문법이 다르다.
    const SPRAY_N = 12
    const spray = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.055, 0),
      new THREE.MeshBasicMaterial({ color: '#eef6fd', transparent: true, opacity: 0.8, depthWrite: false, fog: false }),
      SPRAY_N
    )
    spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    spray.frustumCulled = false
    root.add(spray)
    const spraySeed = []
    for (let i = 0; i < SPRAY_N; i++) {
      const s = i % 2 ? 1 : -1
      spraySeed.push({
        s,
        x0: -s * (0.1 + hash(i * 3.7) * 0.6), // 제 팔의 마루 언저리에서
        y0: 3.0 + hash(i * 5.1) * 0.4,
        z0: (hash(i * 11.3) - 0.5) * 0.3,
        vx: -s * (0.5 + hash(i * 7.3) * 0.8), // 마루를 넘어 바깥으로
        sp: 0.35 + hash(i * 9.7) * 0.3,
        ph: hash(i * 13.1),
      })
    }

    // 빛 웅덩이 — 젖은 바닥의 반사광. 문 앞에 고인다.
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(2.0, 24),
      new THREE.MeshBasicMaterial({ map: poolTex, color: '#7fb8e8', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    )
    pool.rotation.x = -Math.PI / 2
    pool.position.set(0, 0.05, 0.8)
    root.add(pool)

    // 발치 표류목 — 물가에 밀려온 나무가 팔 밑동에 걸려 누워 있다. 세워 두면 공중에 뜬
    // 막대로 읽힌다 — 거의 수평(rz≈1.5)으로 눕히고 바닥에 붙인다. 물의 문에도 뭍의 받침.
    const drift = weld([
      memb(gat(GC(0.06, 0.09, 1.6, 5), -2.66, 0.1, 0.3, 0, 0.55, 1.5), '#b6926a'),
      memb(gat(GC(0.05, 0.075, 1.2, 5), -2.3, 0.08, -0.3, 0, -0.8, 1.52), '#a9885f'),
      memb(gat(GC(0.055, 0.085, 1.45, 5), 2.58, 0.09, -0.2, 0, 0.95, -1.5), '#bb9770'),
      memb(gat(GB(0.4, 0.28, 0.36), 2.32, 0.12, 0.34, 0, 0.4), '#b0a48e'),
    ])
    root.add(drift)
    contactSpots.push({ x: -2.4, d: g, r: 0.6 }, { x: 2.4, d: g, r: 0.6 })

    const cursor = gateTeaser(next, g)

    gateAnims.push((walked, t) => {
      const near = g - walked
      const vis = (1 - smooth01((near - 26) / 20)) * (1 - smooth01((-near - 16) / 8))
      root.visible = vis > 0.01
      if (root.visible) {
        const approach = 1 - smooth01((near - 4) / 20)
        const breath = 0.5 + 0.5 * Math.sin(t * 1.7)
        const pass = Math.max(0, 1 - Math.abs(near) / 3)
        const core = Math.max(0, 1 - Math.abs(near) / 1.2)
        const linger = 1 - 0.9 * smooth01((-near - 1.5) / 4.5)
        // 물결 스웨이 — 정점이 높이에 비례해 파도의 위상을 탄다. t 만의 파형이라 되감아도 같다.
        const ap = arms.geometry.attributes.position
        for (let i = 0; i < ap.count; i++) {
          const bx = armsBase[i * 3]
          const by = armsBase[i * 3 + 1]
          const bz = armsBase[i * 3 + 2]
          const k = Math.min(1, by / 3.2)
          ap.array[i * 3] = bx + Math.sin(by * 1.6 + t * 2.1) * 0.07 * k
          ap.array[i * 3 + 1] = by + Math.sin(bx * 2.2 + t * 2.7) * 0.045 * k
          ap.array[i * 3 + 2] = bz + Math.cos(by * 1.3 + t * 1.7) * 0.06 * k
        }
        ap.needsUpdate = true
        arms.material.opacity = (0.58 + 0.34 * approach) * vis * linger
        // 통과 순간 물이 빛을 머금는다 — 링의 후광 폭발에 해당하는 한 박자
        arms.material.emissiveIntensity = 0.06 + 0.18 * approach * (0.6 + 0.4 * breath) + 0.7 * pass
        // 막 — 링 게이트와 같은 문법: 접근하며 짙어지고, 몸이 닿는 순간 걷힌다
        membrane.material.opacity = (0.42 + 0.4 * approach + 0.08 * breath) * (1 - 0.8 * core) * vis * linger
        for (let i = 1; i < memPos.count; i++) {
          const [r0, a0] = memBase[i]
          const w = 1 + 0.06 * Math.sin(a0 * 3 + t * 1.5) + 0.032 * Math.sin(a0 * 5 - t * 2.3)
          memPos.setXY(i, Math.cos(a0) * r0 * w, Math.sin(a0) * r0 * w)
        }
        memPos.needsUpdate = true
        membrane.material.map.rotation = 0.1 * Math.sin(t * 0.55)
        // 물보라 — 마루에서 솟아 바깥으로 떨어지는 포물선. 위상은 t 의 나머지 연산.
        spray.material.opacity = (0.25 + 0.55 * approach) * vis * linger
        for (let i = 0; i < SPRAY_N; i++) {
          const sd = spraySeed[i]
          const u = (t * sd.sp + sd.ph) % 1
          seat.position.set(
            sd.x0 + sd.vx * u,
            sd.y0 + 1.1 * u - 2.4 * u * u,
            sd.z0
          )
          seat.rotation.set(t * 1.3 + i, 0, t * 0.9 + i * 2.1)
          seat.scale.setScalar(Math.max(0.001, (1 - u * 0.6) * (0.7 + hash(i * 5.3) * 0.6)))
          seat.updateMatrix()
          spray.setMatrixAt(i, seat.matrix)
        }
        spray.instanceMatrix.needsUpdate = true
        pool.material.opacity = (0.08 + 0.2 * approach + 0.45 * pass) * vis
      }
      if (cursor) cursor.material.opacity = (t % 1.06) < 0.55 ? 0.9 : 0.05
    })
  }

  // ── 경계 2 전용 — 모래의 문. 이 존의 재료는 사암과 바람이다. ──
  // 마주 기울어 선 두 사암 기둥. 꼭대기는 끝내 닿지 않고, 그 틈을 바람이 실어 온 모래가 건너
  // 아치를 잇는다 — 문을 완성하는 건 돌이 아니라 계속 부는 바람이다.
  // 링 계열(이중 호·룬돌)은 존3~4 의 것 — 존1이 물로 문을 열었듯, 존2 는 모래로 연다.
  function gateSandPortal() {
    const g = gateOf(1)
    const next = premises[2]
    const root = new THREE.Group()
    root.position.set(0, trackY(g), -g)
    group.add(root)

    // 층리 — 무른 층은 더 깎이고 단단한 층은 남는다. 색 계단이 곧 세월의 눈금이다.
    const STRATA = ['#c19a6b', '#b4915c', '#cfb083', '#a9834f']
    const H0 = 3.9
    const FOOT = 2.32 // 발치 — 로봇(|x|<0.5)도 카메라(x≈-2.1)도 지나갈 자리를 비워 둔다
    const LEAN = 0.3 // 발치를 축으로 안쪽으로 기운 각. 꼭대기 사이 2.0m 가 바람의 몫이다.
    // 바위 하나는 하나의 덩어리다. 상자를 쌓아 올리면 아무리 색을 입혀도 벽돌탑으로 읽힌다 —
    // 오각 프리즘 한 덩이를 발치 기준으로 기울이고, 그 위에 층리 선반만 얹는다.
    const onAxis = (geo, side, hLocal, twist) => {
      geo.translate(0, hLocal, 0)
      if (twist) geo.rotateY(twist)
      geo.rotateZ(side * LEAN)
      geo.translate(side * FOOT, 0, 0)
      return geo
    }
    function pillarParts(side, tall, twist) {
      const parts = []
      const H = H0 * tall
      const rAt = (h) => 0.66 - 0.34 * (h / H0) // 위로 갈수록 가늘어진다
      const body = GC(rAt(H), 0.68, H, 5)
      parts.push(memb(onAxis(body, side, H / 2, twist), STRATA[0], { gradH: H * 0.85, strength: 0.34, upBoost: 0.12, floorY: -0.2 }))
      // 층리 선반 — 단단한 층만 남아 옆구리로 튀어나온 자리. 표면이 깎인 면이 되는 건 이것 때문이다.
      for (let i = 0; i < 3; i++) {
        const h = H * (0.2 + i * 0.26) + hash(i * 3.9 + side) * 0.14
        const r = rAt(h)
        parts.push(
          memb(
            onAxis(GC(r + 0.03, r + 0.08, 0.12 + hash(i * 4.3) * 0.05, 5), side, h, twist + (hash(i * 6.1) - 0.5) * 0.3),
            STRATA[1 + (i % 3)],
            { gradH: 0.34, strength: 0.36 }
          )
        )
      }
      // 부리 — 꼭대기가 틈 쪽으로 더 뻗다 끊긴다. 잇지 못한 그 한 뼘이 이 문의 형태다.
      const beak = GC(0.16, rAt(H) + 0.02, 0.62, 5)
      beak.rotateZ(side * 0.42)
      parts.push(memb(onAxis(beak, side, H + 0.2, twist), STRATA[2]))
      // 바람이 쌓아 놓은 발치 모래 — 기둥이 땅에 박힌 게 아니라 모래에 묻혀 서 있어야 한다
      const drift = new THREE.IcosahedronGeometry(0.95, 0)
      drift.scale(1.5, 0.3, 1.25)
      drift.translate(side * (FOOT + 0.1), 0.0, side * 0.3)
      parts.push(memb(drift.toNonIndexed(), '#e0c99c'))
      return parts
    }
    // 한쪽이 낮고 더 깎였다 — 대칭 아치는 유적이 아니라 조형물이다.
    // 불투명 + 안개 적용 — 빛으로 된 문(존3~4)과 달리 이건 돌이다. 반투명하게 두면 겹친
    // 상자 속면이 다 비쳐 종이 상자가 된다. 대신 멀리서부터 안개 속에 서 있어, 팝인이 없다.
    const pillars = weld([...pillarParts(1, 1, 0.15), ...pillarParts(-1, 0.88, -0.22)])
    pillars.material.emissive = new THREE.Color('#c08a3c')
    pillars.material.emissiveIntensity = 0
    root.add(pillars)

    // 무너진 층 하나 — 문 옆에 떨어져 반쯤 묻혔다. 이 문은 지금도 깎이는 중이다.
    const fallen = weld([
      memb(gat(GB(0.86, 0.3, 0.7), -2.95, 0.1, 1.15, 0.1, 0.4, 0.18), '#b4915c'),
      memb(gat(GB(0.5, 0.22, 0.44), -2.5, 0.06, 1.5, 0, -0.3, -0.1), '#c8a97c'),
      memb(gat(GB(0.42, 0.26, 0.38), 2.9, 0.08, -1.3, 0, 0.6, 0.12), '#a9834f'),
    ])
    root.add(fallen)

    // 막 — 틈 너머로 비치는 잿빛 도시. 돌은 이 존의 것이고, 문 안쪽만 다음 존이다.
    // 원판을 늘여 놓으면 문이 아니라 알이 된다. 두 기둥의 안쪽 면과 지면이 만드는
    // 실제 개구부 모양 그대로 부채꼴을 짠다 — 틈이 곧 문의 형태여야 한다.
    const MEM_CY = 1.6
    const innerX = (y, side, tall) => {
      const hAxis = Math.min(y / Math.cos(LEAN), H0 * tall)
      return side * (FOOT - hAxis * Math.sin(LEAN) - (0.66 - 0.34 * (hAxis / H0)) + 0.06)
    }
    const openingGeo = (() => {
      // 개구부 폴리곤 — 오른 기둥을 따라 올라가 두 부리 사이를 건너고 왼 기둥을 따라 내려온다
      const poly = []
      const YS = [0.06, 0.7, 1.5, 2.3, 3.0, 3.45]
      for (const y of YS) poly.push(new THREE.Vector2(innerX(y, 1, 1), y))
      for (let i = YS.length - 1; i >= 0; i--) poly.push(new THREE.Vector2(innerX(Math.min(YS[i], 3.02), -1, 0.88), Math.min(YS[i], 3.02)))
      // 중심에서 각 방향으로 쏜 광선이 폴리곤과 만나는 점 — 부채꼴 정점이 된다
      const hit = (ang) => {
        const dx = Math.cos(ang)
        const dy = Math.sin(ang)
        let best = 6
        for (let i = 0; i < poly.length; i++) {
          const p1 = poly[i]
          const p2 = poly[(i + 1) % poly.length]
          const ex = p2.x - p1.x
          const ey = p2.y - p1.y
          const den = dx * ey - dy * ex
          if (Math.abs(den) < 1e-6) continue
          const rx = p1.x - 0
          const ry = p1.y - MEM_CY
          const s = (rx * ey - ry * ex) / den
          const tt = (rx * dy - ry * dx) / den
          if (s > 0.05 && tt >= 0 && tt <= 1) best = Math.min(best, s)
        }
        return Math.min(best, 5)
      }
      const N = 56
      const pos = [0, 0, 0]
      const uv = [0.5, 0.5]
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2
        const r = hit(a) * 0.985 // 돌 면에 살짝 못 미치게 — 겹치면 z-파이팅이 난다
        const x = Math.cos(a) * r
        const y = Math.sin(a) * r
        pos.push(x, y, 0)
        uv.push(0.5 + x / 4, 0.5 + y / 5)
      }
      const idx = []
      for (let i = 1; i <= N; i++) idx.push(0, i, i + 1)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      geo.setIndex(idx)
      geo.computeVertexNormals()
      return geo
    })()
    const membrane = new THREE.Mesh(
      openingGeo,
      // color 로 한 단 눌러 놓는다 — 볕 센 사막 한가운데서 밝은 막은 유리구슬로 읽힌다.
      // 문 안쪽이 바깥보다 어두워야 "저쪽은 다른 세계"가 명암으로 먼저 읽힌다.
      new THREE.MeshBasicMaterial({ color: '#77828e', map: portalSkyTexture(1), transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, fog: false })
    )
    membrane.position.y = MEM_CY
    membrane.material.map.center.set(0.5, 0.5)
    root.add(membrane)
    const memPos = membrane.geometry.attributes.position
    const memBase = []
    for (let i = 0; i < memPos.count; i++) {
      memBase.push([Math.hypot(memPos.getX(i), memPos.getY(i)), Math.atan2(memPos.getY(i), memPos.getX(i))])
    }

    // 모래 다리 — 낮은 기둥 마루에서 높은 기둥 마루로 건너가는 모래 줄기.
    // 마루 위로 부풀어 올랐다 떨어지는 포물선. 낱알이 아니라 흐름으로 읽히도록 길게 늘인다.
    // 두 부리 끝을 잇는다 — 기울인 기둥의 꼭대기(발치 기준 회전의 결과)를 그대로 받아 적는다
    const tipAt = (side, tall) => {
      const H = H0 * tall + 0.5
      return new THREE.Vector3(side * (FOOT - H * Math.sin(LEAN)) - side * 0.16, H * Math.cos(LEAN), -side * 0.05)
    }
    const A = tipAt(-1, 0.88)
    const B = tipAt(1, 1)
    const bridgeAt = (u, off) => new THREE.Vector3(
      A.x + (B.x - A.x) * u,
      A.y + (B.y - A.y) * u + Math.sin(Math.PI * u) * (0.34 + off * 0.34),
      A.z + (B.z - A.z) * u + off * 0.7
    )
    const GRAIN_N = 34
    const grains = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.065, 0),
      new THREE.MeshBasicMaterial({ color: '#e8d0a2', transparent: true, opacity: 0.85, depthWrite: false, fog: false }),
      GRAIN_N
    )
    grains.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    grains.frustumCulled = false
    root.add(grains)
    const grainSeed = []
    for (let i = 0; i < GRAIN_N; i++) {
      grainSeed.push({
        off: (hash(i * 3.3) - 0.5) * 1.0, // 줄기의 두께 — 한 줄로 서면 실이지 모래가 아니다
        sp: 0.26 + hash(i * 5.9) * 0.26,
        ph: hash(i * 7.1),
        len: 2.2 + hash(i * 9.7) * 2.6, // 늘인 정도가 곧 그 알의 속도로 읽힌다
        sz: 0.6 + hash(i * 11.3) * 0.7,
      })
    }

    // 마루에서 흩날려 떨어지는 모래 — 다리에서 새어 나온 것. 문 앞 땅으로 사라진다.
    const FALL_N = 10
    const falls = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.04, 0),
      new THREE.MeshBasicMaterial({ color: '#e3cb9e', transparent: true, opacity: 0.55, depthWrite: false, fog: false }),
      FALL_N
    )
    falls.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    falls.frustumCulled = false
    root.add(falls)
    const fallSeed = []
    for (let i = 0; i < FALL_N; i++) {
      fallSeed.push({ u: 0.15 + hash(i * 4.1) * 0.7, sp: 0.3 + hash(i * 6.7) * 0.25, ph: hash(i * 8.3), sw: (hash(i * 10.1) - 0.5) * 0.5 })
    }

    // 문이 바닥에 흘리는 빛 — 다른 문과 같은 문법, 색만 이 존의 볕이다
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(2.1, 24),
      new THREE.MeshBasicMaterial({ map: poolTex, color: '#e8c98d', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    )
    pool.rotation.x = -Math.PI / 2
    pool.position.set(0, 0.05, 0.9)
    root.add(pool)

    contactSpots.push({ x: -2.4, d: g, r: 0.7 }, { x: 2.4, d: g, r: 0.7 })

    const cursor = gateTeaser(next, g)

    gateAnims.push((walked, t) => {
      const near = g - walked
      // 돌은 안개 속에 먼저 서 있다 — 멀리서 보이는 목적지가 곧 걷는 이유가 된다.
      // 사라지는 건 문의 연출(막·모래·빛)뿐이고, 지나온 뒤 뒤돌아보면 돌은 그대로 있다.
      const vis = 1 - smooth01((-near - 26) / 10)
      root.visible = near < 90 && vis > 0.01
      if (root.visible) {
        const approach = 1 - smooth01((near - 4) / 20)
        const breath = 0.5 + 0.5 * Math.sin(t * 1.5 + 1.2)
        const pass = Math.max(0, 1 - Math.abs(near) / 3)
        const core = Math.max(0, 1 - Math.abs(near) / 1.2)
        const linger = 1 - 0.9 * smooth01((-near - 1.5) / 4.5)
        // 통과 순간 돌이 볕을 머금는다 — 물의 문에서 물이 빛나던 그 한 박자
        pillars.material.emissiveIntensity = 0.04 + 0.12 * approach * (0.6 + 0.4 * breath) + 0.5 * pass
        membrane.material.opacity = (0.24 + 0.45 * approach + 0.06 * breath) * (1 - 0.8 * core) * vis * linger
        for (let i = 1; i < memPos.count; i++) {
          const [r0, a0] = memBase[i]
          const w = 1 + 0.055 * Math.sin(a0 * 3 + t * 1.4) + 0.03 * Math.sin(a0 * 5 - t * 2.1)
          memPos.setXY(i, Math.cos(a0) * r0 * w, Math.sin(a0) * r0 * w)
        }
        memPos.needsUpdate = true
        membrane.material.map.rotation = 0.08 * Math.sin(t * 0.5)
        // 모래 다리 — 통과하는 동안 바람이 거세진다(위상은 t 의 나머지 연산이라 되감아도 같다)
        const gust = 1 + 0.9 * pass
        grains.material.opacity = (0.35 + 0.5 * approach) * vis * linger
        for (let i = 0; i < GRAIN_N; i++) {
          const gs = grainSeed[i]
          const u = (t * gs.sp * gust + gs.ph) % 1
          const p = bridgeAt(u, gs.off)
          const q = bridgeAt(Math.min(1, u + 0.02), gs.off)
          seat.position.copy(p)
          seat.rotation.set(0, 0, Math.atan2(q.y - p.y, q.x - p.x))
          // 흐름 방향으로 늘여 놓으면 낱알이 궤적이 된다 — 입자 수를 늘리는 것보다 싸다
          seat.scale.set(gs.len * gs.sz * (1 + 0.6 * pass), gs.sz * 0.7, gs.sz * 0.7)
          seat.updateMatrix()
          grains.setMatrixAt(i, seat.matrix)
        }
        grains.instanceMatrix.needsUpdate = true
        falls.material.opacity = (0.2 + 0.4 * approach) * vis * linger
        for (let i = 0; i < FALL_N; i++) {
          const fs = fallSeed[i]
          const k = (t * fs.sp * gust + fs.ph) % 1
          const p = bridgeAt(fs.u, 0)
          seat.position.set(p.x + fs.sw * k * 2, p.y - 3.6 * k * k, p.z + fs.sw * k)
          seat.rotation.set(t + i, 0, t * 0.7 + i)
          seat.scale.setScalar(Math.max(0.001, 1 - k * 0.8))
          seat.updateMatrix()
          falls.setMatrixAt(i, seat.matrix)
        }
        falls.instanceMatrix.needsUpdate = true
        pool.material.opacity = (0.08 + 0.18 * approach + 0.4 * pass) * vis
      }
      if (cursor) cursor.material.opacity = (t % 1.06) < 0.55 ? 0.9 : 0.05
    })
  }

  gateWavePortal()
  gateSandPortal()
  for (let z = 2; z < chapterCount; z++) gatePortal(z)




  // ── 경계 4 (d=254) — 부두 끝 토리이. 막을 판이 처음부터 없는 문 — 그 사실이 형태다. ──
  {
    const g4 = gateOf(3)
    const root = new THREE.Group()
    root.position.set(0, trackY(g4 - 0.5), -(g4 - 0.5))
    group.add(root)
    const ringGrp = new THREE.Group()
    ringGrp.position.set(0, trackY(g4 + 5) + 2.45, -(g4 + 5))
    const ringMain = new THREE.Mesh(
      new THREE.TorusGeometry(2.35, 0.09, 8, 48),
      new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.9, fog: false })
    )
    const ringSub = new THREE.Mesh(
      new THREE.TorusGeometry(2.62, 0.035, 6, 40),
      new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.32, fog: false })
    )
    ringSub.rotation.z = 0.25
    const membrane = new THREE.Mesh(
      new THREE.CircleGeometry(2.35, 40),
      new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
    )
    ringGrp.add(ringMain, ringSub, membrane)
    group.add(ringGrp)
    gateAnims.push((walked, t) => {
      const pass = Math.max(0, 1 - Math.abs(g4 + 5 - walked) / 3)
      membrane.material.opacity = 0.08 + 0.55 * pass * pass
      ringMain.material.opacity = 0.25 + 0.7 * (1 - smooth01((g4 + 5 - walked - 18) / 14))
      ringGrp.visible = g4 + 5 - walked < 28
      ringSub.rotation.z = 0.25 + t * 0.15
    })
  }

  // ----- 존마다 하나씩, 그 존에만 있는 것 -----




  // 존2 — 무너지지 말라고 쌓은 옹벽. 길과 나란한 연속 구조물이라 읽는 동안에도 조용하다.
  // 시작은 게이트1 12m 뒤 — 문 앞 안개 커튼의 미포그 근접 영역(카메라 22m)에 벽이 들어오면
  // 통과 전에 다음 존이 보인다. 끝은 원래대로 게이트2 너머 10m.
  {
    const z = 1
    const from = INTRO_LEN + z * ZONE_LEN // = 게이트1 + 12
    const to = INTRO_LEN + 2 * ZONE_LEN - 2
    const rows = Math.floor((to - from) / 0.95)
    const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.45, 0.9), std('#ffffff'), rows * 6)
    const tone = ['#cbab7a', '#bd9a68', '#d6bb8d'].map((c) => new THREE.Color(c))
    const capTone = new THREE.Color('#a8845a')
    const caps = new THREE.InstancedMesh(
      bakeAO(new THREE.BoxGeometry(0.66, 0.18, 1.2, 2, 1, 2), { gradH: 0.09, strength: 0.22, upBoost: 0.2, edge: 0.12 }),
      std('#ffffff', { vertexColors: true }),
      rows
    )
    let n = 0
    let cn = 0
    for (let r = 0; r < rows; r++) {
      const d = from + r * 0.95
      if (d > 132.2 && d < 135.6) continue // 게이트2(성문) 자리
      // 붕괴 틈 — 60m 내내 균질하면 벽이 아니라 텍스처다. 한 곳이 무너져 뒤로 하늘이 보인다.
      const gap = d > 117 && d < 122
      let tiers = 4 + Math.round(hash(r * 3.1) * 1.4) - Math.round(smooth01((d - (from + 46)) / 14) * 4)
      if (gap) tiers = Math.min(tiers, 1)
      for (let t = 0; t < tiers; t++) {
        seat.position.set(4.6 + t * 0.09 + (hash(r * 5 + t) - 0.5) * 0.08, trackY(d) - 0.05 + 0.22 + t * 0.45, -(d + (hash(r * 3 + t) - 0.5) * 0.36))
        seat.rotation.set(0, (hash(r * 7 + t) - 0.5) * 0.06, 0)
        seat.scale.set(0.85 + hash(r * 13 + t) * 0.45, 0.9 + hash(r * 17 + t) * 0.2, 0.9 + hash(r * 19 + t) * 0.25)
        seat.updateMatrix()
        wall.setMatrixAt(n, seat.matrix)
        wall.setColorAt(n, tone[Math.floor(hash(r * 11 + t) * 3)])
        n++
      }
      // 캡스톤 — 튀어나온 마감돌이 아래 벽면에 그림자 띠를 만든다. 톱니가 구조물이 된다.
      if (!gap && tiers >= 3 && r % 1 === 0) {
        seat.position.set(4.6 + tiers * 0.09 - 0.06, trackY(d) - 0.05 + 0.22 + (tiers - 1) * 0.45 + 0.315, -d)
        seat.rotation.set(0, (hash(r * 23) - 0.5) * 0.05, 0)
        seat.scale.set(1.05, 1, 1)
        seat.updateMatrix()
        caps.setMatrixAt(cn, seat.matrix)
        caps.setColorAt(cn, capTone)
        cn++
      }
    }
    wall.count = n
    wall.frustumCulled = false
    wall.receiveShadow = true
    wall.castShadow = true
    group.add(wall)
    caps.count = cn
    caps.frustumCulled = false
    caps.castShadow = true
    group.add(caps)

    // 틈에서 굴러떨어진 석재 — 두 개는 길 가장자리까지 온다. 길은 안 막고 위태로움만 발밑까지.
    const fallen = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.45, 0.9), std('#d8d0bd'), 9)
    for (let k = 0; k < 9; k++) {
      const fd = 116 + hash(k * 3.7) * 8
      const fx = k < 2 ? 1.9 + hash(k * 5.1) * 0.4 : 2.6 + hash(k * 5.1) * 1.8
      seat.position.set(fx, trackY(fd) + 0.14, -fd)
      seat.rotation.set((hash(k * 7.3) - 0.5) * 0.5, hash(k * 9.1) * 3.1, (hash(k * 11.7) - 0.5) * 0.7)
      seat.scale.setScalar(0.7 + hash(k * 13.3) * 0.5)
      seat.updateMatrix()
      fallen.setMatrixAt(k, seat.matrix)
    }
    fallen.frustumCulled = false
    fallen.castShadow = true
    fallen.receiveShadow = true
    group.add(fallen)

    // 물때 계단 — 바다로 내려가 안개에 잠긴다. 되풀이되는 절차의 사물.
    const stair = new THREE.Group()
    for (let k = 0; k < 7; k++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 0.55), std(k > 3 ? '#8f9a8a' : '#b0a894'))
      step.position.set(-k * 0.55, -k * 0.34, 0)
      stair.add(step)
    }
    stair.position.set(-4.4, trackY(INTRO_LEN + ZONE_LEN + 32) - 0.1, -(INTRO_LEN + ZONE_LEN + 32))
    shadowed(stair)
    group.add(stair)
  }




  // 존3 — 회색빛 도시. 건물은 크고 창은 거의 꺼져 있다. 켜진 창 하나가 외로움의 크기다.
  {
    const z = 2
    const base = INTRO_LEN + z * ZONE_LEN
    const bTone = ['#9ba1a5', '#a8adb0', '#8e9498', '#b3b7b9'].map((c) => new THREE.Color(c))
    const buildings = new THREE.InstancedMesh(
      bakeAO(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), { gradH: 0.5, strength: 0.35, upBoost: 0.12 }),
      std('#ffffff', { vertexColors: true }),
      14
    )
    let bn = 0
    const bldg = [] // 옥상 키트가 참조할 배치 기록
    for (let k = 0; k < 14; k++) {
      const side = 1 // 창 없는 민짜 박스가 되므로 건너편 실루엣은 두지 않는다
      const bd = base + 2 + hash(k * 3.7) * (ZONE_LEN + 4)
      const w = 3 + hash(k * 5.1) * 3.5
      // 높이 계급 — 균등 분포는 스카이라인을 밋밋하게 만든다
      const r = hash(k * 7.3)
      const h = r < 0.6 ? 3.5 + r * 5.5 : r < 0.9 ? 7 + (r - 0.6) * 14 : 12 + (r - 0.9) * 30
      const bx = side > 0 ? 5.5 + hash(k * 9.7) * 9 : -(11 + hash(k * 9.7) * 8)
      const gy = landH(bx, bd) - 0.35 // 지면에 앵커 — trackY 로 두면 존3 후반에 뜬다
      const dz = 2.8 + hash(k * 13.9) * 2.5
      seat.position.set(bx, gy + h / 2, -bd)
      seat.rotation.set(0, (hash(k * 11.3) - 0.5) * 0.12, 0)
      seat.scale.set(w, h, dz)
      seat.updateMatrix()
      buildings.setMatrixAt(bn, seat.matrix)
      buildings.setColorAt(bn, bTone[Math.floor(hash(k * 15.1) * 4)])
      bn++
      bldg.push({ k, side, bd, w, h, bx, gy, dz })
      // 셋백 — 상위 계급은 위에 한 단 더. 스카이라인이 계단이 된다.
      if (r > 0.72 && bn < buildings.count) {
        seat.position.set(bx, gy + h + (h * 0.38) / 2, -bd)
        seat.scale.set(w * 0.68, h * 0.38, dz * 0.68)
        seat.updateMatrix()
        buildings.setMatrixAt(bn, seat.matrix)
        buildings.setColorAt(bn, bTone[Math.floor(hash(k * 17.7) * 4)])
        bn++
      }
    }
    buildings.count = bn
    // 파라펫 — 난간턱 하나가 "잘린 슬래브"를 건물로 바꾼다
    const parapet = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std('#83898d'), 30)
    let ppn = 0
    for (const b of bldg) {
      if (b.side < 0 || ppn >= 30) continue
      seat.position.set(b.bx, b.gy + b.h + 0.11, -b.bd)
      seat.rotation.set(0, (hash(b.k * 11.3) - 0.5) * 0.12, 0)
      seat.scale.set(b.w + 0.24, 0.22, b.dz + 0.24)
      seat.updateMatrix()
      parapet.setMatrixAt(ppn++, seat.matrix)
      if (hash(b.k * 21.7) < 0.6 && ppn < 30) { // 계단탑
        seat.position.set(b.bx + (hash(b.k * 23.1) - 0.5) * b.w * 0.4, b.gy + b.h + 0.75, -b.bd)
        seat.scale.set(1.3, 1.5, 1.2)
        seat.updateMatrix()
        parapet.setMatrixAt(ppn++, seat.matrix)
      }
    }
    parapet.count = ppn
    parapet.frustumCulled = false
    group.add(parapet)
    // 실외기 — 평면 파사드에 요철이 생겨야 빛이 걸린다
    const acUnit = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.4, 0.34), std('#7f858a'), 30)
    let acn = 0
    for (const b of bldg) {
      if (b.side < 0) continue
      const rows = Math.floor(b.h / 1.6)
      for (let rr = 0; rr < rows && acn < 30; rr++) {
        if (hash(b.k * 100 + rr * 7) < 0.55) continue
        seat.position.set(
          b.bx - b.w / 2 + 0.4 + hash(b.k * 31 + rr) * (b.w - 0.8),
          b.gy + 1.0 + rr * 1.6,
          -(b.bd - b.dz / 2 - 0.19)
        )
        seat.rotation.set(0, 0, 0)
        seat.scale.set(1, 1, 1)
        seat.updateMatrix()
        acUnit.setMatrixAt(acn++, seat.matrix)
      }
    }
    acUnit.count = acn
    acUnit.frustumCulled = false
    group.add(acUnit)
    buildings.frustumCulled = false
    buildings.castShadow = true
    buildings.receiveShadow = true
    group.add(buildings)

    // 꺼진 창들 — 격자로 어둡게. 켜진 창은 단 하나.
    const winDark = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.66, 0.06), std('#5f6468'), 150)
    let wn = 0
    for (let k = 0; k < 14 && wn < 150; k++) {
      const bd = base + 2 + hash(k * 3.7) * (ZONE_LEN + 4)
      const w = 3 + hash(k * 5.1) * 3.5
      const rW = hash(k * 7.3)
      const h = rW < 0.6 ? 3.5 + rW * 5.5 : rW < 0.9 ? 7 + (rW - 0.6) * 14 : 12 + (rW - 0.9) * 30
      const bx = 5.5 + hash(k * 9.7) * 9
      const gy = landH(bx, bd) - 0.35
      const cols = Math.floor(w / 1.1)
      const rows = Math.floor(h / 1.5)
      for (let c = 0; c < cols && wn < 150; c++) {
        for (let r = 0; r < rows && wn < 150; r++) {
          if (hash(k * 100 + c * 10 + r) < 0.35) continue
          seat.position.set(
            bx - w / 2 + 0.7 + c * 1.1,
            gy + 1.1 + r * 1.5,
            -(bd - (1.4 + hash(k * 13.9) * 1.25) - 0.04)
          )
          seat.rotation.set(0, 0, 0)
          seat.scale.set(1, 1, 1)
          seat.updateMatrix()
          winDark.setMatrixAt(wn, seat.matrix)
          wn++
        }
      }
    }
    winDark.count = wn
    winDark.frustumCulled = false
    group.add(winDark)
    const winLit = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.66, 0.07),
      std('#ffe9a0', { emissive: '#ffce7a', emissiveIntensity: 1.1 })
    )
    const litD = base + 30
    winLit.position.set(7.2, landH(7.2, litD) + 4.3, -(litD - 1.9))
    group.add(winLit)

    // 차가운 가로등 — 도시의 불빛은 따뜻하지 않다
    for (let k = 0; k < 4; k++) {
      const ld = base + 8 + k * 14
      const lamp = new THREE.Group()
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.055, 3.4, 6), std('#7a8288'))
      pole.position.y = 1.7
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.045, 0.045), std('#7a8288'))
      arm.position.set(-0.24, 3.36, 0)
      arm.rotation.z = 0.18
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.075, 0.16, 6), std('#5f6468'))
      housing.position.set(-0.47, 3.28, 0)
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 8, 6),
        std('#eef4f6', { emissive: '#cfe0e4', emissiveIntensity: 0.9 })
      )
      bulb.position.set(-0.47, 3.2, 0)
      lamp.add(pole, arm, housing, bulb)
      lamp.position.set(2.6, trackY(ld) - 0.05, -ld)
      addProp(lamp, ld, 0.4)
    }

    // 빈 벤치 — 앉을 사람이 없다
    const bench = new THREE.Group()
    const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.45), std('#8a7358'))
    benchSeat.position.y = 0.42
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 0.06), std('#8a7358'))
    back.position.set(0, 0.72, -0.2)
    back.rotation.x = -0.15
    for (const lx of [-0.6, 0.6]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.4), std('#5f6468'))
      leg.position.set(lx, 0.21, 0)
      bench.add(leg)
    }
    bench.add(benchSeat, back)
    bench.position.set(2.7, trackY(base + 38) - 0.05, -(base + 38))
    bench.rotation.y = -0.35
    addProp(bench, base + 38, 0.8)

    // 장미 한 송이 — 건물 사이, 이 도시의 유일한 색
    {
      const rose = new THREE.Group()
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.026, 0.72, 5), std('#4e7a4a'))
      stem.position.y = 0.36
      rose.add(stem)
      for (const [ly, lr] of [[0.3, 1.9], [0.46, -1.6]]) {
        const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.09, 5), std('#5a8a54', { side: THREE.DoubleSide }))
        leaf.position.set(Math.sin(lr) * 0.1, ly, Math.cos(lr) * 0.1)
        leaf.rotation.set(-0.9, lr, 0)
        rose.add(leaf)
      }
      // 꽃머리 — 겹으로 말린 붉은 층
      const petals = [
        [0.115, 0.72, '#c23a52'],
        [0.085, 0.78, '#d94a5f'],
        [0.055, 0.85, '#e8607a'],
      ]
      for (const [pr, py, pc] of petals) {
        const layer = new THREE.Mesh(new THREE.IcosahedronGeometry(pr, 0), std(pc, { roughness: 0.7 }))
        layer.scale.y = py
        layer.position.y = 0.78
        layer.rotation.y = pr * 20
        rose.add(layer)
      }
      rose.position.set(4.9, trackY(INTRO_LEN + 2 * ZONE_LEN + 24) - 0.05, -(INTRO_LEN + 2 * ZONE_LEN + 24))
      rose.scale.setScalar(1.25)
      addProp(rose, INTRO_LEN + 2 * ZONE_LEN + 24, 0.45)
    }

    // 벤치 옆 시든 꽃 — 도시에서 만나는 유일한 식물은 말라 있다
    const wilted = new THREE.Group()
    for (let k = 0; k < 3; k++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.4, 4), std('#8a7a5c'))
      st.position.set((k - 1) * 0.09, 0.2, (hash(k * 5.3) - 0.5) * 0.08)
      st.rotation.z = 0.5 + hash(k * 3.1) * 0.5 // 꺾여 늘어진 줄기
      const hd = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), std('#9a8468'))
      hd.position.set((k - 1) * 0.09 + 0.17 + hash(k) * 0.04, 0.32, (hash(k * 5.3) - 0.5) * 0.08)
      hd.scale.y = 0.7
      wilted.add(st, hd)
    }
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.16, 7), std('#8e9498'))
    pot.position.y = 0.08
    wilted.add(pot)
    wilted.position.set(3.6, trackY(base + 38.8) - 0.05, -(base + 38.8))
    addProp(wilted, base + 38.8, 0.3)
  }

  // 존4 — 잔잔함은 비움으로 만든다. 넓은 물, 낮은 노을, 등롱이 켜진 곧은 부교.
  // 멀리 등대 하나, 물 건너 불 켜진 집 하나. 그걸로 끝이다.
  {
    const z = 3
    const base = INTRO_LEN + z * ZONE_LEN

    const lh = lighthouse()
    lh.position.set(-7.2, trackY(base + 44) - 0.25, -(base + 44))
    addProp(lh, base + 44)

    const house = new THREE.Group()
    const hs = 1.05
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5 * hs, 1.1 * hs, 1.3 * hs), std('#eef0ee'))
    body.position.y = 0.55 * hs
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25 * hs, 0.75 * hs, 4), std('#b97a5c'))
    roof.position.y = 1.45 * hs
    roof.rotation.y = Math.PI / 4
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(0.28 * hs, 0.32 * hs, 0.03),
      std('#ffe9a0', { emissive: '#ffce7a', emissiveIntensity: 1.2 })
    )
    win.position.set(0.28 * hs, 0.52 * hs, 0.67 * hs)
    house.add(body, roof, win)
    house.position.set(10.5, landH(10.5, base + 34), -(base + 34))
    house.rotation.y = -0.3
    addProp(house, base + 34, 1.3)
  }

  // ----- 아웃트로 — 길은 미리 깔려 있지 않다 -----
  // 이 세계의 규칙은 "길은 발밑의 재료로 만들어진다"였다. 여기엔 재료가 없다.
  // 그래서 걸으면 앞에서 생겨나고, 지나가면 뒤에서 흩어진다. 미지 = 아직 걷지 않은 구간.
  const outroFrom = INTRO_LEN + chapterCount * ZONE_LEN + 3
  const endD = TOTAL - 3
  const endY = trackY(endD)
  pathFloat(9, outroFrom + 4.5)

  const GEN_N = 13 + 4
  const genSolid = new THREE.InstancedMesh(
    bakeAO(new THREE.BoxGeometry(2.2, 0.07, 0.62), { gradH: 0.07, strength: 0.26, upBoost: 0.15 }),
    std('#a98b6a', { vertexColors: true }),
    GEN_N
  )
  genSolid.frustumCulled = false
  group.add(genSolid)
  const genEdge = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.32, 0.02, 0.72),
    new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    GEN_N
  )
  genEdge.frustumCulled = false
  group.add(genEdge)
  const genD = []
  for (let i = 0; i < GEN_N; i++) genD.push(outroFrom + 9.4 + i * 0.82)
  // 광장 너머 — 마지막 프레임에 다음 한 칸이 나타나다 만 채로 남아야 "만나서 걷고 싶습니다"가 초대가 된다
  for (let i = 0; i < 4; i++) genD.push(endD + 6.2 + i * 0.95)

  // 광장 — 부교와 같은 재료의 원형 데크. 마지막에 재료가 끊기면 안 된다.
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.09, 24), std('#a98b6a'))
  plaza.position.set(0, 0.045 + endY, -endD)
  plaza.receiveShadow = true
  group.add(plaza)
  const plazaRim = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.07, 6, 40), std('#96795b'))
  plazaRim.rotation.x = Math.PI / 2
  plazaRim.position.set(0, 0.09 + endY, -endD)
  group.add(plazaRim)

  // ----- 발밑 -----
  // 개수가 문제였다. 유사 요소 225개가 동시에 잡히면 개체로도 질감으로도 안 읽혀
  // 하나하나 세어지면서 얼룩으로 보인다. 70개 아래로 내린다.
  function groundY(d, x) {
    // 스커트 윗면과 맨땅의 높이가 달라 어떤 것은 파묻히고 어떤 것은 떠 있었다 — 한 함수로 통일한다
    return Math.abs(x) < 1.9 ? trackY(d) + 0.012 : landH(x, d)
  }
  // 무리 크기를 분포로 — 고정 3포기는 "군집"이 아니라 "반복"이다
  function clusterSize(u) {
    return u < 0.38 ? 1 : u < 0.64 ? 2 : u < 0.82 ? 3 : u < 0.94 ? 5 : 8
  }

  // 돌 — L 14 / M 40 / S 는 L·M 곁에만. 홀로 놓인 10cm 는 20m 에서 3px, 정의상 노이즈다.
  const rockTone = ['#b9ac95', '#a89c88', '#c6b9a2', '#9e9384'].map((c) => new THREE.Color(c))
  const rockMeshes = [0, 1, 2].map((v) => {
    const m = new THREE.InstancedMesh(rockGeometry(v), std('#ffffff'), 120)
    m.count = 0
    m.frustumCulled = false
    m.castShadow = true
    m.receiveShadow = true
    group.add(m)
    return m
  })
  const rockN = [0, 0, 0]
  function placeRock(d, x, size, seed) {
    const v = Math.floor(hash(seed * 3.7) * 3)
    const m = rockMeshes[v]
    if (rockN[v] >= 120) return
    seat.position.set(x, groundY(d, x) - size * 0.16, -d)
    seat.rotation.set((hash(seed * 5.1) - 0.5) * 0.24, hash(seed) * 6.28, (hash(seed * 7.3) - 0.5) * 0.24)
    seat.scale.setScalar(size)
    seat.updateMatrix()
    m.setMatrixAt(rockN[v], seat.matrix)
    m.setColorAt(rockN[v], rockTone[Math.floor(hash(seed * 11.3) * 4)])
    rockN[v]++
  }
  {
    let placed = 0
    for (let i = 0; i < 400 && placed < 54; i++) {
      const d = 4 + hash(i * 3.1 + 7) * (TOTAL - 20)
      const zi = zoneOf(d)
      // 존3 은 물이라 돌이 없다. 존1·2 가 돌의 세계다.
      const p = [0.85, 1.0, 0.12, 0.3][zi]
      if (hash(i * 7.7) > p) continue
      const side = d < 105 || hash(i * 2.3) < 0.62 ? 1 : -1
      const x = side * (2.3 + Math.pow(hash(i * 5.9), 1.4) * 4.4)
      const big = hash(i * 13.1) < 0.26
      const size = big ? 1.1 + hash(i * 17.3) * 1.0 : 0.42 + hash(i * 19.7) * 0.34
      placeRock(d, x, size, i)
      placed++
      // 잔자갈은 큰 돌 곁에만 — 부속으로만 존재한다
      const kids = big ? 3 + Math.floor(hash(i * 23.1) * 3) : 0
      for (let k = 0; k < kids; k++) {
        const a = hash(i * 29 + k) * 6.28
        const r = 0.5 + hash(i * 31 + k) * 0.8
        placeRock(d + Math.sin(a) * r, x + Math.cos(a) * r, 0.14 + hash(i * 37 + k) * 0.1, i * 100 + k)
      }
    }
  }

  // 새싹 — 무리마다 크기차를 강제한다. 두 값의 반복은 군집이 아니라 패턴이다.
  const SPROUT_MAX = 140
  const sproutMesh = new THREE.InstancedMesh(
    sproutGeometry(),
    std('#ffffff', { side: THREE.DoubleSide, roughness: 0.92 }),
    SPROUT_MAX
  )
  const C_YOUNG = new THREE.Color('#d9ea9e')
  const C_MID = new THREE.Color('#9ed184')
  const C_LUSH = new THREE.Color('#63ab6d')
  const _sc = new THREE.Color()
  let sn = 0
  for (let c = 0; c < 400 && sn < SPROUT_MAX; c++) {
    const cd = 8 + hash(c * 1.7 + 61) * (TOTAL - 16)
    const life = groundLife(cd)
    if (hash(c * 9.1) > life * 0.75) continue
    if (cd < gateOf(0)) continue // 존1 은 백사장이다 — 들판의 새싹은 두지 않고, 길 위에 딱 하나만 둔다(아래)
    const side = cd < 105 || hash(c * 2.3) < 0.6 ? 1 : -1 // 바다가 있는 동안 왼편에는 심지 않는다
    const cx = side * (1.5 + Math.pow(hash(c * 5.9), 1.3) * 3.2)
    // 존1 은 큰 무리를 만들지 않는다 — 한두 포기까지. 8포기 덩어리가 곧 '징그러운 풀숲'이 된다.
    const size = cd < gateOf(0) ? (hash(c * 3.7) < 0.7 ? 1 : 2) : clusterSize(hash(c * 3.7))
    const lead = 0.9 + hash(c * 11.3) * 0.35
    for (let k = 0; k < size && sn < SPROUT_MAX; k++) {
      const d = cd + (hash(c * 100 + k) - 0.5) * (0.7 + size * 0.22)
      const x = cx + (hash(c * 100 + k + 50) - 0.5) * (0.7 + size * 0.22)
      const s = k === 0 ? lead : lead * (0.4 + hash(c * 7 + k) * 0.32)
      seat.position.set(x, groundY(d, x) - 0.02, -d)
      seat.rotation.set((hash(c * 5.1 + k) - 0.5) * 0.2, hash(c * 6.3 + k) * 6.28, (hash(c * 7.9 + k) - 0.5) * 0.2)
      seat.scale.set(s, s * (0.9 + hash(c * 17.1 + k) * 0.25), s)
      seat.updateMatrix()
      sproutMesh.setMatrixAt(sn, seat.matrix)
      const g = Math.min(1, life * 1.1)
      if (g < 0.5) _sc.copy(C_YOUNG).lerp(C_MID, g / 0.5)
      else _sc.copy(C_MID).lerp(C_LUSH, (g - 0.5) / 0.5)
      _sc.offsetHSL((hash(c * 4.9 + k) - 0.5) * 0.05, (hash(c * 5.7 + k) - 0.5) * 0.12, (hash(c * 6.5 + k) - 0.5) * 0.1)
      sproutMesh.setColorAt(sn, _sc)
      sn++
    }
  }
  // 존1 의 새싹은 딱 하나 — 길 한가운데 널 틈에서 돋는다.
  // 백사장에 흩어 놓으면 잡초지만, 사람이 밟고 지나는 판 사이에서 하나가 올라오면 그게 '시작'이다.
  {
    const d = 30
    const x = 0.42
    seat.position.set(x, trackY(d) + 0.1, -d)
    seat.rotation.set(0.05, 2.1, -0.04)
    seat.scale.set(0.85, 0.9, 0.85)
    seat.updateMatrix()
    sproutMesh.setMatrixAt(sn, seat.matrix)
    sproutMesh.setColorAt(sn, C_MID)
    sn++
  }
  sproutMesh.count = sn
  sproutMesh.frustumCulled = false
  sproutMesh.castShadow = true
  group.add(sproutMesh)

  // 풀포기 — 0.35m 와 1.5m 사이가 비어 근경이 한 겹으로 무너져 있었다
  const TUFT_MAX = 36
  const tuftMesh = new THREE.InstancedMesh(tuftGeometry(), std('#ffffff', { side: THREE.DoubleSide }), TUFT_MAX)
  const tuftTone = ['#a8bc8a', '#93ac7c', '#bcc894', '#88a074'].map((c) => new THREE.Color(c))
  let tn = 0
  for (let i = 0; i < 300 && tn < TUFT_MAX; i++) {
    const d = 10 + hash(i * 2.9 + 13) * (TOTAL - 20)
    const lifeT = groundLife(d)
    if (lifeT < 0.12 || hash(i * 6.1) > lifeT * 0.9) continue
    if (d < gateOf(0)) continue // 존1 에 풀포기 없음 — 첫 장면의 초록은 새싹 몇 포기로 충분하다
    const side = d < 105 || hash(i * 4.7) < 0.55 ? 1 : -1
    const x = side * (2.0 + Math.pow(hash(i * 8.3), 1.3) * 4.6)
    const s = 0.7 + Math.pow(hash(i * 12.7), 0.7) * 0.65
    seat.position.set(x, groundY(d, x) - 0.03, -d)
    seat.rotation.set(0, hash(i * 9.1) * 6.28, 0)
    seat.scale.set(s, s * (0.85 + hash(i * 14.3) * 0.4), s)
    seat.updateMatrix()
    tuftMesh.setMatrixAt(tn, seat.matrix)
    tuftMesh.setColorAt(tn, tuftTone[Math.floor(hash(i * 15.9) * 4)])
    tn++
  }
  tuftMesh.count = tn
  tuftMesh.frustumCulled = false
  tuftMesh.castShadow = true
  group.add(tuftMesh)

  // 꽃 — 마지막 140m 에 60송이. 채도는 땅(0.165)의 두 배를 넘지 않는다.
  const FLOWER_MAX = 60
  const headMesh = new THREE.InstancedMesh(
    flowerHeadGeometry(),
    std('#ffffff', { side: THREE.DoubleSide, vertexColors: true }),
    FLOWER_MAX
  )
  const stemMesh = new THREE.InstancedMesh(
    flowerStemGeometry(),
    std('#7fae70', { side: THREE.DoubleSide }),
    FLOWER_MAX
  )
  const petal = [
    ['#fbf4e6', 0.4], ['#f3ddb8', 0.2], ['#eeb9b4', 0.2], ['#d9a7c0', 0.12], ['#e07a86', 0.08],
  ].map(([c, w]) => [new THREE.Color(c), w])
  function pickWeighted(list, u) {
    let acc = 0
    for (const [c, w] of list) {
      acc += w
      if (u <= acc) return c
    }
    return list[0][0]
  }
  const bloomFrom = TOTAL - 140
  let fn = 0
  for (let c = 0; c < 300 && fn < FLOWER_MAX; c++) {
    const cd = bloomFrom + hash(c * 2.7 + 5) * 140
    if (hash(c * 4.3) > 0.08 + 0.4 * smooth01((cd - bloomFrom) / 120)) continue
    const side = hash(c * 6.9) < 0.5 ? 1 : -1
    const cx = side * (1.5 + Math.pow(hash(c * 8.1), 1.4) * 2.6)
    if (Math.hypot(cx, cd - endD) < 4.2) continue
    const size = clusterSize(hash(c * 3.1))
    const lead = 0.95 + hash(c * 9.3) * 0.45
    const tone = pickWeighted(petal, hash(c * 7.3))
    for (let k = 0; k < size && fn < FLOWER_MAX; k++) {
      const d = cd + (hash(c * 100 + k) - 0.5) * (0.6 + size * 0.2)
      const x = cx + (hash(c * 100 + k + 50) - 0.5) * (0.6 + size * 0.2)
      const s = k === 0 ? lead : lead * (0.45 + hash(c * 7 + k) * 0.3)
      seat.position.set(x, groundY(d, x) - 0.02, -d)
      seat.rotation.set(0, hash(c * 8.3 + k) * 6.28, (hash(c * 10.9 + k) - 0.5) * 0.24)
      seat.scale.setScalar(s)
      seat.updateMatrix()
      headMesh.setMatrixAt(fn, seat.matrix)
      stemMesh.setMatrixAt(fn, seat.matrix)
      headMesh.setColorAt(fn, tone)
      fn++
    }
  }
  headMesh.count = fn
  stemMesh.count = fn
  headMesh.frustumCulled = false
  stemMesh.frustumCulled = false
  headMesh.castShadow = true
  group.add(headMesh, stemMesh)

  // ----- 정서 디테일 — 감정은 소품이 아니라 날씨가 만든다 -----
  // 존3 외로움 — 비. 회색 도시에는 비가 온다.
  const RAIN_N = 220
  const rain = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.012, 0.55, 0.012),
    new THREE.MeshBasicMaterial({ color: '#aebbc4', transparent: true, opacity: 0.42 }),
    RAIN_N
  )
  rain.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  rain.frustumCulled = false
  rain.visible = false
  scene.add(rain) // 씬에 직접 — 카메라 주변을 따라다닌다
  const rainSeed = []
  for (let i = 0; i < RAIN_N; i++) {
    rainSeed.push({ x: -12 + hash(i * 3.1) * 26, z: 14 - hash(i * 5.7) * 42, ph: hash(i * 7.3) * 9, sp: 7 + hash(i * 9.1) * 4 })
  }

  // 존2 힘듬 — 모래바람. 낮게 긴 먼지가 흐른다.
  const DUST_N = 40
  const dust = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.6, 0.02, 0.05),
    new THREE.MeshBasicMaterial({ color: '#d9c49a', transparent: true, opacity: 0.3 }),
    DUST_N
  )
  dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  dust.frustumCulled = false
  dust.visible = false
  scene.add(dust)
  const dustSeed = []
  for (let i = 0; i < DUST_N; i++) {
    dustSeed.push({ y: 0.15 + hash(i * 3.7) * 1.4, z: 12 - hash(i * 5.1) * 40, ph: hash(i * 7.9) * 30, sp: 3 + hash(i * 9.3) * 3 })
  }

  // ----- 접지 그림자 -----
  // 그림자 카메라(±26m) 밖은 그림자가 물리적으로 없다. 없으면 전부 스티커가 된다.
  {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 128
    const cctx = cv.getContext('2d')
    const grad = cctx.createRadialGradient(64, 64, 2, 64, 64, 64)
    grad.addColorStop(0, 'rgba(30,34,30,0.5)')
    grad.addColorStop(0.45, 'rgba(30,34,30,0.26)')
    grad.addColorStop(1, 'rgba(30,34,30,0)')
    cctx.fillStyle = grad
    cctx.fillRect(0, 0, 128, 128)
    const shadowTex = new THREE.CanvasTexture(cv)
    const contact = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.5, 12),
      new THREE.MeshBasicMaterial({
        map: shadowTex, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
      contactSpots.length
    )
    contact.renderOrder = 1
    for (let i = 0; i < contactSpots.length; i++) {
      const sp = contactSpots[i]
      // 접지 얼룩도 해를 따라 눕는다 — 방향 없이 아무 각도로 돌려 놓으면(예전: hash*6.28)
      // 진짜 그림자와 각이 어긋나 물체마다 제멋대로 눕는 타원이 된다.
      const [sx, sz] = shadowDirAt(sp.d)
      seat.position.set(sp.x + sx * sp.r * 0.5, groundY(sp.d, sp.x) + 0.018, -sp.d + sz * sp.r * 0.5)
      seat.rotation.set(-Math.PI / 2, 0, Math.atan2(sx, sz))
      seat.scale.set(sp.r * 1.9, sp.r * 2.6, 1)
      seat.updateMatrix()
      contact.setMatrixAt(i, seat.matrix)
    }
    contact.frustumCulled = false
    group.add(contact)
  }

  // ----- 광장 너머 — 로봇이 꿈꾸는 세계 -----
  // 걸어온 길은 나무와 흙과 돌이었다. 발광하는 청록은 여기에만 있다.
  const dream = new THREE.Group()
  dream.position.set(0, endY, -endD)
  dream.visible = false // 멀리서 안개색 실루엣으로 새어 나오면 렌더 결함으로 보인다
  group.add(dream)

  const dreamPath = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 78),
    new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.3 })
  )
  dreamPath.rotation.x = -Math.PI / 2
  dreamPath.position.set(0, 0.06, -(7 + 39))
  dream.add(dreamPath)

  for (let k = 0; k < 5; k++) {
    const r = 2.6 + k * 0.9
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.06, 6, 36),
      new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.72, fog: false })
    )
    ring.position.set(0, 1.6 + k * 0.5, -(14 + k * 16))
    ring.rotation.z = (hash(k * 3.3) - 0.5) * 0.14
    dream.add(ring)
  }
  for (let k = 0; k < 4; k++) {
    const side = k % 2 === 0 ? 1 : -1
    const d = 22 + k * 16
    const isle = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5 + hash(k * 7.7) * 1.3, 0), std('#cfe4ee'))
    isle.scale.set(1, 0.42, 1)
    isle.position.set(side * (7 + hash(k * 5.1) * 5), 5.5 + hash(k * 9.1) * 4.5, -d)
    dream.add(isle)
  }
  // 모노리스 — 기울어 떠 있는 돌기둥. 아래 광원 원판이 부양을 증명한다.
  for (const [mx, md, my, tilt] of [[-16, 24, 9, 0.12], [21, 42, 14, -0.08], [-27, 58, 11, 0.05]]) {
    const mono = new THREE.Mesh(new THREE.BoxGeometry(1.0, 13, 1.0), std('#dfe0f2'))
    mono.position.set(mx, my, -md)
    mono.rotation.z = tilt
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.4, 1.15), glowMat(GLOW, 1.4))
    band.position.set(mx + Math.sin(tilt) * 6.3, my - Math.cos(tilt) * 6.3, -md)
    band.rotation.z = tilt
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 12),
      new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.12, depthWrite: false, fog: false })
    )
    disc.rotation.x = -Math.PI / 2
    disc.position.set(mx, 0.1, -md)
    dream.add(mono, band, disc)
  }


  // 저중력 파편 — 밟고 온 재료(부교 판재·판석)가 중력을 잃었다
  const DEBRIS = 14
  const debris = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.34, 0),
    std('#ffffff', { emissive: '#2a6b78', emissiveIntensity: 0.35 }),
    DEBRIS
  )
  const debrisBase = []
  {
    const dt1 = new THREE.Color('#c9c3d6')
    const dt2 = new THREE.Color('#a8bcd0')
    for (let k = 0; k < DEBRIS; k++) {
      const a = hash(k * 3.1) * Math.PI * 2
      const r = 6.5 + hash(k * 5.7) * 8.5
      // 길 위(|x|<4.2)에는 띄우지 않는다 — 낙석으로 읽힌다
      const x = Math.sign(Math.cos(a) || 1) * (4.2 + Math.abs(Math.cos(a)) * r)
      debrisBase.push({ x, y: 1.2 + hash(k * 7.3) * 6.3, z: -Math.sin(a) * r * 0.6 - 2, k })
      debris.setColorAt(k, k < 8 ? dt1 : dt2)
    }
  }
  debris.frustumCulled = false
  dream.add(debris)

  // 청록 역광 — 여정 내내 정면광이던 로봇이 마지막에 처음으로 실루엣이 된다
  const dreamLight = new THREE.PointLight(GLOW, 0, 44)
  dreamLight.position.set(0, endY + 3.4, -(endD + 6))
  group.add(dreamLight)
  // 좌후방 냉광 필 — 어깨 한 줄이 살아야 실루엣이 된다
  const rimLight = new THREE.PointLight('#8ad8ff', 0, 26)
  rimLight.position.set(-4.5, endY + 1.2, -(endD + 3.5))
  group.add(rimLight)
  // 광장 바닥의 청록 풀 — 바닥이 실루엣보다 밝아야 실루엣이 성립한다
  const plazaGlow = new THREE.Mesh(
    new THREE.CircleGeometry(7.5, 28),
    new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  )
  plazaGlow.rotation.x = -Math.PI / 2
  plazaGlow.position.set(0, endY + 0.06, -endD)
  group.add(plazaGlow)

  // ----- 매 프레임 -----
  function update(walked, dt, t, talkZone = -1, talkK = 0) {
    const p = oceanGeo.attributes.position.array
    for (let i = 0; i < p.length; i += 3) {
      const x = oceanBase[i]
      const y = oceanBase[i + 1]
      const amp = smooth01((SHORE_X1 - 2 - (x - 60)) / 8)
      // 잔물결 — 구역 분리 이전 진폭(0.22/0.18). 3배로 키운 파도는 바다를 거칠게 만든다.
      p[i + 2] = (Math.sin(x * 0.25 + t * 1.1) * 0.22 + Math.cos(y * 0.08 + t * 0.7) * 0.18) * amp
    }
    oceanGeo.attributes.position.needsUpdate = true

    // 석호 잔물결 — 3.5cm 진폭이면 flatShading 면 사이 각이 4~7° 벌어져 반짝인다
    if (walked > INTRO_LEN + 2 * ZONE_LEN) {
      const lpArr = lagoonGeo.attributes.position.array
      for (let i = 0; i < lpArr.length; i += 3) {
        const lx = lagoonBase[i]
        const lyy = lagoonBase[i + 1]
        lpArr[i + 2] = 0.035 * Math.sin(lyy * 1.05 + t * 1.4) + 0.022 * Math.sin(lx * 0.83 - t * 0.9)
      }
      lagoonGeo.attributes.position.needsUpdate = true
    }

    const bornAt = fogFarAt(walked) * 0.72 // 안개에 거의 묻힌 채로 나타나야 튀지 않는다
    for (const pr of props) {
      const ahead = pr.dist - walked
      const target = ahead < bornAt && ahead > -16 ? 1 : 0
      if (pr.born !== target) {
        pr.born = Math.min(1, Math.max(0, pr.born + (target === 1 ? dt * 1.6 : -dt * 2)))
        pr.obj.scale.setScalar(Math.max(0.001, easeOutBack(pr.born)))
      }
    }

    for (const a of gateAnims) a(walked, t)

    npcs.forEach((n, ni) => {
      const near = Math.abs(n.dist - walked) < 10
      if (near && !n.wasNear) n.excite = 1
      n.wasNear = near
      n.excite = Math.max(0, n.excite - dt * 2.5) // 읽기 시작과 겹치지 않게 빨리 멎는다
      const talk = ni === talkZone ? talkK : 0
      const m = n.mark.material
      // 상영이 시작되면 ? 는 내려간다 — 질문은 이미 화면이 하고 있다
      m.opacity += ((near && talk < 0.15 ? 1 : 0) - m.opacity) * Math.min(1, dt * 5)
      // 시전 몸 돌림 — 스크린을 향해 돌아서서 쏘고, 대화가 끝나면 제자리로 돌아온다
      n.group.rotation.y = n.baseRot + (n.castRot - n.baseRot) * smooth01(talk)
      const hop = Math.abs(Math.sin(t * 9)) * 0.3 * n.excite
      n.group.position.y = n.baseY + 0.12 + hop + Math.sin(t * (near ? 4 : 1.6) + n.dist) * (near ? 0.12 : 0.05)
    })

    dream.visible = walked > endD - 95

    // 생성되는 길 — 앞 5m 에서 청록 윤곽으로 나타나 실체가 되고, 지난 지 8m 에서 흩어진다
    for (let i = 0; i < GEN_N; i++) {
      const d = genD[i]
      const ahead = d - walked
      const f = smooth01((5 - ahead) / 2.5) * (1 - smooth01((walked - d - 8) / 3))
      seat.position.set(0, trackY(d) + 0.035 - (1 - f) * 0.5, -d)
      seat.rotation.set((1 - f) * 0.4 * (hash(i * 7) - 0.5), 0, (1 - f) * 0.5 * (hash(i * 13) - 0.5))
      seat.scale.setScalar(Math.max(0.001, f))
      seat.updateMatrix()
      genSolid.setMatrixAt(i, seat.matrix)
      const edgeK = Math.sin(Math.PI * Math.min(1, Math.max(0, f))) // 전이 중에만 윤곽이 빛난다
      seat.scale.setScalar(Math.max(0.001, edgeK))
      seat.updateMatrix()
      genEdge.setMatrixAt(i, seat.matrix)
    }
    genSolid.instanceMatrix.needsUpdate = true
    genEdge.instanceMatrix.needsUpdate = true

    const night = smooth01((walked - (endD - 30)) / 20)
    dreamLight.intensity = 40 * night
    rimLight.intensity = 18 * night
    plazaGlow.material.opacity = 0.12 * night
    debris.visible = night > 0.05 // 낮에 보이면 꿈의 재료가 아니라 낙석이다
    if (dream.visible) {
      if (debris.visible) {
        const pop = smooth01((night - 0.12) / 0.35)
        for (const db of debrisBase) {
          seat.position.set(db.x, db.y + Math.sin(t * 0.5 + db.k * 1.7) * 0.5, db.z)
          seat.rotation.set(t * 0.1 + db.k, t * 0.15 + db.k * 2, 0)
          seat.scale.setScalar((0.7 + hash(db.k * 9.1) * 0.8) * pop)
          seat.updateMatrix()
          debris.setMatrixAt(db.k, seat.matrix)
        }
        debris.instanceMatrix.needsUpdate = true
      }
    }

    group.position.y = -trackY(walked)

    // 물거품 — 물가 선을 따라간다
    const top = trackY(walked) - 0.05
    const s = (SEA_Y - top) / (SEA_Y - 0.3 - top)
    const u = 0.5 - Math.sin(Math.asin(1 - 2 * Math.min(1, Math.max(0, s))) / 3)
    const wx = SHORE_X0 + (0.3 + 0.7 * u) * (SHORE_X1 - SHORE_X0) // 구역 분리 이전 물가 선
    const wet = 1 - seaGone(walked) // 물가가 닫히면 거품도 함께 잦아든다
    for (const f of foams) {
      const breathe = Math.sin(t * 0.9 + f.phase)
      f.mesh.position.x = wx + f.offset + breathe * 0.5
      f.mesh.material.opacity = (0.3 + (breathe * 0.5 + 0.5) * 0.35) * wet // 구역 분리 이전 거품 농도
    }

    // 날씨 — 존2 모래바람, 존3 비. 카메라 주변만 돌면 된다.
    const inCity = walked > INTRO_LEN + 2 * ZONE_LEN - 8 && walked < INTRO_LEN + 3 * ZONE_LEN + 4
    rain.visible = inCity
    if (inCity) {
      for (let i = 0; i < RAIN_N; i++) {
        const r = rainSeed[i]
        const fall = 8.5 - ((t * r.sp + r.ph) % 8.5)
        seat.position.set(r.x, -trackY(walked) + fall, r.z)
        seat.rotation.set(0, 0, 0.06)
        seat.scale.set(1, 1, 1)
        seat.updateMatrix()
        rain.setMatrixAt(i, seat.matrix)
      }
      rain.instanceMatrix.needsUpdate = true
    }
    const inWaste = walked > INTRO_LEN + ZONE_LEN - 10 && walked < INTRO_LEN + 2 * ZONE_LEN + 2
    dust.visible = inWaste
    if (inWaste) {
      for (let i = 0; i < DUST_N; i++) {
        const ds = dustSeed[i]
        const drift = ((t * ds.sp + ds.ph) % 46) - 30
        seat.position.set(drift, -trackY(walked) + ds.y, ds.z)
        seat.rotation.set(0, 0.1, 0)
        seat.scale.set(1 + hash(i * 11.7) * 1.6, 1, 1)
        seat.updateMatrix()
        dust.setMatrixAt(i, seat.matrix)
      }
      dust.instanceMatrix.needsUpdate = true
    }

    // 모트 순환 — 존1(해안)에서만 보인다. 걸음에 맞춰 120m 주기로 되돌아온다.
    const mp = moteGeo.attributes.position.array
    for (let k = 0; k < MOTES; k++) {
      mp[k * 3] = moteBase[k * 3] + Math.sin(t * 0.5 + k) * 0.6
      mp[k * 3 + 1] = moteBase[k * 3 + 1] + Math.sin(t * 0.8 + k * 2.7) * 0.35
      mp[k * 3 + 2] = (((moteBase[k * 3 + 2] + walked) % 120) + 120) % 120 - 100
    }
    moteGeo.attributes.position.needsUpdate = true
    motes.material.opacity = 0.8 * (1 - smooth01((walked - (gateOf(0) - 10)) / 14))
    motes.visible = motes.material.opacity > 0.02

    group.position.z = walked
  }

  return { group, TOTAL, npcs, projectors, update, fogFarAt, skyPhaseAt, trackYAt: trackY }
}
