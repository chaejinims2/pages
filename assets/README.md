# assets 구조

## 기존 (Jekyll 사이트용)

- `css/tokens.css` — 디자인 토큰 + 테마(dark/light/modern/connect), `css/base.css` — 메인 스타일 (레이아웃에서 로드)
- `js/` — vendor, plugins, main 등

## WebEAST wwwroot 복사분 (구조 개선)

WebEAST 프로젝트의 `wwwroot`를 **완전 복사가 아닌, 폴더 구조를 정리해서** 반영한 영역입니다.

```
css/
  global/              # 전역: 테마·레이아웃·공통
    theme.css          # CSS 변수(토큰), data-theme (dark/light/modern)
    app-shell.css      # 앱 쉘(패널, 네비 등)
    site.css           # 공통(base, 링크, 버튼)
  features/            # 기능별 (필요 시 로드)
    dashboard/
      board-status.css
    connect-style.css
    script-generator.css

js/
  core/
    site.js            # 사이드바/테마/레이아웃
  features/
    dashboard/
      dashboard.js
      board-status.js
    settings/
      settings.js
  ws/
    websocket.js
```

- **사용**: 레이아웃에서 `tokens.css`·`base.css` 대신 또는 추가로 `css/global/theme.css` 등을 로드해 WebEAST 계열 디자인을 쓸 수 있음.
- **lib**: Bootstrap/jQuery 등은 복사하지 않음. CDN 또는 기존 `js/vendor` 사용.
