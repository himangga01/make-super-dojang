# 슈퍼도장

전자서명과 도장 이미지를 브라우저에서 만들고 PNG로 바로 내려받는 웹서비스입니다.

## 기능

| 탭 | 내용 |
| --- | --- |
| 직접 서명 | 손가락·마우스·펜으로 그리기, 또는 **종이에 쓴 서명 사진의 배경을 지워** 가져오기 |
| 서명 생성 | 이름을 입력하면 **한글 24가지, 영문 24가지** 서명 형태 (흘림 밑줄, 동그라미, 세로 서명, 모노그램 등). 기울기·굵기 조절 |
| 도장 생성 | **28가지** 도장 (원형, 타원, 사각, 음각, 칸 나눔, 꽃테, 팔각, 육각, 둘레글자, 날짜 도장 등). 분류 필터, '인' 붙이기, 전통 세로 순서, 인주 질감, 잉크 번짐, 회전 |
| 문서에 넣기 | 계약서 등 문서 이미지 위에 서명·도장을 끌어 놓고 저장 (긴 변 4000px까지 원본 해상도 유지) |

공통 저장 옵션: 투명 배경 또는 배경색, 잉크 색, 보통·고해상도 PNG, 카드별 바로 다운로드, 후보 전체 ZIP, 클립보드 복사, 공유(지원 기기), 보관함 저장. 한글·영문은 입력값으로 자동 감지합니다.

이미지는 모두 사용자 브라우저에서 만들고 서버로 보내지 않습니다. 설계는 [docs/DESIGN.md](docs/DESIGN.md)에 있습니다.

## 실행

빌드 과정이나 설치할 패키지가 없습니다. ES 모듈을 쓰므로 HTTP(S)로 서비스해야 합니다.

```bash
npm start          # http://localhost:8080
```

## 배포

저장소 폴더를 그대로 정적 호스팅에 올리면 됩니다. GitHub Pages라면 저장소 Settings → Pages에서 배포 브랜치와 루트 폴더(`/`)를 고르면 됩니다. 클립보드 복사는 HTTPS에서만 동작합니다.

## 개발

```bash
npm test                     # core 모듈 단위 테스트 (Node 내장 러너)
npm run e2e                  # Playwright로 전체 흐름 확인 (playwright 설치 필요)
node scripts/fonts-link.mjs  # js/fonts.js 글꼴 목록을 바꾼 뒤 index.html 글꼴 링크 갱신
```

## 구조

```
index.html               화면
css/style.css            스타일
js/app.js                탭, 상태, 이벤트 연결
js/fonts.js              글꼴 목록과 로더 (Google Fonts)
js/signature-styles.js   서명 형태 48가지 정의
js/signature-gen.js      이름 → 서명
js/signature-pad.js      직접 서명 패드
js/stamp-gen.js          이름 → 도장 28가지
js/photo-import.js       서명 사진 → 투명 서명
js/doc-composer.js       문서에 서명·도장 넣기
js/library.js            보관함 (IndexedDB)
js/exporter.js           여백 자르기, 배경 합성, PNG 저장·복사
js/core/                 DOM 없는 순수 함수 (언어 감지, 배치 계산, 이미지 처리, ZIP, 시드 난수)
```

글꼴은 Google Fonts에서 SIL Open Font License로 배포하는 글꼴을 씁니다.
