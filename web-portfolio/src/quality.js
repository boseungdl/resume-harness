// 자동 품질 스케일링 — 사무용 노트북에서도 버벅이지 않게.
// FPS 가 기준 미달이면 DPR 을 단계적으로 낮추고, 최후엔 블룸을 끈다.

const DPR_STEPS = [1.75, 1.5, 1.25, 1]

export function createQualityGovernor({ renderer, onDisableBloom }) {
  let step = 0
  let frames = 0
  let windowStart = performance.now()
  let bloomOn = true

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_STEPS[step]))

  function tick() {
    frames++
    const now = performance.now()
    const elapsed = now - windowStart
    if (elapsed < 2000) return
    const fps = (frames / elapsed) * 1000
    frames = 0
    windowStart = now
    if (fps >= 45) return
    if (step < DPR_STEPS.length - 1) {
      step++
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_STEPS[step]))
    } else if (bloomOn) {
      bloomOn = false
      onDisableBloom()
    }
  }

  return { tick }
}
