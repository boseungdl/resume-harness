// 챕터 데이터 — 콘텐츠는 전부 여기서만 수정한다.
// formation: protagonist.js 의 파티클 대형 키. 문장이 말하는 변화를 파티클이 그대로 수행한다.
// 텍스트는 플레이스홀더 — UI 보면서 갈아끼움.

export const CHAPTERS = [
  {
    id: 'hero',
    layout: 'hero',
    formation: 'wave', // 넓고 잔잔한 흐름의 표면 — 방문자가 흐름 위에 올라탐
    kicker: 'PORTFOLIO',
    name: '한승보',
    tagline: '신뢰할 수 있는 데이터 흐름을 설계하는 데이터 엔지니어',
    sub: '지금부터 3분, 제가 설계한 흐름을 그대로 타고 내려가시면 됩니다.',
  },
  {
    id: 'turning-1',
    layout: 'chapter',
    formation: 'stream', // 흩어져 있던 입자들이 한 줄기 물길로 정렬
    kicker: 'Chapter 01',
    title: '흩어진 것에서, 길을 먼저 만듭니다.',
    body: '플레이스홀더 — 무슨 일이든 부분보다 전체 흐름부터 잡습니다. 실시간으로 흘러야 할 것과 쌓여야 할 것의 길을 먼저 나눈 뒤에 세부를 채웁니다. 이 자리는 UI를 보면서 실제 문장으로 교체합니다.',
  },
  {
    id: 'turning-2',
    layout: 'chapter',
    formation: 'core', // 흐르던 입자들이 하나의 형태로 조립
    kicker: 'Chapter 02',
    title: '따로 배운 것들이, 하나로 합쳐졌습니다.',
    body: '플레이스홀더 — 화면에서 서버로, 서버에서 인프라로, 인프라에서 데이터로 내려간 시간이 하나의 구조로 모였습니다. 전환점 서사가 들어갈 자리입니다.',
  },
  {
    id: 'outro',
    layout: 'outro',
    formation: 'rest', // 도착 — 잔잔하게 흩어져 별자리처럼 정착
    kicker: 'Contact',
    title: '흐름의 끝입니다.',
    body: '여기까지 막힘이 없으셨다면 — 그게 제가 하는 일입니다.',
    links: [
      { label: '기술 포트폴리오', href: '#' },
      { label: 'GitHub', href: 'https://github.com/boseungdl' },
      { label: '이메일', href: 'mailto:96tmdtmd@gmail.com' },
    ],
  },
]

// 챕터 간 카메라 하강 간격 (world units)
export const CHAPTER_SPACING = 60
