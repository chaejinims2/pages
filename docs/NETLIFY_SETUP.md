# Netlify + Decap CMS 설정 가이드

배포 후 Netlify 대시보드에서 진행할 단계입니다.

---

## 1. GitHub 저장소 연결

1. [Netlify](https://app.netlify.com) 로그인 후 **Add new site** → **Import an existing project**
2. **GitHub** 선택 후 권한 허용
3. 저장소 목록에서 **chaejinims2.github.io** (또는 해당 repo) 선택
4. **Branch to deploy**: `main`
5. **Build command**, **Publish directory**: `netlify.toml`에 이미 설정되어 있으므로 비워두거나 그대로 두기
6. **Deploy site** 클릭 → 첫 빌드 완료될 때까지 대기

---

## 2. Netlify Identity 활성화

1. 사이트 대시보드에서 **Site configuration** (또는 **Site settings**) 이동
2. 왼쪽 메뉴 **Identity** 클릭
3. **Enable Identity** 버튼 클릭하여 활성화

---

## 3. Git Gateway 활성화

1. 같은 **Identity** 페이지에서 아래로 스크롤
2. **Services** 섹션의 **Git Gateway** 찾기
3. **Enable Git Gateway** 클릭  
   - GitHub 권한 요청 시 허용

---

## 4. 관리자 사용자 초대 (Invite only)

1. **Identity** 탭에서 **Invite users** (또는 **Invitations**) 클릭
2. CMS로 로그인할 이메일 주소 입력 후 **Invite** 전송
3. 해당 이메일 받은편지함에서 Netlify 초대 메일을 연 뒤 **Accept the invite** 링크 클릭
4. 열리는 페이지에서 **비밀번호를 입력·확인** 후 가입 완료

> **비밀번호는 어디서 설정하나요?**  
> Netlify 대시보드에는 비밀번호 입력란이 없습니다. **초대 메일 안의 "Accept the invite" 링크를 눌렀을 때 열리는 페이지**에서만 비밀번호를 정할 수 있습니다. 그때 설정한 비밀번호로 `/admin` 로그인 시 사용합니다.

---

## 5. 가입 방식 제한 (Invite only)

1. **Identity** → **Settings and usage** (또는 **Registration**)
2. **Registration preferences**: **Invite only** 선택  
   - 누구나 가입하지 못하고, 초대된 사용자만 로그인 가능

---

## 6. /admin 로그인 및 초안 게시물 테스트

1. 브라우저에서 `https://<your-site>.netlify.app/admin` 접속
2. **Login with Netlify Identity** 선택 후 위에서 초대한 이메일/비밀번호로 로그인
3. **Posts** → **New Posts** (또는 **New Post**) 클릭
4. 제목, 날짜, 본문 등 입력 후 **Save** (초안 저장)
5. 상단 상태를 **Draft** → **Ready** 등으로 바꾼 뒤 **Publish** 실행
6. 저장소 `main` 브랜치에 커밋이 생성되고, Netlify가 자동으로 재배포하는지 확인

---

## 요약 체크리스트 (Netlify 대시보드에서 할 일)

| 순서 | 위치 | 할 일 |
|------|------|--------|
| 1 | Add new site | GitHub repo 연결, branch: main |
| 2 | Identity | Enable Identity |
| 3 | Identity → Services | Enable Git Gateway |
| 4 | Identity → Invite | 관리자 이메일 초대 후 수락 |
| 5 | Identity → Registration | Invite only 로 설정 |
| 6 | 브라우저 | /admin 접속 → 로그인 → 초안 작성 → Publish 테스트 |
