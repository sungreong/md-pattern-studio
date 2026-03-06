# Layout Orientation Rules

## 기본 화면비
- `landscape`: `1120x720`
- `portrait`: `794x1123` (A4 계열 비율)

## pageWidth/pageHeight 해석 규칙
1. 숫자 입력은 `px`로 자동 보정합니다.
   - `pageWidth: 1900` -> `1900px`
   - `pageHeight: 800` -> `800px`
2. 단위가 있는 값은 그대로 사용합니다.
   - 허용 단위: `px`, `%`, `vw`, `vh`, `rem`, `em`
3. 값이 비정상이면 기본값으로 폴백합니다.

## 화면/출력 정책
- 화면(에디터 Preview/Slides): `contain` 스케일
  - 비율 유지
  - 콘텐츠 잘림 방지
- 저장 HTML/인쇄: 고정 페이지 박스
  - frontmatter의 `pageWidth/pageHeight` 우선

## 방향 추천 점수표
초기 점수:
- `landscape = 0`
- `portrait = 0`

가점 규칙:
1. 표 열 수가 4개 이상: `landscape +2`
2. 표 열 수가 6개 이상: `landscape +3`
3. 다단 구조(`.two-column`, `.three-column`, `.cols-N`) 사용: `landscape +2`
4. 코드 블록의 긴 라인이 많음: `landscape +1`
5. 가로형 이미지 비중이 큼: `landscape +1`
6. 긴 본문 위주 문서(표/코드 적음): `portrait +2`

결정 규칙:
- 점수가 큰 쪽을 추천
- 동점이면 `landscape` 추천
- 사용자가 명시하면 사용자 선택을 우선
