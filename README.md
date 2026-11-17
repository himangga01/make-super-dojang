# 슈퍼도장

전자서명과 도장 이미지를 브라우저에서 만들고 PNG로 바로 내려받는 웹서비스입니다.

- **직접 서명**: 손가락, 마우스, 펜으로 그리기 (되돌리기, 지우기, 펜 굵기)
- **서명 생성**: 이름을 입력하면 손글씨 글꼴 8종으로 서명 후보 생성 (기울기, 밑줄 장식)
- **도장 생성**: 이름을 입력하면 타원, 원형, 정사각, 둥근 사각, 이중 원, 가로형 도장 생성 ('인' 붙이기, 전통 세로 순서, 인주 질감)
- **저장**: 투명 배경 또는 배경색 선택, 잉크 색 선택, 보통·고해상도 PNG. 카드마다 바로 다운로드 버튼이 있고, 지원 브라우저에서는 클립보드 복사도 됩니다.
- **한글·영문** 지원 (입력값으로 자동 감지)

이미지는 모두 사용자 브라우저에서 만들고 서버로 보내지 않습니다. 설계는 [docs/DESIGN.md](docs/DESIGN.md)에 있습니다.

## 실행

빌드 과정이나 설치할 패키지가 없습니다. ES 모듈을 쓰므로 HTTP로 서비스해야 합니다.

```bash
npm start          # http://localhost:8080
```

## 배포

저장소 폴더를 그대로 정적 호스팅에 올리면 됩니다. GitHub Pages라면 저장소 Settings → Pages에서 배포 브랜치와 루트 폴더(`/`)를 고르면 됩니다.

## 테스트

```bash
npm test           # core 모듈 단위 테스트 (Node 내장 러너)
npm run e2e        # Playwright로 세 탭 생성·다운로드 확인 (playwright 설치 필요)
```

## 구조

```
index.html            화면
css/style.css         스타일
js/app.js             탭, 상태, 이벤트 연결
js/fonts.js           글꼴 목록과 로더 (Google Fonts)
js/signature-pad.js   직접 서명 패드
js/signature-gen.js   이름 → 서명
js/stamp-gen.js       이름 → 도장
js/exporter.js        여백 자르기, 배경 합성, PNG 저장·복사
js/core/              DOM 없는 순수 함수 (언어 감지, 검증, 배치 계산, 시드 난수)
```

글꼴은 Google Fonts에서 SIL Open Font License로 배포하는 글꼴을 씁니다.
