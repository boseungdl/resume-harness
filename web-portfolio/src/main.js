// 걷는 사람 — 스크롤은 걸음이 된다.
// 길에서 NPC 를 만나면 질문 팝업이 떠오르고, 지나가면 사라진다.
// 알게 된 것은 우상단 대시보드에 영구히 채워진다.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { PREMISES, STOP_LABELS, PANEL_IN, PANEL_OUT } from './story.js'
import { buildWorld } from './world.js'

function smooth01(u) {
  const x = Math.min(1, Math.max(0, u))
  return x * x * (3 - 2 * x)
}
import { createQualityGovernor } from './quality.js'

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

// ---------- UI 준비 ----------

const spacer = document.getElementById('spacer')
// 정거장당 스크롤 분량(vh) — 값이 클수록 걸음이 느긋해진다
const SCROLL_PER_STOP = 700
spacer.style.height = `${(PREMISES.length + 2.4) * SCROLL_PER_STOP}vh`

const landingEl = document.getElementById('landing')
const miniEl = document.getElementById('mini')
const popupEl = document.getElementById('popup')
const popupQ = popupEl.querySelector('.q')
const popupA = popupEl.querySelector('.a')
const outroEl = document.getElementById('outro-panel')
const routeEl = document.getElementById('route')
const routeDone = document.getElementById('route-done')
const mapNodes = document.getElementById('map-nodes')
const mapMe = document.getElementById('map-me')
const qlistEl = document.getElementById('qlist')
const stTime = document.getElementById('st-time')
const stRead = document.getElementById('st-read')
// 분모는 story.js 가 소유한다 — 문단을 늘리면 지표가 따라온다
const BEATS_TOTAL = PREMISES.reduce((n, p) => n + p.beats.length, 0)
stRead.innerHTML = `00<i> / ${BEATS_TOTAL}</i>`
const popupWho = popupEl.querySelector('.who')
const outroRecord = document.getElementById('outro-record')
const thanksBubble = document.getElementById('thanks-bubble')

// 길목 라벨 — 몇 번째 자리인지가 진행의 언어다 (story.js 소유)
const MEET_LABELS = STOP_LABELS

const veil = document.getElementById('veil')
function liftVeil() {
  veil.classList.add('off')
}
setTimeout(liftVeil, 3200) // 로드가 늦어도 여정은 시작된다

// 우상단 요약 — 지나기 전엔 자리 이름(kicker)만 보인다. 네 전제를 미리 다 깔면
// 문마다의 발견이 죽는다. 통과하면 그 자리에서 "무엇을 바꿨는가"(chip)가 남는다.
const chips = PREMISES.map((item, i) => {
  const li = document.createElement('li')
  li.innerHTML = `<b>${i + 1}</b><span>${item.kicker}</span>`
  qlistEl.appendChild(li)
  return li
})
const chipShown = [false, false, false, false]
// 만남 게이트 — 클릭해서 '수집'해야 걸음이 다시 열린다
const collected = PREMISES.map(() => false)

// ---------- 랜딩 인터랙션 (WebGL 여부와 무관) ----------

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// 모션 법칙: 로드 시 1회 페이드, 이후 UI는 정지 — 움직임은 세계의 것
document.querySelectorAll('.land-fade').forEach((el, i) => {
  setTimeout(() => el.classList.add('in'), reduceMotion ? 0 : 200 + i * 140)
})

// 커밋 차트 — 외주 위젯 대신 직접 그린다. 주 단위 합계는 0일들을 왜곡 없이 흡수한다.
const FALLBACK_WEEKS = [
  ['6/26', 6], ['7/3', 12], ['7/10', 9], ['7/17', 4], ['7/24', 0], ['7/31', 10],
]
async function commitChart() {
  const el = document.getElementById('gh-chart')
  if (!el) return
  let weeks = FALLBACK_WEEKS
  try {
    const r = await fetch('https://github-contributions-api.jogruber.de/v4/boseungdl?y=last')
    const days = (await r.json()).contributions.slice(-42)
    if (days.length === 42) {
      weeks = []
      for (let i = 0; i < 6; i++) {
        const w = days.slice(i * 7, (i + 1) * 7)
        const d = new Date(w[0].date)
        weeks.push([`${d.getMonth() + 1}/${d.getDate()}`, w.reduce((s, x) => s + x.count, 0)])
      }
    }
  } catch { /* 오프라인이면 마지막 확인값으로 그린다 */ }
  const total = weeks.reduce((s, w) => s + w[1], 0)
  const cap = document.getElementById('gh-cap')
  if (cap) cap.textContent = `최근 6주 ${total}커밋`
  const chart = echarts.init(el)
  chart.setOption({
    grid: { left: 0, right: 0, top: 2, bottom: 0 },
    xAxis: { type: 'category', show: false, data: weeks.map((w) => w[0]) },
    yAxis: { type: 'value', show: false },
    tooltip: {
      trigger: 'axis',
      formatter: (p) => `${p[0].name} 주 — ${p[0].value}커밋`,
      textStyle: { fontSize: 11 },
    },
    series: [{
      type: 'bar',
      barWidth: '52%',
      barMinHeight: 2,
      data: weeks.map((w, i) => ({
        value: w[1],
        itemStyle: {
          color: i === weeks.length - 1 ? '#0b7c8c' : 'rgba(14,168,184,0.55)',
          borderRadius: [1, 1, 0, 0],
        },
      })),
    }],
    animationDuration: reduceMotion ? 0 : 500,
  })
  window.addEventListener('resize', () => chart.resize())
}
commitChart()

// ---------- 3D 세계 ----------

const canvas = document.getElementById('bg')

function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

if (!webglAvailable()) {
  // 3D 가 없으면 여정도 없다 — 빈 스크롤과 유령 계기판을 남기지 않는다
  document.body.classList.add('no-webgl')
  spacer.style.height = '0'
  miniEl.classList.add('hidden-panel')
} else {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05 // 구역 분리 이전 값 — 0.92 는 세계 전체를 반 스톱 눌러 흐렸다

  const scene = new THREE.Scene()

  const SKY = [
    [0.0, new THREE.Color('#cfe9f8')],  // 존1 산뜻한 출발 — 맑은 바다 아침
    [0.26, new THREE.Color('#eeddc0')], // 존2 황무지 — 마르고 뜨거운 흙먼지
    [0.5, new THREE.Color('#c6cacd')],  // 존3 외로움 — 회색빛 도시
    [0.75, new THREE.Color('#ffd2b0')], // 존4 잔잔함 — 낮게 가라앉은 노을
    [0.88, new THREE.Color('#b98098')], // 황혼
    [1.0, new THREE.Color('#8b8dc8')],  // 너머 — 미지의 어스름 (밝은 라벤더)
  ]
  const skyNow = SKY[0][1].clone()
  scene.background = skyNow
  scene.fog = new THREE.Fog(skyNow, 22, 78)

  // 카메라 A(랜딩): 로봇 눈높이에서 마주 보기 / B(여정): 높은 동행 샷 — 스크롤로 스크럽
  // near 를 0.1 로 두면 깊이 정밀도를 낭비해 먼 면들이 깜빡인다 — 최근접 지오메트리가 6m 밖이다
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 400)
  camera.position.set(-2.8, 2.0, 6.6)
  camera.lookAt(-0.5, 1.05, -9)

  // ----- 하늘 돔 (그라데이션) · 태양 · 구름 -----
  const skyUniforms = {
    top: { value: new THREE.Color('#2b93de') },
    bottom: { value: skyNow.clone() },
    // 그라데이션 굽힘 — 낮을수록 천정 파랑이 지평선 가까이까지 내려온다.
    // 존1 만 강하게 굽혀(0.34) 흰 헤이즈 띠를 지평선에 붙이고 화면 대부분을 파랑으로 채운다.
    bend: { value: 0.55 },
  }
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(300, 20, 14),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: skyUniforms,
      vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'varying vec3 vP; uniform vec3 top; uniform vec3 bottom; uniform float bend;' +
        // 지평선(y=0)이 정확히 안개색이 되어야 하늘과 땅의 이음매가 사라진다
        'void main() { float h = clamp(normalize(vP).y, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, bend)), 1.0); }',
    })
  )
  scene.add(skyDome)
  const SKY_TOP = [
    [0.0, new THREE.Color('#1180d6')],  // 산뜻 — 쨍한 한여름 파랑(천정). 지평선 흰 헤이즈와의 낙차가 "푸름"을 만든다
    [0.26, new THREE.Color('#c2ad84')], // 황무지 — 먼지 낀 누런 하늘
    [0.5, new THREE.Color('#8d97a2')],  // 외로움 — 잿빛
    [0.75, new THREE.Color('#e8987c')], // 잔잔 — 노을
    [0.88, new THREE.Color('#6f5a92')],
    [1.0, new THREE.Color('#4a4e8a')],
  ]
  const SKY_BEND = [0.34, 0.55, 0.55, 0.55, 0.55, 0.55]
  // 광원·태양 스프라이트도 같은 키를 탄다 — 하늘만 밤이고 해가 높으면 무대조명이 된다
  const KEY_T = [0, 0.26, 0.5, 0.75, 0.88, 1]
  // 광원은 화면에 보이는 해와 같은 쪽에 서야 한다 — 존1·2 는 해가 왼쪽 앞(SUN2D 의 -x, -z)에 걸리는데
  // 광원만 오른쪽 뒤(6, 9, 4)에 있어 그림자가 해를 향해 뻗었다. 방위각을 SUN2D 와 맞추고(왼쪽 29°)
  // 고도만 40° 로 남겨(스프라이트는 낮게 걸려 있어도 그림자는 짧게) 그림자가 오른쪽 앞으로 눕게 한다.
  // world.js 의 SUN_XZ(접지 그림자 방향)와 짝이다 — 해를 옮기면 거기도 옮긴다.
  const SUN_POS = [[-5.4, 9, -9.6], [-5.6, 9.5, -10.3], [1, 12.5, -1], [-14, 4.2, -8], [-20, 1.6, -11], [-22, 0.6, -12]]
  const SUN_INT = [1.6, 1.8, 0.55, 1.35, 0.75, 0.85] // 존1 은 구역 분리 이전 값(1.6)
  const SUN_COL = ['#fff6e4', '#ffe9c0', '#eef0f2', '#ffbe8c', '#d9a0b0', '#7f86d8'].map((c) => new THREE.Color(c))
  // 존1 의 하늘빛 앰비언트는 흰색이 아니라 파랑이어야 한다 — 흰 앰비언트가 채도를 씻어낸다
  const HEMI_SKY = ['#eaf6ff', '#f2e2c2', '#c9ced4', '#ffdcc0', '#c8b0d0', '#c6c8f2'].map((c) => new THREE.Color(c))
  const HEMI_GND = ['#c2d4c4', '#c9b58e', '#9aa0a4', '#c89a84', '#8a6a80', '#8e96bc'].map((c) => new THREE.Color(c))
  const HEMI_INT = [1.15, 1.05, 1.25, 1.1, 0.78, 1.2] // 존1 은 구역 분리 이전 값(1.15)
  // 존1 은 구역 분리 이전의 해 스프라이트 — 높이 55, 크기 60 (수평선 위에 낮게 걸리지 않는다)
  const SUN2D = [[-120, 55, -220, 60, 1], [-130, 62, -240, 56, 1], [-60, 96, -220, 44, 0.9], [-150, 26, -250, 74, 1], [-160, 8, -255, 66, 0.5], [-160, 4, -255, 60, 0]]
  function keyLerp(t, get, set) {
    for (let i = 0; i < KEY_T.length - 1; i++) {
      if (t <= KEY_T[i + 1]) {
        return set(i, i + 1, (t - KEY_T[i]) / (KEY_T[i + 1] - KEY_T[i]))
      }
    }
    return set(KEY_T.length - 2, KEY_T.length - 1, 1)
  }

  const sunCv = document.createElement('canvas')
  sunCv.width = sunCv.height = 128
  const sctx = sunCv.getContext('2d')
  const grad = sctx.createRadialGradient(64, 64, 6, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,252,238,1)')
  grad.addColorStop(0.25, 'rgba(255,240,200,0.9)')
  grad.addColorStop(1, 'rgba(255,240,200,0)')
  sctx.fillStyle = grad
  sctx.fillRect(0, 0, 128, 128)
  const sun2d = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sunCv), transparent: true, depthWrite: false })
  )
  sun2d.scale.setScalar(60)
  sun2d.position.set(-120, 55, -220)
  scene.add(sun2d)

  // 안개색을 지평선 하늘색 그대로 두면 원경이 흰 판이 된다 — 존1 만 한 단 더 푸르게 빼서
  // 공기원근을 살리고 먼 지형에 채도를 남긴다
  // 구름 — 구역 분리 이전 그대로: 납작하게 눌린 구 퍼프를 옆으로 늘어놓은 반투명 덩어리.
  // 정점 그라데이션 구름은 형태가 또렷해 하늘이 무거워진다.
  const cloudDay = new THREE.Color('#dceef4')
  const cloudNight = new THREE.Color('#3a3c68')
  const cloudMat = new THREE.MeshBasicMaterial({ color: '#dceef4', transparent: true, opacity: 0.62, fog: false })
  const clouds = []
  for (let i = 0; i < 7; i++) {
    const cl = new THREE.Group()
    const n = 3 + (i % 3)
    for (let k = 0; k < n; k++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(3.2 + (k % 3) * 1.6, 7, 5), cloudMat)
      puff.position.set(k * 4.2 - n * 2, (k % 2) * 1.4, 0)
      puff.scale.y = 0.55
      cl.add(puff)
    }
    cl.position.set(-90 + i * 34, 26 + (i % 3) * 9, -160 - (i % 4) * 40)
    scene.add(cl)
    clouds.push(cl)
  }

  // ----- 미지의 밤 — 별과 행성 (아웃트로에서만 떠오른다) -----
  const starGeo = new THREE.BufferGeometry()
  const starPos = new Float32Array(220 * 3)
  for (let k = 0; k < 220; k++) {
    const a = Math.random() * Math.PI * 2
    const e = 0.16 + Math.random() * 1.3
    const r = 230 + Math.random() * 40
    starPos[k * 3] = Math.cos(a) * Math.cos(e) * r
    starPos[k * 3 + 1] = 40 + Math.sin(e) * r * 0.6
    starPos[k * 3 + 2] = Math.sin(a) * Math.cos(e) * r
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: '#e4e0ff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })
  )
  scene.add(stars)
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(26, 16, 12),
    new THREE.MeshBasicMaterial({ color: '#cfc4e8', transparent: true, opacity: 0, fog: false })
  )
  planet.position.set(-150, 62, -300)
  scene.add(planet)
  const planetRing = new THREE.Mesh(
    new THREE.TorusGeometry(38, 1.6, 6, 40),
    new THREE.MeshBasicMaterial({ color: '#9fd4e0', transparent: true, opacity: 0, fog: false })
  )
  planetRing.position.copy(planet.position)
  planetRing.rotation.x = 1.25
  planetRing.rotation.y = 0.3
  scene.add(planetRing)

  const hemi = new THREE.HemisphereLight('#eaf6ff', '#8fa08c', 0.72) // 바운스가 밝으면 아래면이 안 어두워진다
  scene.add(hemi)
  const sun = new THREE.DirectionalLight('#fff6e4', 1.6)
  sun.position.set(-5.4, 9, -9.6) // 첫 프레임부터 SUN_POS[0] 과 같은 자리 — 해와 그림자가 어긋난 채 시작하지 않는다
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -26
  sun.shadow.camera.right = 26
  sun.shadow.camera.top = 26
  sun.shadow.camera.bottom = -26
  sun.shadow.bias = -0.0008
  sun.shadow.normalBias = 0.02
  scene.add(sun)

  // 땅·모래·바다는 세계(world)가 지형으로 소유한다 — 길과 함께 층층이 내려가야 하므로
  const world = buildWorld(scene, PREMISES.length, PREMISES)

  // CTA 입간판 — 버튼은 세계 속 팻말 위에 얹힌다. 걷기 시작하면 풍경과 함께 뒤로 흘러간다
  const sign = new THREE.Group()
  const signPostMat = new THREE.MeshStandardMaterial({ color: '#b98a5e', flatShading: true })
  const signPostL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.15, 0.09), signPostMat)
  signPostL.position.set(-0.76, 0.575, 0)
  const signPostR = signPostL.clone()
  signPostR.position.x = 0.76
  // 간판 글씨 — 버튼 DOM 대신 판에 직접 그린다 (클릭하면 문구가 바뀐다)
  const signCv = document.createElement('canvas')
  signCv.width = 640
  signCv.height = 344
  const signCtx = signCv.getContext('2d')
  // roundRect 미지원 브라우저에서 간판 그리기가 통째로 죽지 않도록 폴백을 깐다
  if (typeof signCtx.roundRect !== 'function') {
    signCtx.roundRect = function (x, y, w, h, r) { this.rect(x, y, w, h); return this }
  }
  let signMode = 'cta' // 폰트가 늦게 로드돼 다시 그릴 때, 현재 문구를 잃지 않는다
  function drawSign(mode) {
    signMode = mode ?? signMode
    const W = 640
    signCtx.fillStyle = '#ffffff'
    signCtx.fillRect(0, 0, W, 344)
    signCtx.textAlign = 'center'
    if (signMode === 'thanks') {
      signCtx.fillStyle = 'rgba(22, 48, 60, 0.78)'
      signCtx.font = '600 32px "IBM Plex Sans KR", "Malgun Gothic", sans-serif'
      signCtx.fillText('소중한 시간 내어주셔서', W / 2, 130)
      signCtx.fillStyle = '#f4552b'
      signCtx.font = '700 58px "IBM Plex Sans KR", "Malgun Gothic", sans-serif'
      signCtx.fillText('감사합니다', W / 2, 212)
    } else {
      signCtx.fillStyle = '#16303c'
      signCtx.font = '700 46px "IBM Plex Sans KR", "Malgun Gothic", sans-serif'
      signCtx.fillText('한 걸음씩 소개하겠습니다', W / 2, 118)
      signCtx.fillStyle = '#f4552b'
      signCtx.beginPath()
      signCtx.roundRect(W / 2 - 90, 146, 180, 7, 4)
      signCtx.fill()
      signCtx.fillStyle = 'rgba(22, 48, 60, 0.82)'
      signCtx.font = '600 32px "IBM Plex Sans KR", "Malgun Gothic", sans-serif'
      signCtx.fillText('바쁘시겠지만, 잠깐 걸으며 알아가요', W / 2, 214)
      // 클릭 어포던스 — 코랄 필
      signCtx.fillStyle = '#f4552b'
      signCtx.beginPath()
      signCtx.roundRect(W / 2 - 92, 248, 184, 52, 26)
      signCtx.fill()
      signCtx.fillStyle = '#ffffff'
      signCtx.font = '700 27px "IBM Plex Sans KR", "Malgun Gothic", sans-serif'
      signCtx.fillText('눌러서 시작', W / 2, 283)
    }
  }
  drawSign()
  const signTex = new THREE.CanvasTexture(signCv)
  signTex.colorSpace = THREE.SRGBColorSpace
  if (document.fonts?.ready) document.fonts.ready.then(() => { drawSign(signMode); signTex.needsUpdate = true })
  const signSideMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#dff2f8', emissiveIntensity: 0.42, flatShading: true })
  const signFaceMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: signTex,
    emissive: '#ffffff',
    emissiveMap: signTex,
    emissiveIntensity: 0.5,
    flatShading: true,
  })
  const signBoard = new THREE.Mesh(
    new THREE.BoxGeometry(1.82, 0.98, 0.07),
    [signSideMat, signSideMat, signSideMat, signSideMat, signFaceMat, signSideMat]
  )
  signBoard.position.set(0, 1.14, 0)
  const signEdge = new THREE.Mesh(
    new THREE.BoxGeometry(1.86, 0.06, 0.075),
    new THREE.MeshStandardMaterial({ color: '#3fd4e0', emissive: '#3fd4e0', emissiveIntensity: 0.9 })
  )
  signEdge.position.set(0, 0.62, 0.004)
  sign.add(signPostL, signPostR, signBoard, signEdge)
  sign.position.set(1.95, 0, 0.5)
  sign.rotation.y = -0.5
  sign.scale.setScalar(0.85)
  sign.traverse((c) => { if (c.isMesh) c.castShadow = true })
  world.group.add(sign)

  // 후처리 없음 — 빛 번짐을 쓰지 않기로 했으므로 컴포저도 두지 않는다.
  // (렌더타깃 2장 ≈ 100MB 를 쓰지도 않으면서 잡고 있었다)
  // 느린 기기에서만 해상도를 단계적으로 낮춘다 (45fps 이상이면 아무것도 하지 않는다)
  const quality = createQualityGovernor({ renderer, onDisableBloom: () => {} })

  // 하단 여정 바 — 7개 노드와 달리는 점
  // 지도 — 굽은 경로 하나에 자리 4개를 얹고, 걸은 만큼 실선이 따라온다
  const NS = 'http://www.w3.org/2000/svg'
  const routeLen = routeEl.getTotalLength()
  routeDone.style.strokeDasharray = `0 ${routeLen}`
  const journeyNodes = world.npcs.map((n) => {
    const pt = routeEl.getPointAtLength((n.dist / world.TOTAL) * routeLen)
    const c = document.createElementNS(NS, 'circle')
    c.setAttribute('class', 'node')
    c.setAttribute('r', '3')
    c.setAttribute('cx', pt.x.toFixed(1))
    c.setAttribute('cy', pt.y.toFixed(1))
    mapNodes.appendChild(c)
    return c
  })
  function drawMap(progress) {
    const at = Math.min(1, Math.max(0, progress)) * routeLen
    routeDone.style.strokeDasharray = `${at} ${routeLen}`
    const pt = routeEl.getPointAtLength(at)
    mapMe.setAttribute('cx', pt.x.toFixed(1))
    mapMe.setAttribute('cy', pt.y.toFixed(1))
  }

  // 챕터 진입 타이틀 카드
  const cardEl = document.getElementById('chapter-card')
  const cardNum = cardEl.querySelector('.num')
  const cardTitle = cardEl.querySelector('.t')
  let cardTimer = null
  function flashChapterCard(i) {
    cardNum.textContent = `CHAPTER ${String(i + 1).padStart(2, '0')}`
    cardEl.style.setProperty('--zone-c', PREMISES[i].themeColor ?? '')
    cardTitle.textContent = PREMISES[i].kicker
    cardEl.classList.add('show')
    if (cardTimer) clearTimeout(cardTimer)
    cardTimer = setTimeout(() => cardEl.classList.remove('show'), 2400)
  }

  // ---------- 걷는 로봇 ----------

  // 성장 연출 — 한계를 깰 때마다 발밑에서 빛 고리가 퍼지고 불꽃이 오르며, 로봇이 실제로 조금 자란다
  const growRing = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1, 40),
    new THREE.MeshBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
  )
  growRing.rotation.x = -Math.PI / 2
  growRing.position.y = 0.1
  scene.add(growRing)
  const SPARK_N = 18
  const sparks = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.045, 0),
    new THREE.MeshBasicMaterial({ color: '#ffe9b0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    SPARK_N
  )
  sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  sparks.frustumCulled = false
  scene.add(sparks)
  const sparkSeed = []
  for (let i = 0; i < SPARK_N; i++) {
    sparkSeed.push({ a: (i / SPARK_N) * Math.PI * 2 + (i % 3) * 0.4, r: 0.35 + (i % 5) * 0.13, sp: 1.6 + (i % 4) * 0.5 })
  }
  const growSeat = new THREE.Object3D()

  // 레벨 배지 — 머리 위에 떠서, 한계를 깰 때마다 오른다
  const lvCv = document.createElement('canvas')
  lvCv.width = 256
  lvCv.height = 96
  const lvCtx = lvCv.getContext('2d')
  const lvTex = new THREE.CanvasTexture(lvCv)
  lvTex.colorSpace = THREE.SRGBColorSpace
  function drawLevel(n) {
    lvCtx.clearRect(0, 0, 256, 96)
    lvCtx.font = '700 44px "IBM Plex Sans KR", sans-serif'
    lvCtx.textAlign = 'center'
    lvCtx.textBaseline = 'middle'
    lvCtx.lineWidth = 7
    lvCtx.strokeStyle = 'rgba(22, 48, 60, 0.8)'
    lvCtx.strokeText(`Lv.${n}`, 128, 47)
    lvCtx.fillStyle = '#ffe9a0'
    lvCtx.fillText(`Lv.${n}`, 128, 47)
    lvTex.needsUpdate = true
  }
  drawLevel(1)
  const lvSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: lvTex, transparent: true, depthWrite: false }))
  lvSprite.scale.set(1.1, 0.41, 1)
  lvSprite.position.y = 2.35
  let curLv = 1

  const walker = new THREE.Group()
  walker.position.set(0, 0.05, 0) // 발이 흙길 윗면에 선다
  walker.rotation.y = -0.49 // 랜딩에서는 관람자를 바라본다
  scene.add(walker)
  walker.add(lvSprite)

  let mixer = null
  let walkAction = null
  let idleAction = null
  let waveAction = null
  let yesAction = null
  let jumpAction = null
  let thumbsAction = null
  let landingFace = -0.49 // 랜딩 기본: 관람자를 본다. 간판을 가리킬 때 잠시 돌아선다
  let waved = false

  new GLTFLoader().load(
    './models/RobotExpressive.glb',
    (gltf) => {
      const model = gltf.scene
      model.scale.setScalar(0.44)
      model.traverse((c) => { if (c.isMesh) c.castShadow = true })
      walker.add(model)
      mixer = new THREE.AnimationMixer(model)
      const clips = gltf.animations
      const find = (name) => clips.find((c) => c.name.toLowerCase() === name)
      const walkClip = find('walking') ?? clips[0]
      const idleClip = find('idle') ?? clips[0]
      const waveClip = find('wave')
      walkAction = mixer.clipAction(walkClip)
      idleAction = mixer.clipAction(idleClip)
      walkAction.play()
      idleAction.play()
      walkAction.weight = 0
      idleAction.weight = 1
      if (waveClip) {
        waveAction = mixer.clipAction(waveClip)
        waveAction.setLoop(THREE.LoopOnce)
        waveAction.clampWhenFinished = true
      }
      const yesClip = find('yes')
      if (yesClip) {
        yesAction = mixer.clipAction(yesClip)
        yesAction.setLoop(THREE.LoopOnce)
      }
      const jumpClip = find('jump')
      if (jumpClip) {
        jumpAction = mixer.clipAction(jumpClip)
        jumpAction.setLoop(THREE.LoopOnce)
      }
      const thumbsClip = find('thumbsup')
      if (thumbsClip) {
        thumbsAction = mixer.clipAction(thumbsClip)
        thumbsAction.setLoop(THREE.LoopOnce)
      }
      // 동작의 규칙: 인사(Wave)와 끄덕임(Yes)은 1회 재생 후 일상으로 돌아간다
      mixer.addEventListener('finished', (e) => {
        if (e.action === waveAction && !waved) waveAction.fadeOut(0.5)
        if (e.action === waveAction && waved && yesAction) {
          setTimeout(() => yesAction.reset().fadeIn(0.3).play(), 400) // 인사 뒤 목례
        }
        if (e.action === yesAction) yesAction.fadeOut(0.4)
        if (e.action === jumpAction) jumpAction.fadeOut(0.3)
        if (e.action === thumbsAction) {
          thumbsAction.fadeOut(0.4)
          landingFace = -0.49 // 소개가 끝나면 다시 관람자에게
        }
      })
      // 랜딩 인사 — 우연히 서 있는 게 아니라 기다리고 있었다
      if (waveAction) {
        setTimeout(() => {
          if (window.scrollY < window.innerHeight * 0.3) waveAction.reset().fadeIn(0.3).play()
        }, 1400)
      }
      // 간판 소개 — 이따금 간판 쪽으로 돌아서서 엄지척: "이거 보세요"
      if (thumbsAction) {
        setInterval(() => {
          if (walkStarted || window.scrollY > window.innerHeight * 0.3) return
          if (waveAction?.isRunning() || jumpAction?.isRunning() || thumbsAction.isRunning()) return
          landingFace = 1.15
          setTimeout(() => thumbsAction.reset().fadeIn(0.25).play(), 320)
        }, 7500)
      }
      liftVeil()
    },
    undefined,
    () => {
      const mat = new THREE.MeshStandardMaterial({ color: '#8d857a', flatShading: true })
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.75, 4, 10), mat)
      body.position.y = 1.05
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), mat)
      head.position.y = 1.85
      body.castShadow = head.castShadow = true
      walker.add(body, head)
    }
  )

  // ---------- 스크롤 = 걸음 ----------

  let walked = 0

  // 랜딩을 다 지나야 여정이 시작된다
  function journeyBase() {
    return Math.max(0, landingEl.offsetHeight - window.innerHeight * 0.15)
  }

  function scrollProgress() {
    const base = journeyBase()
    const span = document.documentElement.scrollHeight - window.innerHeight - base
    return span > 0 ? Math.min(1, Math.max(0, (window.scrollY - base) / span)) : 0
  }

  let walkStarted = false
  function startWalk() {
    const go = () => window.scrollTo({ top: journeyBase() + window.innerHeight * 0.25, behavior: 'smooth' })
    if (walkStarted || reduceMotion) { walkStarted = true; go(); return }
    walkStarted = true
    landingFace = -0.49 // 간판을 보던 중이었어도 관람자를 향해 인사한다
    // 시작의 감사는 계약으로 — 간판 글씨가 바뀌고, 클릭 유도는 임무 종료
    drawSign('thanks')
    signTex.needsUpdate = true
    const hint = document.getElementById('click-hint')
    if (hint) hint.style.display = 'none'
    // 클릭은 나에 대한 선택 — 로봇이 머리 위 말풍선과 함께 기뻐서 뛴다
    if (thanksBubble) {
      camera.updateMatrixWorld()
      const p = new THREE.Vector3(0, 2.5, 0).project(camera)
      thanksBubble.style.left = `${((p.x * 0.5 + 0.5) * 100).toFixed(1)}%`
      thanksBubble.style.top = `${((-p.y * 0.5 + 0.5) * 100).toFixed(1)}%`
      thanksBubble.classList.add('show')
      setTimeout(() => thanksBubble.classList.remove('show'), 1200) // 세계가 움직이기 전에 사라진다
    }
    if (jumpAction) jumpAction.reset().fadeIn(0.15).play()
    else if (yesAction) yesAction.reset().fadeIn(0.2).play()
    setTimeout(go, 1050) // 점프가 착지한 뒤 세계가 움직인다
  }
  const startBtn = document.getElementById('start-walk')
  startBtn.addEventListener('click', startWalk)
  // 호버 — 간판이 반갑게 반응한다
  startBtn.addEventListener('pointerenter', () => {
    sign.scale.setScalar(0.89)
    signEdge.material.emissiveIntensity = 1.6
  })
  startBtn.addEventListener('pointerleave', () => {
    sign.scale.setScalar(0.85)
    signEdge.material.emissiveIntensity = 0.9
  })

  // CTA를 로봇 발 앞 월드 좌표에 앵커 — 뷰포트 비율이 바뀌어도 '발밑' 관계 유지
  const ctaWrap = document.querySelector('.cta-wrap')
  const ctaAnchor = new THREE.Vector3()
  function placeCta() {
    if (!ctaWrap || window.scrollY > window.innerHeight * 0.3) return
    // 좁은 화면에서는 간판이 화면 밖으로 밀려난다 — 위치를 CSS(가운데)에 되돌려준다
    if (window.innerWidth < 900) {
      if (ctaWrap.style.left) { ctaWrap.style.left = ''; ctaWrap.style.top = '' }
      return
    }
    camera.updateMatrixWorld()
    // 팻말 판 중앙에 버튼을 얹는다
    const v = ctaAnchor.set(1.95, 0.97, 0.5).project(camera)
    const left = Math.min(94, Math.max(6, (v.x * 0.5 + 0.5) * 100))
    const top = Math.min(92, Math.max(8, (-v.y * 0.5 + 0.5) * 100))
    ctaWrap.style.left = `${left.toFixed(2)}%`
    ctaWrap.style.top = `${top.toFixed(2)}%`
  }
  setTimeout(placeCta, 150)

  // 랜딩에서는 마우스가 카메라를 미세하게 움직인다 — 유리 뒤 세계가 패럴랙스로 살아난다
  let mouseX = 0
  let mouseY = 0
  window.addEventListener('pointermove', (e) => {
    mouseX = e.clientX / window.innerWidth - 0.5
    mouseY = e.clientY / window.innerHeight - 0.5
  })

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, renderer.getPixelRatio()))
    renderer.setSize(window.innerWidth, window.innerHeight)
    placeCta()
  })

  function skyAt(t) {
    for (let i = 0; i < SKY.length - 1; i++) {
      const [t0, c0] = SKY[i]
      const [t1, c1] = SKY[i + 1]
      if (t <= t1) return c0.clone().lerp(c1, (t - t0) / (t1 - t0))
    }
    return SKY[SKY.length - 1][1].clone()
  }

  // ---------- UI 갱신 (만남 팝업 · 대시보드 · 인트로/엔딩) ----------

  let activePopup = -1
  let typeTimer = null
  let outroFilled = false
  let atEnd = false
  let farthest = 0 // 가장 멀리 간 지점 — 되돌아 걸어도 기록은 줄지 않는다

  // 전제가 한 글자씩 새겨지고, 걸음에 따라 비트가 하나씩 얹힌다.
  // 한 번에 다 쏟으면 읽기 벽이 되고, 정작 세계에서 일어나는 일을 못 본다.
  function stopTyping() {
    if (typeTimer) {
      clearInterval(typeTimer)
      typeTimer = null
    }
  }

  // 만남 — 로봇은 자리에 멈춰 NPC 를 마주 보고, 스페이스로 문답을 넘긴다. 최대 3문답.
  // state 0 대기 / 1 대화 중(걸음·스크롤 잠금) / 2 끝(다시 걸음)
  const meets = PREMISES.map(() => ({ state: 0, step: 1, t0: 0, shownAll: false }))
  // 비트를 3묶음으로 — 한 번에 한두 문단씩. oneShot 존은 쪼개지 않는다(상영과 함께 전부 한 번에).
  const chunk3 = (beats) => {
    const per = Math.ceil(beats.length / 3)
    const chunks = []
    for (let i = 0; i < beats.length; i += per) chunks.push(beats.slice(i, i + per))
    return chunks
  }
  const meetChunks = PREMISES.map((p2) => (p2.oneShot ? [p2.beats] : chunk3(p2.beats)))
  const popupStep = popupEl.querySelector('.hint .step')
  const popupHint = popupEl.querySelector('.hint')
  const popupVerb = popupEl.querySelector('.hint .verb')
  // 터치 기기엔 SPACE 가 없다 — 힌트가 거짓말하지 않게
  const popupKbd = popupEl.querySelector('.hint kbd')
  if (popupKbd && matchMedia('(pointer: coarse)').matches) popupKbd.textContent = 'TAP'
  let lockScrollY = -1 // 대화 중 고정할 스크롤 위치
  let talkF = 0 // 대화 몰입 계수 — 카메라·비네트가 함께 탄다
  let projZone = -1 // 어느 존의 영사기가 주인인가 — 소등 페이드 동안에도 유지되는 래치
  const veilEl = document.getElementById('talk-veil')
  const talkingNow = () => meets.findIndex((m) => m.state === 1)
  function renderMeet(i) {
    const m = meets[i]
    const chunks = meetChunks[i]
    const oneShot = !!PREMISES[i].oneShot
    popupStep.textContent = chunks.length > 1 ? `${Math.min(m.step, chunks.length)} / ${chunks.length}` : ''
    popupHint.classList.add('on')
    // oneShot: 힌트는 두 박자 늦게 — 즉시 띄우면 재촉으로 읽힌다
    popupHint.style.transitionDelay = oneShot && m.step === 1 ? '2s' : '0s'
    popupVerb.textContent = m.step >= chunks.length ? '계속 걷기' : '다음'
    const shown = chunks[Math.min(m.step, chunks.length) - 1] || []
    ui.beatKey = `meet:${i}:${m.step}`
    // oneShot: 장면(0s) → 답 첫 줄(0.6s) → 둘째 줄(1.05s) — 시선이 한 번씩만 지나가는 스태거
    popupA.innerHTML = shown
      .map(
        (b, j) =>
          `<p class="${b.kind === 'cost' ? 'cost' : ''}"${oneShot ? ` style="animation-delay:${(0.6 + j * 0.45).toFixed(2)}s"` : ''}>${b.text}</p>`
      )
      .join('')
    popupA.classList.add('on')
  }
  function endMeet(i) {
    meets[i].state = 2
    ui.beatKey = `meet:${i}:done` // 이미 다 보인 글을 다시 그려 깜빡이지 않게
    popupStep.textContent = ''
    popupHint.classList.remove('on')
    popupHint.style.transitionDelay = '0s'
    // 자동 접근으로 당겨 걸은 거리만큼 스크롤을 앞으로 맞춘다 — 안 맞추면 대화가 끝나고 뒷걸음질친다
    const stopD = world.npcs[i].dist - 2.1
    const base = journeyBase()
    const span = document.documentElement.scrollHeight - window.innerHeight - base
    if (span > 0 && scrollProgress() * world.TOTAL < stopD) {
      window.scrollTo(0, base + (stopD / world.TOTAL) * span)
    }
  }
  function advanceMeet() {
    const i = talkingNow()
    if (i < 0) return false
    const m = meets[i]
    // 성급한 첫 입력은 닫기가 아니라 전부 보여주기 — 스태거를 건너뛰고 상영은 결말로 빨리감기
    if (PREMISES[i].oneShot && !m.shownAll && sceneTime - m.t0 < 1.8) {
      m.shownAll = true
      popupA.querySelectorAll('p').forEach((p) => {
        p.style.animation = 'none'
        p.style.opacity = '1'
        p.style.transform = 'none'
      })
      world.projectors?.forEach((p) => {
        if (p.zone === i) p.fast()
      })
      return true
    }
    if (m.step >= meetChunks[i].length) endMeet(i)
    else {
      m.step += 1
      renderMeet(i)
    }
    return true
  }
  // 대화 중 스크롤 잠금 — 걸음이 잠겨 있는데 화면만 흐르면 어긋난다.
  // 탈출구는 있으되, 걸어오던 관성 스크롤이 대화를 스치듯 끝내면 안 된다:
  // 만남 1.5초 경과 후, 직전 휠과 350ms 이상 떨어진 "새 플릭"만 세어 두 번이면 계속 걷기.
  let talkWheelN = 0
  let talkWheelT = 0
  const blockIfTalking = (e) => {
    const i = talkingNow()
    if (i < 0) return
    e.preventDefault()
    if (e.type === 'wheel') {
      const now = performance.now()
      const fresh = now - talkWheelT > 350
      talkWheelT = now
      if (sceneTime - meets[i].t0 < 1.5) {
        talkWheelN = 0 // 진입 관성은 탈출 의사가 아니다
        return
      }
      if (fresh) {
        talkWheelN += 1
        if (talkWheelN >= 2) {
          talkWheelN = 0
          endMeet(i)
        }
      }
    }
  }
  window.addEventListener('wheel', blockIfTalking, { passive: false })
  window.addEventListener('touchmove', blockIfTalking, { passive: false })
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.key === ' ') {
      if (advanceMeet()) e.preventDefault()
      return
    }
    if (e.key === 'Escape' && talkingNow() >= 0) {
      endMeet(talkingNow()) // 탈출에 사과나 확인창은 없다 — 손님의 시간을 존중하는 게 인상이 된다
      return
    }
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key) && talkingNow() >= 0) {
      e.preventDefault()
    }
  })
  popupEl.addEventListener('click', () => advanceMeet()) // 마우스만 쓰는 손님을 위해

  // 화면에 동시에 두 개까지. 세 번째가 뜨면 첫째는 빠진다.
  function renderBeats(index, rel) {
    const item = PREMISES[index]
    const shown = item.beats.filter((b) => rel >= b.at)
    const key = `${index}:${shown.length}`
    if (key === ui.beatKey) return
    ui.beatKey = key
    if (!shown.length) {
      popupA.innerHTML = ''
      popupA.classList.remove('on')
      return
    }
    popupA.innerHTML = shown
      .slice(-2)
      .map((b) => `<p class="${b.kind === 'cost' ? 'cost' : ''}">${b.text}</p>`)
      .join('')
    popupA.classList.add('on')
  }

  function typeQuestion(index) {
    stopTyping()
    const text = PREMISES[index].premise
    // 헤더는 존 테마('시작' 등)를 존 색으로 — 서수는 HUD 번호가 이미 말한다
    popupWho.textContent = PREMISES[index].kicker
    popupEl.style.setProperty('--zone-c', PREMISES[index].themeColor ?? '')
    popupA.innerHTML = ''
    popupA.classList.remove('on')
    ui.beatKey = ''
    popupQ.innerHTML = '<span class="caret"></span>'
    if (reduceMotion) {
      popupQ.innerHTML = `“${text}”`
      return
    }
    let k = 0
    typeTimer = setInterval(() => {
      k++
      popupQ.innerHTML = `“${text.slice(0, k)}”<span class="caret"></span>`
      if (k >= text.length) {
        stopTyping()
        popupQ.innerHTML = `“${text}”`
      }
    }, 42) // 쏟아지지 않고 새겨지는 속도 — 첫 문장이 손글씨의 리듬으로 적힌다
  }

  // 이름을 collect 로 되돌리지 말 것 — echarts 가 최상위에 같은 이름의 함수를 갖고 있어
  // 번들에서 충돌한다("Identifier 'collect' has already been declared"). dev 서버는 모듈을
  // 따로 두어 멀쩡하고, 프로덕션 빌드에서만 스크립트 전체가 파싱 단계에서 죽는다.
  function markCollected(i) {
    if (collected[i]) return
    collected[i] = true
    chips[i]?.classList.add('done')
    journeyNodes[i]?.classList.add('done')
  }

  // 매 프레임 같은 값을 다시 쓰면 레이아웃이 무효화된다 — 바뀔 때만 손댄다
  const ui = { pct: -1, title: '', dist: -1, time: '', fade: -1, inJourney: null, beatKey: '', nowChip: -1, read: -1, verdict: -1 }

  const verdictEl = document.getElementById('verdict')
  let veilOn = false
  let arrived = 0 // 자리 도착 계수 — 몸 돌림·카메라·비네트가 함께 탄다

  function updateUi(progress, t) {
    // v2: 스크롤 락 없음 — 세계는 걸음을 멈추지 않는다.
    // 칩은 정거장을 지나치기만 해도 쌓여, 빨리 걸어도 요지는 남는다.

    // 걷기 시작하면 버튼은 임무를 마치고 사라진다 (팻말은 세계와 함께 뒤로)
    if (ctaWrap) {
      const phUi = THREE.MathUtils.smoothstep(window.scrollY / (window.innerHeight * 0.9), 0, 1)
      const fade = Math.round(Math.max(0, 1 - phUi * 2.4) * 100) / 100
      if (fade !== ui.fade) {
        ui.fade = fade
        ctaWrap.style.opacity = String(fade)
        ctaWrap.style.pointerEvents = fade < 0.4 ? 'none' : ''
      }
    }

    // 계기판·여정 바는 여정에 들어선 뒤에만
    const inJourney = window.scrollY > journeyBase() * 0.72
    if (inJourney !== ui.inJourney) {
      ui.inJourney = inJourney
      miniEl.classList.toggle('hidden-panel', !inJourney)
    }

    // 엔딩 — 임계에 이력을 둬야 경계에서 패널과 로봇이 덜덜 떨지 않는다
    const wasEnd = atEnd
    atEnd = atEnd ? progress > 0.945 : progress > 0.955
    if (atEnd !== wasEnd) outroEl.classList.toggle('hidden-panel', !atEnd)
    if (atEnd && !outroFilled && outroRecord && walked / world.TOTAL > 0.95) {
      outroFilled = true
      const secs = Math.floor(t)
      outroRecord.innerHTML = `여기까지 함께 걸어주셨습니다 — <b>${Math.round(farthest)}m</b>.`
    }

    // 칩 적립은 팝업과 무관 — 지나친 정거장은 무조건 쌓인다 (점프 스크롤 포함)
    world.npcs.forEach((n, i) => {
      if (!collected[i] && walked > n.dist - 2) markCollected(i)
    })

    // 만남 팝업: 대화 중(state 1)에만 뜬다 — 창이 곧 이벤트다. 걸어오는 길에 미리 보이면 김이 샌다.
    // 다시 읽는 방법은 텍스트 잔류가 아니라 되돌아와서 상영을 다시 여는 것(양방향 재무장).
    let near = -1
    meets.forEach((m, i) => {
      if (m.state === 1) near = i
    })
    if (atEnd) near = -1
    if (near !== activePopup) {
      activePopup = near
      if (near >= 0) {
        popupEl.classList.remove('hidden-panel')
        typeQuestion(near)
        flashChapterCard(near)
      } else {
        stopTyping() // 타이핑 중에 지나쳐도 숨은 팝업이 혼자 진행되지 않게
        popupEl.classList.add('hidden-panel')
      }
    }
    if (veilEl) veilEl.classList.toggle('on', veilOn)
    if (near >= 0 && PREMISES[near].flow) {
      // 흐르는 존 — 걸음이 곧 페이지 넘김. 정지도 클릭도 없다. (현재 미사용 — oneShot 상영이 표준)
      renderBeats(near, walked - world.npcs[near].dist)
    } else if (near >= 0 && meets[near].state === 1 && ui.beatKey !== `meet:${near}:${meets[near].step}`) {
      renderMeet(near) // 대화는 멈춰 선 문답이 전부다 — 걷는 중에는 아무것도 재생하지 않는다
    }
    if (near !== ui.nowChip) {
      chips[ui.nowChip]?.classList.remove('now')
      ui.nowChip = near
      chips[near]?.classList.add('now')
      chips[near]?.style.setProperty('--zone-c', PREMISES[near]?.themeColor ?? '') // 현재 존 한 줄만 존 색
    }
    // 머문 시간 — 분모도 목표도 붙이지 않는다. 재는 값이 아니라 적는 값이다
    const sec = Math.floor(t)
    const clockStr = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
    if (clockStr !== ui.time) {
      ui.time = clockStr
      stTime.firstChild.textContent = clockStr.slice(0, 2)
      stTime.querySelector('i').textContent = clockStr.slice(2)
    }
    // 읽은 문단 — 진행을 세계의 단위(m·%)가 아니라 읽기의 단위로 말한다
    let read = 0
    for (let i = 0; i < PREMISES.length; i++) {
      const rel = walked - world.npcs[i].dist
      for (const b of PREMISES[i].beats) if (rel >= b.at) read++
    }
    if (read !== ui.read) {
      ui.read = read
      stRead.firstChild.textContent = String(read).padStart(2, '0')
    }
    // 결론 — 전제가 무너진 직후에만 잔해 위에 선다. 걸음의 순수 함수라 되감아도 성립한다.
    let verdict = -1
    for (let i = 0; i < PREMISES.length; i++) {
      const gate = 26 + i * 60 + 48
      if (walked > gate + 3 && walked < gate + 16) verdict = i
      const passed = walked > gate + 3
      if (passed !== chipShown[i]) {
        chipShown[i] = passed
        chips[i].innerHTML = `<b>${i + 1}</b><span>${passed ? PREMISES[i].chip : PREMISES[i].kicker}</span>`
      }
    }
    if (verdict !== ui.verdict) {
      ui.verdict = verdict
      if (verdict >= 0) {
        verdictEl.textContent = PREMISES[verdict].conclusion
        verdictEl.style.opacity = '1'
      } else {
        verdictEl.style.opacity = '0'
      }
    }

    drawMap(progress)

  }

  // ── 문을 지나는 순간의 가속 ──
  // 스크롤→걸음 사상을 문 앞뒤에서 구부린다. 문 직전에는 걸음이 뒤로 눌려 뜸을 들이다가,
  // 문턱에서 두 배 가까운 속도로 빠져나간다 — 통과가 "지나갔다"가 아니라 "빨려 들어갔다"가 된다.
  // 진행률만의 순수 함수라 되감아도 같은 자리다(상태 없음 = 역스크롤 멱등).
  // 기울기 1 + (A/W)(1-u²)e^(-u²/2) 의 최솟값이 1 - 0.446(A/W) — A/W = 0.9 면 0.6배까지만
  // 느려지고 절대 뒤로 가지 않는다. 문턱에서는 1.9배.
  const GATES = [0, 1, 2, 3].map((i) => 26 + i * 60 + 48)
  const DASH_W = 5.5
  const DASH_A = DASH_W * 0.9
  function gateWarp(d) {
    let out = d
    for (const g of GATES) {
      const u = (d - g) / DASH_W
      // 창을 ±6 으로 잡는다 — ±4 에서 자르면 경계에서 6mm 가 툭 끊긴다(미분이 튄다)
      if (u > -6 && u < 6) out += DASH_A * u * Math.exp(-u * u * 0.5)
    }
    return out
  }
  // 문턱에서의 화각 킥 — 속도는 다리가 아니라 시야가 말한다. 걸음이 제일 빠른 지점에서 최대.
  const BASE_FOV = camera.fov

  const clock = new THREE.Clock()
  const lookTarget = new THREE.Vector3(-0.5, 1.05, -9)
  const lookNow = lookTarget.clone()
  let prevWalked = 0
  let idleFor = 0 // 자리를 비운 시간은 머문 시간이 아니다
  let sceneTime = 0 // clamped dt 누적 — 탭을 오래 비워도 파도·호흡 위상이 튀지 않는다
  let walkTime = 0 // 함께한 시간은 페이지를 연 때가 아니라 걷기 시작한 때부터
  let booting = true

  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.06, clock.getDelta())
    sceneTime += dt
    const t = sceneTime
    const progress = scrollProgress()
    // 랜딩→여정 위상 (0=마주 보기, 1=동행) — 스크롤 첫 0.9화면 구간을 스크럽
    const ph = THREE.MathUtils.smoothstep(window.scrollY / (window.innerHeight * 0.9), 0, 1)
    const walkedTarget = gateWarp(progress * world.TOTAL)

    if (booting) {
      // 새로고침으로 중간에서 시작하면, 걸어온 척 되감지 않고 그 자리에서 시작한다
      booting = false
      walked = walkedTarget
      const passed = world.npcs.filter((n) => walked > n.dist - 2).length
      world.npcs.forEach((n, i) => {
        if (walked > n.dist - 2) markCollected(i)
        // flow 존은 state 2 로 잠그지 않는다 — 새로고침 후 되돌아와도 흔적이 다시 흘러야 한다
        if (walked > n.dist - 2.1 && !PREMISES[i].flow) meets[i].state = 2
      })
    } else {
      let target = walkedTarget
      for (let i = 0; i < meets.length; i++) {
        const m = meets[i]
        const stopD = world.npcs[i].dist - 2.1 // NPC 두 걸음 앞
        // 어느 방향으로든 멀어지면 재무장 — 돌아오면 상영이 처음부터 다시 열린다.
        // 재무장 경계(-7/+9)가 발동권(±6)보다 바깥이라, 끝내고 걸어 나가는 중에 다시 발동하지 않는다.
        if (m.state === 2 && (walked < stopD - 7 || walked > stopD + 9)) {
          m.state = 0
          m.step = 1
          m.shownAll = false
        }
        // 발동권(±6m)에 들어서면 스크롤과 무관하게 자동으로 NPC 앞까지 걸어가 멈춘다 — 상영관이 된다
        if (m.state === 0 && !PREMISES[i].flow && Math.abs(walked - stopD) < 6 && !atEnd) {
          m.state = 1
          m.step = 1
          m.t0 = sceneTime // 성급한 입력·관성 스크롤 판정 기준
          projZone = i // 이 존의 영사기가 소등 페이드까지 주인이다
          talkWheelN = 0
          lockScrollY = window.scrollY // 대화 동안 화면도 여기 선다
        }
        if (m.state === 1) target = stopD // 남은 걸음은 자동 — 스페이스로 끝내야 풀린다
      }
      if (talkingNow() >= 0 && lockScrollY >= 0 && Math.abs(window.scrollY - lockScrollY) > 2) {
        window.scrollTo(0, lockScrollY)
      }
      walked += (target - walked) * Math.min(1, dt * 4.5)
    }
    farthest = Math.max(farthest, walked)
    idleFor = Math.abs(walked - prevWalked) > dt * 0.25 ? 0 : idleFor + dt
    if (walked > 0.5 && !atEnd && idleFor < 20) walkTime += dt

    world.update(walked, dt, t, projZone, talkF) // 대화 상태를 넘긴다 — ? 스프라이트·NPC 몸 돌림이 이걸 탄다

    // 성장 — 한계를 깰 때마다 로봇이 5% 씩 자란다. 네 번이면 스스로 알아챌 만큼.
    let grown = 0
    let burstU = -1
    for (let i = 0; i < 4; i++) {
      const gate = GATES[i]
      grown += smooth01((walked - gate) / 4)
      const u = (walked - gate) / 5.5
      if (u > 0 && u < 1) burstU = u
    }
    walker.scale.setScalar(1 + 0.05 * grown)
    const lvNow = 1 + GATES.filter((g) => walked > g + 2.2).length
    if (lvNow !== curLv) {
      curLv = lvNow
      drawLevel(curLv)
    }
    // 레벨업 순간 배지가 한 번 부풀었다 돌아온다
    const lvPop = burstU >= 0 ? Math.sin(Math.PI * Math.min(1, burstU * 1.6)) * 0.35 : 0
    lvSprite.scale.set(1.1 * (1 + lvPop), 0.41 * (1 + lvPop), 1)
    lvSprite.position.y = 2.35 + Math.sin(t * 1.8) * 0.05
    if (burstU >= 0) {
      const ringU = Math.min(1, burstU * 1.4)
      growRing.visible = true
      growRing.scale.setScalar(0.4 + ringU * 4.2)
      growRing.material.opacity = 0.75 * (1 - ringU)
      sparks.visible = true
      sparks.material.opacity = 0.9 * (1 - burstU)
      for (let i = 0; i < SPARK_N; i++) {
        const sk = sparkSeed[i]
        growSeat.position.set(
          Math.cos(sk.a + burstU * 2) * sk.r * (1 + burstU * 0.6),
          0.15 + burstU * sk.sp,
          Math.sin(sk.a + burstU * 2) * sk.r * (1 + burstU * 0.6)
        )
        growSeat.scale.setScalar(1 - burstU * 0.75)
        growSeat.updateMatrix()
        sparks.setMatrixAt(i, growSeat.matrix)
      }
      sparks.instanceMatrix.needsUpdate = true
    } else {
      growRing.visible = false
      sparks.visible = false
    }
    updateUi(progress, walkTime)

    // 실제 지면 이동 속도에 걸음 주기를 맞춘다 — 발이 미끄러지지 않게
    const groundSpeed = dt > 0 ? (walked - prevWalked) / dt : 0
    prevWalked = walked
    const moving = Math.abs(groundSpeed) > 0.25
    if (mixer && walkAction && idleAction) {
      const targetW = moving ? 1 : 0
      walkAction.weight += (targetW - walkAction.weight) * Math.min(1, dt * 6)
      idleAction.weight = 1 - walkAction.weight
      walkAction.timeScale = THREE.MathUtils.clamp(Math.abs(groundSpeed) / 1.35, 0.55, 2.6)
      mixer.update(dt)
    }

    // 랜딩에선 관람자를 보고, 걷기 시작하면 길을 향해 돌아서고, 끝에서 다시 마주 본다
    // (atEnd 는 updateUi 가 이력 임계로 갱신한다 — 경계에서 앞뒤로 돌지 않게)
    let facing = atEnd
      ? 0
      : THREE.MathUtils.lerp(landingFace, Math.PI, THREE.MathUtils.smoothstep(ph, 0.25, 0.8))
    // 자리에 도착해 멈춘 뒤에만 NPC 를 마주 본다 — 걸으면서 돌아보면 옆걸음이 된다
    arrived = 0
    if (!atEnd && activePopup >= 0 && meets[activePopup].state === 1) {
      const npc = world.npcs[activePopup]
      const stopD2 = npc.dist - 2.1
      arrived = smooth01((walked - (stopD2 - 1.2)) / 1.1) // 멈추는 마지막 한 걸음에서만
      const dx = npc.group.position.x
      const dz = -npc.dist + walked
      facing += (Math.atan2(dx, dz) - Math.PI) * arrived
    }
    veilOn = arrived > 0.5
    let dFace = facing - walker.rotation.y
    dFace = ((dFace + Math.PI) % (Math.PI * 2)) - Math.PI // 최단 회전 — 돌아섰던 방향 그대로 되돌아온다
    if (dFace < -Math.PI) dFace += Math.PI * 2
    walker.rotation.y += dFace * Math.min(1, dt * 3)
    if (atEnd && !waved && waveAction) {
      waved = true
      waveAction.reset().play()
    }

    // 카메라 리그 — 랜딩 A(마주 보기) → 여정 B(동행)를 스크롤로 스크럽 + 바닷바람 스웨이
    const onLanding = ph < 0.5
    const px = onLanding && !reduceMotion ? mouseX * 0.5 : 0
    const py = onLanding && !reduceMotion ? -mouseY * 0.25 : 0
    camera.position.x = THREE.MathUtils.lerp(-2.8, -2.1, ph) + Math.sin(t * 0.32) * 0.18 + px + talkF * 0.55
    const terrace = Math.max(0, world.trackYAt(Math.max(0, walked - 8.8)) - world.trackYAt(walked))
    // 대화 중에는 카메라가 반 걸음 다가서고 낮아진다 — 시선이 두 사람에게 모인다
    talkF += (arrived - talkF) * Math.min(1, dt * 2.2)
    // 상영 구동 — 빔·스크린은 대화 몰입 계수를 그대로 탄다 (점등·소등 이징이 공짜)
    world.projectors?.forEach((p) => p.update(p.zone === projZone ? talkF : 0, t, dt))
    camera.position.y = THREE.MathUtils.lerp(2.0, 3.1, ph) + terrace * 0.85 + Math.sin(t * 0.45) * 0.08 + py - talkF * 0.75
    camera.position.z = THREE.MathUtils.lerp(6.6, 8.8, ph) - talkF * 2.6
    lookTarget.set(
      THREE.MathUtils.lerp(-0.5, 0.35, ph) - talkF * 1.0, // 로봇과 NPC 의 가운데로
      THREE.MathUtils.lerp(1.05, 1.15, ph) - talkF * 0.15,
      THREE.MathUtils.lerp(-9, -2.5, ph) + talkF * 1.2
    )
    lookNow.lerp(lookTarget, Math.min(1, dt * 2.2))
    camera.lookAt(lookNow)
    // 문턱의 화각 킥 — 걸음이 제일 빠른 지점에서 시야가 벌어졌다 닫힌다. 속도는 다리보다
    // 시야가 먼저 말한다. 걸음(walked)만의 함수라 되감으면 그대로 되감긴다.
    // 다만 실제로 움직일 때만 — 문 앞에 멈춰 서 있는데 화각이 벌어져 있으면 그건 왜곡이다.
    let dash = 0
    for (const g of GATES) {
      const u = (walked - g) / (DASH_W * 0.8)
      if (u > -3 && u < 3) dash = Math.max(dash, Math.exp(-u * u * 0.5))
    }
    dash *= THREE.MathUtils.clamp(Math.abs(groundSpeed) / 5, 0, 1)
    const fovWant = BASE_FOV + 7 * dash
    camera.fov += (fovWant - camera.fov) * Math.min(1, dt * 6)
    if (Math.abs(camera.fov - fovWant) > 0.005 || Math.abs(camera.fov - BASE_FOV) > 0.005) {
      camera.updateProjectionMatrix()
    }
    // 간판은 바닷바람에 흔들린다 — 클릭 영역도 같이 흔들려야 어긋나지 않는다
    if (onLanding) placeCta()

    // 하늘 — 돔·안개·배경이 함께 물든다
    const skyPhase = world.skyPhaseAt(walked)
    const c = skyAt(skyPhase)
    // 상영 소등 — 대화 중 세계가 반 스톱 어두워진다. 밝은 존1 하늘 위에서도 빔이 서고,
    // talk-veil 의 가장자리 어둠과 합쳐져 "객석 소등"이 된다.
    const dim = 1 - 0.34 * talkF
    skyNow.copy(c).multiplyScalar(dim)
    scene.fog.color.copy(skyNow) // 안개는 하늘색 그대로 — 원경을 덮는 커튼은 흰빛이다
    // 전제가 무너질 때마다 보이는 세계가 넓어진다 — 발밑보다 이쪽이 먼저 읽힌다
    scene.fog.far = world.fogFarAt(walked)
    scene.fog.near = 18 + 4 * ph // 랜딩에선 원경이 살짝 물러나 로봇만 또렷하다
    // 광원도 하늘과 같은 키를 탄다 — 새벽 낮은 해에서 미지의 밤까지
    keyLerp(skyPhase, null, (a, b, u) => {
      sun.position.set(
        SUN_POS[a][0] + (SUN_POS[b][0] - SUN_POS[a][0]) * u,
        SUN_POS[a][1] + (SUN_POS[b][1] - SUN_POS[a][1]) * u,
        SUN_POS[a][2] + (SUN_POS[b][2] - SUN_POS[a][2]) * u
      )
      sun.intensity = SUN_INT[a] + (SUN_INT[b] - SUN_INT[a]) * u
      sun.color.copy(SUN_COL[a]).lerp(SUN_COL[b], u)
      skyUniforms.bend.value = SKY_BEND[a] + (SKY_BEND[b] - SKY_BEND[a]) * u
      hemi.color.copy(HEMI_SKY[a]).lerp(HEMI_SKY[b], u)
      hemi.groundColor.copy(HEMI_GND[a]).lerp(HEMI_GND[b], u)
      hemi.intensity = HEMI_INT[a] + (HEMI_INT[b] - HEMI_INT[a]) * u
      sun2d.position.set(
        SUN2D[a][0] + (SUN2D[b][0] - SUN2D[a][0]) * u,
        SUN2D[a][1] + (SUN2D[b][1] - SUN2D[a][1]) * u,
        SUN2D[a][2] + (SUN2D[b][2] - SUN2D[a][2]) * u
      )
      sun2d.scale.setScalar(SUN2D[a][3] + (SUN2D[b][3] - SUN2D[a][3]) * u)
      sun2d.material.opacity = SUN2D[a][4] + (SUN2D[b][4] - SUN2D[a][4]) * u
    })
    // 상영 소등 — keyLerp 가 매 프레임 값을 새로 쓰므로 곱해도 누적되지 않는다
    sun.intensity *= dim
    hemi.intensity *= 1 - 0.28 * talkF
    // 밤이 오면 별과 행성이 떠오르고, 구름은 어둡게 물러난다
    const night = Math.max(0, (skyPhase - 0.86) / 0.14)
    stars.material.opacity = night * 0.9
    planet.material.opacity = night * 0.85
    planetRing.material.opacity = night * 0.5
    cloudMat.opacity = 0.62 - night * 0.3
    cloudMat.color.copy(cloudDay).lerp(cloudNight, night)
    skyUniforms.bottom.value.copy(skyNow)
    for (let i = 0; i < SKY_TOP.length - 1; i++) {
      const [t0, c0] = SKY_TOP[i]
      const [t1, c1] = SKY_TOP[i + 1]
      if (skyPhase <= t1) {
        skyUniforms.top.value.copy(c0).lerp(c1, (skyPhase - t0) / (t1 - t0))
        break
      }
    }
    skyUniforms.top.value.multiplyScalar(dim) // 돔 상단도 함께 소등
    clouds.forEach((cl, i) => {
      cl.position.x += Math.sin(t * 0.08 + i) * 0.004
    })

    quality.tick()
    renderer.render(scene, camera)
  })
}
