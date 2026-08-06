// 주인공 파티클 무리 — 페이지 전체를 관통하는 단 하나의 3D 요소.
// 스크롤 진행도에 따라 챕터별 대형(formation)으로 변신하며 방문자와 함께 하강한다.
// 대형 = 문장의 수행: 흩어짐 → 한 줄기 흐름 → 하나의 코어 → 정착.

import * as THREE from 'three'

const N = 6000
const ACCENT = new THREE.Color('#7dd3fc')
const VIOLET = new THREE.Color('#a78bfa')

// ---------- 대형별 목표 좌표 ----------
// 각 함수는 (i, t, out) → 파티클 i 의 이 순간 목표 위치 (챕터 로컬 좌표)

const GRID_COLS = 100
const GRID_ROWS = 60

function waveTarget(i, t, out) {
  // 넓고 잔잔한 흐름의 표면 — 텍스트 아래에 수평으로 펼쳐짐
  const col = i % GRID_COLS
  const row = Math.floor(i / GRID_COLS) % GRID_ROWS
  const x = (col - GRID_COLS / 2) * 0.85
  const z = -6 - row * 0.75
  out.x = x
  out.y = -7 + Math.sin(x * 0.25 + t * 0.8) * Math.cos(z * 0.2 + t * 0.5) * 1.4
  out.z = z
}

function streamTarget(i, t, out) {
  // 한 줄기 물길 — 나선을 그리며 아래로 흐른다 (하강 모티브)
  const u = ((i / N) + t * 0.022) % 1
  const angle = u * Math.PI * 5
  const radius = 6.5 + Math.sin(i * 12.9898) * 1.1 // 굵기 지터 (결정적)
  out.x = Math.cos(angle) * radius
  out.y = 16 - u * 34
  out.z = Math.sin(angle) * radius - 12
}

function coreTarget(i, t, out) {
  // 하나의 코어 — 피보나치 구 + 궤도 링 15%
  const ringShare = Math.floor(N * 0.85)
  const spin = t * 0.22
  if (i < ringShare) {
    const k = i / ringShare
    const phi = Math.acos(1 - 2 * k)
    const theta = Math.PI * (1 + Math.sqrt(5)) * i + spin
    const r = 5.6
    out.x = Math.sin(phi) * Math.cos(theta) * r
    out.y = Math.cos(phi) * r
    out.z = Math.sin(phi) * Math.sin(theta) * r - 12
  } else {
    const k = (i - ringShare) / (N - ringShare)
    const a = k * Math.PI * 2 + spin * 1.6
    out.x = Math.cos(a) * 9.5
    out.y = Math.sin(a) * 9.5 * 0.28
    out.z = Math.sin(a) * 9.5 * 0.9 - 12
  }
}

function restTarget(i, t, out) {
  // 도착 — 성긴 별자리처럼 정착, 아주 느리게 숨쉰다
  const h1 = Math.sin(i * 12.9898) * 43758.5453
  const h2 = Math.sin(i * 78.233) * 12543.2634
  const h3 = Math.sin(i * 39.425) * 26251.1257
  const rx = (h1 - Math.floor(h1) - 0.5) * 80
  const ry = (h2 - Math.floor(h2) - 0.5) * 44
  const rz = (h3 - Math.floor(h3)) * -38 - 6
  const breathe = 1 + Math.sin(t * 0.4 + i * 0.01) * 0.02
  out.x = rx * breathe
  out.y = ry * breathe
  out.z = rz
}

const FORMATIONS = { wave: waveTarget, stream: streamTarget, core: coreTarget, rest: restTarget }

function smoothstep(x) {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}

// ---------- 주인공 생성 ----------
// chapterDefs: [{ formation, x, y }] — 챕터별 대형 키와 월드 오프셋

export function createProtagonist(chapterDefs) {
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(N * 3)
  const col = new Float32Array(N * 3)
  const tmp = new THREE.Vector3()
  const tmpB = new THREE.Vector3()

  const c = new THREE.Color()
  for (let i = 0; i < N; i++) {
    // 시작은 히어로 대형 근처에서
    waveTarget(i, 0, tmp)
    pos[i * 3] = tmp.x + chapterDefs[0].x
    pos[i * 3 + 1] = tmp.y + chapterDefs[0].y
    pos[i * 3 + 2] = tmp.z
    c.lerpColors(ACCENT, VIOLET, (i % 97) / 97)
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))

  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  )
  // 매 프레임 전 구간을 이동하는 무리 — 초기 바운딩 구로 컬링되면 하강 후 통째로 사라진다
  points.frustumCulled = false

  // progress: 0 ~ (챕터수-1). 소수부로 이웃 대형을 블렌드.
  function update(t, progress) {
    const kA = Math.min(chapterDefs.length - 1, Math.max(0, Math.floor(progress)))
    const kB = Math.min(chapterDefs.length - 1, kA + 1)
    const blend = smoothstep(progress - kA)
    const defA = chapterDefs[kA]
    const defB = chapterDefs[kB]
    const fA = FORMATIONS[defA.formation]
    const fB = FORMATIONS[defB.formation]
    const p = geo.attributes.position.array

    for (let i = 0; i < N; i++) {
      fA(i, t, tmp)
      tmp.x += defA.x
      tmp.y += defA.y
      if (blend > 0 && kB !== kA) {
        fB(i, t, tmpB)
        tmpB.x += defB.x
        tmpB.y += defB.y
        tmp.lerp(tmpB, blend)
      }
      // 파티클마다 다른 관성 — 무리가 유기체처럼 따라온다
      const ease = 0.05 + ((i * 7) % 13) * 0.006
      const j = i * 3
      p[j] += (tmp.x - p[j]) * ease
      p[j + 1] += (tmp.y - p[j + 1]) * ease
      p[j + 2] += (tmp.z - p[j + 2]) * ease
    }
    geo.attributes.position.needsUpdate = true
  }

  return { points, update }
}

// 은은한 배경 별밭 — 전 구간에 깔리는 정적 요소
export function createAmbient(totalDepth) {
  const M = 900
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(M * 3)
  for (let k = 0; k < M; k++) {
    pos[k * 3] = (Math.random() - 0.5) * 110
    pos[k * 3 + 1] = 20 - Math.random() * (totalDepth + 60)
    pos[k * 3 + 2] = -14 - Math.random() * 45
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.12,
      color: ACCENT,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  )
}
