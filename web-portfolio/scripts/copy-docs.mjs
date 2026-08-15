// 읽을거리 배선 — portfolio/ 와 입사지원서/ 는 vite 루트 밖이라 빌드에 안 들어간다.
// 그래서 랜딩의 「기술 포트폴리오 / 이력서 / 경력 기술서」가 전부 href="#" 였고,
// 누르면 scrollY 가 0 이 되어 걸어온 거리가 통째로 사라졌다.
// 원본은 저장소 루트에 그대로 두고, dev/build 직전에 public/docs 로 복사만 한다 —
// 사본을 손대면 다음 실행에 덮어써진다. 진실은 언제나 루트 쪽이다.
import { cp, rm, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const out = resolve(here, '../public/docs')

const JOBS = [
  { from: resolve(repo, 'portfolio'), to: resolve(out, 'portfolio') },
  { from: resolve(repo, '입사지원서/한승보_이력서.html'), to: resolve(out, '이력서.html') },
  { from: resolve(repo, '입사지원서/한승보_경력기술서.html'), to: resolve(out, '경력기술서.html') },
  { from: resolve(repo, '입사지원서/han2.png'), to: resolve(out, 'han2.png') },
  // PDF 는 web-portfolio 루트에 있다 — vite 루트라 dev 에서는 열리지만 빌드 산출물에는 안 들어간다.
  // 내려받기용 원본이므로 public 으로 옮겨 dist 에 실린다.
  // 사본 파일명은 ASCII 로 둔다 — 비ASCII 경로는 정적 호스팅(S3·CDN)에서 깨지는 사례가 흔하다.
  // 저장될 때의 한글 이름은 <a download="..."> 가 정한다.
  { from: resolve(here, '../한승보_portfolio.pdf'), to: resolve(out, 'han-portfolio.pdf') },
  { from: resolve(here, '../한승보_이력서.pdf'), to: resolve(out, 'han-resume.pdf') },
]

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

let missing = 0
for (const j of JOBS) {
  if (!existsSync(j.from)) {
    console.warn(`[copy-docs] 없음: ${j.from}`)
    missing++
    continue
  }
  await cp(j.from, j.to, { recursive: true })
}
console.log(`[copy-docs] ${JOBS.length - missing}/${JOBS.length} → public/docs`)
