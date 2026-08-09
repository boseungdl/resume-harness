// 걷는 사람 — 스크롤은 걸음이 된다.
// 길에서 NPC 를 만나면 질문 팝업이 떠오르고, 지나가면 사라진다.
// 알게 된 것은 우상단 대시보드에 영구히 채워진다.

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { STORY } from './story.js'
import { buildWorld } from './world.js'
import { createQualityGovernor } from './quality.js'

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

// ---------- UI 준비 ----------

const spacer = document.getElementById('spacer')
// 정거장당 스크롤 분량(vh) — 값이 클수록 걸음이 느긋해진다
const SCROLL_PER_STOP = 600
spacer.style.height = `${(STORY.length + 2.4) * SCROLL_PER_STOP}vh`

const landingEl = document.getElementById('landing')
const dashEl = document.getElementById('dash')
const journeyEl = document.getElementById('journey')
const popupEl = document.getElementById('popup')
const popupQ = popupEl.querySelector('.q')
const popupA = popupEl.querySelector('.a')
const outroEl = document.getElementById('outro-panel')
const dashChips = document.getElementById('dash-chips')
const dashPct = document.getElementById('dash-pct')
const kpiMeet = document.getElementById('kpi-meet')
const kpiDist = document.getElementById('kpi-dist')
const kpiTime = document.getElementById('kpi-time')
const popupWho = popupEl.querySelector('.who')
const dashTitle = document.getElementById('dash-title')
const halfNote = document.getElementById('half-note')
const outroRecord = document.getElementById('outro-record')
const thanksBubble = document.getElementById('thanks-bubble')

// 만남 라벨 — 얼마나 왔고 얼마나 남았는지가 관계의 언어다
const MEET_LABELS = ['첫 번째 질문', '두 번째 질문', '세 번째 질문', '네 번째 질문', '다섯 번째 질문', '여섯 번째 질문', '마지막 질문']

const veil = document.getElementById('veil')
function liftVeil() {
  veil.classList.add('off')
}
setTimeout(liftVeil, 3200) // 로드가 늦어도 여정은 시작된다

const chips = STORY.map((item) => {
  const el = document.createElement('div')
  el.className = 'chip'
  el.innerHTML =
    `<div class="row"><span class="dot"></span><span class="label"><span class="key">${item.kicker}</span><span class="val">${item.chip}</span></span></div>` +
    `<div class="bar"><i></i></div>`
  dashChips.appendChild(el)
  return el
})
// 만남 게이트 — 클릭해서 '수집'해야 걸음이 다시 열린다
const collected = STORY.map(() => false)

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
  dashEl.classList.add('hidden-panel')
  journeyEl.classList.add('hidden-panel')
} else {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new THREE.Scene()

  const SKY = [
    [0.0, new THREE.Color('#cfe9f8')],
    [0.35, new THREE.Color('#d9f1f4')],
    [0.7, new THREE.Color('#ffd9b4')],
    [1.0, new THREE.Color('#f6ac9c')],
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
    top: { value: new THREE.Color('#8fc8ec') },
    bottom: { value: skyNow.clone() },
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
        'varying vec3 vP; uniform vec3 top; uniform vec3 bottom;' +
        // 지평선(y=0)이 정확히 안개색이 되어야 하늘과 땅의 이음매가 사라진다
        'void main() { float h = clamp(normalize(vP).y, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.55)), 1.0); }',
    })
  )
  scene.add(skyDome)
  const SKY_TOP = [
    [0.0, new THREE.Color('#7fbce8')],
    [0.35, new THREE.Color('#8fd0e4')],
    [0.7, new THREE.Color('#f0a878')],
    [1.0, new THREE.Color('#e07868')],
  ]

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

  const hemi = new THREE.HemisphereLight('#eaf6ff', '#c2d4c4', 1.15)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight('#fff6e4', 1.6)
  sun.position.set(6, 9, 4)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -18
  sun.shadow.camera.right = 18
  sun.shadow.camera.top = 18
  sun.shadow.camera.bottom = -18
  sun.shadow.bias = -0.0008
  sun.shadow.normalBias = 0.02
  scene.add(sun)

  // 땅·모래·바다는 세계(world)가 지형으로 소유한다 — 길과 함께 층층이 내려가야 하므로
  const world = buildWorld(scene, STORY.length)

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
  const journeyTrack = document.querySelector('#journey .track')
  const journeyFill = document.querySelector('#journey .fill')
  const journeyRunner = document.querySelector('#journey .runner')
  const journeyNodes = world.npcs.map((n) => {
    const el = document.createElement('div')
    el.className = 'node'
    el.style.left = `${(n.dist / world.TOTAL) * 100}%`
    journeyTrack.appendChild(el)
    return el
  })

  // 챕터 진입 타이틀 카드
  const cardEl = document.getElementById('chapter-card')
  const cardNum = cardEl.querySelector('.num')
  const cardTitle = cardEl.querySelector('.t')
  let cardTimer = null
  function flashChapterCard(i) {
    cardNum.textContent = `CHAPTER ${String(i + 1).padStart(2, '0')}`
    cardTitle.textContent = STORY[i].kicker
    cardEl.classList.add('show')
    if (cardTimer) clearTimeout(cardTimer)
    cardTimer = setTimeout(() => cardEl.classList.remove('show'), 2400)
  }

  // ---------- 걷는 로봇 ----------

  const walker = new THREE.Group()
  walker.position.set(0, 0.08, 0) // 발이 데크 윗면에 선다
  walker.rotation.y = -0.49 // 랜딩에서는 관람자를 바라본다
  scene.add(walker)

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

  // 질문이 타이핑되고, 이어서 답이 떠오른다. 막는 것은 없다 — 걸음은 언제나 독자의 것.
  function stopTyping() {
    if (typeTimer) {
      clearInterval(typeTimer)
      typeTimer = null
    }
  }

  function typeQuestion(index) {
    stopTyping()
    const text = STORY[index].question
    popupWho.textContent = MEET_LABELS[index] ?? '길에서 만난 질문'
    popupA.textContent = STORY[index].text
    popupA.classList.remove('on')
    popupQ.innerHTML = '<span class="caret"></span>'
    if (reduceMotion) {
      popupQ.innerHTML = `“${text}”`
      popupA.classList.add('on')
      return
    }
    let k = 0
    typeTimer = setInterval(() => {
      k++
      popupQ.innerHTML = `“${text.slice(0, k)}”<span class="caret"></span>`
      if (k >= text.length) {
        stopTyping()
        popupQ.innerHTML = `“${text}”`
        popupA.classList.add('on')
      }
    }, 28)
  }

  let halfNoteShown = false
  function collect(i) {
    if (collected[i]) return
    collected[i] = true
    chips[i].classList.add('filled')
    journeyNodes[i].classList.add('lit')
    kpiMeet.textContent = String(collected.filter(Boolean).length)
    // 절반 지점 — 감사를 말이 아니라 개방의 심화로 지불한다 (되감아 다시 지나도 한 번만)
    if (i === 3 && halfNote && !halfNoteShown) {
      halfNoteShown = true
      halfNote.classList.add('show')
      setTimeout(() => halfNote.classList.remove('show'), 4200)
    }
  }

  // 매 프레임 같은 값을 다시 쓰면 레이아웃이 무효화된다 — 바뀔 때만 손댄다
  const ui = { pct: -1, title: '', dist: -1, time: '', fade: -1, inJourney: null }

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
      dashEl.classList.toggle('hidden-panel', !inJourney)
      journeyEl.classList.toggle('hidden-panel', !inJourney)
    }

    // 엔딩 — 임계에 이력을 둬야 경계에서 패널과 로봇이 덜덜 떨지 않는다
    const wasEnd = atEnd
    atEnd = atEnd ? progress > 0.945 : progress > 0.955
    if (atEnd !== wasEnd) outroEl.classList.toggle('hidden-panel', !atEnd)
    if (atEnd && !outroFilled && outroRecord && walked / world.TOTAL > 0.95) {
      outroFilled = true
      const secs = Math.floor(t)
      outroRecord.innerHTML = `여기까지 함께 걸어주셨습니다 — <b>${Math.round(farthest)}m, ${Math.floor(secs / 60)}분 ${secs % 60}초</b>.`
    }

    // 칩 적립은 팝업과 무관 — 지나친 정거장은 무조건 쌓인다 (점프 스크롤 포함)
    world.npcs.forEach((n, i) => {
      if (!collected[i] && walked > n.dist - 2) collect(i)
    })

    // 만남 팝업: 가장 가까운 NPC 가 반경 안일 때
    let near = -1
    world.npcs.forEach((n, i) => {
      if (Math.abs(n.dist - walked) < 10) near = i
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

    // 계기판 — 측정이 아니라 동행의 기록. 거리는 되돌아 걸어도 줄지 않는다.
    const pct = Math.round(Math.min(100, (progress * 100)))
    if (pct !== ui.pct) {
      ui.pct = pct
      dashPct.textContent = `${pct}%`
      journeyFill.style.width = `${pct}%`
      journeyRunner.style.left = `${pct}%`
    }
    const title = pct >= 99 ? '함께 걸었습니다' : '함께 걷는 중'
    if (dashTitle && title !== ui.title) {
      ui.title = title
      dashTitle.textContent = title
    }
    const dist = Math.round(farthest)
    if (dist !== ui.dist) {
      ui.dist = dist
      kpiDist.textContent = String(dist)
    }
    const sec = Math.floor(t)
    const time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
    if (time !== ui.time) {
      ui.time = time
      kpiTime.textContent = time
    }
  }

  const clock = new THREE.Clock()
  const lookTarget = new THREE.Vector3(-0.5, 1.05, -9)
  const lookNow = lookTarget.clone()
  let prevWalked = 0
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
    const walkedTarget = progress * world.TOTAL

    if (booting) {
      // 새로고침으로 중간에서 시작하면, 걸어온 척 되감지 않고 그 자리에서 시작한다
      booting = false
      walked = walkedTarget
      const passed = world.npcs.filter((n) => walked > n.dist - 2).length
      if (passed >= 4) halfNoteShown = true // 복원은 조용히
      world.npcs.forEach((n, i) => { if (walked > n.dist - 2) collect(i) })
    } else {
      walked += (walkedTarget - walked) * Math.min(1, dt * 4.5)
    }
    farthest = Math.max(farthest, walked)
    if (walked > 0.5) walkTime += dt

    world.update(walked, dt, t)
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
    const facing = atEnd
      ? 0
      : THREE.MathUtils.lerp(landingFace, Math.PI, THREE.MathUtils.smoothstep(ph, 0.25, 0.8))
    walker.rotation.y += (facing - walker.rotation.y) * Math.min(1, dt * 3)
    if (atEnd && !waved && waveAction) {
      waved = true
      waveAction.reset().play()
    }

    // 카메라 리그 — 랜딩 A(마주 보기) → 여정 B(동행)를 스크롤로 스크럽 + 바닷바람 스웨이
    const onLanding = ph < 0.5
    const px = onLanding && !reduceMotion ? mouseX * 0.5 : 0
    const py = onLanding && !reduceMotion ? -mouseY * 0.25 : 0
    camera.position.x = THREE.MathUtils.lerp(-2.8, -2.1, ph) + Math.sin(t * 0.32) * 0.18 + px
    camera.position.y = THREE.MathUtils.lerp(2.0, 3.1, ph) + Math.sin(t * 0.45) * 0.08 + py
    camera.position.z = THREE.MathUtils.lerp(6.6, 8.8, ph)
    if (activePopup >= 0) {
      const npc = world.npcs[activePopup]
      lookTarget.set(npc.group.position.x * 0.55, 1.05, -2.5)
    } else {
      lookTarget.set(
        THREE.MathUtils.lerp(-0.5, 0.35, ph),
        THREE.MathUtils.lerp(1.05, 1.15, ph),
        THREE.MathUtils.lerp(-9, -2.5, ph)
      )
    }
    lookNow.lerp(lookTarget, Math.min(1, dt * 2.2))
    camera.lookAt(lookNow)
    // 간판은 바닷바람에 흔들린다 — 클릭 영역도 같이 흔들려야 어긋나지 않는다
    if (onLanding) placeCta()

    // 하늘 — 돔·안개·배경이 함께 물든다
    const c = skyAt(progress)
    skyNow.copy(c)
    scene.fog.color.copy(c)
    scene.fog.near = 18 + 4 * ph // 랜딩에선 원경이 살짝 물러나 로봇만 또렷하다
    skyUniforms.bottom.value.copy(c)
    for (let i = 0; i < SKY_TOP.length - 1; i++) {
      const [t0, c0] = SKY_TOP[i]
      const [t1, c1] = SKY_TOP[i + 1]
      if (progress <= t1) {
        skyUniforms.top.value.copy(c0).lerp(c1, (progress - t0) / (t1 - t0))
        break
      }
    }
    clouds.forEach((cl, i) => {
      cl.position.x += Math.sin(t * 0.08 + i) * 0.004
    })

    quality.tick()
    renderer.render(scene, camera)
  })
}
