# MindFlow

마인드맵, 메모, 캘린더를 통합한 개인용 PWA | https://thefirstplum.github.io/mindmap-flow/

## 개요

유료 마인드맵 앱을 대신하기 위해 시작한 프로젝트로, 이후 메모와 캘린더 기능을 더해 하나의 앱으로 통합. 빌드 도구 없는 HTML, CSS, JavaScript로 구현했으며, 데이터는 브라우저에 저장한 뒤 Google Drive로 기기 간 동기화. 휴대폰, 태블릿, 데스크톱에서 상시 사용 중.

- 개발 원본 저장소(커밋 기록): https://github.com/thefirstplum/mindmap-flow
- 개발 과정 정리: https://github.com/thefirstplum/mindflow-case-study
- 이 저장소는 원본을 공개용으로 정리해 커밋 하나로 올린 사본

## 주요 기능

- 메모: CodeMirror 6 마크다운 에디터, `#상위/하위` 중첩 태그, `[[제목]]` 링크와 백링크, `![[제목]]` 임베드, `tag:` `is:` 같은 검색 연산자, 이미지와 파일 첨부, 펜 필기
- 마인드맵: 캔버스에서 노드 추가와 연결, 노드마다 메모 연결
- 캘린더: 타임블록과 Google Calendar 일정을 한 주간 시간표에 표시, 날짜별 감정일기(#일기 메모로 저장)
- 홈: 프로젝트 태그별 최근 노트, 노트 속 미완료 체크박스를 모은 오늘의 할 일
- 집중 타이머: 시작 시각만 저장하고 경과 시간은 매번 계산. 모바일 화면이 꺼져도 시간 유지
- 백업과 오프라인: IndexedDB 자동 스냅샷, JSON 내보내기, 서비스 워커 캐시

## 주요 기술 과제

- 다른 기기에서 삭제한 메모가 동기화 후 복원되는 문제: 마지막 동기화 스냅샷과 비교하는 3-way 판정으로 해결
- 마인드맵 동시 편집 시 덮어쓰기: 노드, 엣지 단위 병합과 tombstone 적용
- localStorage 5MB 한계: 동기 API를 유지한 채 IndexedDB로 이전
- 간헐적인 "동기화 실패" 표시: 토큰 만료를 실패로 처리하던 분기를 찾아 무중단 갱신으로 변경
- iOS에서 화면이 꺼지면 타이머가 멈추는 문제: 시작 시각 기준 계산으로 변경

코드 발췌와 배경은 [케이스 스터디](https://github.com/thefirstplum/mindflow-case-study#코드-발췌).

## 동기화

- Drive `MindFlow/` 폴더에 메모는 프론트매터가 붙은 `.md` 파일로, 마인드맵과 타임블록은 JSON으로 저장. 메모는 Obsidian 등 다른 도구에서도 열람 가능
- 로그인은 Authorization Code + PKCE. refresh token은 Cloudflare Worker(저장소 미포함)에 두고, 브라우저에는 단기 access token만 보관
- 15초 주기로 Drive Changes API를 조회해 변경이 있을 때만 파일 목록 수신
- 항목별로 마지막 동기화 시점과 로컬, 원격 수정 시각을 비교해 업로드와 다운로드를 결정
- 양쪽이 모두 바뀐 메모는 충돌 사본을 생성하고, 마인드맵은 노드 단위로 병합

## 디렉터리 구조

```
index.html            화면 마크업, 스크립트 로드 순서
styles.css            스타일, 테마
service-worker.js     네트워크 우선, 오프라인일 때만 캐시 사용
js/
  sync.js             동기화 엔진 (push/pull, 병합, 스냅샷)
  sync-adapters.js    데이터 종류별 저장 형식과 충돌 판정
  drive-client.js     Drive API 호출, OAuth
  utils.js            저장소(IndexedDB + localStorage), 마크다운 렌더
  memo.js, mindmap.js, calendar.js, gcal.js, home.js, pomodoro.js ...
  vendor/             CodeMirror 6 번들
tools/                아이콘 생성 스크립트
CLAUDE.md             Claude Code 작업 규칙
```

## 로컬 실행

빌드 과정 없이 정적 서버로 실행.

```bash
git clone https://github.com/thefirstplum/mindflow.git
cd mindflow
python3 -m http.server 4173
```

- `http://localhost:4173` 접속
- Drive 동기화와 Google Calendar 연동을 제외한 모든 기능이 로컬에서 동작. 두 기능은 OAuth 클라이언트에 등록된 주소에서만 연결

## 개발 방식

Claude Code를 활용해 개발. 반복되는 실수는 `CLAUDE.md` 규칙으로 관리하고, 작업 흐름과 검증 방법, 주요 결정은 [케이스 스터디](https://github.com/thefirstplum/mindflow-case-study)에 정리.
