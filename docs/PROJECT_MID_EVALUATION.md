# 프로젝트 중간 평가

> 지금까지 진행한 리팩터링(아이콘·네비·URL 구조·pjax)을 기점으로 한 세부 평가 및 개선 포인트.

---

## 1. 변경 사항 요약

| 영역 | 변경 전 | 변경 후 |
|------|---------|---------|
| 아이콘 | `_includes/icon/*.html` (include) | `assets/svg/*.svg` + CSS mask (`--ico`) |
| Favicon | data URI 인라인 SVG | `assets/svg/sparkles-solid.svg` 링크 |
| 네비 분기 | URL 경로 (`/public/`, `/protected/`) | front matter `type: sidebar` / `type: topbar` |
| 섹션 URL | `/public/cases/`, `/protected/home/` 등 | `/cases/`, `/home/`, `/settings/` 등 |
| 사이드바 active | 현재 섹션만 펼침 (Liquid + pjax setActive) | 동일 유지, 인덱스·pjax 보정 |
| 하위 페이지 수집 | `url contains group_base` 만 | `group_base` + `group_base_alt`(group_key) concat/uniq |

---

## 2. 세부 평가

### 2.1 아키텍처·구조 (7/10)

**장점**
- Jekyll collections(`_pages`) + layout(default/section/page/startup) 분리가 명확함.
- 네비게이션을 **데이터 기반**(`type`, `layout`, `url`)으로 분기해, URL 네이밍에 덜 의존함.
- 아이콘을 정적 SVG + CSS 변수로 통일해, include 의존과 중복이 줄어듦.

**약점**
- **Liquid 배열 인덱스**가 Jekyll/Liquid 버전에 따라 0/1-based 이슈가 있어, `url_parts[2] | default: url_parts[1]` 같은 방어 로직이 여러 곳에 흩어져 있음.
- **경로 규칙**이 `_config.yml` defaults, front matter permalink, 컬렉션 `/:path/`에 나뉘어 있어, 한곳에서 “단일 소스 오브 트루스”로 보기 어려움.

---

### 2.2 유지보수성 (6/10)

**장점**
- `type: sidebar` / `type: topbar` 로 노출 위치를 제어해, 새 섹션 추가 시 front matter만 수정하면 됨.
- 아이콘 추가는 `assets/svg/`에 파일만 넣고, 기존 `icon` 이름 규칙(outline/solid)을 따르면 됨.

**약점**
- **admin/config.yml**이 여전히 `_pages/public/...`, `_pages/protected/...` 경로를 참조함. 실제 디렉터리는 `_pages/cases/`, `_pages/home/` 등이라 CMS에서 해당 파일을 찾지 못할 수 있음.
- **section.html**의 하위 페이지 수집이 `item.url contains page_group_base` 단일 조건이라, permalink가 `/:path/` 만 쓰는 하위 페이지(`/cases/nvme-mi-basic/`)는 포함되지만, 다른 형태가 생기면 누락 가능성 있음.
- **오타**: `op-soures`(설정·폴더명), 이전 `stemap`(sitemap) 등이 문서/체크리스트에 남아 있으면 혼선 유발.

---

### 2.3 성능 (8/10)

**장점**
- 아이콘을 SVG 파일 + mask로 두어, HTML 중복 감소·캐시 활용에 유리함.
- pjax로 본문만 교체해 전체 리로드가 줄어듦.
- `concat`/`uniq` 사용은 빌드 타임 비용이지만, 런타임에는 영향 없음.

**약점**
- 사이드바에서 `group_pages_a`/`group_pages_b` 두 번의 `where_exp` + `concat`/`uniq`로, 페이지 수가 많아지면 빌드 시간이 조금씩 늘어날 수 있음(현재 규모에서는 무시 가능).

---

### 2.4 접근성·호환성 (7/10)

**장점**
- 아이콘에 `aria-hidden="true"` 적용.
- 네비에 `title`, 링크 텍스트(`app-nav-label` 등) 유지.
- CSS mask 사용 시 `-webkit-` 접두어로 구형 브라우저 고려.

**약점**
- pjax 후 포커스 이동·스크린 리더 알림 등은 없음. SPA처럼 “콘텐츠 변경 알림”을 넣으면 접근성 개선 가능.
- `favicon_color`는 더 이상 head에서 사용하지 않는데 `_config.yml`에 남아 있어, 사용처 정리 또는 제거가 좋음.

---

### 2.5 일관성 (6/10)

**장점**
- URL을 `/cases/`, `/home/` 등으로 통일해, 링크·라우팅 규칙이 단순해짐.
- outline/solid 아이콘 네이밍(`*.svg`, `*-solid.svg`)이 일관됨.

**약점**
- **Liquid 인덱스**: sidebar/topbar는 `url_parts[2] | default: url_parts[1]`, section/page 레이아웃은 `url_parts[2]`만 사용. 한쪽이 0-based 환경이면 불일치 가능.
- **admin/config.yml**의 file 경로가 실제 `_pages` 구조와 불일치(public/protected 디렉터리 없음).
- **docs/MIGRATION_CHECKLIST.md**에 `/public/about/`, `/protected/settings/` 등 구 URL이 남아 있음.

---

### 2.6 테스트·검증 (5/10)

**장점**
- GitHub Pages 호환 플러그인만 사용해 빌드 환경이 단순함.

**약점**
- Liquid/URL 인덱스, active 상태 등에 대한 자동화 테스트 없음.
- pjax 동작(같은 origin, replaceState 후 setActive 등)은 수동 확인에 의존.

---

## 3. 개선 포인트 (우선순위)

### 높음

1. **admin/config.yml 경로 정리**
   - `_pages/public/...` → `_pages/home/...`, `_pages/cases/...` 등 **실제 디렉터리 구조**에 맞게 수정.
   - 존재하지 않는 경로(`_pages/public/about/...`, `_pages/protected/about/...`) 제거 또는 실제 파일로 매핑.

2. **Liquid 경로 로직 단일화**
   - “섹션 키” 추출을 한 곳에서 정의하고, include/레이아웃에서는 그 결과만 쓰도록 정리.
   - 예: `_includes/nav_utils.liquid` 같은 partial에 `page_group`, `group_key` 계산을 모아두고, sidebar/topbar/section에서 재사용.

3. **_config.yml 미사용 항목 정리**
   - `favicon_color`: 사용하지 않으면 제거하거나, 나중에 SVG 색상 등에 쓰일 계획이면 주석으로 용도 명시.

### 중간

4. **section.html 하위 목록 수집**
   - sidebar와 동일하게 `page_group_base` + “alt”(group_key만으로 만든 경로)를 합쳐서 수집하면, permalink 구조가 바뀌어도 하위 페이지 누락을 줄일 수 있음.

5. **pjax 접근성**
   - `loadPage` 성공 후 `contentInner`에 `tabindex="-1"`과 `focus()`로 포커스 이동.
   - 필요 시 `aria-live` 영역에 “페이지 전환됨” 등 안내 문구 추가.

6. **문서·체크리스트 정리**
   - `docs/MIGRATION_CHECKLIST.md` 등에서 `/public/`, `/protected/` 예시를 현재 URL 구조(`/cases/`, `/home/` 등)로 수정.
   - `op-soures` vs “Opensource” 등 오타/표기 통일.

### 낮음

7. **에러 처리·폴백**
   - pjax fetch 실패 시 사용자에게 “페이지를 불러오지 못했습니다. 새로고침해 주세요.” 등 메시지 표시.
   - 아이콘 SVG 로드 실패 시 placeholder 또는 텍스트만 보이도록 CSS/마크업 고려.

8. **빌드/배포 검증**
   - GitHub Actions 등에서 `jekyll build` 후 주요 URL이 200으로 응답하는지 스모크 테스트 추가 검토.

---

## 4. 점수 요약

| 항목 | 점수 | 비고 |
|------|------|------|
| 아키텍처·구조 | 7/10 | type 기반 분기 좋음, 경로·인덱스 일관성 보강 여지 |
| 유지보수성 | 6/10 | admin/config, section 하위 수집 정리 필요 |
| 성능 | 8/10 | pjax·SVG 구조 적절 |
| 접근성·호환성 | 7/10 | pjax 포커스·알림 보강 가능 |
| 일관성 | 6/10 | Liquid 인덱스·admin·문서 정리 |
| 테스트·검증 | 5/10 | 자동화 테스트 없음 |

**종합**: 현재 구조와 리팩터링 방향은 적절하며, **admin 경로·Liquid 일관성·문서 정리**를 우선하면 유지보수와 확장성이 더 좋아질 것으로 보임.
