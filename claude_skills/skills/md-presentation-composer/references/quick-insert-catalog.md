# Quick Insert Catalog

`md-presentation-composer`가 제안/변환 단계에서 참조하는 삽입 카탈로그입니다.

## 현재 빠른 삽입(앱 UI)

| pattern_id | trigger | snippet_id | when_to_use | snippet_text |
| --- | --- | --- | --- | --- |
| section_h2 | H2 섹션 | `h2` | 일반 섹션 시작 | `## 섹션 제목` |
| cover | Cover | `cover` | 문서 첫 표지 | `# 보고서 제목 {#cover .cover eyebrow="Monthly Report"}` |
| two_column | 2단 섹션 | `two-column` | 좌우 비교/요약 | `## 핵심 요약 {#summary .two-column}` |
| stats | Stats | `stats` | KPI 카드형 요약 | `### 핵심 KPI {#kpi .stats}` |
| callout | Callout | `callout` | 강조 문구/경고 | `> [!INFO] 핵심 메시지` |
| table_attr | 표 + 속성 | `table` | 표 스타일 지정 | `{: .zebra .bordered .compact ...}` |
| image_attr | 이미지 + 속성 | `image` | 이미지 캡션/정렬 | `{: width="88%" align="center" caption="..."}` |
| code_block | 코드 블록 | `code` | 예시 코드 삽입 | ````` ```js ... ``` ````` |
| title_slide | Title Slide | `title-slide` | 발표 시작 슬라이드 | 제목 + 부제 + `page-break` |
| agenda_slide | Agenda | `agenda-slide` | 목차 슬라이드 | `## Agenda {#agenda .agenda}` |
| message_slide | Key Message | `message-slide` | 핵심 메시지 전달 | `## 핵심 메시지 {#message .message}` |
| compare_slide | Compare 2-up | `compare-slide` | 2열 비교 | `## 비교 {#compare .compare}` |
| timeline_slide | Timeline | `timeline-slide` | 일정/로드맵 | `## 일정 {#timeline .timeline}` |
| data_slide | Data Slide | `data-slide` | 데이터 중심 슬라이드 | `## 데이터 {#data .card}` |
| quote_slide | Quote Slide | `quote-slide` | 인용/코멘트 | `## 인용 {#quote .quote-slide}` |
| qa_slide | Q&A | `qa-slide` | 마무리 질의응답 | `## Q&A {#qa .message}` |
| page_break | Page Break | `page-break` | 페이지 분리 | `---` + `{: .page-break}` |

## 범용 문서 도구(승인형 자동삽입 대상)

| tool_id | trigger | when_to_use | snippet_text |
| --- | --- | --- | --- |
| toc-basic | 목차 | 문서 길이가 긴 경우 | `## 목차\n- 1. ...\n- 2. ...` |
| checklist | 체크리스트 | 작업 점검 항목 | `- [ ] 항목 A\n- [ ] 항목 B` |
| action-items | 액션아이템 | 담당/기한 관리 | `| 항목 | 담당 | 기한 | 상태 |` |
| decision-log | 의사결정 로그 | 결정 근거 기록 | `## 의사결정 로그\n- 결정:\n- 근거:\n- 영향:` |
| reference-links | 참고 링크 | 근거/출처 정리 | `## 참고 링크\n- [문서명](URL) - 설명` |

## 자동 삽입 제안 방식
- 스킬은 문서를 분석해 필요한 후보를 먼저 "제안"합니다.
- 사용자의 문서 전체 승인 전에는 원문을 수정하지 않습니다.
- 승인 후에만 최종 Markdown에 삽입/재배치합니다.

## 기본 MD 보장 항목

아래 항목은 스니펫 없이 일반 Markdown만으로도 렌더가 보장됩니다.

- task list (`- [ ]`, `- [x]`)
- 중첩 리스트(들여쓰기)
- reference link/image (`[text][id]`, `![alt][id]` + `[id]: ...`)
- code fence (` ``` `, `~~~`)
