## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## 자소서 (라우터)

자소서(자기소개서) 작업은 **반드시 스킬로 라우팅**한다. CLAUDE.md는 규칙 원문을 담지 않는다.

- **작성**: `write-jaso` 스킬 — 리서치 → 모범답안 → 개인화. **서사 규칙(S1~S6) + 문항별 카드로 생성**한다(메인이 통으로 써 인생 축 공유). 프로필 사실을 인과 서사로 번역, 기술 상세는 이력서·포폴로, 약점 과노출 금지.
- **검증**: `review-jaso` 스킬 — 서사 규칙 준수 검증 + 폴리시(AI 문어체·비유·스택 name-drop 등) + 커스텀. 신선한 컨텍스트 독립 감사(문항별 병렬 가능).
- **설계 결정**: `docs/adr/` — 0003 자유도, 0004 파이프라인, 0005·0006·0007 서사 규칙은 생성 / 폴리시는 리뷰 / 2계층+카드.
