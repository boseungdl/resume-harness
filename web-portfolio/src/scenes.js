// 챕터별 3D 씬 빌더 — chapters.js 의 scene 키와 1:1.
// 각 빌더는 { group, update(t) } 를 반환한다. group.position.y 는 main 이 배치.

import * as THREE from 'three'

const ACCENT = new THREE.Color('#7dd3fc')
const VIOLET = new THREE.Color('#a78bfa')

function pointsMaterial(size, color, opacity = 0.9) {
  return new THREE.PointsMaterial({
    size,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

// 픽셀 그리드 — '화면' 층. 물결치는 점 평면.
function screen() {
  const group = new THREE.Group()
  const COLS = 90
  const ROWS = 50
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(COLS * ROWS * 3)
  let i = 0
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      pos[i++] = (x - COLS / 2) * 0.9
      pos[i++] = (y - ROWS / 2) * 0.9
      pos[i++] = 0
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const pts = new THREE.Points(geo, pointsMaterial(0.14, ACCENT, 0.8))
  pts.rotation.x = -0.9
  pts.position.z = -18
  group.add(pts)

  const base = pos.slice()
  return {
    group,
    update(t) {
      const p = geo.attributes.position.array
      for (let j = 0; j < p.length; j += 3) {
        const x = base[j]
        const y = base[j + 1]
        p[j + 2] = Math.sin(x * 0.35 + t * 0.9) * Math.cos(y * 0.3 + t * 0.6) * 1.6
      }
      geo.attributes.position.needsUpdate = true
    },
  }
}

// 흐르는 입자 스트림 — '데이터 흐름' 층.
function flow() {
  const group = new THREE.Group()
  const STREAMS = 7
  const PER = 260
  const streams = []
  for (let s = 0; s < STREAMS; s++) {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(PER * 3)
    const phase = new Float32Array(PER)
    const radius = 6 + s * 1.6
    for (let k = 0; k < PER; k++) {
      phase[k] = (k / PER) * Math.PI * 2
      pos[k * 3] = Math.cos(phase[k]) * radius
      pos[k * 3 + 1] = ((k % 13) - 6) * 0.35
      pos[k * 3 + 2] = Math.sin(phase[k]) * radius
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const color = s % 2 ? VIOLET : ACCENT
    const pts = new THREE.Points(geo, pointsMaterial(0.16, color, 0.75))
    pts.position.z = -14
    pts.rotation.x = 0.5
    group.add(pts)
    streams.push({ geo, phase, radius, speed: 0.25 + s * 0.045 })
  }
  return {
    group,
    update(t) {
      for (const st of streams) {
        const p = st.geo.attributes.position.array
        for (let k = 0; k < st.phase.length; k++) {
          const a = st.phase[k] + t * st.speed
          p[k * 3] = Math.cos(a) * st.radius
          p[k * 3 + 2] = Math.sin(a) * st.radius
        }
        st.geo.attributes.position.needsUpdate = true
      }
    },
  }
}

// 와이어프레임 코어 + 궤도 링 — '합쳐진 지식' 층.
function core() {
  const group = new THREE.Group()
  const ico = new THREE.Mesh(
    new THREE.IcosahedronGeometry(5.2, 1),
    new THREE.MeshBasicMaterial({ color: ACCENT, wireframe: true, transparent: true, opacity: 0.55 })
  )
  ico.position.z = -14
  group.add(ico)

  const rings = []
  for (let r = 0; r < 3; r++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(8 + r * 2.4, 0.03, 8, 120),
      new THREE.MeshBasicMaterial({ color: r % 2 ? VIOLET : ACCENT, transparent: true, opacity: 0.4 })
    )
    ring.position.z = -14
    ring.rotation.x = Math.PI / 2 + (r - 1) * 0.35
    group.add(ring)
    rings.push(ring)
  }
  return {
    group,
    update(t) {
      ico.rotation.y = t * 0.25
      ico.rotation.x = Math.sin(t * 0.18) * 0.3
      rings.forEach((ring, r) => {
        ring.rotation.z = t * (0.1 + r * 0.05)
      })
    },
  }
}

// 잔잔한 별밭 — 아웃트로.
function field() {
  const group = new THREE.Group()
  const N = 700
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(N * 3)
  for (let k = 0; k < N; k++) {
    pos[k * 3] = (Math.random() - 0.5) * 90
    pos[k * 3 + 1] = (Math.random() - 0.5) * 50
    pos[k * 3 + 2] = -8 - Math.random() * 40
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const pts = new THREE.Points(geo, pointsMaterial(0.18, ACCENT, 0.6))
  group.add(pts)
  return {
    group,
    update(t) {
      pts.rotation.y = Math.sin(t * 0.05) * 0.1
    },
  }
}

export const SCENE_BUILDERS = { screen, flow, core, field }
