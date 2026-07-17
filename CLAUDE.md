## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## 자소서 (라우터)

자소서(자기소개서) 작업은 **반드시 스킬로 라우팅**한다. CLAUDE.md는 순수 라우터다 — 규칙 원문은 스킬(`write-jaso/rules.md`·`review-jaso`)과 `docs/adr/`에만 둔다.

- **작성**: `write-jaso` 스킬 — 리서치 → 모범답안 → 서사·고민 재구성 → 작성.
- **검증**: `review-jaso` 스킬 — 신선한 컨텍스트 독립 감사.
- **설계 결정**: `docs/adr/` 0003~0012.
