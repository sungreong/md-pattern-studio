# PPT-Like Markdown Rules

이 규칙은 평범한 Markdown을 `Markdown Pattern Studio`에서 PPT처럼 보이는 슬라이드형 Markdown으로 바꿀 때 사용합니다. 목표는 장식이 아니라 슬라이드 단위의 선명한 메시지, 리듬, 시각 위계입니다.

## 기본 원칙

- 하나의 슬라이드는 하나의 메시지만 전달합니다.
- 긴 문단을 그대로 두지 말고 핵심 주장과 근거 bullet로 분해합니다.
- 모든 슬라이드는 제목을 갖고, `---` 다음 줄의 `{: .page-break}`로 끝냅니다.
- 기본 화면비는 `landscape`를 추천합니다. 표/코드가 많으면 `pageWidth: 1120px`, `pageHeight: 720px`를 유지합니다.
- 같은 슬라이드 패턴을 3회 이상 연속 사용하지 않습니다.

## Frontmatter 기본값

```md
---
title: "Deck Title"
theme: "presentation"
pageWidth: 1120px
pageHeight: 720px
---
```

## 슬라이드 밀도 제한

- 제목: 3~8단어 또는 짧은 한 문장.
- 본문: bullet 3~5개.
- bullet: 한 줄에 하나의 idea.
- 표: 4열 이하, 6행 이하를 우선합니다.
- 강조: 한 슬라이드에 bold 1~2개만 사용합니다.
- 문단: 3줄을 넘으면 bullet, 2단, 표, 카드 중 하나로 바꿉니다.

## 권장 흐름

1. Cover: 제목, 한 줄 가치, 맥락.
2. Agenda: 3~5개 섹션.
3. Key Message: 전체 주장을 한 번에 보여줍니다.
4. Evidence: 데이터, 비교, 사례, 절차를 2~5장으로 분리합니다.
5. Recommendation: 결정/다음 행동.
6. Closing: 요약 또는 Q&A.

## 패턴 선택 규칙

| 상황 | 패턴 | Markdown 힌트 |
| --- | --- | --- |
| 표지 | cover | `# 제목 {#cover .cover eyebrow="Presentation"}` |
| 한 문장 핵심 | message | `## 핵심 메시지 {#message .message}` + `{: .lead}` |
| 목차 | agenda | `## Agenda {#agenda .agenda}` |
| 전후/옵션 비교 | compare | `## 비교 {#compare .compare}` |
| 단계/일정 | timeline | `## 실행 타임라인 {#timeline .timeline}` |
| KPI/숫자 | stats | `### 핵심 KPI {#kpi .stats}` |
| 데이터 표 | card + table-fit | `## 데이터 {#data .card}` + `{: .table-fit ...}` |
| 병렬 항목 | two-column/three-column | `## 요약 {#summary .two-column}` |
| 강한 인용 | quote-slide | `## 고객 멘트 {#quote .quote-slide}` |

## 변환 알고리즘

1. 원문의 heading과 문단을 topic 단위로 묶습니다.
2. 각 topic에서 한 문장 핵심 메시지를 뽑습니다.
3. topic 하나를 1~2장으로 제한합니다.
4. 슬라이드별 패턴을 고릅니다: message, compare, timeline, stats, data, quote, columns.
5. 긴 문단은 3~5개 bullet로 줄입니다.
6. 표가 크면 핵심 행/열만 남기고 나머지는 부록 또는 별도 슬라이드로 분리합니다.
7. 각 슬라이드 뒤에 page-break를 둡니다.
8. 마지막에 연속 패턴, bullet 길이, 제목 누락, page-break 누락을 점검합니다.

## 템플릿 예시

### Cover

```md
# 제품 전략 업데이트 {#cover .cover eyebrow="Strategy Deck"}

**이번 분기의 초점은 성장보다 전환 품질입니다.**

---
{: .page-break}
```

### Key Message

```md
## 핵심 메시지 {#message .message}

전환율은 올랐지만 유지율 개선 없이는 성장이 누적되지 않습니다.
{: .lead}

- 신규 유입은 안정적으로 증가
- 2주차 이탈이 주요 병목
- 다음 실험은 온보딩 품질에 집중

---
{: .page-break}
```

### Compare

```md
## 전략 전환 {#compare .compare}

### As-Is

- 유입량 중심 캠페인
- 클릭률 최적화
- 단기 전환 추적

### To-Be

- 활성 유지 중심 실험
- 첫 사용 성공률 최적화
- 2주차 리텐션 추적

---
{: .page-break}
```

### Data

```md
## 핵심 지표 {#data .card}

| 지표 | 이전 | 현재 | 변화 |
| --- | ---: | ---: | ---: |
| 전환율 | 3.2% | 4.1% | +0.9%p |
| 2주차 유지율 | 41% | 38% | -3%p |
{: .zebra .bordered .compact .table-fit caption="분기 핵심 지표" emphasis="last-col"}

---
{: .page-break}
```

## 금지 패턴

- 한 슬라이드에 표, 긴 문단, 리스트를 모두 넣지 않습니다.
- 모든 슬라이드를 카드형으로 만들지 않습니다.
- `###` 이하 heading을 남발하지 않습니다. 슬라이드 안의 계층은 bullet과 bold로 처리합니다.
- 원문에 없는 수치, 결론, 사례를 만들어 넣지 않습니다.
- 의미 없는 “~입니다”, “~합니다” bullet 반복을 줄이고 동사형 행동 또는 명사형 핵심으로 정리합니다.

## 최종 체크

- 모든 슬라이드에 제목이 있는가?
- 모든 슬라이드가 page-break로 분리되었는가?
- 첫 3장 안에 핵심 메시지가 보이는가?
- 같은 패턴이 3회 이상 반복되지 않는가?
- bullet이 너무 길거나 5개를 넘지 않는가?
- 표/코드/이미지의 문법과 의미가 보존되었는가?
