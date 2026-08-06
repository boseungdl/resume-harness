// 해안 데이터로드 — 바다를 낀 미래적 해안 길.
// 걷는 사람은 원점에 고정, 세계가 +z 로 흘러 지나간다.
// 길은 빛나는 트랙, 랜드마크는 각 챕터의 내용을 미래적 사물로 말한다.

import * as THREE from 'three'

export const INTRO_LEN = 26
export const ZONE_LEN = 60
export const OUTRO_LEN = 46

// 구간별 팔레트 — 차가운 새벽 바다 → 노을 산호빛
const ZONE_COLORS = [
  ['#9fc4d8', '#c8e2ee', '#7fb0cc'],
  ['#8fc8c0', '#bce4dc', '#66b0a4'],
  ['#96d0a8', '#c2e8cc', '#6fbc88'],
  ['#b8d490', '#d8e8b4', '#98bc66'],
  ['#d8cc88', '#ecdfae', '#c0ac60'],
  ['#e8b088', '#f4ccac', '#d49060'],
  ['#f09890', '#f8c0b8', '#dc7468'],
]

const GLOW = '#3fd4e0' // 트랙·홀로그램 공통 발광색
const CORAL = '#ff8a66'

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function easeOutBack(t) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, ...extra })
}

function glowMat(color = GLOW, intensity = 1.2) {
  return std(color, { emissive: color, emissiveIntensity: intensity })
}

function shadowed(obj) {
  obj.traverse((c) => { if (c.isMesh) c.castShadow = true })
  return obj
}

// ---------- 기본 소품 ----------

function pine(color, s) {
  // 해안 우산소나무 느낌
  const g = new THREE.Group()
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.14 * s, 1.3 * s, 5), std('#8a6f52'))
  trunk.position.y = 0.65 * s
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.8 * s, 7, 5), std(color))
  crown.scale.y = 0.55
  crown.position.y = 1.55 * s
  g.add(trunk, crown)
  return g
}

function rock(color, s) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 * s, 0), std(color))
  m.scale.y = 0.6
  m.position.y = 0.28 * s
  m.rotation.y = s * 7
  return m
}

function bush(color, s) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 * s, 1), std(color))
  m.scale.set(1.25, 0.8, 1.25)
  m.position.y = 0.4 * s
  return m
}

function pylon(_color, s) {
  // 빛기둥 — 가로등의 미래 버전
  const g = new THREE.Group()
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.2 * s, 0.18, 6), std('#7a8288'))
  base.position.y = 0.09
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09 * s, 2.3 * s, 0.09 * s), glowMat(GLOW, 1.0))
  bar.position.y = 1.25 * s
  g.add(base, bar)
  return g
}

// ---------- 챕터 랜드마크 ----------

// 01 첫인상 — 차가운 얼음 크리스탈 군락
function lmCrystals(palette) {
  const g = new THREE.Group()
  ;[[-0.6, 1.5, 0], [0.8, 2.3, -0.8], [2.0, 1.1, 0.5], [-1.8, 0.9, -1.2]].forEach(([x, s, dz], i) => {
    const c = new THREE.Mesh(
      new THREE.ConeGeometry(0.34 * s, 1.5 * s, 5),
      std('#cfeefa', { emissive: '#9fdcf0', emissiveIntensity: 0.35 })
    )
    c.position.set(x, 0.75 * s, dz)
    c.rotation.y = hash(i * 7) * 2
    c.rotation.z = (hash(i * 13) - 0.5) * 0.25
    g.add(c)
  })
  return g
}

// 02 문제 앞에서 — 홀로그램 갈림길 표지판
function lmHoloSign() {
  const g = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 6), std('#7a8288'))
  pole.position.y = 1.2
  const a = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 0.05), glowMat(GLOW, 0.9))
  a.position.set(0.42, 2.0, 0)
  a.rotation.y = 0.5
  const b = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 0.05), glowMat(CORAL, 0.9))
  b.position.set(-0.38, 1.6, 0)
  b.rotation.y = -0.6
  g.add(pole, a, b)
  return g
}

// 03 일하는 방식 — 미리 놓인 에너지 램프 셋
function lmEnergyLamps() {
  const g = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const l = new THREE.Group()
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.7, 5), std('#7a8288'))
    leg.position.y = 0.35
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), glowMat('#ffe9a0', 1.3))
    orb.position.y = 0.85
    l.add(leg, orb)
    l.position.set(0, 0, -i * 1.6)
    g.add(l)
  }
  return g
}

// 04 팀 안에서 — 모닥불과 둘러앉는 통나무 (따뜻함은 미래에도 그대로)
function lmCampfire() {
  const g = new THREE.Group()
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 6), glowMat('#ff9d5c', 1.4))
  fire.position.y = 0.4
  g.add(fire)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), std('#8d959c'))
    stone.position.set(Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55)
    g.add(stone)
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 7), std('#9a7d5c'))
    log.rotation.z = Math.PI / 2
    log.rotation.y = a
    log.position.set(Math.cos(a) * 1.5, 0.16, Math.sin(a) * 1.5)
    g.add(log)
  }
  return g
}

// 06 꾸준함 — 살짝 떠 있는 기록의 돌탑
function lmFloatCairn() {
  const g = new THREE.Group()
  ;[[0, 5, 1], [1.4, 4, 0.75], [-1.1, 3, 0.6]].forEach(([x, n, s]) => {
    let y = 0.05
    for (let i = 0; i < n; i++) {
      const r = (0.34 - i * 0.05) * s
      const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), std(i % 2 ? '#aab4bc' : '#98a4ac'))
      stone.scale.y = 0.55
      y += r * 0.62
      stone.position.set(x, y, 0)
      stone.rotation.y = hash(x * 10 + i) * 2
      y += r * 0.38 + 0.07 // 돌 사이 틈 — 중력을 조금 이긴 듯한
      g.add(stone)
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4 * s, 0.02, 6, 20), glowMat(GLOW, 0.8))
    ring.rotation.x = Math.PI / 2
    ring.position.set(x, 0.06, 0)
    g.add(ring)
  })
  return g
}

// 07 움직이는 이유 — 등대와 불 켜진 해안 집들
function lmLighthouse() {
  const g = new THREE.Group()
  const lh = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5 - i * 0.08, 0.58 - i * 0.08, 0.85, 10),
      std(i % 2 ? '#f0ece4' : CORAL)
    )
    seg.position.y = 0.42 + i * 0.85
    lh.add(seg)
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.5, 8), std('#5c666e'))
  cap.position.y = 2.9
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), glowMat('#fff3c4', 1.6))
  light.position.y = 2.65
  lh.add(cap, light)
  lh.position.set(-1.2, 0, 0)
  g.add(lh)
  ;[[1.6, 1.2, 0.4], [3.2, -0.6, -0.3]].forEach(([x, dz, ry], i) => {
    const h = new THREE.Group()
    const s = 0.8 + hash(i * 91) * 0.3
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4 * s, 1.0 * s, 1.2 * s), std('#eef0ee'))
    body.position.y = 0.5 * s
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.15 * s, 0.7 * s, 4), std('#5c98b8'))
    roof.position.y = 1.35 * s
    roof.rotation.y = Math.PI / 4
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.26 * s, 0.3 * s, 0.03), glowMat('#ffe9a0', 1.2))
    win.position.set(0.25 * s, 0.5 * s, 0.62 * s)
    h.add(body, roof, win)
    h.position.set(x, 0, -dz)
    h.rotation.y = ry
    g.add(h)
  })
  return g
}

const LANDMARKS = [lmCrystals, lmHoloSign, lmEnergyLamps, lmCampfire, null /* 신뢰=다리 */, lmFloatCairn, lmLighthouse]

// ---------- NPC (길에서 질문하는 동글이 드론) ----------

function questionSprite() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const ctx = cv.getContext('2d')
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  ctx.arc(64, 64, 56, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#0ea8b8'
  ctx.font = 'bold 74px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('?', 64, 68)
  const tex = new THREE.CanvasTexture(cv)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0 }))
  sp.scale.setScalar(0.65)
  return sp
}

function buildNpc(color) {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), std(color))
  body.position.y = 0.55
  body.scale.y = 0.92
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), std('#22303a'))
  const eyeR = eyeL.clone()
  eyeL.position.set(-0.13, 0.65, 0.36)
  eyeR.position.set(0.13, 0.65, 0.36)
  const antenna = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glowMat(GLOW, 1.3))
  antenna.position.y = 1.08
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 20), glowMat(GLOW, 0.9))
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.1
  g.add(body, eyeL, eyeR, antenna, ring)
  return g
}

// ---------- 세계 조립 ----------

export function buildWorld(scene, chapterCount) {
  const TOTAL = INTRO_LEN + chapterCount * ZONE_LEN + OUTRO_LEN
  const group = new THREE.Group()
  scene.add(group)

  const props = []
  const npcs = []

  // 트랙 널판 텍스처 — 단색 박스 대신 이음매가 있는 데크
  const plankCv = document.createElement('canvas')
  plankCv.width = 128
  plankCv.height = 256
  const pctx = plankCv.getContext('2d')
  pctx.fillStyle = '#eaf0f2'
  pctx.fillRect(0, 0, 128, 256)
  pctx.fillStyle = 'rgba(120, 140, 150, 0.35)'
  for (let y = 0; y < 256; y += 64) pctx.fillRect(0, y, 128, 3)
  pctx.fillStyle = 'rgba(120, 140, 150, 0.16)'
  pctx.fillRect(62, 0, 2, 256)
  const plankTexBase = new THREE.CanvasTexture(plankCv)
  plankTexBase.wrapS = plankTexBase.wrapT = THREE.RepeatWrapping

  function deckMaterialFor(len) {
    const tex = plankTexBase.clone()
    tex.needsUpdate = true
    tex.repeat.set(1, len / 2.6)
    return new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, flatShading: true })
  }

  const stoneMat = std('#d4dde0')

  function addProp(obj, dist) {
    obj.scale.setScalar(0.001)
    shadowed(obj)
    group.add(obj)
    props.push({ obj, dist, born: 0 })
  }

  // ----- 바다 (정적 — 파도만 친다) -----
  const oceanGeo = new THREE.PlaneGeometry(80, 900, 20, 110)
  const ocean = new THREE.Mesh(
    oceanGeo,
    std('#38b0cc', { flatShading: true, transparent: true, opacity: 0.94 })
  )
  ocean.rotation.x = -Math.PI / 2
  ocean.position.set(-46, -0.3, -240)
  scene.add(ocean)
  const oceanBase = oceanGeo.attributes.position.array.slice()

  // 모래사장 — 바다와 길 사이
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(13, 900), std('#eee2c4'))
  beach.rotation.x = -Math.PI / 2
  beach.position.set(-8, 0.01, -240)
  beach.receiveShadow = true
  scene.add(beach)

  // 물거품 라인 — 물가에서 숨쉬듯 밀려온다
  const foams = []
  ;[[-14.2, 0], [-16.4, 2.1]].forEach(([x, phase]) => {
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 900),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 })
    )
    foam.rotation.x = -Math.PI / 2
    foam.position.set(x, 0.02, -240)
    scene.add(foam)
    foams.push({ mesh: foam, baseX: x, phase })
  })

  // 떠다니는 빛 입자 — 바닷바람에 실린 모트
  const MOTES = 90
  const moteGeo = new THREE.BufferGeometry()
  const motePos = new Float32Array(MOTES * 3)
  for (let k = 0; k < MOTES; k++) {
    motePos[k * 3] = -22 + Math.random() * 40
    motePos[k * 3 + 1] = 0.4 + Math.random() * 4
    motePos[k * 3 + 2] = -Math.random() * 560 + 30
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
  group.add(motes)

  for (let z = 0; z < chapterCount; z++) {
    const zoneStart = INTRO_LEN + z * ZONE_LEN
    const palette = ZONE_COLORS[z % ZONE_COLORS.length]

    // 빛나는 트랙 — 구간 안에서 이어지고 사이에서 끊긴다
    const stripLen = ZONE_LEN * 0.62
    const stripZ = -(zoneStart + ZONE_LEN * 0.45)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, stripLen), deckMaterialFor(stripLen))
    strip.position.set(0, 0.04, stripZ)
    strip.receiveShadow = true
    group.add(strip)
    const edgeL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, stripLen), glowMat(GLOW, 0.85))
    edgeL.position.set(-1.18, 0.05, stripZ)
    const edgeR = edgeL.clone()
    edgeR.position.x = 1.18
    group.add(edgeL, edgeR)

    // 끊긴 구간 — 신뢰 구간(z=4) 뒤는 빛나는 다리, 나머지는 부유석
    if (z === 4) {
      const gapMid = zoneStart + ZONE_LEN * 0.88
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 9), std('#c8d4d8'))
      deck.position.set(0, 0.32, -gapMid)
      const railL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 9), glowMat(GLOW, 1.1))
      railL.position.set(-0.8, 0.75, -gapMid)
      const railR = railL.clone()
      railR.position.x = 0.8
      const postA = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), std('#7a8288'))
      postA.position.set(-0.8, 0.5, -(gapMid - 4.2))
      const postB = postA.clone(); postB.position.x = 0.8
      const postC = postA.clone(); postC.position.z = -(gapMid + 4.2)
      const postD = postC.clone(); postD.position.x = 0.8
      const bridge = new THREE.Group()
      bridge.add(deck, railL, railR, postA, postB, postC, postD)
      shadowed(bridge)
      group.add(bridge)
    } else {
      for (let k = 0; k < 3; k++) {
        const d = zoneStart + ZONE_LEN * (0.82 + k * 0.07)
        const stone = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.5), stoneMat)
        stone.position.set((hash(z * 31 + k) - 0.5) * 1.6, 0.12, -d)
        stone.rotation.y = hash(z * 17 + k) * 1.2
        const under = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.3), glowMat(GLOW, 0.7))
        under.position.copy(stone.position)
        under.position.y = 0.03
        group.add(stone, under)
      }
    }

    // 상징 랜드마크 — 구간 중반, 길 옆 (바다 반대쪽에 크게, 바다쪽은 낮게)
    const lmFactory = LANDMARKS[z]
    if (lmFactory) {
      const lm = lmFactory(palette)
      const side = z % 2 === 0 ? 1 : -1
      lm.position.set(side * 3.4, 0, -(zoneStart + ZONE_LEN * 0.58))
      addProp(lm, zoneStart + ZONE_LEN * 0.58)
    }

    // NPC — 구간 초입, 길가에서 떠서 기다린다
    const npcDist = zoneStart + ZONE_LEN * 0.3
    const npc = buildNpc(palette[0])
    const nside = z % 2 === 0 ? 1 : -1
    npc.position.set(nside * 2.05, 0, -npcDist)
    npc.rotation.y = nside > 0 ? -0.9 : 0.9
    shadowed(npc)
    const mark = questionSprite()
    mark.position.y = 1.55
    npc.add(mark)
    group.add(npc)
    npcs.push({ group: npc, mark, dist: npcDist, wasNear: false, excite: 0 })

    // 배경 소품 — 육지쪽은 소나무·바위, 바다쪽은 부표
    const COUNT = 8
    for (let i = 0; i < COUNT; i++) {
      const n = z * 100 + i
      const d = zoneStart + (i / COUNT) * ZONE_LEN + hash(n * 5) * 4
      const seaside = i % 3 === 2
      if (seaside) {
        const buoy = new THREE.Group()
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), std(CORAL))
        ball.position.y = 0.1
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), glowMat('#ffe9a0', 1.2))
        tip.position.y = 0.5
        buoy.add(ball, tip)
        buoy.position.set(-(11 + hash(n * 13) * 7), -0.15, -d)
        addProp(buoy, d)
      } else {
        const factory = [pine, bush, rock, pine, pylon][Math.floor(hash(n) * 5)]
        const color = palette[Math.floor(hash(n * 3) * palette.length)]
        const size = 0.8 + hash(n * 7) * 0.9
        const obj = factory(color, size)
        obj.position.set(3.6 + hash(n * 13) * 6.5, 0, -d)
        addProp(obj, d)
      }
    }
  }

  // 아웃트로 — 여정이 멈추는 전망 광장
  const endD = TOTAL - 2
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.08, 24), std('#eaf0f2'))
  plaza.position.set(0, 0.04, -endD)
  plaza.receiveShadow = true
  group.add(plaza)
  const plazaRing = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.05, 6, 48), glowMat(GLOW, 0.9))
  plazaRing.rotation.x = Math.PI / 2
  plazaRing.position.set(0, 0.09, -endD)
  group.add(plazaRing)
  const warm = ZONE_COLORS[ZONE_COLORS.length - 1]
  ;[[pylon, '#fff', 1.2, 3.0, endD - 3], [pine, warm[0], 1.3, 4.6, endD + 2], [bush, warm[2], 1.1, -3.2, endD + 3]].forEach(
    ([factory, color, size, x, d]) => {
      const obj = factory(color, size)
      obj.position.set(x, 0, -d)
      addProp(obj, d)
    }
  )

  function update(walked, dt, t) {
    // 파도
    const p = oceanGeo.attributes.position.array
    for (let i = 0; i < p.length; i += 3) {
      const x = oceanBase[i]
      const y = oceanBase[i + 1]
      p[i + 2] = Math.sin(x * 0.25 + t * 1.1) * 0.22 + Math.cos(y * 0.08 + t * 0.7) * 0.18
    }
    oceanGeo.attributes.position.needsUpdate = true

    for (const pr of props) {
      const ahead = pr.dist - walked
      const target = ahead < 42 ? 1 : 0
      if (pr.born !== target) {
        pr.born = Math.min(1, Math.max(0, pr.born + (target === 1 ? dt * 1.6 : -dt * 2)))
        pr.obj.scale.setScalar(Math.max(0.001, easeOutBack(pr.born)))
      }
    }
    for (const n of npcs) {
      const near = Math.abs(n.dist - walked) < 10
      if (near && !n.wasNear) n.excite = 1 // 만나는 순간 반갑게 폴짝
      n.wasNear = near
      n.excite = Math.max(0, n.excite - dt * 1.1)
      const m = n.mark.material
      m.opacity += ((near ? 1 : 0) - m.opacity) * Math.min(1, dt * 5)
      const hop = Math.abs(Math.sin(t * 9)) * 0.3 * n.excite
      n.group.position.y = 0.12 + hop + Math.sin(t * (near ? 4 : 1.6) + n.dist) * (near ? 0.14 : 0.06)
    }

    // 물거품 호흡
    for (const f of foams) {
      const breathe = Math.sin(t * 0.9 + f.phase)
      f.mesh.position.x = f.baseX + breathe * 0.5
      f.mesh.material.opacity = 0.3 + (breathe * 0.5 + 0.5) * 0.35
    }
    // 빛 입자 부유
    const mp = moteGeo.attributes.position.array
    for (let k = 0; k < MOTES; k++) {
      mp[k * 3] = moteBase[k * 3] + Math.sin(t * 0.5 + k) * 0.6
      mp[k * 3 + 1] = moteBase[k * 3 + 1] + Math.sin(t * 0.8 + k * 2.7) * 0.35
    }
    moteGeo.attributes.position.needsUpdate = true

    group.position.z = walked
  }

  return { group, TOTAL, npcs, update }
}
