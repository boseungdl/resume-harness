## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## 자소서 (라우터)

자소서(자기소개서) 작업은 **반드시 스킬로 라우팅**한다. CLAUDE.md는 규칙 원문을 담지 않는다.

- **작성**: `write-jaso` 스킬 — 리서치 → 모범답안 → 개인화. **규칙 없이 '날것'을 생성**한다(자유도·형식만 적용).
- **검증**: `review-jaso` 스킬 — **자소서 규칙(절대 규칙·지원자 맥락·커스텀)의 유일한 적용 지점**. 날것을 신선한 컨텍스트로 감사한다. 규칙 원문도 여기에 있다.
- **설계 결정**: `docs/adr/` — 0003 자유도, 0004 파이프라인, 0005 날것 생성·규칙은 리뷰 전용.
