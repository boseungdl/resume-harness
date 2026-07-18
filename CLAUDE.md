## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## 자소서 (라우터)

자소서(자기소개서) 작업은 **반드시 스킬로 라우팅**한다. CLAUDE.md는 순수 라우터다 — 규칙 원문은 스킬에만 둔다.

**v2 — 스킬을 처음부터 다시 만드는 중이다. 규칙은 스킬 파일에 하나씩 누적하며, 이전 규칙 체계(ADR 0003~0017 포함)는 참고하지 않는다.**

- **작성**: `write-jaso` 스킬 — 리서치(직무/기업 분기) → 인물 판단 → 작성.
- **검증**: `review-jaso` 스킬 — 독자 심리 시뮬레이션 + 글쓰기 감사.
