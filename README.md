# 버스 빼기 퍼즐

판 위의 버스와 자동차를 모두 밖으로 빼내는 1인용 웹 퍼즐.
HTML + CSS + 순수 JavaScript(ES 모듈) + Canvas. 외부 라이브러리·빌드 도구 없음.

## 폴더 구조

```
BusPuzzle/
├─ index.html                 진입 페이지 (모든 화면의 뼈대)
├─ style.css                  디자인 — 버스 터미널 안내판 느낌
├─ package.json               Node 테스트용 설정 — 브라우저는 읽지 않는다
├─ .nojekyll                  GitHub Pages가 Jekyll 처리를 하지 않게
├─ src/
│  ├─ main.js                 시작점: 화면 잇기·한 판 시작/마무리·기록 저장
│  ├─ core/                   ← 화면과 무관한 순수 로직. Node에서 그대로 테스트한다
│  │  ├─ rules.js             규칙 엔진: 미끄러지기·탈출·클리어·막힘 판정
│  │  ├─ game.js              한 판 진행: 이동 횟수·되돌리기·재시작·상태
│  │  ├─ generator.js         판 생성기 (역방향 짓기 + '고리' 끼워 넣기)
│  │  ├─ solver.js            솔버 (목표 이동 수)
│  │  ├─ levels.js            1~10단계 설정 + 자유 모드 규칙  ← 숫자만 바꿔 난이도 조정
│  │  ├─ records.js           별점·최고 기록 합치기·시간 표시
│  │  ├─ random.js            시드 난수
│  │  └─ textBoard.js         글자 그림 ↔ 판 정의 (테스트·디버그)
│  ├─ render/
│  │  └─ boardRenderer.js     Canvas 그리기·애니메이션
│  ├─ ui/
│  │  ├─ screens.js           화면 전환
│  │  ├─ input.js             마우스·터치·키보드 → 엔진 명령
│  │  ├─ gameScreen.js        플레이 화면 (판·통계·막힘/나가기 안내·시계)
│  │  ├─ levelSelect.js       단계 선택 (노선도)
│  │  ├─ resultScreen.js      결과 (승차권)
│  │  ├─ recordsScreen.js     기록
│  │  ├─ freeMode.js          자유 모드 설정
│  │  ├─ rulesDialog.js       규칙 창 + 연습 판
│  │  └─ puzzleLoader.js      판 불러오기 (Web Worker + 캐시)
│  ├─ workers/
│  │  └─ generator.worker.js  판 생성을 다른 스레드에서
│  └─ storage/
│     └─ save.js              localStorage (해금·기록·자유 모드 설정·만든 판 캐시)
├─ tools/
│  └─ levels-report.js        1~10단계를 만들어 보고 표로 출력
└─ tests/                     node --test
```

의존 방향은 한쪽뿐이다: `ui` → `render`·`core`·`storage`, `render` → `core`. **`core`는 DOM·Canvas·localStorage를 모른다.**

## 테스트

Node 18 이상(내장 `node:test` 사용, 설치할 것 없음):

```
node --test
```

레벨 숫자를 바꾼 뒤에는 10단계가 모두 조건을 맞추는지 표로 확인:

```
node tools/levels-report.js          # --show 를 붙이면 판 그림까지
```

## 로컬에서 실행

ES 모듈은 `file://`로 열면 브라우저가 막는다. 간단한 서버를 띄우고 연다 (PowerShell):

```
python -m http.server 8000 --bind 127.0.0.1 --directory D:\Game_Test\BusPuzzle
```

그다음 브라우저에서 <http://localhost:8000> 을 연다.

⚠️ **`--bind 127.0.0.1`과 `--directory`를 빼지 말 것.** 둘 다 없으면 *명령을 친 폴더 전체*가 *인터넷 전체*에 열린다.
이 PC는 공유기 없이 공인 IP를 직접 받고 있어서, 2026-10-12에 실제로 Unity 프로젝트 폴더가 몇 시간 동안 열려
`.env`·인증 파일을 찾는 스캐너가 찾아왔다. 휴대폰에서 해 보려면 서버를 열지 말고 아래 '배포'로 올려서 열 것.
코드를 고친 뒤 화면이 그대로면 브라우저가 옛 파일을 기억하고 있는 것이다 — **Ctrl+F5**(강력 새로고침).

## 판 정의 형식

```js
{
  size: 6,
  blocks: [[x, y], ...],                            // 고정 구조물 (1칸)
  vehicles: [{ kind: 'car' | 'bus', x, y, front }], // (x, y) = 가장 왼쪽·위 칸, front = 앞쪽 방향
}
```

테스트와 손으로 만드는 판은 글자 그림으로도 쓸 수 있다 (`parseTextBoard`):

```
. . . # .
# a A b .      a A = 오른쪽을 보는 자동차 (대문자가 앞쪽)
. d . B .      b/B = 아래를 보는 세로 자동차
. D c C #      # = 고정 구조물
G g g e E      G g g = 왼쪽을 보는 버스
```

## 배포

폴더를 **빌드 없이 그대로** 올리면 된다 (`index.html`이 맨 위에 있어야 한다).

**GitHub Pages**
1. github.com에서 새 저장소를 만든다 (예: `bus-puzzle`).
2. 이 폴더에서:
   ```
   git init
   git add .
   git commit -m "버스 빼기"
   git branch -M main
   git remote add origin https://github.com/<아이디>/bus-puzzle.git
   git push -u origin main
   ```
3. 저장소 → Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save.
4. 1~2분 뒤 `https://<아이디>.github.io/bus-puzzle/` 에서 열린다. (`.nojekyll`은 GitHub의 Jekyll 처리를 끄는 빈 파일)

**itch.io**
1. 폴더 안의 파일들(`index.html`, `style.css`, `src/` …)을 zip으로 묶는다 — 폴더째가 아니라 **내용물**을 묶어 zip 맨 위에 `index.html`이 오게.
2. itch.io → Upload new project → Kind of project: **HTML** → zip 업로드 → "This file will be played in the browser" 체크.
3. 화면 크기는 960×720 정도, "Mobile friendly"·"Fullscreen button" 체크를 권장.
⚠️ itch.io는 게임을 다른 도메인의 iframe에서 돌리므로, 일부 브라우저(사파리 등)가 localStorage를 막으면 기록이 그 방문 동안만 남는다.
