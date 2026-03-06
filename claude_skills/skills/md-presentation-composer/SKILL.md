---
name: md-presentation-composer
description: 기존 Markdown을 읽고 발표/리포트용 Markdown으로 재구성합니다. 먼저 전체 변경안을 제안하고 승인 후 반영하며, 화면은 반응형(contain), 저장 HTML/인쇄는 고정 페이지 크기를 유지합니다.
argument-hint: [source-md-or-file] [tone(optional)]
---

# MD Presentation Composer

## 목적
- 기존 Markdown의 의미를 유지하면서 가독성이 좋은 발표/리포트 문서로 재구성합니다.
- `page-break` 기반 페이지 분리, 표/이미지/코드 배치, 섹션 구조 정리를 일관되게 적용합니다.

## 실행 원칙
1. 먼저 전체 변환안을 제시합니다. 원문은 이 단계에서 수정하지 않습니다.
2. 제안안에는 변경 요약, 자동 삽입 후보, 추천 화면비를 포함합니다.
3. 사용자 승인 후 최종 Markdown을 생성합니다.

## 입력 규칙
1. `$ARGUMENTS[0]`가 파일 경로면 파일을 읽어 처리합니다.
2. `$ARGUMENTS[0]`가 본문 문자열이면 해당 내용을 직접 처리합니다.
3. `$ARGUMENTS[1]`가 없으면 기본 톤은 `report`로 둡니다.

## 페이지 크기/화면 정책
- frontmatter `pageWidth`, `pageHeight`는 CSS 길이 값을 사용합니다.
- 단위 없는 숫자는 `px`로 자동 보정합니다. 예: `1900` -> `1900px`
- 화면(앱/웹 미리보기)은 `contain` 반응형 스케일을 사용합니다.
- 저장 HTML/인쇄는 고정 페이지 크기를 유지합니다.

## 출력 순서
1. 원문 진단 요약
2. 변경 제안(자동 삽입 목록 포함)
3. 화면비 추천(`landscape`/`portrait`)과 근거
4. 사용자 승인 확인
5. 승인 후 최종 Markdown 출력

## 참조 문서
- 빠른 삽입/일반 도구 카탈로그: `references/quick-insert-catalog.md`
- 화면비 판단 규칙: `references/layout-orientation-rules.md`
- 검증/복구 규칙: `references/validation-rules.md`

## 품질 게이트
- 연속 `page-break`, 문서 말미 `page-break`를 정리합니다.
- 빈 페이지 생성 요소를 제거합니다.
- 표/이미지/코드가 밀집된 경우 페이지 분리를 우선 검토합니다.
- 인코딩 깨짐(UTF-8) 문자를 탐지하고 복구합니다.
- 페이지/스크립트 정책이 바뀐 경우 저장 HTML 재생성을 안내합니다.

## 기본 문법 보존 체크리스트

변환 시 아래 문법을 손상시키지 않습니다.

- 체크리스트(`- [ ]`, `- [x]`)
- 중첩 리스트와 아이템 후속 문단
- `_ / __ / * / ** / ~~` 인라인 강조
- 자동 URL 링크와 참조형 링크/이미지
- 코드펜스(````/~~~`)와 하드 브레이크

## Export 품질 체크 (추가)

- 상대경로 이미지가 저장 HTML/CLI에서 깨지지 않는지 확인
- Mermaid가 성공 시 시각화, 실패 시 원문 유지되는지 확인
- Outline 클릭 이동 및 현재 위치 표시가 동작하는지 확인
- 코드 블록 헤더 복사 버튼이 동작하는지 확인(standalone 기준)
- 긴 코드에는 `maxHeight` 속성을 우선 검토하고 섹션 높이는 필요 시에만 제한
