// 읽을거리 배선 — 내려받게 할 PDF 두 개를 dist 에 싣는다.
// 원본(web-portfolio 루트)은 그대로 두고 dev/build 직전에 public/docs 로 복사만 한다 —
// 사본을 손대면 다음 실행에 덮어써진다. 진실은 언제나 루트 쪽이다.
// HTML 문서 사본(portfolio/·이력서·경력기술서)은 랜딩에서 링크를 뺐으므로 함께 지웠다 —
// 아무도 도달할 수 없는 사본은 무게일 뿐이다. 다시 링크하려면 여기 JOBS 에 되돌리면 된다.
import { cp, rm, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const out = resolve(here, '../public/docs')

const JOBS = [
  // PDF 는 web-portfolio 루트에 있다 — vite 루트라 dev 에서는 열리지만 빌드 산출물에는 안 들어간다.
  // 내려받기용 원본이므로 public 으로 옮겨 dist 에 실린다.
  // 사본 파일명은 ASCII 로 둔다 — 비ASCII 경로는 정적 호스팅(S3·CDN)에서 깨지는 사례가 흔하다.
  // 저장될 때의 한글 이름은 <a download="..."> 가 정한다.
  { from: resolve(here, '../한승보_포트폴리오.pdf'), to: resolve(out, 'han-portfolio.pdf') },
  { from: resolve(here, '../한승보_이력서.pdf'), to: resolve(out, 'han-resume.pdf') },
]

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

// 원본이 없으면 경고가 아니라 실패다 (2026-08-21).
// 예전엔 경고만 찍고 넘어갔는데, 파일 이름이 바뀐 걸 아무도 못 보고 그대로 배포돼
// 내려받기 버튼이 404 를 뱉었다. 없는 파일은 빌드에서 걸려야 배포 전에 걸린다.
const missing = JOBS.filter((j) => !existsSync(j.from))
if (missing.length) {
  console.error('[copy-docs] 원본이 없다 — 이름이 바뀌었는지 확인:')
  for (const j of missing) console.error(`  ${j.from}`)
  process.exit(1)
}
for (const j of JOBS) await cp(j.from, j.to, { recursive: true })
console.log(`[copy-docs] ${JOBS.length}/${JOBS.length} → public/docs`)
