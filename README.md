# 게임 서랍 — 설치 안내

브라우저 게임 10개를 모은 홈페이지입니다. 처음 들어온 사람에게 회원번호(100001부터)와 이어하기 코드를 주고, 게임 기록을 회원번호별로 서버에 저장합니다.

필요한 것: 무료 계정 2개 (Supabase = 저장 서버, GitHub = 홈페이지 호스팅). 비용은 들지 않습니다.

## 폴더 구성

```
index.html            메인 홈페이지 (게임 목록 + 회원증)
games/*.html          게임 10개
assets/config.js      ← 저장 서버 주소를 넣는 곳 (2단계)
assets/member.js      회원번호 발급·저장 동기화
supabase/schema.sql   저장 서버에 한 번 실행할 설정 (1단계)
```

## 1단계. 저장 서버 만들기 (Supabase)

1. https://supabase.com 가입 → **New project**
   - 이름: 아무거나 (예: game-drawer)
   - Region: **Northeast Asia (Seoul)**
   - 데이터베이스 비밀번호는 아무거나 만들어 따로 적어 두세요 (이 사이트엔 안 씁니다)
2. 왼쪽 메뉴 **SQL Editor** → `supabase/schema.sql` 파일 내용을 전부 복사해 붙여넣고 **Run**
   - 아래쪽에 `Success` 가 나오면 성공
3. 왼쪽 메뉴 **Authentication** → **Sign In / Providers** (또는 Providers) → **Allow anonymous sign-ins** 켜고 저장
   - 이걸 켜야 가입 절차 없이 회원번호가 자동으로 나옵니다
4. 왼쪽 메뉴 **Project Settings** → **API** (또는 Data API / API Keys)
   - **Project URL** 과 **anon public** 키를 복사

## 2단계. 연결 정보 넣기

`assets/config.js` 를 메모장으로 열어 따옴표 안에 붙여넣습니다.

```js
window.GAME_SITE_CONFIG = {
  supabaseUrl: "https://xxxxxxxx.supabase.co",
  supabaseAnonKey: "eyJhbGciOi..."
};
```

- anon public 키는 공개돼도 괜찮습니다. 보안 규칙(schema.sql)이 남의 기록을 못 보게 막습니다.
- **service_role** 키는 절대 넣지 마세요.

## 3단계. 홈페이지 올리기 (GitHub Pages)

1. https://github.com 가입 → 오른쪽 위 **+** → **New repository**
   - 이름: 예) `game-drawer`, **Public** 선택 → Create
2. **uploading an existing file** 클릭 → 이 폴더 안의 내용(index.html, games, assets, supabase, README.md)을 통째로 끌어다 놓기 → **Commit changes**
3. 저장소의 **Settings** → **Pages** → Branch: `main`, 폴더: `/ (root)` → Save
4. 1~2분 뒤 `https://내아이디.github.io/game-drawer/` 로 접속 → 이 주소를 공유하면 됩니다

## 확인하기

- 홈 회원증에 `No.100001` 같은 번호와 **저장 서버 연결됨** 이 보이면 성공
- 게임 화면 왼쪽 아래에 `← 서랍 · No.100001 · 저장됨` 표시가 나옵니다
- 연결 정보를 넣기 전에는 "이 기기에만 저장"으로 동작합니다 (게임은 정상 실행)

## 회원번호 동작 방식

- 처음 들어오면 회원번호 + 8자리 이어하기 코드 발급 (가입·이메일 없음)
- 같은 브라우저로 다시 오면 같은 회원번호
- 다른 기기: 홈의 **다른 기기에서 하던 기록 불러오기** 에 회원번호 + 코드 입력
- 코드를 10번 틀리면 1시간 동안 막힙니다
- 브라우저 기록을 지우면 회원번호를 잃습니다 → 코드를 적어 두면 되찾을 수 있음

## 게임을 고쳤을 때 (업데이트)

이 사이트의 게임 파일은 Claude 채팅방에 있는 게임의 **복사본**입니다. 채팅방에서 게임을 고쳐도 사이트는 자동으로 바뀌지 않습니다.

1. Claude에게 "게임 서랍 업데이트해줘"라고 요청 → 최신 게임으로 다시 묶은 zip을 받음
2. GitHub 저장소에 `games/` 폴더의 바뀐 파일만 다시 올리기 (Add file → Upload files → 같은 이름이면 덮어씀)

회원 저장 기록은 Supabase에 있어서 파일을 바꿔도 지워지지 않습니다.

## 알아 둘 점

- 게임은 모두 10개이며, 다시 열면 하던 곳부터 이어집니다.
- **표류자들의 섬 · 규칙 없는 마을 · 참가편**은 각 시간대(오전·오후·저녁)가 끝날 때 저장됩니다. 미션이나 사건 선택창이 열린 상태에서 나가면 그 직전 시간대부터 이어집니다. 엔딩을 보면 저장이 지워지고, 다음엔 새 판으로 시작합니다.
- **어항 하우스**의 AI 두뇌는 Claude 안에서만 작동합니다. 이 사이트에서는 기본 학습기(키워드 지령)로 돌아갑니다.
- **버드내의 밤**은 판 진행이 아니라 승/패 전적이 저장됩니다.
- Supabase 무료 플랜은 오랫동안 접속이 없으면 프로젝트가 일시 정지될 수 있습니다. 대시보드에서 다시 켜면 기록은 그대로입니다.
- 게임을 고치면 `games/` 안의 해당 파일만 GitHub에 다시 올리면 됩니다. 새 게임을 추가할 때는 `<head>` 바로 뒤에 다른 게임 파일과 같은 3줄의 `<script>` 를 넣고, `data-game` 에 영문 이름을 적은 뒤 `index.html` 의 `GAMES` 목록에 한 줄 추가하세요.
