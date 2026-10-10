# 우리 문서함

구글 드라이브에 올린 HTML 문서를 렌더링해서 보여주는 정적 뷰어. 서버 없이 GitHub Pages에서 동작함.
보는 사람 본인의 구글 계정으로 Drive API를 호출하므로, 열람 권한은 드라이브 공유 설정을 그대로 따름.

- 목록: `https://<user>.github.io/<repo>/`
- 문서: `https://<user>.github.io/<repo>/?id=<드라이브 파일 ID>`

## 설정

### 1. Google Cloud
1. https://console.cloud.google.com 에서 새 프로젝트 생성
2. **API 및 서비스 → 라이브러리**에서 **Google Drive API** 사용 설정
3. **OAuth 동의 화면** (Google Auth Platform)
   - 사용자 유형: **외부**, 게시 상태는 **테스트**로 유지
   - 데이터 액세스(범위): `https://www.googleapis.com/auth/drive.readonly` 추가
   - 대상(테스트 사용자): 나와 아내의 구글 계정 추가
4. **클라이언트 → 클라이언트 만들기**
   - 유형: **웹 애플리케이션**
   - 승인된 JavaScript 원본: `https://<user>.github.io` (경로 없이 origin만)
   - 로컬 테스트를 하려면 `http://localhost:8000`도 추가
5. 발급된 클라이언트 ID를 `config.js`의 `CLIENT_ID`에 입력

### 2. 드라이브
1. HTML 문서를 넣을 폴더를 만들고 아내에게 **뷰어** 권한으로 공유
2. 폴더 URL(`drive.google.com/drive/folders/XXXX`)의 `XXXX`를 `config.js`의 `FOLDER_ID`에 입력

### 3. GitHub Pages
1. 이 폴더를 GitHub 레포로 push (무료 플랜은 public 레포여야 Pages 사용 가능.
   클라이언트 ID와 폴더 ID는 노출돼도 권한 없는 사람은 아무것도 볼 수 없음)
2. 레포 **Settings → Pages → Source: Deploy from a branch → main / (root)**

## 사용
- 드라이브 폴더에 `.html` 업로드 → 목록에서 "링크 복사" → 아내에게 전송
- 또는 목록 상단 입력창에 드라이브 공유 링크를 붙여넣으면 뷰어 링크로 변환됨
- 첫 접속 시 "확인되지 않은 앱" 경고가 뜨면 **고급 → (앱 이름)(으)로 이동**

## 로컬 테스트
```sh
python3 -m http.server 8000
```

## 참고
- HTML은 단일 파일이어야 함 (CSS/JS/이미지는 인라인, CDN 또는 data URI). 상대경로 리소스는 불러오지 못함
- 문서는 `allow-same-origin` 없는 sandbox iframe에서 실행됨. 그래서 문서 안 스크립트가 뷰어의 토큰에 접근할 수 없고, 대신 문서 안에서 `localStorage`는 쓸 수 없음
- 토큰은 약 1시간 유효함. 만료되면 로그인 버튼을 한 번 더 누르면 됨 (보통 계정 선택 없이 바로 넘어감)
