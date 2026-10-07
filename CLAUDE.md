# MindFlow 코드 작업 메모

## 아이콘과 이모지

같은 의미를 이모지와 Material Symbols 양쪽으로 쓰지 않는다. 용도별로 하나를 정해 쓴다.

### UI 컨트롤과 액션 시트는 Material Symbols만

버튼, 툴바, FAB, 인라인 액션, 액션 시트와 모달 안의 항목 버튼이 해당된다.
형식은 `<span class="mi mi-sm">아이콘이름</span>`.

예전에 이모지가 섞여 있던 자리는 다음 이름으로 바꾼다.

| 의미 | Material Symbol |
|---|---|
| 이름 변경 | `edit` |
| 삭제 | `delete` |
| 고정 | `push_pin` (해제는 `mi-fill` 토글) |
| 복제 | `content_copy` |
| 초기화 | `restart_alt` |
| 폴더 | `folder` |
| 새로고침, 동기화 | `refresh` 또는 `sync` |
| 설정 | `settings` |
| 드로잉 | `brush` |
| 메모 | `edit_note` |
| 검색 | `search` |
| 별표 | `star` |

```html
<button onclick="..."><span class="mi mi-sm">delete</span> 삭제</button>
```

새로 쓰는 아이콘은 `tools/icon-names.txt`에 추가하고 폰트 서브셋을 다시 받는다.

### 안내 문구, toast, alert에는 이모지 허용

의미 표지로만 쓰고 종류를 늘리지 않는다: 팁(전구), 경고, 에러, 성공, 정보, 첨부 파일(클립).

메모 본문에 넣는 첨부 링크는 파일 종류와 상관없이 클립 하나로 통일한다. 파일 타입별로 이모지를 다르게 붙이면 일관성이 깨진다. 해본 적 있음, 2026-05-29에 되돌림.

### 적용 범위

전체 교체는 따로 진행한다. 새로 추가하거나 고치는 버튼과 액션 시트부터 위 규칙을 따른다.

## 기타

- `main` 브랜치에 바로 커밋한다.
- 커밋 메시지는 한국어로 쓴다.
- 캐시 버스팅: index.html의 `<script src="js/xxx.js?v=YYYYMMDDa">`. 파일을 고치면 버전을 올린다.
- localStorage 키는 `mindflow_` 접두사를 쓴다. utils.js의 `save()`가 붙여 준다.
- 빌드 시스템 없음: 바닐라 JS, deferred script 순서 의존. import/export를 쓰지 않고, index.html의 스크립트 순서를 바꿀 때 주의한다.
