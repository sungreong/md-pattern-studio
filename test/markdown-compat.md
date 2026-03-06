# Markdown Compatibility Smoke

## 1) Nested List + Continuation
- [x] 완료된 작업
  후속 설명 문단입니다. 같은 항목 내부에서 줄이 이어집니다.
  두 칸 공백 뒤 줄바꿈  
  하드 브레이크가 적용되어야 합니다.
  - 하위 bullet A
  - 하위 bullet B
    1. ordered child 1
    2. ordered child 2
- [ ] 미완료 작업
  > 인용도 아이템 내부에서 유지되어야 합니다.

## 2) Inline Syntax
일반 *italic* / _italic_ / **bold** / __bold__ / ~~strike~~

escaped: \*literal-asterisk\* and \_literal-underscore\_

auto link: https://example.com/docs/path?q=1

inline link: [OpenAI](https://openai.com)

reference link: [문서 링크][docs]

[docs]: https://example.com/reference "참조 링크"

## 3) Fence Variant
~~~js
const hello = 'world';
console.log(hello);
~~~

## 4) Reference Image
![성능 차트][chart]

[chart]: https://dummyimage.com/1200x520/e5eefc/1f3b7a.png&text=Chart

## 5) Quote Mixed Blocks
> [!INFO] 혼합 블록
> 첫 문단
>
> - 항목 A
> - 항목 B
>
> ```bash
> echo "quote code block"
> ```
