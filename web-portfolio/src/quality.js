// 자동 품질 스케일링 — 사무용 노트북에서도 버벅이지 않게.
// FPS 가 기준 미달이면 DPR 을 단계적으로 낮추고, 최후엔 블룸을 끈다.

const DPR_STEPS = [1.75, 1.5, 1.25, 1]

export function createQualityGovernor({ renderer, composer, onDisableBloom }) {
  let step = 0
  let frames = 0
  let windowStart = performance.now()
  let bloomOn = true

  function applyDpr() {
    const ratio = Math.min(window.devicePixelRatio, DPR_STEPS[step])
    renderer.setPixelRatio(ratio)
    if (composer) {
      composer.setPixelRatio(ratio)
      composer.setSize(window.innerWidth, window.innerHeight)
    }
    return ratio
  }
  applyDpr()

  function tick() {
    frames++
    const now = performance.now()
    const elapsed = now - windowStart
    if (elapsed < 2000) return
    const fps = (frames / elapsed) * 1000
    frames = 0
    windowStart = now
    if (fps >= 45) return
    // 화면 DPR 이 낮으면 효과 없는 단계가 있다 — 실제로 낮아지는 단계까지 건너뛴다
    const before = renderer.getPixelRatio()
    while (step < DPR_STEPS.length - 1) {
      step++
      if (applyDpr() < before) return
    }
    if (bloomOn) {
      bloomOn = false
      onDisableBloom()
    }
  }

  return { tick }
}
