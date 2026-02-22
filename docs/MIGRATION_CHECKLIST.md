# Netlify 마이그레이션 체크리스트

## 배포 전 (로컬)

- [ ] `bundle install` 성공
- [ ] `bundle exec jekyll build` 성공
- [ ] `_site` 폴더가 생성되고 기존 URL 구조가 유지되는지 확인 (예: `/public/about/`, `/protected/settings/` 등)
- [ ] 변경 사항 커밋 후 `main`에 푸시

## Netlify 연결

- [ ] Netlify에서 **Add new site** → **Import from Git** → 해당 GitHub 저장소 선택
- [ ] Production branch: **main**
- [ ] Build 설정은 `netlify.toml` 사용 (별도 입력 불필요)
- [ ] 첫 Deploy 성공 확인

## URL / 다운타임

- [ ] 기존 GitHub Pages URL은 유지하려면 도메인을 Netlify로 옮기거나 리다이렉트 설정
- [ ] Netlify 기본 URL `https://<site-name>.netlify.app` 로 접속 테스트
- [ ] 커스텀 도메인 사용 시: Netlify **Domain management**에서 도메인 추가 후 DNS 설정

## Decap CMS (/admin)

- [ ] **Identity** → Enable Identity
- [ ] **Identity** → Git Gateway 활성화
- [ ] **Identity** → Invite로 관리자 초대 후 수락
- [ ] **Identity** → Registration을 **Invite only**로 설정
- [ ] `https://<site-name>.netlify.app/admin` 접속 → 로그인
- [ ] Posts에서 초안 작성 → Publish → GitHub에 커밋되는지 확인

## 안전성 확인

- [ ] 기존 테마/레이아웃 파일 변경 없음
- [ ] `_config.yml` 변경 없음 (permalink 등 유지)
- [ ] `.gitignore`에 `_site` 유지 (Netlify는 소스에서 새로 빌드)
