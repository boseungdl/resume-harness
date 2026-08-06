// 걷는 사람 — 스크롤은 걸음이 된다.
// 길에서 NPC 를 만나면 질문 팝업이 떠오르고, 지나가면 사라진다.
// 알게 된 것은 우상단 대시보드에 영구히 채워진다.

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { STORY } from './story.js'
import { buildWorld } from './world.js'

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

// ---------- UI 준비 ----------

const spacer = document.getElementById('spacer')
spacer.style.height = `${(STORY.length + 2.4) * 120}vh`

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
const resumeBtn = document.getElementById('resume-walk')

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

// 로드 스태거 등장 — 위에서 아래로
document.querySelectorAll('#landing .fx').forEach((el, i) => {
  setTimeout(() => el.classList.add('in'), reduceMotion ? 0 : 250 + i * 90)
})

// 숫자 카운트업
document.querySelectorAll('[data-count]').forEach((el) => {
  const to = Number(el.dataset.count)
  if (reduceMotion || !Number.isFinite(to)) return
  const t0 = performance.now()
  const step = (now) => {
    const p = Math.min(1, (now - t0) / 900)
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))))
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
})

// 틸트 — rAF 보간(고무줄 없이), 소형 카드만
if (!reduceMotion) {
  document.querySelectorAll('#land-live .panel, .door').forEach((card) => {
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = null
    const loop = () => {
      cx += (tx - cx) * 0.14
      cy += (ty - cy) * 0.14
      card.style.transform = `perspective(900px) rotateY(${cx.toFixed(2)}deg) rotateX(${cy.toFixed(2)}deg)`
      if (Math.abs(cx - tx) + Math.abs(cy - ty) > 0.01) raf = requestAnimationFrame(loop)
      else raf = null
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop) }
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect()
      tx = ((e.clientX - r.left) / r.width - 0.5) * 3
      ty = -((e.clientY - r.top) / r.height - 0.5) * 3
      kick()
    })
    card.addEventListener('pointerleave', () => { tx = 0; ty = 0; kick() })
  })
}

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
  if (cap) cap.textContent = `주 단위 합계 ${total}커밋 · 출처: GitHub API`
  const chart = echarts.init(el)
  chart.setOption({
    grid: { left: 30, right: 8, top: 10, bottom: 24 },
    xAxis: {
      type: 'category',
      data: weeks.map((w) => w[0]),
      axisLine: { lineStyle: { color: 'rgba(22,48,60,0.18)' } },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(22,48,60,0.5)', fontSize: 10, fontFamily: 'IBM Plex Sans KR' },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: 'rgba(14,168,184,0.12)' } },
      axisLabel: { color: 'rgba(22,48,60,0.45)', fontSize: 10 },
    },
    tooltip: { trigger: 'axis', formatter: (p) => `${p[0].name} 주 — ${p[0].value}커밋` },
    series: [{
      type: 'bar',
      barWidth: '55%',
      data: weeks.map((w, i) => ({
        value: w[1],
        itemStyle: i === weeks.length - 1
          ? { color: '#ff7a59', borderRadius: [4, 4, 0, 0] }
          : {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: '#22c4d4' },
                { offset: 1, color: '#0ea8b8' },
              ]),
              borderRadius: [4, 4, 0, 0],
            },
      })),
    }],
    animationDuration: reduceMotion ? 0 : 700,
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
  document.body.classList.add('no-webgl')
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

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500)
  camera.position.set(-2.1, 3.1, 8.8)
  camera.lookAt(0.35, 1.15, -2.5)

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
        'void main() { float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.75)), 1.0); }',
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
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = -12
  sun.shadow.camera.right = 12
  sun.shadow.camera.top = 12
  sun.shadow.camera.bottom = -12
  scene.add(sun)

  // 땅은 육지 쪽만 — 왼쪽은 모래사장을 지나 바다로 이어진다
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(206, 900),
    new THREE.MeshStandardMaterial({ color: '#cfe0cb' })
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set(99, 0, -240)
  ground.receiveShadow = true
  scene.add(ground)

  const world = buildWorld(scene, STORY.length)

  // 블룸 — 트랙 엣지·크리스탈·등대가 실제로 빛난다
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(
    new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.5, 0.92)
  )

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
  walker.position.set(0, 0, 0)
  walker.rotation.y = Math.PI
  scene.add(walker)

  let mixer = null
  let walkAction = null
  let idleAction = null
  let waveAction = null
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

  function startWalk() {
    window.scrollTo({ top: journeyBase() + window.innerHeight * 0.25, behavior: 'smooth' })
  }
  document.getElementById('start-walk').addEventListener('click', startWalk)

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
    renderer.setSize(window.innerWidth, window.innerHeight)
    composer.setSize(window.innerWidth, window.innerHeight)
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

  // 질문이 타이핑되며 나타나고, 답이 뒤따라 떠오른다
  function typeQuestion(index) {
    if (typeTimer) clearInterval(typeTimer)
    const text = STORY[index].question
    popupA.textContent = STORY[index].text
    popupA.classList.remove('on')
    popupQ.innerHTML = '<span class="caret"></span>'
    let k = 0
    typeTimer = setInterval(() => {
      k++
      popupQ.innerHTML = `“${text.slice(0, k)}”<span class="caret"></span>`
      if (k >= text.length) {
        clearInterval(typeTimer)
        typeTimer = null
        popupQ.innerHTML = `“${text}”`
        popupA.classList.add('on')
        if (!collected[index]) {
          resumeBtn.classList.add('on')
          popupEl.classList.add('gated')
        }
      }
    }, 34)
  }

  function collect(i) {
    collected[i] = true
    chips[i].classList.add('filled')
    journeyNodes[i].classList.add('lit')
    kpiMeet.textContent = String(collected.filter(Boolean).length)
    resumeBtn.classList.remove('on')
    popupEl.classList.remove('gated')
  }
  resumeBtn.addEventListener('click', () => {
    if (activePopup >= 0 && !collected[activePopup]) collect(activePopup)
  })

  function updateUi(progress, t) {
    // 만남 게이트 — 수집 전에는 그 앞에서 스크롤이 멈춘다
    const gi = collected.findIndex((done) => !done)
    if (gi >= 0) {
      const base = journeyBase()
      const span = document.documentElement.scrollHeight - window.innerHeight - base
      const gY = base + (world.npcs[gi].dist / world.TOTAL) * span
      if (window.scrollY > gY + 1) window.scrollTo(0, gY)
    }

    // 계기판·여정 바는 여정에 들어선 뒤에만
    const inJourney = window.scrollY > journeyBase() * 0.72
    dashEl.classList.toggle('hidden-panel', !inJourney)
    journeyEl.classList.toggle('hidden-panel', !inJourney)

    // 엔딩
    const atEnd = progress > 0.955
    outroEl.classList.toggle('hidden-panel', !atEnd)

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
        popupEl.classList.add('hidden-panel')
        popupEl.classList.remove('gated')
        resumeBtn.classList.remove('on')
      }
    }

    // 계기판 — 수집률·거리·시간
    const pct = Math.min(100, (walked / world.TOTAL) * 100)
    dashPct.textContent = `${Math.round(pct)}%`
    kpiDist.textContent = String(Math.round(walked))
    const sec = Math.floor(t)
    kpiTime.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

    // 여정 바
    journeyFill.style.width = `${pct}%`
    journeyRunner.style.left = `${pct}%`
  }

  const clock = new THREE.Clock()
  const lookTarget = new THREE.Vector3(0.35, 1.15, -2.5)
  const lookNow = lookTarget.clone()
  let prevWalked = 0

  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.06, clock.getDelta())
    const t = clock.elapsedTime
    const progress = scrollProgress()
    const walkedTarget = progress * world.TOTAL
    const speed = walkedTarget - walked
    walked += speed * Math.min(1, dt * 4.5)

    world.update(walked, dt, t)
    updateUi(progress, t)

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

    // 여정 끝 — 돌아서서 손을 흔든다
    const atEnd = progress > 0.955
    const facing = atEnd ? 0 : Math.PI
    walker.rotation.y += (facing - walker.rotation.y) * Math.min(1, dt * 3)
    if (atEnd && !waved && waveAction) {
      waved = true
      waveAction.reset().play()
    }

    // 살아있는 카메라 — 바닷바람 스웨이 + 랜딩 마우스 패럴랙스 + 만남 때 NPC 쪽으로 시선
    const onLanding = window.scrollY < journeyBase() * 0.5
    const px = onLanding && !reduceMotion ? mouseX * 0.6 : 0
    const py = onLanding && !reduceMotion ? -mouseY * 0.3 : 0
    camera.position.x = -2.1 + Math.sin(t * 0.32) * 0.18 + px
    camera.position.y = 3.1 + Math.sin(t * 0.45) * 0.08 + py
    if (activePopup >= 0) {
      const npc = world.npcs[activePopup]
      lookTarget.set(npc.group.position.x * 0.55, 1.05, -2.5)
    } else {
      lookTarget.set(0.35, 1.15, -2.5)
    }
    lookNow.lerp(lookTarget, Math.min(1, dt * 2.2))
    camera.lookAt(lookNow)

    // 하늘 — 돔·안개·배경이 함께 물든다
    const c = skyAt(progress)
    skyNow.copy(c)
    scene.fog.color.copy(c)
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

    composer.render()
  })
}
