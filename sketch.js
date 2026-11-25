//메인 파일 (11월 1일 기준)


// 🌟 모바일 뷰포트 고정 스크립트
(function ensureViewportMeta() {
  let meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
})();


let peer;
let connections = [];
let myRole = "";
let myId = "";
let currentRoomId = "";
let players = {};


let myColor;
let inputRoomId, inputNickCreate, inputNickJoin;
let myNickname = '';   // 내 닉네임 (비어 있으면 ID 앞 5글자로 표시)


// --- 🌟 레이아웃 변수 (툴바 + 게임 영역 분리) ---
let appRoot;        // 툴바 + 게임 영역을 감싸는 최상위 래퍼
let toolbar;        // 상단 고정 툴바 (게임 영역 밖)
let canvasWrapper;  // 게임 영역 (캔버스 + 오버레이)


// --- 신규 UI 상태 관리 변수 ---
let uiState = 0; // 0: 메인, 1: 방 ID 입력, 2: 게임 중, 3: 도움말, 4: 방 만들기(닉네임), 5: 방 입장(닉네임)
let mainUIContainer;


// --- 도움말 팝업 관련 변수 ---
let helpOverlay, helpCard;
let helpVisible = false;
let helpNav = null;               // 메인 도움말 카드의 섹션 네비게이터
let helpPopupNav = null;          // ? 버튼 팝업의 섹션 네비게이터
let helpBackBtn = null;
let helpHideTimer = null;


// --- 2D 시점 및 조작 변수 ---
let playerAngle = 0; // 캐릭터 바라보는 방향 (라디안)


// =====================================================
// 🔗 minigame.html 과 반드시 같은 값으로 유지할 공통 상수
// =====================================================
const BASE_W = 800;
const BASE_H = 500;
const PLAYER_RADIUS = 20;
const PLAYER_SPEED = 4;
const JOY = { baseX: 90, baseOffsetY: 90, r: 50, stickR: 25 };
// 입장 버튼: C 버튼과 겹치지 않도록 위쪽에 배치
const ENTER_BTN = () => ({ x: width - 70, y: height - 140, r: 35 });
const TOOLBAR_H = 48; // 상단 툴바 높이 (게임 영역은 이 아래부터)
const TOOLBAR_COLLAPSED_H = 4; // 접힌 툴바: 얇은 선(존재만 표시)
let toolbarCollapsed = false;


// --- 닉네임 ---
const NICK_MAX = 8;
const NICK_KEY = 'land2d_nick';


// 닉네임 정리: 제어문자/방향 제어 문자 제거, 공백 정리, 최대 NICK_MAX 글자
// (다른 플레이어가 보낸 값도 반드시 이 함수를 거쳐서 사용 - 신뢰할 수 없는 입력)
function sanitizeNick(v) {
  if (typeof v !== 'string') return '';
  const clean = v
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, NICK_MAX).join('');
}


// 머리 위 이름표: 닉네임 > (나 / ID 앞 5글자)
function displayNameOf(id, p) {
  const nick = sanitizeNick(p && p.name);
  if (id === myId) return nick || '나';
  return nick || String(id).substring(0, 5);
}


function loadSavedNick() {
  try { return sanitizeNick(localStorage.getItem(NICK_KEY) || ''); } catch (e) { return ''; }
}
function saveNick(n) {
  try { localStorage.setItem(NICK_KEY, n); } catch (e) {}
}
// =====================================================


// --- 모바일 가상 조이스틱 & 버튼 변수 ---
let isMobile = false;          // 현재 모드에서 모바일 조작 UI를 쓰는지 (applyInputMode가 계산)
let inputMode = 'AUTO';        // 'PC' | 'AUTO' | 'MOBILE'  (툴바에서 선택)
let touchCapable = false;      // AUTO 판별용: 터치 기기 여부


// --- 키 상태 직접 추적 (키 포커스가 iframe으로 넘어가면 keyup을 놓쳐서 키가 눌린 채 남는 문제 방지) ---
const heldKeys = new Set();
function isHeld(code) { return heldKeys.has(code); }
function clearHeldKeys() { heldKeys.clear(); }
window.addEventListener('keyup', (e) => { if (e.code) heldKeys.delete(e.code); });


// Enter / C 는 p5 keyPressed 대신 직접 처리한다.
//  - p5 는 keyup 을 놓치면 같은 키의 keydown 을 계속 무시함 (포커스가 iframe 으로 오가면 발생)
//  - 한글 IME / 일부 태블릿 키보드에서는 keyCode 가 229 로 들어와 ENTER(13) 비교가 실패함 → e.code 로 판별
window.addEventListener('keydown', (e) => {
  if (e.code) heldKeys.add(e.code);
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;


  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (myRole === "" || !players[myId]) return;
  const me = players[myId];
  ensureLobbyEconomy(me);


  // iframe 안에서도 Shift 대쉬는 iframe 전용 keydown 연결부가 처리함
  if (me.inMinigame) return;


  // 🛒 상점 단축키: B 열기/닫기, 상점이 열려 있을 때 1/2 구매, Esc 닫기
  if (tag.phase === 'off' && (e.code === 'KeyB')) {
    lobbyShopOpen = !lobbyShopOpen;
    return;
  }
  if (lobbyShopOpen && tag.phase === 'off') {
    if (e.code === 'Escape') { lobbyShopOpen = false; return; }
    if (e.code === 'Digit1' || e.code === 'Numpad1') { buyLobbyUpgrade('speed'); return; }
    if (e.code === 'Digit2' || e.code === 'Numpad2') { buyLobbyUpgrade('dash'); return; }
    if (e.code === 'Digit3' || e.code === 'Numpad3') { buyLobbyUpgrade('jump'); return; }
    if (e.code.startsWith('Key') || e.code.startsWith('Arrow')) return;
  }


  // 🏃 대쉬 구매 후 Shift로 사용(쿨타임 1초). 술래잡기 중에는 기존 스킬 유지
  if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    if (tag.phase === 'off') startLobbyDash();
    else useTagSkill();
    return;
  }
  // 🦘 점프 구매 후 Space로 로비 벽을 넘어갈 수 있음
  if ((e.code === 'Space' || e.key === ' ') && tag.phase === 'off') {
    e.preventDefault();
    startLobbyJump();
    return;
  }
  // 🎒 카운트다운 중 1 / 2 키로 스킬 선택
  if (tag.phase === 'ready' && isTagRunnerAlive()) {
    if (e.code === 'Digit1' || e.code === 'Numpad1') { mySkill = 'invis'; return; }
    if (e.code === 'Digit2' || e.code === 'Numpad2') { mySkill = 'boost'; return; }
    if (e.code === 'Digit3' || e.code === 'Numpad3') { mySkill = 'boom'; return; }
  }


  // 🎉 로비 이모트: 1~4 키 (술래잡기 준비 중 스킬 선택 키와 충돌하지 않음)
  if (tag.phase === 'off') {
    const emotes = {
      Digit1: '👋', Numpad1: '👋',
      Digit2: '😎', Numpad2: '😎',
      Digit3: '😂', Numpad3: '😂',
      Digit4: '🔥', Numpad4: '🔥'
    };
    if (emotes[e.code]) { triggerLobbyEmote(emotes[e.code]); return; }
  }


  if (e.code === 'KeyC') {
    changeShape();
  } else if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter') && isNearMinigamePortal) {
    e.preventDefault(); // 포커스된 버튼이 Enter 로 눌리는 것 방지
    enterMinigameWorld();
  } else if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter') && isNearTagPortal && !tagSetupVisible) {
    e.preventDefault();
    openTagSetup();
  }
});
window.addEventListener('blur', clearHeldKeys);


// 메인 페이지로 키보드 포커스를 되돌림 (iframe에 남아 있으면 키 입력이 사라짐)
function focusMainPage() {
  // iframe 안에 남은 포커스를 먼저 해제 (chat.html 쪽에서도 CHAT_BLUR 로 한 번 더 풀어줌)
  if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) {
    document.activeElement.blur();
  }
  clearHeldKeys();
  window.focus();
  // 메인 문서가 실제로 키보드 포커스를 받도록 캔버스(또는 body)에 포커스 지정
  const target = document.querySelector('canvas') || document.body;
  if (target === document.body && !document.body.hasAttribute('tabindex')) document.body.tabIndex = -1;
  try { target.focus({ preventScroll: true }); } catch (e) {}
}
let joystickBase = { x: JOY.baseX, y: 0, r: JOY.r };
let joystickStick = { x: JOY.baseX, y: 0, r: JOY.stickR };
let joystickActive = false;
let joystickMove = { x: 0, y: 0 };
let btnCMobile;


// --- 바닥 맵 및 격자 설정 ---
// 🌍 월드 좌표계는 기기/화면 크기와 무관하게 항상 동일 (절대 좌표)
const MAP_SIZE = 800;          // 땅(청색 한계선) 한 변의 길이 - 고정
const TILE_SIZE = 50;


// =====================================================
// 🎡 로비 놀거리: 랜덤 코인 / 코스 방향 부스터 4개 / 체크포인트 코스 / 벽
// 모든 좌표는 로비 월드 좌표이며, 술래잡기 중에는 숨겨짐
// =====================================================
// 🪙 코인은 플레이어별로 맵 안의 임의 위치에 생성되고 획득 후 다시 생성됨
const LOBBY_COIN_COUNT = 6;
const LOBBY_COIN_RESPAWN_MS = 1800;
const LOBBY_SKINS = [
  { id: 'ruby', name: '루비', cost: 1, color: [239, 68, 68] },
  { id: 'emerald', name: '에메랄드', cost: 2, color: [34, 197, 94] },
  { id: 'sapphire', name: '사파이어', cost: 3, color: [59, 130, 246] }
];
function randomLobbyCoinPosition() {
  // 코스 체크포인트/맵 가장자리에서 살짝 떨어진 곳에 생성
  return { x: Math.floor(Math.random() * 620) - 310, y: Math.floor(Math.random() * 620) - 310, r: 13 };
}
function ensureLobbyCoinsSpawned(me) {
  if (!Array.isArray(me.lobbyCoinDrops) || me.lobbyCoinDrops.length !== LOBBY_COIN_COUNT) {
    me.lobbyCoinDrops = Array.from({ length: LOBBY_COIN_COUNT }, () => ({ ...randomLobbyCoinPosition(), availableAt: 0 }));
  }
  if (!Number.isFinite(me.lobbyLapTokens)) me.lobbyLapTokens = 0;
  if (!Array.isArray(me.lobbyOwnedSkins)) me.lobbyOwnedSkins = [];
  if (!me.lobbySkinId) me.lobbySkinId = 'default';
}


// 부스터는 체크포인트 코스를 따라 시계 방향으로 정확히 4개 배치
// 코스 진행 방향: 위쪽 → 오른쪽 → 아래쪽 → 왼쪽
const LOBBY_BOOST_PADS = [
  { id: 'pad-top',    x:   0, y: -270, r: 28, angle: 0 },             // 위쪽: 오른쪽으로
  { id: 'pad-right',  x: 270, y:    0, r: 28, angle: Math.PI / 2 },  // 오른쪽: 아래로
  { id: 'pad-bottom', x:   0, y:  270, r: 28, angle: Math.PI },      // 아래쪽: 왼쪽으로
  { id: 'pad-left',   x: -270, y:   0, r: 28, angle: -Math.PI / 2 } // 왼쪽: 위로
];
const LOBBY_PAD_DASH_DISTANCE = 135;
const LOBBY_PAD_DASH_DURATION = 0.22;


const LOBBY_CHECKPOINTS = [
  { x: -270, y: -270 },
  { x: 270, y: -270 },
  { x: 270, y: 270 },
  { x: -270, y: 270 }
];


// 🎁 보상 진행도
// 별 총 10개 이상이면 미니게임 월드가 열리고,
// 수집 코인 10개 + 코스 5바퀴마다 제작자 레벨이 하나씩 열림.
const MINIGAME_WORLD_STAR_REQUIREMENT = 10;
const CREATOR_LEVEL_MAX = 10;
const CREATOR_LEVEL_STARS_STEP = 10;
const CREATOR_LEVEL_LAPS_STEP = 5;
const CREATOR_LEVEL_NAMES = [
  '새싹 제작자', '초보 제작자', '견습 제작자', '실력 제작자', '숙련 제작자',
  '전문 제작자', '엘리트 제작자', '마스터 제작자', '레전드 제작자', '전설의 제작자'
];


function hasMinigameWorldUnlocked(p) {
  return !!p && Number(p.lobbyStars || 0) >= MINIGAME_WORLD_STAR_REQUIREMENT;
}


function getLobbyCreatorLevel(p) {
  if (!p) return 0;
  const pickedStars = Math.max(0, Math.floor(Number(p.lobbyStarPickups) || 0));
  const laps = Math.max(0, Math.floor(Number(p.lobbyLaps) || 0));
  return Math.min(
    CREATOR_LEVEL_MAX,
    Math.floor(pickedStars / CREATOR_LEVEL_STARS_STEP),
    Math.floor(laps / CREATOR_LEVEL_LAPS_STEP)
  );
}


function getLobbyCreatorTitle(p) {
  const level = getLobbyCreatorLevel(p);
  return level <= 0 ? '예비 제작자' : CREATOR_LEVEL_NAMES[level - 1];
}


// 로비 장애물 벽: 코스 바깥쪽을 막지 않고 내부에서만 이동 경로를 바꿈.
// 좌표 x/y는 벽의 왼쪽 위 모서리이며, 벽 충돌은 로비에서만 적용.
const LOBBY_WALLS = [
  { id: 'wall0', x: -210, y: -195, w: 100, h: 18 },
  { id: 'wall1', x:  165, y: -160, w:  18, h: 95 },
  { id: 'wall2', x:  145, y:   25, w: 105, h: 18 },
  { id: 'wall3', x: -210, y:   40, w:  18, h: 105 },
  { id: 'wall4', x: -100, y:  155, w: 105, h: 18 },
  { id: 'wall5', x:   15, y:   80, w:  18, h: 90 }
];


// 🪙 코인 상점 업그레이드 가격
const LOBBY_UPGRADE_PRICE = { speed: 10, dash: 20, jump: 30 };
const LOBBY_DEV_COIN_CODE = 'LEGO'; // 개발자 코드: 입력 시 상점 코인 무제한
const LOBBY_DASH_COOLDOWN = 1; // 대쉬 쿨타임 1초
const LOBBY_JUMP_DURATION_MS = 800; // 점프 지속 시간: 이 시간 동안 로비 벽 충돌 무시 (기존보다 0.05초 짧게)
const LOBBY_JUMP_SPEED_MULT = 1.3; // 점프 중 이동 속도 보정
const LOBBY_SPEED_UPGRADE_MULT = 1.5;
let lobbyShopOpen = false;

// --- 💬 채팅 ---
const CHAT_MAX_LEN = 60;
const CHAT_BUBBLE_MS = 4000;
let chatFrame = null;       // chat.html iframe
let chatBubbles = {};       // { [playerId]: { text, until } }
const chatSeen = new Set(); // 중복 메시지 방지
let minigameKeydownHandler = null;
let gameWorldDashCooldownUntil = 0;


// 🧱 코스를 완주할수록 새 벽이 열려 난이도가 점점 상승
// 2회 완주마다 난이도 레벨이 1 상승하며 최대 레벨은 6
const LOBBY_PROGRESSIVE_WALLS = [
  { id: 'wall-hard-2', unlockLap: 2, x: -70, y: -218, w: 135, h: 15 },
  { id: 'wall-hard-4', unlockLap: 4, x: 92, y: -125, w: 15, h: 100 },
  { id: 'wall-hard-6', unlockLap: 6, x: -36, y: 95, w: 135, h: 15 },
  { id: 'wall-hard-8', unlockLap: 8, x: 132, y: 145, w: 15, h: 100 },
  { id: 'wall-hard-10', unlockLap: 10, x: -218, y: 205, w: 88, h: 15 }
];


function getLobbyDifficultyLevel(p) {
  const laps = Math.max(0, Math.floor(Number(p && p.lobbyLaps) || 0));
  return Math.min(6, 1 + Math.floor(laps / 2));
}


function getActiveLobbyWalls(p) {
  const laps = Math.max(0, Math.floor(Number(p && p.lobbyLaps) || 0));
  return LOBBY_WALLS.concat(LOBBY_PROGRESSIVE_WALLS.filter(w => laps >= w.unlockLap));
}


function ensureLobbyEconomy(p) {
  if (!p) return;
  if (!Number.isFinite(p.lobbyCoins)) p.lobbyCoins = 0;
  p.lobbyDashUnlocked = p.lobbyDashUnlocked === true;
  p.lobbySpeedUnlocked = p.lobbySpeedUnlocked === true;
  p.lobbyJumpUnlocked = p.lobbyJumpUnlocked === true;
  p.lobbyInfiniteCoins = p.lobbyInfiniteCoins === true;
}


// --- 미니게임 포탈 설정 (월드 절대 좌표) ---
let minigamePortal = { name: "미니게임-이예찬의 게임제작소 월드로 이동", icon: "🎮", x: MAP_SIZE / 2 - 80, y: MAP_SIZE / 2 - 80, size: 70 };
let isNearMinigamePortal = false;
let minigameIframe = null;


// =====================================================
// 🏃 술래잡기 모드 (방장 전용 포탈 → 전원 동시 전환)
// =====================================================
const TAG_IT_SPEED = 4.6;      // 술래 속도 (도망자는 PLAYER_SPEED)
const TAG_DRAW_SEC = 3.5;      // 룰렛 뽑기 연출 시간
const TAG_READY_SEC = 3;       // 시작 전 카운트다운
const TAG_END_SEC = 6;         // 결과 화면 시간
const TAG_TIME_DEFAULT = 120;
const TAG_TIME_MIN = 15;
const TAG_TIME_MAX = 600;


let tagPortal = { name: "술래잡기", icon: "🏃", x: MAP_SIZE / 2 - 200, y: MAP_SIZE / 2 - 80, size: 70 };
let isNearTagPortal = false;


function newTagState(round) {
  return { phase: 'off', round: round || 0, it: '', timeLeft: 0, duration: TAG_TIME_DEFAULT, out: {}, winner: '', reason: '', broken: [], itStun: 0 };
}
let tag = newTagState();       // phase: off | draw | ready | playing | ended
let tagSeenPhase = 'off';
let tagSeenRound = 0;
let tagDrawStart = 0;
let lastTagDuration = TAG_TIME_DEFAULT;
let tagSetupOverlay, tagTimeInput;
let tagSetupVisible = false;


// =====================================================
// 🌿 술래잡기 맵 (술래잡기 중에만 나타나는 벽 / 덩굴)
//   - 좌표는 월드 절대 좌표 (맵 중앙 0,0 / 범위 -400 ~ 400)
//   - 벽: 통과 불가 / 덩굴: 안에 들어가면 술래 눈에 보이지 않는 은신 영역
//   - 모든 기기가 같은 상수를 쓰므로 별도 동기화 메시지는 필요 없음
// =====================================================
const TAG_WALLS = [
  { x: -300, y: -150, w: 180, h: 24 },
  { x: 120, y: -300, w: 24, h: 240 },
  { x: -200, y: 60, w: 40, h: 80 },
  { x: 40, y: 120, w: 180, h: 24 },
  { x: -340, y: 100, w: 24, h: 160 },
  { x: -120, y: 250, w: 180, h: 24 },
  { x: 280, y: -320, w: 60, h: 60 }
];
const TAG_VINES = [
  { x: -60, y: -280, w: 140, h: 90 },
  { x: -260, y: -40, w: 110, h: 120 },
  { x: 40, y: -40, w: 100, h: 80 },
  { x: 150, y: 170, w: 90, h: 70 }
];


// 맵 요소는 술래잡기가 진행 중(draw ~ ended)일 때만 적용/표시
function tagObstaclesActive() {
  return tag.phase !== 'off';
}


// 원(플레이어)과 벽(사각형)이 겹치는지 검사
function hitsTagWall(x, y, r) {
  if (!tagObstaclesActive()) return false;
  for (let wi = 0; wi < TAG_WALLS.length; wi++) {
    if (isWallBroken(wi)) continue;   // 💥 파괴된 벽은 통과 가능
    const w = TAG_WALLS[wi];
    const cx = constrain(x, w.x, w.x + w.w);
    const cy = constrain(y, w.y, w.y + w.h);
    if (dist(x, y, cx, cy) < r) return true;
  }
  return false;
}


// 덩굴 안에 있는지 검사
function inTagVine(x, y) {
  if (!tagObstaclesActive()) return false;
  return TAG_VINES.some(v => x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h);
}


// 로비 벽과 술래잡기 벽 충돌을 구분해서 검사
function hitsLobbyWall(x, y, r) {
  if (tag.phase !== 'off') return false;
  const me = players[myId];
  for (const w of getActiveLobbyWalls(me)) {
    const cx = constrain(x, w.x, w.x + w.w);
    const cy = constrain(y, w.y, w.y + w.h);
    if (dist(x, y, cx, cy) < r) return true;
  }
  return false;
}


function hitsAnyWorldWall(x, y, r) {
  if (tagObstaclesActive()) return hitsTagWall(x, y, r);
  return tag.phase === 'off' && hitsLobbyWall(x, y, r);
}


// 🦘 점프 중인지 확인. 로비 점프는 술래잡기 벽에는 적용되지 않음.
function isLobbyJumping(p) {
  return !!(tag.phase === 'off' && p && Number(p.lobbyJumpUntil || 0) > Date.now());
}


// 벽에 막히면 축별로 나눠 이동. 점프 중에는 로비 벽 충돌을 무시해 벽을 넘어감.
function moveWithWalls(p, dx, dy) {
  if (isLobbyJumping(p)) {
    p.x += dx;
    p.y += dy;
    return;
  }
  if (!hitsAnyWorldWall(p.x + dx, p.y, PLAYER_RADIUS)) p.x += dx;
  if (!hitsAnyWorldWall(p.x, p.y + dy, PLAYER_RADIUS)) p.y += dy;
}


// 도망자 시작 위치: 벽과 겹치지 않는 곳을 찾음 (앞 40번은 바깥 링 우선)
function findTagSpawn() {
  const half = MAP_SIZE / 2 - PLAYER_RADIUS;
  for (let i = 0; i < 60; i++) {
    let x, y;
    if (i < 40) {
      const a = random(TWO_PI), r = random(220, 340);
      x = cos(a) * r; y = sin(a) * r;
    } else {
      x = random(-half, half); y = random(-half, half);
    }
    x = constrain(x, -half, half);
    y = constrain(y, -half, half);
    if (!hitsTagWall(x, y, PLAYER_RADIUS + 2)) return { x, y };
  }
  return { x: 0, y: 0 };   // 중앙은 벽이 없으므로 최후의 안전 위치
}


// 🌿 맵 그리기 (덩굴 → 벽 순서로 그려서 플레이어 아래에 깔림)
function drawTagMap() {
  if (!tagObstaclesActive()) return;
  push();
  rectMode(CORNER);


  for (const v of TAG_VINES) {
    fill(34, 110, 50, 170); stroke(74, 180, 90, 200); strokeWeight(2);
    rect(v.x, v.y, v.w, v.h, 14);
    // 잎 장식 (위치가 고정이라 매 프레임 같은 모양으로 그려짐)
    noStroke(); fill(90, 200, 110, 200);
    const cols = Math.max(2, Math.floor(v.w / 22));
    const rows = Math.max(2, Math.floor(v.h / 22));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const lx = v.x + (i + 0.5) * (v.w / cols);
        const ly = v.y + (j + 0.5) * (v.h / rows);
        const k = (i * 7 + j * 13) % 5;
        ellipse(lx, ly, 8 + k, 5 + (k % 3));
      }
    }
  }


  for (let wi = 0; wi < TAG_WALLS.length; wi++) {
    if (isWallBroken(wi)) continue;   // 💥 파괴된 벽은 그리지 않음
    const w = TAG_WALLS[wi];
    fill(96, 104, 120); stroke(30, 36, 48); strokeWeight(2);
    rect(w.x, w.y, w.w, w.h, 3);
    noStroke(); fill(255, 255, 255, 30);
    rect(w.x + 2, w.y + 2, w.w - 4, 4, 2);   // 윗면 하이라이트
  }
  pop();
}


// --- 통신 서버 설정 ---
const peerOptions = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  }
};

// 🌐 스카이캐쳐 직접 대전 연결 상태
let scLink = { conn: null, expected: '' };

// 스카이캐쳐의 SC_SET 값을 내 플레이어 상태에 반영 (방 전체로 자동 전파됨)
function scApplySet(d) {
  const me = players[myId];
  if (!me || !d) return;
  if ('on' in d) me.scOn = d.on === true;
  if ('match' in d) me.scMatch = (typeof d.match === 'string' && d.match) ? d.match : null;
  if ('inv' in d) {
    me.inv = (d.inv && typeof d.inv.to === 'string' && Number.isFinite(d.inv.seq))
      ? { to: d.inv.to, seq: d.inv.seq } : null;
  }
  if ('rep' in d) {
    me.rep = (d.rep && typeof d.rep.to === 'string' && Number.isFinite(d.rep.seq))
      ? { to: d.rep.to, seq: d.rep.seq, ok: d.rep.ok === true } : null;
  }
}

// 스카이캐쳐(iframe)로 메시지 전달 (런처가 SC_ 메시지를 그대로 중계함)
function scToGame(msg) {
  if (!players[myId] || !players[myId].inMinigame) return;
  if (!minigameIframe || !minigameIframe.elt || !minigameIframe.elt.contentWindow) return;
  minigameIframe.elt.contentWindow.postMessage(msg, '*');
}

// 직접 연결 채널 하나에 이벤트 묶기
function scAttach(c) {
  scLink.conn = c;
  const onOpen = () => { if (scLink.conn === c) scToGame({ type: 'SC_LINK', state: 'open' }); };
  if (c.open) onOpen(); else c.on('open', onOpen);
  c.on('data', (d) => {
    if (scLink.conn === c && d && d.sc === 1) scToGame({ type: 'SC_DATA', data: d.data });
  });
  c.on('close', () => {
    if (scLink.conn === c) { scLink.conn = null; scToGame({ type: 'SC_LINK', state: 'closed' }); }
  });
  c.on('error', () => {
    if (scLink.conn === c) scToGame({ type: 'SC_LINK', state: 'error' });
  });
}

function scClose() {
  const c = scLink.conn;
  scLink.conn = null;
  scLink.expected = '';
  if (c) { try { c.close(); } catch (e) {} }
}

// 초대를 수락한 쪽(R): 약속된 상대가 연결해 올 때만 받는다
function scOnIncoming(conn) {
  if (!scLink.expected || conn.peer !== scLink.expected) {
    try { conn.close(); } catch (e) {}
    return;
  }
  scLink.expected = '';
  scClose();
  scAttach(conn);
}

// 초대를 건 쪽(L): 수락 후 상대에게 직접 연결
function scConnect(peerId) {
  if (!peer || peer.destroyed || typeof peerId !== 'string' || !peerId) return;
  scClose();
  const c = peer.connect(peerId, { reliable: true, metadata: { sc: true } });
  scAttach(c);
}

function scSend(data) {
  const c = scLink.conn;
  if (c && c.open) c.send({ sc: 1, data: data });
}


// --- 도움말 내용 (섹션별로 관리: 카드 목록 / 팝업 전체 모두 이 데이터를 사용) ---
const HELP_SECTIONS = [
  {
    icon: '🎮', title: '조작법',
    items: [
      '<b>PC</b> : <b>W A S D / 방향키</b>로 이동해요.',
      '<b>PC</b> : <b>Enter</b>로 포탈에 입장해요. 포탈 근처에서만 작동해요.',
      '<b>PC</b> : <b>C</b>로 아바타 모양(원 / 사각형)을 바꿔요.',
      '<b>PC</b> : <b>1~4</b>로 이모트(👋 😎 😂 🔥)를 보내요.',
      '<b>모바일</b> : 좌측 하단 영역의 조이스틱으로 이동해요.',
      '<b>모바일</b> : 하단 이모트 바의 <b>[C 모양]</b>으로 모양을 바꾸고, <b>[1~4]</b>로 이모트를 보내요.',
      '<b>모바일</b> : 포탈 근처에서 우측에 뜨는 <b>[입장]</b> 버튼을 눌러요.',
      '<b>툴바</b> : 🖥 / AUTO / 📱로 조이스틱·버튼 표시를 직접 고를 수 있어요.',
      '<b>툴바</b> : 🎵로 배경음악을 끄고 켜요. 💬로 채팅창을 열어요.',
      '<b>📊 내 정보</b> : 왼쪽 위 패널의 ▲로 접고, 툴바 닉네임 옆 📊로 다시 펼쳐요.'
    ]
  },
  {
    icon: '🪙', title: '코인 & 상점',
    items: [
      '맵에 흩어진 <b>🪙 코인</b>을 모으면 코인이 쌓여요. 먹은 코인은 잠시 후 다른 곳에 다시 나타나요.',
      '<b>B</b> : 상점 열기 / 닫기. 상점이 열려 있을 때 <b>Esc</b>로도 닫을 수 있어요.',
      '<b>1 속도 업그레이드</b> (10코인) : 로비에서 이동 속도가 1.5배 빨라져요.',
      '<b>2 대쉬</b> (20코인) : 구매 후 <b>Shift</b>로 순간 돌진해요. 쿨타임 1초.',
      '<b>3 점프</b> (30코인) : 구매 후 <b>Space</b>로 점프해서 로비 벽을 넘어갈 수 있어요. 약 0.8초 동안 유지돼요.',
      '구매한 업그레이드는 계속 유지돼요.'
    ]
  },
  {
    icon: '🏁', title: '로비 놀거리',
    items: [
      '<b>🚀 부스터 패드</b>를 밟으면 화살표 방향으로 튕겨 나가요.',
      '<b>🏁 체크포인트 1~4</b>를 순서대로 모두 통과하면 코스 완주! 완주할 때마다 <b>🧱 레고 토큰</b>을 1개 받아요.',
      '<b>🧱 레고 토큰</b>은 상점에서 스킨을 사는 데 쓰여요. 한 번 산 스킨은 계속 보유하고, 눌러서 바로 착용할 수 있어요.',
      '<b>📈 난이도 Lv.</b> : 코스를 2번 완주할 때마다 난이도가 1씩 올라가요(최대 Lv.6). 레벨이 오를 때마다 코스에 벽이 하나씩 추가돼요. 내 완주 기록 기준이에요.',
      '완주 시간은 최고 기록(베스트 랩)으로 저장돼요.'
    ]
  },
  {
    icon: '🛠', title: '제작자 레벨',
    items: [
      '<b>수집 코인</b>과 <b>코스 완주</b> 횟수가 쌓일수록 제작자 레벨이 올라가요.',
      '레벨 1은 수집 코인 10개 · 완주 5회, 레벨 2는 20개 · 10회, 레벨 3은 30개 · 15회처럼 10개와 5회씩 늘어나요. 최대 Lv.10까지 있어요.',
      '레벨은 다른 플레이어 이름 옆에 <b>🛠Lv.N</b>으로 표시돼요.'
    ]
  },
  {
    icon: '🎮', title: '미니게임 월드',
    items: [
      '코인을 <b>10개 이상</b> 모으면 미니게임 포탈이 열려요. 포탈 표시가 <b>미니게임 월드</b>로 바뀌어요.',
      '포탈에 들어가면 미니게임 화면으로 이동해요.',
      '미니게임 화면에서도 채팅 말풍선이 그대로 보이고, 이모트도 보낼 수 있어요.'
    ]
  },
  {
    icon: '🏃', title: '술래잡기 (방장 전용)',
    items: [
      '방장이 <b>🏃 술래잡기</b> 포탈에서 <b>Enter</b>(또는 [술래잡기] 버튼)를 누르고 제한 시간을 정하면 시작해요. 제한 시간은 15초~10분 사이에서 고를 수 있어요.',
      '시작 전 룰렛으로 <b>술래</b>가 랜덤으로 뽑혀요. 나머지는 모두 도망자예요.',
      '술래에게 닿은 도망자는 탈락해요. 술래는 도망자보다 조금 빨라요.',
      '카운트다운 중 <b>1 / 2 / 3</b> 키(모바일은 화면 버튼)로 스킬을 고를 수 있어요. 고르지 않으면 스킬 없이 플레이해요.',
      '<b>👻 투명인간</b> (1) : 5초간 술래 눈에 보이지 않아요. 쿨타임 10초.',
      '<b>💨 가속</b> (2) : 5초간 1.25배 빨리 달려요. 쿨타임 10초.',
      '<b>💥 폭발</b> (3) : 주변 벽을 부수고, 반경 안의 술래를 5초간 멈춰요. 쿨타임 20초.',
      '스킬은 게임 중 <b>Shift</b>(모바일은 스킬 버튼)로 사용해요.',
      '<b>벽</b>은 통과할 수 없어요. <b>🌿 덩굴</b> 안에 숨으면 술래 눈에 보이지 않지만, 술래에게 닿으면 여전히 잡혀요.',
      '술래잡기 중에는 로비 상점, 대쉬, 점프, 이모트 기능이 잠시 쉬어요.'
    ]
  },
  {
    icon: '⌨', title: '채팅',
    items: [
      '툴바의 <b>💬</b> 버튼으로 채팅창을 열고 닫을 수 있어요.',
      '같은 방에 있는 사람들의 메시지가 채팅창과 캐릭터 위 말풍선에 함께 보여요.'
    ]
  }
];

function helpListHtml(items) {
  return '<ul style="margin:4px 0 12px 18px; padding:0; font-size:14px; line-height:1.6;">' +
    items.map(t => '<li>' + t + '</li>').join('') + '</ul>';
}

function helpSectionHtml(sec) {
  return '<div style="font-weight:bold; font-size:17px; margin-bottom:8px;">' + sec.icon + ' ' + sec.title + '</div>' +
    helpListHtml(sec.items);
}

// 팝업(툴바 ? 버튼)에서는 전체 섹션을 한 번에 보여줌
const HELP_HTML = HELP_SECTIONS.map(helpSectionHtml).join('');


function computeCanvasSize() {
  // 툴바(TOOLBAR_H)를 뺀 남은 높이 안에 800:500 비율의 게임 영역이 들어가도록 계산
  let maxByHeight = (windowHeight - currentToolbarH()) * (BASE_W / BASE_H);
  let w = min(BASE_W, windowWidth, max(320, maxByHeight));
  let h = w * (BASE_H / BASE_W);
  return { w, h };
}


function windowResized() {
  let size = computeCanvasSize();
  resizeCanvas(size.w, size.h);
  appRoot.style('width', size.w + 'px');
  canvasWrapper.style('width', size.w + 'px');
  canvasWrapper.style('height', size.h + 'px');
  applyToolbarLayout(size.w);


  joystickBase.y = height - JOY.baseOffsetY;
  if (!joystickActive) joystickStick.y = joystickBase.y;
  if (btnCMobile) {
    btnCMobile.style('left', (width - 75) + 'px');
    btnCMobile.style('top', (height - 75) + 'px');
  }
}


function setup() {
  let size = computeCanvasSize();


  myColor = [random(100, 255), random(100, 255), random(100, 255)];
  touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  myNickname = loadSavedNick();


  // 최상위 래퍼: [툴바] + [게임 영역] 세로 배치
  appRoot = createDiv('');
  appRoot.id('app-root');
  appRoot.style('width', size.w + 'px');
  appRoot.style('margin', '0 auto');


  createToolbar();


  canvasWrapper = createDiv('');
  canvasWrapper.parent(appRoot);
  canvasWrapper.style('position', 'relative');
  canvasWrapper.style('width', size.w + 'px');
  canvasWrapper.style('height', size.h + 'px');


  let canvas = createCanvas(size.w, size.h);
  canvas.parent(canvasWrapper);
  canvas.style('display', 'block');


  joystickBase.y = height - JOY.baseOffsetY;
  joystickStick.y = joystickBase.y;


  createHelpPopup();
  createTagSetupPopup();
  createCustomUI();
  createMinigameIframeContainer();
  createChatFrame();
  createMobileUI();


  applyToolbarLayout(size.w);
  applyInputMode();


  // 미니게임 iframe 에서 온 메시지만 처리
  window.addEventListener('message', (e) => {
    if (!e.data || !players[myId]) return;
    if (!minigameIframe || e.source !== minigameIframe.elt.contentWindow) return;


    if (e.data.type === 'MINIGAME_MOVE') {
      players[myId].minigameX = e.data.x;
      players[myId].minigameY = e.data.y;
      players[myId].angle = e.data.angle;
    } else if (e.data.type === 'RETURN_TO_MAIN') {
      exitMinigameWorld();
    } else if (e.data.type === 'CHANGE_SHAPE') {
      changeShape();
    } else if (e.data.type === 'EMOTE') {
      triggerMinigameEmote(e.data.emoji);
    } else if (e.data.type === 'GAMEWORLD_READY') {
      sendGameWorldUpgrades();
    } else if (e.data.type === 'SC_SET') {
      scApplySet(e.data);
    } else if (e.data.type === 'SC_EXPECT') {
      scLink.expected = (typeof e.data.peerId === 'string') ? e.data.peerId : '';
    } else if (e.data.type === 'SC_CONNECT') {
      scConnect(e.data.peerId);
    } else if (e.data.type === 'SC_SEND') {
      scSend(e.data.data);
    } else if (e.data.type === 'SC_CLOSE') {
      scClose();
    } else if (e.data.type === 'SC_RESET') {
      scClose();
      scApplySet({ on: false, match: null, inv: null, rep: null });
    }
  });


  bgmInstallUnlock();   // 🎵 첫 클릭/키 입력 뒤 배경음악 시작
  setTimeout(windowResized, 300);
}


function draw() {
  background(40, 44, 52);


  if (myRole !== "" && players[myId]) {
    let me = players[myId];


    if (!me.inMinigame) {
      let moveX = 0;
      let moveY = 0;


      if (isHeld('KeyW') || isHeld('ArrowUp')) moveY -= 1;
      if (isHeld('KeyS') || isHeld('ArrowDown')) moveY += 1;
      if (isHeld('KeyA') || isHeld('ArrowLeft')) moveX -= 1;
      if (isHeld('KeyD') || isHeld('ArrowRight')) moveX += 1;


      if (isMobile && (joystickMove.x !== 0 || joystickMove.y !== 0)) {
        moveX = joystickMove.x;
        moveY = joystickMove.y;
      }


      // 🏃 뽑기 중 / 술래 카운트다운 중 / 설정창 또는 상점 열림 → 이동 잠금
      if (tagMoveLocked() || lobbyShopOpen) { moveX = 0; moveY = 0; }


      // 🏃 로비 대쉬: 1초 쿨타임. 대쉬 중에는 일반 이동을 잠시 멈춤.
      let didLobbyDash = false;
      if (tag.phase === 'off' && lobbyDashLeft > 0 && !tagMoveLocked()) {
        const dashDt = Math.min(deltaTime, 100) / 1000;
        const activeDt = Math.min(dashDt, lobbyDashLeft);
        moveDashWithWalls(me, lobbyDashDir.x * lobbyDashSpeed * activeDt, lobbyDashDir.y * lobbyDashSpeed * activeDt);
        lobbyDashLeft = Math.max(0, lobbyDashLeft - dashDt);
        didLobbyDash = true;
      } else if (lobbyDashLeft > 0) {
        lobbyDashLeft = 0;
      }


      if (!didLobbyDash && (moveX !== 0 || moveY !== 0)) {
        playerAngle = atan2(moveY, moveX);
        let len = sqrt(moveX * moveX + moveY * moveY);
        if (len > 1) {
          moveX /= len;
          moveY /= len;
        }


        // 🏃 술래는 도망자보다 약간 빠름
        let spd = ((tag.phase === 'ready' || tag.phase === 'playing') && tag.it === myId) ? TAG_IT_SPEED : PLAYER_SPEED;
        if (me.boostLeft > 0 && tag.it !== myId) spd *= TAG_BOOST_MULT;   // 💨 술래잡기 기존 속도 스킬
        if (tag.phase === 'off' && me.lobbySpeedUnlocked) spd *= LOBBY_SPEED_UPGRADE_MULT; // 🪙 영구 속도 업그레이드
        if (isLobbyJumping(me)) {
          const jumpFrameScale = Math.min(Math.max(Number(deltaTime) || (1000 / 60), 1), 50) / (1000 / 60);
          spd *= LOBBY_JUMP_SPEED_MULT * jumpFrameScale; // 🦘 기기 FPS에 따라 점프 이동 거리가 크게 달라지지 않도록 보정
        }
        moveWithWalls(me, moveX * spd, moveY * spd);      // 🧱 점프 중 로비 벽 통과 가능
      }


      let halfMap = MAP_SIZE / 2;
      me.x = constrain(me.x, -halfMap + PLAYER_RADIUS, halfMap - PLAYER_RADIUS);
      me.y = constrain(me.y, -halfMap + PLAYER_RADIUS, halfMap - PLAYER_RADIUS);
      me.angle = playerAngle;


      // 🎡 로비에서만 코인 수집 / 체크포인트 / 부스터 패드 작동
      if (tag.phase === 'off') updateLobbyPlay(me);


      let d = dist(me.x, me.y, minigamePortal.x, minigamePortal.y);
      // 🏃 술래잡기 진행 중에는 두 포탈 모두 비활성
      const tagIdle = (tag.phase === 'off');
      isNearMinigamePortal = tagIdle && (d < PLAYER_RADIUS + minigamePortal.size / 2);
      // 🏃 술래잡기 포탈은 방장만 사용 가능
      isNearTagPortal = tagIdle && myRole === 'host' &&
        dist(me.x, me.y, tagPortal.x, tagPortal.y) < PLAYER_RADIUS + tagPortal.size / 2;
    }


    updateTagSkillTimers();   // 🎒 스킬 효과 / 쿨타임 감소
    updateBoomFx();          // 💥 새 폭발 감지 → 연출 등록
    updateTagFx();   // 💥 새로 잡힌 사람 감지 → 연출 등록
    push();
    translate(width / 2 - me.x, height / 2 - me.y);


    draw2DGridMap();
    drawLobbyDecorations();
    drawLobbyPlayObjects();
    drawPortals();
    drawTagMap();
    drawPlayers();
    drawTagCatchFx();   // 💥 반으로 갈라지는 연출
    drawTagBoomFx();    // 💥 폭발 연출


    pop();


    drawLobbyPlayHUD();


    if (isNearMinigamePortal && !me.inMinigame) {
      drawPortalUI();
    }


    // 🏃 술래잡기 판정(방장) + 안내 UI
    if (myRole === 'host') tickTagHost();
    if (isNearTagPortal && !me.inMinigame) drawTagPortalUI();
    drawTagHUD();
    drawTagSkillHUD();
    drawTagFlash();   // 💥 내가 잡혔을 때 붉은 화면


    broadcastMyState();


    if (me.inMinigame && minigameIframe && minigameIframe.elt && minigameIframe.elt.contentWindow) {
      minigameIframe.elt.contentWindow.postMessage({
        type: 'SYNC_PLAYERS',
        myId: myId,
        players: players,
        inputMode: inputMode,
        gameWorldUpgrades: getGameWorldUpgradeState(players[myId])
      }, '*');
    }


  } else {
    push();
    translate(width / 2, height / 2);
    draw2DGridMap();
    drawLobbyDecorations();
    drawLobbyPlayObjects();
    drawPortals();
    pop();
  }


  bgmSync();   // 🎵 술래잡기 중이면 긴장 테마, 아니면 메인 테마
  setPlayerCount(Object.keys(players).length);


  if (isMobile && myRole !== "" && !players[myId]?.inMinigame) {
    drawJoystickHUD();
  }
}


function draw2DGridMap() {
  let halfMap = MAP_SIZE / 2;
  stroke(60, 65, 75);
  strokeWeight(1);


  for (let x = -halfMap; x < halfMap; x += TILE_SIZE) {
    for (let y = -halfMap; y < halfMap; y += TILE_SIZE) {
      if ((Math.floor((x + halfMap) / TILE_SIZE) + Math.floor((y + halfMap) / TILE_SIZE)) % 2 === 0) {
        fill(50, 55, 65);
      } else {
        fill(45, 50, 60);
      }
      rect(x, y, TILE_SIZE, TILE_SIZE);
    }
  }


  noFill();
  stroke(0, 255, 200);
  strokeWeight(4);
  rect(-halfMap, -halfMap, MAP_SIZE, MAP_SIZE);
}


function drawPortals() {
  push();
  let p = minigamePortal;
  const me = players[myId];
  const unlocked = hasMinigameWorldUnlocked(me);
  fill(unlocked ? color(147, 51, 234, 180) : color(71, 85, 105, 190));
  stroke(unlocked ? color(236, 72, 153) : color(148, 163, 184));
  strokeWeight(3);
  ellipse(p.x, p.y, p.size);


  noStroke(); fill(255);
  textSize(28); textAlign(CENTER, CENTER);
  text(unlocked ? p.icon : '🔒', p.x, p.y - 10);
  textSize(10); textStyle(BOLD);
  text(unlocked ? '미니게임 월드' : '코인 ' + Math.min(Number(me?.lobbyStars || 0), MINIGAME_WORLD_STAR_REQUIREMENT) + '/' + MINIGAME_WORLD_STAR_REQUIREMENT, p.x, p.y + 15);
  pop();


  drawTagPortal();
}


function drawPlayers() {
  for (let id in players) {
    let p = players[id];
    if (!p) continue;


    // 🌿 술래 눈에는 덩굴 속 도망자가 보이지 않음
    if (myId === tag.it && id !== myId && (tag.phase === 'ready' || tag.phase === 'playing')
        && !tag.out[id] && !p.inMinigame && (inTagVine(p.x || 0, p.y || 0) || p.invLeft > 0)) continue;


    push();
    let renderX = p.inMinigame ? (p.entryX || p.x) : p.x;
    let renderY = p.inMinigame ? (p.entryY || p.y) : p.y;
    translate(renderX || 0, renderY || 0);


    // 🦘 점프 연출: 바닥 그림자는 남기고 캐릭터와 이름표를 위로 올림
    const jumpNow = Date.now();
    let jumpLift = 0;
    if (!p.inMinigame && tag.phase === 'off' && Number(p.lobbyJumpUntil || 0) > jumpNow) {
      const jumpStart = Number(p.lobbyJumpStartedAt || jumpNow);
      const jumpProgress = constrain((jumpNow - jumpStart) / LOBBY_JUMP_DURATION_MS, 0, 1);
      jumpLift = Math.sin(jumpProgress * Math.PI) * 38;
      noStroke();
      fill(0, 0, 0, 65);
      ellipse(0, 9, Math.max(18, PLAYER_RADIUS * 2 - jumpLift * 0.45), 12);
      translate(0, -jumpLift);
    }


    // 💨 대쉬 순간 바람을 가르는 잔상 효과
    if (id === myId && Date.now() < lobbyDashEffectUntil) {
      const remain = Math.max(0, (lobbyDashEffectUntil - Date.now()) / 360);
      push(); rotate(Math.atan2(lobbyDashDir.y, lobbyDashDir.x));
      stroke(125, 211, 252, 220 * remain); strokeWeight(3);
      line(-48, -13, -13, -13); line(-58, 0, -18, 0); line(-43, 13, -10, 13);
      stroke(255, 255, 255, 190 * remain); strokeWeight(2); line(-34, -6, -8, -6);
      pop();
    }


    // 🏃 술래잡기 상태 표시
    const tagOn = tag.phase !== 'off';
    const isIt = tagOn && id === tag.it;
    const isOut = tagOn && !!tag.out[id];
    // 🌿 덩굴 속에 있는 도망자: 다른 도망자 눈에는 반투명으로 보임
    const invis = (p.invLeft || 0) > 0;
    const hiding = tag.phase === 'playing' && !isIt && !isOut && !p.inMinigame && (inTagVine(p.x || 0, p.y || 0) || invis);


    if (isIt) {   // 술래: 빨간 링
      push();
      noFill();
      if (tag.itStun > 0) stroke(96, 165, 250, 230);   // 💥 정지 중: 파란 링
      else stroke(239, 68, 68, 220);
      strokeWeight(5);
      ellipse(0, 0, (PLAYER_RADIUS + 10) * 2);
      pop();
    }


    stroke(0);
    strokeWeight(2);


    if (p.inMinigame) {
      fill(120, 120, 120, 180);
    } else if (isOut) {   // 탈락: 반투명
      const c = p.color ? p.color : [255, 255, 255];
      fill(c[0], c[1], c[2], 70);
    } else if (hiding) {  // 🌿 은신: 반투명
      const c = p.color ? p.color : [255, 255, 255];
      fill(c[0], c[1], c[2], 90);
    } else {
      fill(p.color ? p.color : [255, 255, 255]);
    }


    let radius = PLAYER_RADIUS;
    if (p.shape === 1) {
      rectMode(CENTER);
      rect(0, 0, radius * 2, radius * 2, 6);
    } else {
      ellipse(0, 0, radius * 2, radius * 2);
    }


    push();
    rotate(p.angle || 0);
    stroke(p.inMinigame ? 180 : 255);
    strokeWeight(3);
    line(0, 0, radius + 8, 0);
    fill(p.inMinigame ? 180 : 255);
    noStroke();
    triangle(radius + 8, -4, radius + 14, 0, radius + 8, 4);
    pop();


    fill(p.inMinigame ? 180 : 255);
    noStroke();
    textAlign(CENTER);
    textSize(12);
    textStyle(BOLD);
    let displayName = displayNameOf(id, p);
    if ((p.lobbyStars || 0) > 0) displayName += ' ⭐' + p.lobbyStars;
    if ((p.lobbyStarPickups || 0) > 0 || (p.lobbyLaps || 0) > 0) displayName += ' 🛠Lv.' + getLobbyCreatorLevel(p);
    if (isIt) displayName = '🔴 ' + displayName;
    if (isOut) displayName += ' (탈락)';
    if (hiding) displayName += invis ? ' 👻' : ' 🌿';
    if (p.inMinigame) {
      text(`${displayName} (미니게임 중)`, 0, -radius - 8);
    } else {
      text(displayName, 0, -radius - 8);
    }


    if (p.emote && Number(p.emoteUntil || 0) > Date.now()) {
      textSize(24);
      text(p.emote, 0, -radius - 34);
    }

    // 💬 채팅 말풍선
    const bubble = chatBubbles[id];
    if (bubble && bubble.until > Date.now()) drawChatBubble(bubble.text, -radius - 62);


    pop();
  }
}


function drawPortalUI() {
  const me = players[myId];
  const unlocked = hasMinigameWorldUnlocked(me);
  const stars = Math.max(0, Math.floor(Number(me?.lobbyStars || 0)));
  let barW = min(width - 20, 440);
  fill(15, 23, 42, 230);
  stroke(unlocked ? color(236, 72, 153) : color(148, 163, 184));
  strokeWeight(2);
  rect(width / 2 - barW / 2, 20, barW, 45, 20);


  noStroke();
  fill(unlocked ? color(255, 255, 0) : color(203, 213, 225));
  textSize(13); textAlign(CENTER, CENTER);
  text(unlocked ? '🌀 [미니게임 월드] 포탈 발견!' : '🔒 [미니게임 월드] 잠겨 있어요', width / 2, 33);
  fill(255); textSize(11);
  text(unlocked
    ? '👉 [Enter] 키 또는 [입장]을 눌러 미니게임 월드로 이동하세요!'
    : '🪙 코인 ' + stars + '/' + MINIGAME_WORLD_STAR_REQUIREMENT + '개 — 코인 10개를 모으면 열려요!', width / 2, 50);
}


function drawJoystickHUD() {
  push();
  fill(255, 255, 255, 80);
  stroke(255, 255, 255, 200);
  strokeWeight(3);
  ellipse(joystickBase.x, joystickBase.y, joystickBase.r * 2);


  fill(0, 255, 255, 200);
  noStroke();
  ellipse(joystickStick.x, joystickStick.y, joystickStick.r * 2);


  if (isNearMinigamePortal || isNearTagPortal) {
    let b = ENTER_BTN();
    const unlocked = hasMinigameWorldUnlocked(players[myId]);
    fill(isNearTagPortal || unlocked ? color(236, 72, 153, 220) : color(100, 116, 139, 220));
    stroke(255); strokeWeight(2);
    ellipse(b.x, b.y, b.r * 2);
    fill(255); noStroke(); textSize(isNearMinigamePortal && !isNearTagPortal && !unlocked ? 10 : 14); textStyle(BOLD);
    textAlign(CENTER, CENTER);
    text(isNearTagPortal ? '술래잡기' : (unlocked ? '입장' : '코인 ' + Math.min(Number(players[myId]?.lobbyStars || 0), MINIGAME_WORLD_STAR_REQUIREMENT) + '/' + MINIGAME_WORLD_STAR_REQUIREMENT), b.x, b.y);
  }
  drawEmoteBar();
  pop();
}


// =====================================================
// 🎉 하단 이모트 바 [C 모양] [1 👋] [2 😎] [3 😂] [4 🔥]  (모바일 / AUTO 조이스틱 모드)
// =====================================================
const EMOTE_BAR_ITEMS = [
  { key: 'shape', label: 'C 모양', w: 64 },
  { key: '👋', label: '1 👋', w: 50 },
  { key: '😎', label: '2 😎', w: 50 },
  { key: '😂', label: '3 😂', w: 50 },
  { key: '🔥', label: '4 🔥', w: 50 }
];
const EMOTE_BAR_GAP = 6;
const EMOTE_BAR_H = 26;
const EMOTE_BAR_BOTTOM = 8; // 캔버스 아래쪽 여백

function emoteBarRects() {
  const total = EMOTE_BAR_ITEMS.reduce((s, b) => s + b.w, 0) + EMOTE_BAR_GAP * (EMOTE_BAR_ITEMS.length - 1);
  let x = width / 2 - total / 2;
  const y = height - EMOTE_BAR_BOTTOM - EMOTE_BAR_H;
  return EMOTE_BAR_ITEMS.map(b => {
    const r = { key: b.key, label: b.label, x: x, y: y, w: b.w, h: EMOTE_BAR_H };
    x += b.w + EMOTE_BAR_GAP;
    return r;
  });
}

function drawEmoteBar() {
  push();
  rectMode(CORNER);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  for (const r of emoteBarRects()) {
    fill(15, 23, 42, 170);
    stroke(r.key === 'shape' ? color(0, 255, 255, 200) : color(255, 255, 255, 120));
    strokeWeight(1.5);
    rect(r.x, r.y, r.w, r.h, 8);
    fill(255); noStroke(); textSize(11);
    text(r.label, r.x + r.w / 2, r.y + r.h / 2);
  }
  pop();
}

// 이모트 바 터치 처리: 눌린 버튼이 있으면 실행하고 true 반환
function hitEmoteBarClick() {
  if (!isMobile || myRole === '' || players[myId]?.inMinigame) return false;
  for (const r of emoteBarRects()) {
    if (mouseX >= r.x && mouseX <= r.x + r.w && mouseY >= r.y && mouseY <= r.y + r.h) {
      if (r.key === 'shape') changeShape(); else triggerLobbyEmote(r.key);
      return true;
    }
  }
  return false;
}


function changeShape() {
  if (!players[myId]) return;
  players[myId].shape = ((players[myId].shape || 0) + 1) % 2;
}


function touchStarted(event) {
  if (event && event.target && event.target.tagName !== 'CANVAS') return;
  if (handleLobbyShopClick(mouseX, mouseY)) return;  // 🛒 상점 버튼 / 구매 버튼
  if (handleTagSkillClick(mouseX, mouseY)) return;   // 🎒 스킬 선택 / 모바일 스킬 버튼
  if (hitEmoteBarClick()) return;                    // 🎉 하단 이모트 바


  if (isMobile && myRole !== "" && !players[myId]?.inMinigame) {
    if (isNearMinigamePortal) {
      let b = ENTER_BTN();
      if (dist(mouseX, mouseY, b.x, b.y) < b.r) { enterMinigameWorld(); return; }
    }
    if (isNearTagPortal && !tagSetupVisible) {
      let b = ENTER_BTN();
      if (dist(mouseX, mouseY, b.x, b.y) < b.r) { openTagSetup(); return; }
    }
    let d = dist(mouseX, mouseY, joystickBase.x, joystickBase.y);
    if (d < joystickBase.r + 20) joystickActive = true;
  }
}


function touchMoved() {
  if (myRole === "" || players[myId]?.inMinigame) return;
  if (isMobile && joystickActive) {
    let d = dist(mouseX, mouseY, joystickBase.x, joystickBase.y);
    let angle = atan2(mouseY - joystickBase.y, mouseX - joystickBase.x);


    if (d < joystickBase.r) {
      joystickStick.x = mouseX;
      joystickStick.y = mouseY;
    } else {
      joystickStick.x = joystickBase.x + cos(angle) * joystickBase.r;
      joystickStick.y = joystickBase.y + sin(angle) * joystickBase.r;
    }


    joystickMove.x = (joystickStick.x - joystickBase.x) / joystickBase.r;
    joystickMove.y = (joystickStick.y - joystickBase.y) / joystickBase.r;
    return false;
  }
  return false;
}


function touchEnded() {
  if (isMobile) {
    joystickActive = false;
    joystickStick.x = joystickBase.x;
    joystickStick.y = joystickBase.y;
    joystickMove = { x: 0, y: 0 };
  }
}


function mousePressed(event) {
  if (event.target.tagName !== 'CANVAS') return;
  touchStarted(event);
}
function mouseDragged() { touchMoved(); }
function mouseReleased() { touchEnded(); }


// --- 미니게임 관련 기능 ---
function enterMinigameWorld() {
  let me = players[myId];
  if (!me) return false;


  if (!hasMinigameWorldUnlocked(me)) {
    const stars = Math.max(0, Math.floor(Number(me.lobbyStars || 0)));
    setLobbyNotice(me, '🔒 미니게임 월드까지 코인 ' + Math.max(0, MINIGAME_WORLD_STAR_REQUIREMENT - stars) + '개!', 2200);
    return false;
  }


  me.inMinigame = true;
  me.entryX = me.x;
  me.entryY = me.y;


  // 조이스틱 상태 초기화
  joystickActive = false;
  joystickStick.x = joystickBase.x;
  joystickStick.y = joystickBase.y;
  joystickMove = { x: 0, y: 0 };


  let container = select('#minigame-iframe-container');
  if (container) {
    container.style('display', 'flex');
  }
  if (minigameIframe) {
    minigameIframe.elt.onload = () => {
      if (!players[myId]?.inMinigame) return;
      minigameIframe.elt.focus();
      try { minigameIframe.elt.contentWindow.focus(); } catch (e) {}
      injectMinigameUpgradeBridge();
      installMinigameUpgradeControls();
      sendGameWorldUpgrades();
    };
    minigameIframe.attribute('src', 'minigame.html');
  }
  setWorldLabel();
  return true;
}


function exitMinigameWorld() {
  let me = players[myId];
  if (!me) return;
  scClose();
  scApplySet({ on: false, match: null, inv: null, rep: null });


  me.inMinigame = false;
  lobbyShopOpen = false;
  if (minigameIframe && minigameIframe.elt && minigameKeydownHandler) {
    try { minigameIframe.elt.contentWindow.removeEventListener('keydown', minigameKeydownHandler, true); } catch (e) {}
    minigameKeydownHandler = null;
  }
  let container = select('#minigame-iframe-container');
  if (container) {
    container.style('display', 'none');
  }
  if (minigameIframe) {
    // removeAttribute 는 문서를 언로드하지 않아 숨겨진 iframe이 포커스를 계속 가져감 → about:blank 로 교체
    minigameIframe.elt.onload = null;
    minigameIframe.elt.src = 'about:blank';
  }
  focusMainPage();
  setWorldLabel();
}


function createMinigameIframeContainer() {
  let div = select('#minigame-iframe-container');
  if (!div) {
    div = createDiv('');
    div.id('minigame-iframe-container');
    div.parent(canvasWrapper);
  }


  div.style('position', 'absolute');
  div.style('top', '0');
  div.style('left', '0');
  div.style('width', '100%');
  div.style('height', '100%');
  div.style('z-index', '1500');
  div.style('background', 'rgba(0, 0, 0, 0.85)');
  div.style('display', 'none');
  div.style('justify-content', 'center');
  div.style('align-items', 'center');


  minigameIframe = select('#minigame-frame');
  if (!minigameIframe) {
    minigameIframe = createElement('iframe');
    minigameIframe.id('minigame-frame');
    minigameIframe.parent(div);
  }


  // 미니게임 캔버스가 메인과 같은 크기(BASE 비율)이므로 영역을 꽉 채운다
  minigameIframe.style('width', '100%');
  minigameIframe.style('height', '100%');
  minigameIframe.style('border', 'none');
  minigameIframe.style('display', 'block');


  minigameIframe.elt.src = 'about:blank';
}


// --- 통신 로직 ---
let peerOpenTimeout = null;
function resetPeerAttempt() {
  if (peerOpenTimeout) {
    clearTimeout(peerOpenTimeout);
    peerOpenTimeout = null;
  }
  try { if (peer && !peer.destroyed) peer.destroy(); } catch (e) {}
  peer = null;
  myRole = "";
  myId = "";
  currentRoomId = "";
  connections = [];
  players = {};
  if (mainUIContainer) mainUIContainer.style('pointer-events', 'auto');
}
function handlePeerError(err) {
  // 실제 원인을 화면에 표시해 '방 생성 실패'만 뜨는 문제를 진단할 수 있게 한다.
  if (myRole === "") {
    const code = err && err.type ? String(err.type) : 'unknown';
    const detail = err && err.message ? String(err.message) : '';
    let message;
    if (code === 'browser-incompatible') message = '브라우저가 멀티플레이를 지원하지 않습니다';
    else if (code === 'network' || code === 'server-error' || code === 'socket-error' || code === 'socket-closed') message = '멀티 서버 연결 실패';
    else if (code === 'unavailable-id') message = '방 ID가 이미 사용 중입니다';
    else if (code === 'ssl-unavailable') message = '보안 연결 실패';
    else if (code === 'peer-unavailable') message = 'PeerJS 서버에서 방을 찾지 못했습니다';
    else message = '방 생성 실패';
    // 상태 표시줄에 오류 종류를 같이 출력해 정확한 원인을 확인할 수 있게 함
    const diagnostic = message + ' [' + code + ']' + (detail ? ': ' + detail : '');
    setStatus(diagnostic, 'warn');
    resetPeerAttempt();
    // resetPeerAttempt가 UI를 복구한 뒤 오류 메시지를 다시 표시
    setStatus(diagnostic, 'warn');
  }
}


function startHost() {
  if (myRole !== "") {
    alert("이미 접속된 상태입니다. 새 방을 만들려면 페이지를 새로고침 해주세요.");
    return;
  }
  if (mainUIContainer) mainUIContainer.style('pointer-events', 'none');
  setStatus('서버에 연결 중...', 'wait');
  try {
    peer = new Peer(null, peerOptions);
  } catch (err) {
    setStatus('방 생성 실패: PeerJS 초기화 오류', 'warn');
    if (mainUIContainer) mainUIContainer.style('pointer-events', 'auto');
    return;
  }


  // 서버가 ID 발급 응답을 주지 않을 때 무한 대기하지 않게 한다.
  if (peerOpenTimeout) clearTimeout(peerOpenTimeout);
  peerOpenTimeout = setTimeout(() => {
    if (myRole === "") {
      setStatus('서버 응답 시간 초과: 인터넷 연결을 확인하고 다시 눌러주세요', 'warn');
      resetPeerAttempt();
    }
  }, 12000);


  peer.on('open', (id) => {
    if (peerOpenTimeout) { clearTimeout(peerOpenTimeout); peerOpenTimeout = null; }
    if (!id) {
      setStatus('방 ID 발급 실패: 다시 시도해주세요', 'warn');
      resetPeerAttempt();
      return;
    }
    myId = id;
    myRole = "host";
    currentRoomId = id;
    players[myId] = { x: 0, y: 0, color: myColor, angle: 0, shape: 0, inMinigame: false, name: myNickname, lobbyCoins: 0, lobbyDashUnlocked: false, lobbySpeedUnlocked: false, lobbyJumpUnlocked: false, lobbyJumpStartedAt: 0, lobbyJumpUntil: 0, lobbyStars: 0, lobbyStarPickups: 0, lobbyLaps: 0 };
    setStatus('방 생성 완료', 'ok');
    switchToConnectedUI();
  });


  peer.on('connection', (conn) => {
    if (conn.metadata && conn.metadata.sc === true) { scOnIncoming(conn); return; }
    conn.on('open', () => {
      connections.push(conn);
      setStatus('참가자 접속됨', 'ok');
    });
    conn.on('data', (data) => {
      if (data && data.t === 'C') { handleChatMessage(data, conn); return; }
      if (data && data.id) {
        if (!players[data.id] && tag.phase !== 'off') tag.out[data.id] = 'spec'; // 🏃 진행 중 난입 → 관전 (잡힘과 구분)
        players[data.id] = data.state;
      }
    });
    conn.on('close', () => {
      delete players[conn.peer];
      delete tag.out[conn.peer];
      connections = connections.filter(c => c !== conn);
      setStatus('참가자 퇴장함', 'wait');
    });
  });


  peer.on('error', handlePeerError);
}


function joinRoom() {
  if (myRole !== "") {
    alert("이미 접속된 상태입니다. 새로 접속하려면 페이지를 새로고침 해주세요.");
    return;
  }
  let targetId = inputRoomId.value().trim();
  if (!targetId) return;


  if (mainUIContainer) mainUIContainer.style('pointer-events', 'none');
  setStatus('서버에 연결 중...', 'wait');
  try {
    peer = new Peer(null, peerOptions);
  } catch (err) {
    setStatus('연결 실패: PeerJS 초기화 오류', 'warn');
    if (mainUIContainer) mainUIContainer.style('pointer-events', 'auto');
    return;
  }
  if (peerOpenTimeout) clearTimeout(peerOpenTimeout);
  peerOpenTimeout = setTimeout(() => {
    if (myRole === "") {
      setStatus('서버 응답 시간 초과: 인터넷 연결을 확인하고 다시 시도해주세요', 'warn');
      resetPeerAttempt();
    }
  }, 12000);


  peer.on('open', (id) => {
    if (peerOpenTimeout) { clearTimeout(peerOpenTimeout); peerOpenTimeout = null; }
    myId = id;
    myRole = "guest";
    currentRoomId = targetId;
    players[myId] = { x: 30, y: 30, color: myColor, angle: 0, shape: 0, inMinigame: false, name: myNickname, lobbyCoins: 0, lobbyDashUnlocked: false, lobbySpeedUnlocked: false, lobbyJumpUnlocked: false, lobbyJumpStartedAt: 0, lobbyJumpUntil: 0, lobbyStars: 0, lobbyStarPickups: 0, lobbyLaps: 0 };
    setStatus('방장 연결 중...', 'wait');
    switchToConnectedUI();


    let conn = peer.connect(targetId);
    conn.on('open', () => {
      connections.push(conn);
      setStatus('연결 성공', 'ok');
    });
    conn.on('data', (data) => {
      if (data && data.t === 'C') { handleChatMessage(data, conn); return; }
      if (!data || data.t !== 'S') return;
      const incoming = data.players || {};
      for (let pid in incoming) {
        if (pid !== myId) players[pid] = incoming[pid];
      }
      for (let pid in players) {   // 퇴장한 플레이어 정리 (생존자 수 계산에 필요)
        if (pid !== myId && !(pid in incoming)) delete players[pid];
      }
      if (data.tag) {
        tag = data.tag;
        if (tag.phase !== tagSeenPhase || tag.round !== tagSeenRound) handleTagTransition();
      }
    });
    conn.on('close', () => {
      setStatus('방장이 나갔습니다', 'warn');
      let myState = players[myId];
      players = {};
      players[myId] = myState;
      tag = newTagState(); tagSeenPhase = 'off'; tagSeenRound = 0;
      setWorldLabel();
    });
    conn.on('error', (err) => {
      if (myRole === "guest" && connections.length === 0) {
        setStatus('접속 실패: 방 ID가 맞는지, 방장이 접속 중인지 확인해주세요', 'warn');
        resetPeerAttempt();
      }
    });
  });


  peer.on('connection', (conn) => {
    if (conn.metadata && conn.metadata.sc === true) scOnIncoming(conn);
    else { try { conn.close(); } catch (e) {} }   // 게스트는 방 참가 연결을 받지 않음
  });
  peer.on('error', handlePeerError);
}


function broadcastMyState() {
  if (frameCount % 4 !== 0) return;
  connections.forEach(conn => {
    if (conn.open) {
      if (myRole === "host") conn.send({ t: 'S', players: players, tag: tag });
      else conn.send({ id: myId, state: players[myId] });
    }
  });
}


// --- UI 생성 ---
// =====================================================
// 🧰 상단 고정 툴바 (게임 영역과 분리된 레이아웃)
//   [🔗] [방 번호] [● 상태] [👥]            [내 ID] [MAIN WORLD] [🖥|AUTO|📱] [🎵][💬][?]   [🔼/🔽]
//   강조색 = 내 아바타 색
// =====================================================
let toolbarWidth = BASE_W;
let copyFlashTimer = null;
let lastPlayerCount = -1;


const TOOLBAR_CSS = `
#toolbar #tb-fold { width: 28px; height: 22px; padding: 0; font-size: 12px; }
#toolbar.tb-collapsed {
  position: relative; z-index: 2100; height: ${TOOLBAR_COLLAPSED_H}px; padding: 0; overflow: visible;
  background: var(--accent-line); border-bottom: 0;
}
#toolbar.tb-collapsed .tb-left, #toolbar.tb-collapsed .tb-right { display: none; }
#toolbar.tb-collapsed #tb-fold {
  position: absolute; top: 100%; right: 12px; z-index: 5;
  width: 32px; height: 18px; padding: 0; font-size: 11px; line-height: 1;
  display: flex; align-items: center; justify-content: center; overflow: visible;
  background: #0b1120; border: 1px solid #334155; border-top: 0; border-radius: 0 0 6px 6px;
}
#toolbar {
  --accent: #2DD4BF; --accent-bg: rgba(45,212,191,.2); --accent-line: rgba(45,212,191,.45);
  height: ${TOOLBAR_H}px; box-sizing: border-box;
  display: flex; align-items: center; gap: 10px; padding: 0 12px;
  background: linear-gradient(#111a2e, #0b1120);
  border-bottom: 1px solid #1e293b;
  color: #e2e8f0;
  font: 400 13px/1 system-ui, -apple-system, 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
  white-space: nowrap; overflow: hidden; user-select: none; -webkit-user-select: none;
}
#toolbar button { font-family: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
#toolbar .tb-left { display: flex; align-items: center; gap: 10px; flex: 1 1 auto; min-width: 0; overflow: hidden; }
#toolbar .tb-right { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
#toolbar .tb-mono { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-weight: 500; letter-spacing: .01em; flex: 0 0 auto; }
#toolbar .tb-accent { color: var(--accent); }
#toolbar .tb-pill {
  height: 32px; padding: 0 12px; flex: 0 0 auto;
  border-radius: 999px; border: 1px solid var(--accent-line);
  background: var(--accent-bg); color: var(--accent);
  font-size: 12px; font-weight: 500;
}
#toolbar .tb-pill:disabled { opacity: .4; cursor: default; }
#toolbar .tb-pill:not(:disabled):hover { background: var(--accent-line); }
#toolbar .tb-state { display: flex; align-items: center; gap: 6px; min-width: 0; }
#toolbar .tb-dot { width: 8px; height: 8px; border-radius: 50%; background: #94a3b8; flex: 0 0 auto; }
#toolbar .tb-dot.ok { background: var(--accent); box-shadow: 0 0 6px var(--accent-line); }
#toolbar .tb-dot.warn { background: #f59e0b; }
#toolbar .tb-status { overflow: hidden; text-overflow: ellipsis; color: #cbd5e1; font-weight: 400; }
#toolbar .tb-count { color: #94a3b8; font-size: 12px; flex: 0 0 auto; }
#toolbar .tb-me { display: flex; align-items: center; gap: 6px; }
#toolbar .tb-name { font-weight: 500; max-width: 120px; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; }
#toolbar .tb-me:not(.has-name) .tb-name { display: none; }
#toolbar .tb-me.has-name .tb-lbl { display: none; }
#toolbar .tb-me.has-name .tb-mono { color: #64748b; font-size: 11px; }
#toolbar.tb-compact .tb-name { max-width: 84px; }
#toolbar.tb-tiny .tb-name { max-width: 52px; }
#toolbar.tb-tiny .tb-me.has-name .tb-mono { display: none; }
#toolbar .tb-lbl { color: #64748b; font-size: 11px; }
#toolbar .tb-world { color: #94a3b8; font-size: 11px; font-weight: 500; letter-spacing: .08em; }
#toolbar .tb-seg {
  display: flex; gap: 2px; padding: 2px;
  border: 1px solid #334155; border-radius: 999px; background: rgba(15,23,42,.6);
}
#toolbar .tb-seg button {
  height: 28px; padding: 0 10px; border: 0; border-radius: 999px;
  background: transparent; color: #94a3b8; font-size: 12px; font-weight: 400;
}
#toolbar .tb-seg button:hover { color: #e2e8f0; }
#toolbar .tb-seg button.active {
  background: var(--accent-bg); color: var(--accent); font-weight: 600;
  box-shadow: inset 0 0 0 1px var(--accent-line);
}
#toolbar .tb-help {
  width: 30px; height: 30px; padding: 0; border-radius: 50%;
  border: 1px solid #334155; background: transparent; color: #94a3b8; font-size: 13px;
}
#toolbar .tb-help:hover { color: #e2e8f0; border-color: #64748b; }


/* 폭이 좁아질 때 단계적으로 줄이기 */
#toolbar.tb-compact { gap: 8px; padding: 0 10px; }
#toolbar.tb-compact .tb-left, #toolbar.tb-compact .tb-right { gap: 8px; }
#toolbar.tb-compact .tb-count, #toolbar.tb-compact .tb-lbl { display: none; }
#toolbar.tb-tiny { gap: 6px; padding: 0 8px; }
#toolbar.tb-tiny .tb-left, #toolbar.tb-tiny .tb-right { gap: 6px; }
#toolbar.tb-tiny .tb-status, #toolbar.tb-tiny .tb-world,
#toolbar.tb-tiny .tb-count, #toolbar.tb-tiny .tb-lbl { display: none; }
#toolbar.tb-tiny .tb-pill { padding: 0 9px; }
#toolbar.tb-tiny .tb-seg button { padding: 0 7px; font-size: 11px; }
#toolbar.tb-tiny .tb-help { width: 28px; height: 28px; }
#toolbar .tb-info { width: 24px; height: 24px; padding: 0; border-radius: 50%; flex: 0 0 auto;
  border: 1px solid var(--accent-line); background: var(--accent-bg); color: var(--accent); font-size: 11px; line-height: 1; }
#toolbar .tb-info:hover { background: var(--accent-line); }
#toolbar .tb-info.on { background: var(--accent); color: #0b1120; }
`;


function createToolbar() {
  const styleEl = document.createElement('style');
  styleEl.id = 'toolbar-style';
  styleEl.textContent = TOOLBAR_CSS;
  document.head.appendChild(styleEl);


  toolbar = createDiv('');
  toolbar.id('toolbar');
  toolbar.parent(appRoot);
  toolbar.html(
    '<div class="tb-left">' +
      '<button id="tb-copy" class="tb-pill" title="방 ID 복사" disabled>🔗</button>' +
      '<span id="tb-room" class="tb-mono tb-accent">---</span>' +
      '<span class="tb-state"><i id="tb-dot" class="tb-dot"></i><span id="tb-status" class="tb-status">접속 대기중...</span></span>' +
      '<span id="tb-count" class="tb-count">👥 0</span>' +
    '</div>' +
    '<div class="tb-right">' +
      '<span id="tb-me" class="tb-me"><span class="tb-lbl">내 ID</span><span id="tb-myname" class="tb-name tb-accent"></span><span id="tb-myid" class="tb-mono tb-accent">--</span><button id="tb-info" class="tb-info" title="내 정보 펼치기" style="display:none">📊</button></span>' +
      '<span id="tb-world" class="tb-world">MAIN WORLD</span>' +
      '<div class="tb-seg" role="group" aria-label="입력 방식">' +
        '<button id="tb-mode-pc" data-mode="PC" title="PC 조작 (키보드·마우스)">🖥</button>' +
        '<button id="tb-mode-auto" data-mode="AUTO" title="자동 감지">AUTO</button>' +
        '<button id="tb-mode-mobile" data-mode="MOBILE" title="모바일 조작 (터치)">📱</button>' +
      '</div>' +
      '<button id="tb-bgm" class="tb-help" aria-label="배경음악" title="배경음악 끄기">🎵</button>' +
      '<button id="tb-chat" class="tb-help" aria-label="채팅" title="채팅 열기">💬</button>' +
      '<button id="tb-help" class="tb-help" aria-label="도움말">?</button>' +
    '</div>' +
    '<button id="tb-fold" class="tb-help" aria-label="툴바 접기" title="툴바 접기">🔼</button>'
  );


  // 강조색 = 내 아바타 색
  const [r, g, b] = myColor.map(Math.round);
  toolbar.elt.style.setProperty('--accent', `rgb(${r},${g},${b})`);
  toolbar.elt.style.setProperty('--accent-bg', `rgba(${r},${g},${b},.2)`);
  toolbar.elt.style.setProperty('--accent-line', `rgba(${r},${g},${b},.45)`);


  document.getElementById('tb-copy').addEventListener('click', copyRoomId);
  document.getElementById('tb-bgm').addEventListener('click', (e) => {
    bgmToggle();
    e.currentTarget.blur();
  });
  document.getElementById('tb-chat').addEventListener('click', () => toggleChat());
  document.getElementById('tb-fold').addEventListener('click', () => toggleToolbar());
  document.getElementById('tb-help').addEventListener('click', (e) => {
    toggleHelpPopup();
    e.currentTarget.blur();
  });
  document.querySelectorAll('#toolbar .tb-seg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      setInputMode(btn.dataset.mode);
      btn.blur(); // 포커스가 남아 Enter 키가 버튼을 다시 누르는 것을 방지
    });
  });
}


// 툴바 접기/펼치기 (접으면 게임 영역이 그만큼 넓어짐)
function currentToolbarH() {
  return toolbarCollapsed ? TOOLBAR_COLLAPSED_H : TOOLBAR_H;
}

function toggleToolbar() {
  toolbarCollapsed = !toolbarCollapsed;
  toolbar.elt.classList.toggle('tb-collapsed', toolbarCollapsed);
  const f = document.getElementById('tb-fold');
  f.textContent = toolbarCollapsed ? '🔽' : '🔼';
  f.title = toolbarCollapsed ? '툴바 펼치기' : '툴바 접기';
  f.setAttribute('aria-label', f.title);
  f.blur();
  windowResized();
}


// 폭에 따라 레이아웃 단계 결정: full / compact / tiny
function applyToolbarLayout(w) {
  toolbarWidth = w;
  const level = w >= 620 ? 'full' : (w >= 460 ? 'compact' : 'tiny');
  toolbar.elt.classList.toggle('tb-compact', level === 'compact');
  toolbar.elt.classList.toggle('tb-tiny', level === 'tiny');
  setRoomDisplay();
}


function setStatus(text, level = 'wait') {
  const t = document.getElementById('tb-status');
  const d = document.getElementById('tb-dot');
  if (!t || !d) return;
  t.textContent = text;
  t.title = text;
  d.className = 'tb-dot' + (level === 'ok' ? ' ok' : level === 'warn' ? ' warn' : '');
}


// 방 번호는 앞부분만 보여주고(폭에 따라 길이 조절) 전체는 툴팁/복사로 제공
function setRoomDisplay() {
  const el = document.getElementById('tb-room');
  const copy = document.getElementById('tb-copy');
  if (!el || !copy) return;
  if (currentRoomId === "") {
    el.textContent = '---';
    el.title = '';
    copy.disabled = true;
    return;
  }
  const keep = toolbar.elt.classList.contains('tb-tiny') ? 4 : (toolbar.elt.classList.contains('tb-compact') ? 5 : 7);
  el.textContent = currentRoomId.length > keep ? currentRoomId.substring(0, keep) + '..' : currentRoomId;
  el.title = currentRoomId;
  copy.disabled = false;
}


function setMyIdDisplay() {
  const idEl = document.getElementById('tb-myid');
  const nameEl = document.getElementById('tb-myname');
  const meEl = document.getElementById('tb-me');
  if (!idEl || !nameEl || !meEl) return;
  const nick = sanitizeNick(myNickname);
  idEl.textContent = myId ? myId.substring(0, 5) : '--'; // 닉네임이 없을 때 머리 위에 뜨는 ID와 같은 5글자
  idEl.title = myId;
  nameEl.textContent = nick;
  nameEl.title = nick ? nick + (myId ? ' (' + myId + ')' : '') : '';
  meEl.classList.toggle('has-name', nick !== '');
}


function setWorldLabel() {
  const el = document.getElementById('tb-world');
  if (!el) return;
  const me = players[myId];
  el.textContent = (me && me.inMinigame) ? 'MINIGAME' : (tag.phase !== 'off' ? 'TAG GAME' : 'MAIN WORLD');
}


function setPlayerCount(n) {
  if (n === lastPlayerCount) return;
  lastPlayerCount = n;
  const el = document.getElementById('tb-count');
  if (el) el.textContent = '👥 ' + n;
}


function copyRoomId() {
  if (currentRoomId === "") return;
  const btn = document.getElementById('tb-copy');
  const fallback = () => prompt("아래 방 ID를 복사(Ctrl+C 또는 터치)하세요:", currentRoomId);
  const done = () => {
    btn.textContent = '✓';
    clearTimeout(copyFlashTimer);
    copyFlashTimer = setTimeout(() => applyToolbarLayout(toolbarWidth), 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(currentRoomId).then(done).catch(fallback);
  } else {
    fallback();
  }
  btn.blur();
}


// --- 입력 방식 (PC / AUTO / 모바일) ---
function setInputMode(mode) {
  if (mode !== 'PC' && mode !== 'AUTO' && mode !== 'MOBILE') return;
  inputMode = mode;
  applyInputMode();
}


function applyInputMode() {
  isMobile = (inputMode === 'MOBILE') || (inputMode === 'AUTO' && touchCapable);


  // 모드가 바뀌면 조이스틱 입력 상태를 초기화해서 이동이 꼬이지 않게 함
  joystickActive = false;
  joystickStick.x = joystickBase.x;
  joystickStick.y = joystickBase.y;
  joystickMove = { x: 0, y: 0 };


  if (btnCMobile) {
    if (isMobile) btnCMobile.show(); else btnCMobile.hide();
  }


  ['PC', 'AUTO', 'MOBILE'].forEach((m) => {
    const el = document.getElementById('tb-mode-' + m.toLowerCase());
    if (!el) return;
    el.classList.toggle('active', m === inputMode);
    el.setAttribute('aria-pressed', m === inputMode ? 'true' : 'false');
  });
}


// 입력 한 칸 + [뒤로][다음] 버튼이 있는 카드 내부 폼 (닉네임/방 ID 단계 공용)
function buildInputForm(o) {
  let form = createDiv('');
  form.id(o.formId);
  form.parent(o.parentCard);
  form.style('display', 'none');
  form.style('flex-direction', 'column');
  form.style('align-items', 'center');
  form.style('justify-content', 'space-between');
  form.style('width', '100%');
  form.style('height', '100%');
  form.style('opacity', '0');
  form.style('transition', 'opacity 0.3s ease 0.3s');


  let label = createDiv(o.label);
  label.parent(form);
  label.style('font-size', '24px');
  label.style('color', '#000');
  label.style('margin-top', '10px');


  let input = createInput(o.value || '');
  input.parent(form);
  input.attribute('placeholder', o.placeholder);
  input.attribute('autocomplete', 'off');
  input.attribute('spellcheck', 'false');
  input.style('width', '80%');
  input.style('height', '40px');
  input.style('border', 'none');
  input.style('background', '#d1d5db');
  input.style('box-shadow', '0 8px 16px rgba(0,0,0,0.4)');
  input.style('font-size', '18px');
  input.style('text-align', 'center');
  input.style('outline', 'none');
  input.style('border-radius', '8px');
  input.style('transition', 'box-shadow 0.15s ease, background 0.15s ease');
  input.mousePressed((e) => e.stopPropagation());
  // Enter = 다음 단계 (한글 조합 중 Enter 는 무시)
  input.elt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      o.onNext();
    }
  });


  let hint = createDiv(o.hint || '');
  hint.parent(form);
  hint.style('font-size', '12px');
  hint.style('color', '#374151');
  hint.style('min-height', '14px');
  input.elt._hintEl = hint.elt;            // 경고 문구를 힌트 줄에 잠깐 보여주기 위해 연결
  input.elt._hintText = o.hint || '';
  if (o.limit) attachInputLimit(input, o.limit);


  let arrowBox = createDiv('');
  arrowBox.parent(form);
  arrowBox.style('width', '100%');
  arrowBox.style('display', 'flex');
  arrowBox.style('justify-content', 'space-between');


  let btnBack = createButton(o.backText);
  btnBack.parent(arrowBox);
  styleArrowBtn(btnBack);
  btnBack.mousePressed((e) => { e.stopPropagation(); o.onBack(); });


  let btnNext = createButton(o.nextText);
  btnNext.parent(arrowBox);
  styleArrowBtn(btnNext);
  btnNext.mousePressed((e) => { e.stopPropagation(); o.onNext(); });


  return { form, input };
}


function createCustomUI() {
  mainUIContainer = createDiv('');
  mainUIContainer.parent(canvasWrapper);
  mainUIContainer.style('position', 'absolute');
  mainUIContainer.style('top', '0');
  mainUIContainer.style('left', '0');
  mainUIContainer.style('width', '100%');
  mainUIContainer.style('height', '100%');
  mainUIContainer.style('background', 'rgba(0, 0, 0, 0.8)');
  mainUIContainer.style('display', 'flex');
  mainUIContainer.style('flex-direction', 'column');
  mainUIContainer.style('align-items', 'center');
  mainUIContainer.style('justify-content', 'center');
  mainUIContainer.style('z-index', '1000');


  let title = createDiv('술래잡기 with 미니게임');
  title.id('main-ui-title');
  title.parent(mainUIContainer);
  title.style('color', 'white');
  title.style('font-size', '48px');
  title.style('font-weight', 'bold');
  title.style('margin-bottom', '20px');
  title.style('transition', 'opacity 0.4s ease');


  let cardBox = createDiv('');
  cardBox.parent(mainUIContainer);
  cardBox.style('display', 'flex');
  cardBox.style('gap', '15px');
  cardBox.style('align-items', 'center');


  // 새 방 생성하기 → 카드가 펼쳐지며 닉네임 입력 단계로
  let btnCreateCard = createCardButton('새 방 생성하기', 'new room', 'linear-gradient(to bottom, #86efac, #14532d)', () => {
    expandCreateCard();
  });
  btnCreateCard.id('card-create');
  btnCreateCard.parent(cardBox);


  let btnJoinCard = createCardButton('방 입장하기', 'room entry', 'linear-gradient(to bottom, #5eead4, #1e3a8a)', () => {
    expandJoinCard();
  });
  btnJoinCard.id('card-join');
  btnJoinCard.parent(cardBox);


  let btnHelpCard = createCardButton('도움말', 'help', 'linear-gradient(to bottom, #fef08a, #78350f)', () => {
    expandHelpCard();
  });
  btnHelpCard.id('card-help');
  btnHelpCard.parent(cardBox);


  // --- 방 만들기: 닉네임 단계 ---
  let createForm = buildInputForm({
    parentCard: btnCreateCard,
    formId: 'create-form-content',
    label: '닉네임을 입력하세요.',
    hint: '비워두면 ID 앞 5글자로 표시돼요',
    placeholder: '닉네임 (최대 ' + NICK_MAX + '자)',
    limit: NICK_MAX,
    value: myNickname,
    backText: '◀ 뒤로',
    onBack: shrinkCreateCard,
    nextText: '생성 ▶',
    onNext: confirmCreate
  });
  inputNickCreate = createForm.input;


  // --- 방 입장하기: 1단계(방 ID) ---
  let joinIdForm = buildInputForm({
    parentCard: btnJoinCard,
    formId: 'join-form-content',
    label: '방 ID를 입력하세요.',
    hint: '방장에게 받은 방 ID를 붙여넣으세요',
    placeholder: '방 ID',
    value: '',
    backText: '◀ 뒤로',
    onBack: shrinkJoinCard,
    nextText: '다음 ▶',
    onNext: goJoinNickStep
  });
  inputRoomId = joinIdForm.input;


  // --- 방 입장하기: 2단계(닉네임) ---
  let joinNickForm = buildInputForm({
    parentCard: btnJoinCard,
    formId: 'join-nick-content',
    label: '닉네임을 입력하세요.',
    hint: '비워두면 ID 앞 5글자로 표시돼요',
    placeholder: '닉네임 (최대 ' + NICK_MAX + '자)',
    limit: NICK_MAX,
    value: myNickname,
    backText: '◀ 뒤로',
    onBack: backToJoinIdStep,
    nextText: '입장 ▶',
    onNext: confirmJoin
  });
  inputNickJoin = joinNickForm.input;


  // --- 도움말 카드 ---
  let helpFormContent = createDiv('');
  helpFormContent.id('help-form-content');
  helpFormContent.parent(btnHelpCard);
  helpFormContent.style('display', 'none');
  helpFormContent.style('flex-direction', 'column');
  helpFormContent.style('align-items', 'center');
  helpFormContent.style('justify-content', 'space-between');
  helpFormContent.style('width', '100%');
  helpFormContent.style('height', '100%');
  helpFormContent.style('opacity', '0');
  helpFormContent.style('transition', 'opacity 0.3s ease 0.3s');
  helpFormContent.style('box-sizing', 'border-box');


  let helpScrollBox = createDiv('');
  helpScrollBox.parent(helpFormContent);
  helpScrollBox.style('width', '100%');
  helpScrollBox.style('flex', '1');
  helpScrollBox.style('overflow', 'hidden');
  helpScrollBox.style('position', 'relative');
  helpScrollBox.style('padding', '0');
  helpScrollBox.style('box-sizing', 'border-box');
  helpScrollBox.style('text-align', 'left');
  helpScrollBox.style('color', '#000');

  helpNav = createHelpNav(helpScrollBox);
  helpNav.onChange = (sec) => { if (helpBackBtn) helpBackBtn.html(sec >= 0 ? '◀ 목록' : '◀ 뒤로'); };


  let helpArrowBox = createDiv('');
  helpArrowBox.parent(helpFormContent);
  helpArrowBox.style('width', '100%');
  helpArrowBox.style('display', 'flex');
  helpArrowBox.style('justify-content', 'flex-start');
  helpArrowBox.style('padding', '8px 22px 4px');
  helpArrowBox.style('box-sizing', 'border-box');


  let btnHelpBack = createButton('◀ 뒤로');
  btnHelpBack.parent(helpArrowBox);
  styleArrowBtn(btnHelpBack);
  helpBackBtn = btnHelpBack;
  btnHelpBack.mousePressed((e) => {
    e.stopPropagation();
    if (helpNav.section >= 0) helpNav.back();
    else shrinkHelpCard();
  });
}


function createCardButton(korText, engText, gradient, onClick) {
  let card = createDiv('');
  card.style('width', '170px');
  card.style('height', '230px');
  card.style('background', gradient);
  card.style('border-radius', '20px');
  card.style('display', 'flex');
  card.style('flex-direction', 'column');
  card.style('align-items', 'center');
  card.style('justify-content', 'center');
  card.style('cursor', 'pointer');
  card.style('user-select', 'none');
  card.style('transition', 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)');
  card.style('padding', '20px');
  card.style('box-sizing', 'border-box');
  card.style('overflow', 'hidden');


  let textContainer = createDiv('');
  textContainer.class('card-text-container');
  textContainer.parent(card);
  textContainer.style('display', 'flex');
  textContainer.style('flex-direction', 'column');
  textContainer.style('align-items', 'center');
  textContainer.style('opacity', '1');
  textContainer.style('white-space', 'nowrap');
  textContainer.style('transition', 'opacity 0.15s ease');


  let kor = createDiv(korText);
  kor.parent(textContainer);
  kor.style('font-size', '20px');
  kor.style('font-weight', 'bold');
  kor.style('color', '#000');


  let eng = createDiv(engText);
  eng.parent(textContainer);
  eng.style('font-size', '13px');
  eng.style('color', '#333');
  eng.style('margin-top', '6px');


  card.elt.onmouseenter = () => {
    if (uiState === 0) card.style('transform', 'scale(1.03)');
  };
  card.elt.onmouseleave = () => {
    if (uiState === 0) card.style('transform', 'scale(1.0)');
  };
  card.mousePressed(onClick);


  return card;
}


function styleArrowBtn(btn) {
  btn.style('background', '#93c5fd');
  btn.style('border', 'none');
  btn.style('padding', '8px 18px');
  btn.style('border-radius', '12px');
  btn.style('font-weight', 'bold');
  btn.style('cursor', 'pointer');
  btn.style('font-size', '15px');
}


// --- 카드 확장/축소 공통 로직 ---
function hideCard(sel) {
  let c = select(sel);
  c.style('opacity', '0');
  c.style('transform', 'scale(0.7)');
  c.style('pointer-events', 'none');
  c.style('width', '0px');
  c.style('padding', '0px');
  c.style('margin', '0px');
}


function showCard(sel) {
  let c = select(sel);
  c.style('opacity', '1');
  c.style('transform', 'scale(1.0)');
  c.style('pointer-events', 'auto');
  c.style('width', '170px');
  c.style('padding', '20px');
}


function expandCard(cardSel, formSel, title, state, w, h, hideSels) {
  if (uiState !== 0) return;
  uiState = state;


  select('#main-ui-title').html(title);
  hideSels.forEach(hideCard);


  let card = select(cardSel);
  card.style('width', `min(${w}px, 90vw)`);
  card.style('height', h + 'px');
  card.style('cursor', 'default');


  let textContainer = select('.card-text-container', card);
  if (textContainer) textContainer.style('display', 'none');


  let formContent = select(formSel);
  formContent.style('transition', 'opacity 0.3s ease 0.3s'); // 카드가 다 커진 뒤에 내용이 나타남
  formContent.style('display', 'flex');
  setTimeout(() => { formContent.style('opacity', '1'); }, 50);
}


function shrinkCard(cardSel, formSel, showSels) {
  uiState = 0;
  let formContent = select(formSel);
  formContent.style('opacity', '0');


  setTimeout(() => {
    formContent.style('display', 'none');
    let card = select(cardSel);
    card.style('width', '170px');
    card.style('height', '230px');
    card.style('cursor', 'pointer');


    let textContainer = select('.card-text-container', card);
    if (textContainer) textContainer.style('display', 'flex');


    select('#main-ui-title').html('2D LAND');
    showSels.forEach(showCard);
  }, 200);
}


// 방 만들기: [카드 확장] → 닉네임 입력 → 방 생성
function expandCreateCard() {
  expandCard('#card-create', '#create-form-content', '방 만들기', 4, 520, 260, ['#card-join', '#card-help']);
  focusInputLater(inputNickCreate);
}
function shrinkCreateCard() {
  shrinkCard('#card-create', '#create-form-content', ['#card-join', '#card-help']);
}
function confirmCreate() {
  if (uiState !== 4) return;
  myNickname = sanitizeNick(inputNickCreate.value());
  saveNick(myNickname);
  startHost();
}


// 방 입장하기: [카드 확장] → 방 ID 입력 → (카드 안에서 전환) → 닉네임 입력 → 입장
function expandJoinCard() {
  expandCard('#card-join', '#join-form-content', '방 입장하기', 1, 520, 260, ['#card-create', '#card-help']);
  focusInputLater(inputRoomId);
}


function goJoinNickStep() {
  if (uiState !== 1) return;
  if (!inputRoomId.value().trim()) { flashInvalid(inputRoomId, '방 ID를 입력해 주세요'); return; }
  uiState = 5;
  swapForm('#join-form-content', '#join-nick-content', '닉네임 설정');
  focusInputLater(inputNickJoin, 350);
}


function backToJoinIdStep() {
  if (uiState !== 5) return;
  uiState = 1;
  swapForm('#join-nick-content', '#join-form-content', '방 입장하기');
  focusInputLater(inputRoomId, 350);
}


function confirmJoin() {
  if (uiState !== 5) return;
  myNickname = sanitizeNick(inputNickJoin.value());
  saveNick(myNickname);
  joinRoom();
}


// 같은 카드 안에서 입력 단계를 부드럽게 전환 (페이드 아웃 → 페이드 인)
function swapForm(fromSel, toSel, title) {
  let from = select(fromSel);
  let to = select(toSel);
  from.style('transition', 'opacity 0.2s ease');
  to.style('transition', 'opacity 0.25s ease');
  from.style('opacity', '0');
  select('#main-ui-title').html(title);
  setTimeout(() => {
    from.style('display', 'none');
    to.style('display', 'flex');
    setTimeout(() => { to.style('opacity', '1'); }, 30);
  }, 200);
}


// 입력창을 잠깐 빨갛게 깜빡이고(+살짝 흔들림) 힌트 줄에 이유를 보여줌
function flashInvalid(inp, msg) {
  const el = inp.elt;
  clearTimeout(el._flashT);
  inp.style('box-shadow', '0 0 0 3px #ef4444');
  inp.style('background', '#fecaca');
  const hint = el._hintEl;
  if (hint && msg) { hint.textContent = msg; hint.style.color = '#dc2626'; }
  if (el.animate) {
    el.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
      { duration: 200 }
    );
  }
  el._flashT = setTimeout(() => {
    inp.style('box-shadow', '0 8px 16px rgba(0,0,0,0.4)');
    inp.style('background', '#d1d5db');
    if (hint) { hint.textContent = el._hintText || ''; hint.style.color = '#374151'; }
  }, 700);
}


// 글자수 제한: 이미 가득 찬 상태에서 더 입력하려 하면 입력을 막고 빨간 깜빡임으로 알림
//  - 기존 글자는 지우지 않음 (넘치는 글자만 들어가지 않음)
//  - 한글 조합 중에는 입력을 막을 수 없으므로 조합이 끝난 뒤 넘친 글자만 제거
//  - 붙여넣기는 들어갈 만큼만 넣고 알림
function attachInputLimit(inp, max) {
  const el = inp.elt;
  const msg = '최대 ' + max + '글자까지 입력할 수 있어요';
  const len = (str) => Array.from(str).length;


  const enforce = () => {
    const arr = Array.from(el.value);
    if (arr.length > max) {
      el.value = arr.slice(0, max).join('');
      flashInvalid(inp, msg);
    }
  };


  el.addEventListener('beforeinput', (e) => {
    if (e.isComposing || !e.inputType || e.inputType.indexOf('insert') !== 0) return;
    let incoming = e.data;
    if (incoming == null && e.dataTransfer) incoming = e.dataTransfer.getData('text');
    if (!incoming) return;


    const start = (el.selectionStart == null) ? el.value.length : el.selectionStart;
    const end = (el.selectionEnd == null) ? start : el.selectionEnd;
    const remaining = max - (len(el.value) - len(el.value.slice(start, end)));
    const inc = Array.from(incoming);
    if (inc.length <= remaining) return;


    e.preventDefault();
    flashInvalid(inp, msg);
    if (remaining > 0 && e.inputType !== 'insertText') {
      el.setRangeText(inc.slice(0, remaining).join(''), start, end, 'end');
    }
  });


  el.addEventListener('input', (e) => {
    if (e.isComposing) {
      if (len(el.value) > max) flashInvalid(inp, msg);
      return;
    }
    enforce();
  });
  el.addEventListener('compositionend', () => setTimeout(enforce, 0));
}


// 카드가 다 펼쳐진 뒤 입력창에 포커스 (터치 기기에서는 화상 키보드가 갑자기 뜨지 않도록 생략)
function focusInputLater(inp, delay = 700) {
  if (isMobile) return;
  setTimeout(() => {
    try { inp.elt.focus(); inp.elt.select(); } catch (e) {}
  }, delay);
}
function shrinkJoinCard() {
  shrinkCard('#card-join', '#join-form-content', ['#card-create', '#card-help']);
}
function expandHelpCard() {
  expandCard('#card-help', '#help-form-content', '도움말', 3, 560, 380, ['#card-create', '#card-join']);
}
function shrinkHelpCard() {
  shrinkCard('#card-help', '#help-form-content', ['#card-create', '#card-join']);
  setTimeout(() => helpNav && helpNav.back(), 400);   // 접힌 뒤 다음에 열면 목록부터 보이도록
}

// 섹션 목록 ↔ 상세 내용을 좌우 슬라이드로 전환하는 네비게이터 (카드·팝업 공용)
function createHelpNav(parent) {
  const nav = { section: -1, onChange: null };

  const root = createDiv('');
  root.parent(parent);
  root.style('width', '100%');
  root.style('height', '100%');
  root.style('position', 'relative');
  root.style('overflow', 'hidden');
  root.style('background', 'rgba(255,255,255,0.94)');
  root.style('border-radius', '14px');
  root.style('box-sizing', 'border-box');
  root.style('text-align', 'left');
  root.style('color', '#000');

  const slider = createDiv('');
  slider.parent(root);
  slider.style('display', 'flex');
  slider.style('width', '200%');
  slider.style('height', '100%');
  slider.style('transform', 'translateX(0)');
  slider.style('transition', 'transform 0.3s ease');

  const listPane = createDiv('');
  listPane.parent(slider);
  listPane.style('width', '50%');
  listPane.style('height', '100%');
  listPane.style('overflow-y', 'auto');
  listPane.style('padding', '14px 22px');
  listPane.style('box-sizing', 'border-box');
  listPane.style('touch-action', 'pan-y');
  listPane.style('-webkit-overflow-scrolling', 'touch');

  HELP_SECTIONS.forEach((sec, i) => {
    const b = createButton(sec.icon + '  ' + sec.title + '  ›');
    b.parent(listPane);
    b.style('display', 'block');
    b.style('width', '100%');
    b.style('text-align', 'left');
    b.style('background', '#fffbeb');
    b.style('border', '1px solid #fde68a');
    b.style('border-radius', '10px');
    b.style('padding', '10px 14px');
    b.style('margin-bottom', '8px');
    b.style('font-size', '15px');
    b.style('font-weight', 'bold');
    b.style('color', '#333');
    b.style('cursor', 'pointer');
    // 모바일: mousePressed 는 터치 시작 시점에 실행되어 스크롤만 해도 눌림 → click 사용
    b.elt.addEventListener('click', (e) => {
      e.stopPropagation();
      nav.open(i);
    });
  });

  const detailPane = createDiv('');
  detailPane.parent(slider);
  detailPane.style('width', '50%');
  detailPane.style('height', '100%');
  detailPane.style('overflow-y', 'auto');
  detailPane.style('padding', '14px 22px');
  detailPane.style('box-sizing', 'border-box');
  detailPane.style('touch-action', 'pan-y');
  detailPane.style('-webkit-overflow-scrolling', 'touch');

  const body = createDiv('');
  body.parent(detailPane);

  nav.open = (i) => {
    nav.section = i;
    body.html(helpSectionHtml(HELP_SECTIONS[i]));
    detailPane.elt.scrollTop = 0;
    slider.style('transform', 'translateX(-50%)');
    if (nav.onChange) nav.onChange(i);
  };
  nav.back = () => {
    nav.section = -1;
    slider.style('transform', 'translateX(0)');
    if (nav.onChange) nav.onChange(-1);
  };
  nav.root = root;
  return nav;
}


function createHelpPopup() {
  // 접속 전 화면과 같은 느낌의 애니메이션 (페이드 + 위에서 내려오기)
  const st = document.createElement('style');
  st.textContent =
    '@keyframes helpFadeIn { from { opacity: 0; } to { opacity: 1; } }' +
    '@keyframes helpFadeOut { from { opacity: 1; } to { opacity: 0; } }' +
    '@keyframes helpDropIn { from { opacity: 0; transform: translateY(-80px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }' +
    '@keyframes helpRiseOut { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(-80px) scale(0.96); } }';
  document.head.appendChild(st);

  helpOverlay = createDiv('');
  helpOverlay.parent(canvasWrapper);
  helpOverlay.style('position', 'absolute');
  helpOverlay.style('top', '0');
  helpOverlay.style('left', '0');
  helpOverlay.style('width', '100%');
  helpOverlay.style('height', '100%');
  helpOverlay.style('background', 'rgba(0, 0, 0, 0.8)');   // 접속 전 화면(mainUIContainer)과 동일
  helpOverlay.style('z-index', '2000');
  helpOverlay.style('display', 'flex');
  helpOverlay.style('align-items', 'center');
  helpOverlay.style('justify-content', 'center');
  helpOverlay.hide();

  helpOverlay.elt.addEventListener('click', (e) => {
    if (e.target === helpOverlay.elt) toggleHelpPopup();
  });

  // 접속 전 화면의 도움말 카드와 같은 그라데이션
  helpCard = createDiv('');
  helpCard.parent(helpOverlay);
  helpCard.style('background', 'linear-gradient(to bottom, #fef08a, #78350f)');
  helpCard.style('border-radius', '20px');
  helpCard.style('padding', '18px');
  helpCard.style('width', 'min(560px, 90vw)');
  helpCard.style('height', 'min(520px, 80vh)');
  helpCard.style('display', 'flex');
  helpCard.style('flex-direction', 'column');
  helpCard.style('box-shadow', '0 10px 25px rgba(0,0,0,0.5)');
  helpCard.style('position', 'relative');
  helpCard.style('box-sizing', 'border-box');

  let title = createDiv('도움말');
  title.parent(helpCard);
  title.style('color', 'white');
  title.style('font-size', '28px');
  title.style('font-weight', 'bold');
  title.style('text-align', 'center');
  title.style('margin-bottom', '12px');
  title.style('flex', 'none');

  let navHost = createDiv('');
  navHost.parent(helpCard);
  navHost.style('flex', '1');
  navHost.style('min-height', '0');
  navHost.style('width', '100%');
  navHost.style('display', 'flex');

  helpPopupNav = createHelpNav(navHost);

  let btnBottom = createButton('닫기');
  btnBottom.parent(helpCard);
  btnBottom.style('flex', 'none');
  btnBottom.style('align-self', 'center');
  btnBottom.style('margin-top', '12px');
  btnBottom.style('padding', '8px 24px');
  btnBottom.style('background', '#fff');
  btnBottom.style('color', '#333');
  btnBottom.style('border', 'none');
  btnBottom.style('border-radius', '8px');
  btnBottom.style('font-weight', 'bold');
  btnBottom.style('cursor', 'pointer');
  btnBottom.elt.addEventListener('click', (e) => {
    e.stopPropagation();
    if (helpPopupNav.section >= 0) helpPopupNav.back();
    else toggleHelpPopup();
  });

  helpPopupNav.onChange = (sec) => { btnBottom.html(sec >= 0 ? '◀ 목록' : '닫기'); };
}

function toggleHelpPopup() {
  helpVisible = !helpVisible;
  if (!helpOverlay) return;
  clearTimeout(helpHideTimer);
  if (helpVisible) {
    helpOverlay.style('display', 'flex');
    helpOverlay.style('animation', 'helpFadeIn 0.25s ease');
    helpCard.style('animation', 'helpDropIn 0.4s cubic-bezier(0.4, 0, 0.2, 1)');
  } else {
    helpOverlay.style('animation', 'helpFadeOut 0.25s ease forwards');
    helpCard.style('animation', 'helpRiseOut 0.25s ease-in forwards');
    helpHideTimer = setTimeout(() => {
      helpOverlay.hide();
      if (helpPopupNav) helpPopupNav.back();   // 다음에 열면 목록부터
    }, 250);
  }
}


function switchToConnectedUI() {
  uiState = 2;
  if (mainUIContainer) mainUIContainer.hide();


  setRoomDisplay();
  setMyIdDisplay();
  setWorldLabel();
}


function createMobileUI() {
  // C(모양) 원형 버튼은 하단 이모트 바([C 모양] [1 👋] ...)로 대체됨 (drawEmoteBar)
}


function styleMobileButton(btn) {
  btn.style('width', '60px');
  btn.style('height', '60px');
  btn.style('border-radius', '30px');
  btn.style('background', 'rgba(255, 255, 255, 0.4)');
  btn.style('border', '1px solid rgba(255, 255, 255, 0.6)');
  btn.style('color', '#000');
  btn.style('font-weight', 'bold');
  btn.style('font-size', '12px');
  btn.style('z-index', '999');
  btn.style('user-select', 'none');
}


// =====================================================
// 🏃 술래잡기: 로직 / 설정창 / 그리기
// =====================================================
function tagMoveLocked() {
  return tagSetupVisible || tag.phase === 'draw' || (tag.phase === 'ready' && tag.it === myId)
    || (tag.phase === 'playing' && tag.it === myId && tag.itStun > 0);   // 💥 정지
}


function tagNameOf(id) {
  return players[id] ? displayNameOf(id, players[id]) : '(퇴장)';
}


function fmtTagTime(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}


// ----- 방장: 게임 시작 / 진행 / 종료 -----
function startTagGame(sec) {
  if (myRole !== 'host' || tag.phase !== 'off') return false;
  lobbyShopOpen = false;
  const ids = Object.keys(players);
  if (ids.length < 2) return false;
  tag = newTagState(tag.round + 1);
  tag.phase = 'draw';
  // 🎲 랜덤 뽑기: 방 안에서 아직 술래를 안 한 사람 중에서만 뽑음
  //    모두 한 번씩 돌았으면 사이클을 리셋하되, 직전 술래는 연속으로 뽑히지 않도록 제외
  let pool = ids.filter(id => !tagPickHistory[id]);
  if (pool.length === 0) {
    tagPickHistory = {};
    pool = ids.filter(id => id !== tagLastIt);
  }
  tag.it = pool[Math.floor(Math.random() * pool.length)];
  tagPickHistory[tag.it] = true;
  tagLastIt = tag.it;
  tag.timeLeft = TAG_DRAW_SEC;
  tag.duration = sec;
  handleTagTransition();
  return true;
}


function endTagGame(winner, reason) {
  tag.phase = 'ended';
  tag.winner = winner;
  tag.reason = reason;
  tag.timeLeft = TAG_END_SEC;
  handleTagTransition();
}


function tickTagHost() {
  if (tag.phase === 'off') return;
  tag.timeLeft -= Math.min(deltaTime, 100) / 1000;
  if (tag.itStun > 0) tag.itStun = Math.max(0, tag.itStun - Math.min(deltaTime, 100) / 1000);
  processTagBooms();   // 💥 폭발 판정 (방장 전용)


  if (tag.phase === 'draw') {
    if (tag.timeLeft <= 0) { tag.phase = 'ready'; tag.timeLeft = TAG_READY_SEC; handleTagTransition(); }


  } else if (tag.phase === 'ready') {
    if (tag.timeLeft <= 0) { tag.phase = 'playing'; tag.timeLeft = tag.duration; handleTagTransition(); }


  } else if (tag.phase === 'playing') {
    // 술래가 나갔으면 생존자 중 한 명이 새 술래
    if (!players[tag.it]) {
      const cand = Object.keys(players).filter(id => !tag.out[id]);
      if (cand.length === 0) { endTagGame('none', '플레이어가 부족해서 종료됐어요'); return; }
      tag.it = cand[Math.floor(Math.random() * cand.length)];
    }


    const itp = players[tag.it];
    const runners = Object.keys(players).filter(id => id !== tag.it && !tag.out[id]);


    // 충돌 판정 → 탈락
    if (itp && !itp.inMinigame && !(tag.itStun > 0)) {   // 💥 정지 중에는 잡기 불가
      for (const id of runners) {
        const p = players[id];
        if (!p || p.inMinigame) continue;   // 🌿 덩굴 속도 잡힐 수 있음 (은신은 시야만 가림)
        if (dist(itp.x || 0, itp.y || 0, p.x || 0, p.y || 0) < PLAYER_RADIUS * 2) tag.out[id] = true;
      }
    }


    const aliveLeft = runners.filter(id => !tag.out[id]);
    if (aliveLeft.length === 0) {
      const anyCaught = Object.keys(tag.out).some(id => players[id] && tag.out[id] === true);
      if (anyCaught) endTagGame('tagger', '모든 도망자를 잡았어요!');
      else endTagGame('none', '도망자가 없어서 종료됐어요');
    } else if (tag.timeLeft <= 0) {
      endTagGame('runners', '시간 종료! 끝까지 살아남았어요');
    }


  } else if (tag.phase === 'ended') {
    if (tag.timeLeft <= 0) {
      tag = newTagState(tag.round);
      handleTagTransition();
    }
  }
}


// ----- 전원 공통: 단계가 바뀔 때 1회 실행 -----
function handleTagTransition() {
  tagSeenPhase = tag.phase;
  tagSeenRound = tag.round;
  const me = players[myId];


  if (tag.phase === 'draw') {
    tagDrawStart = millis();
    tagFx = [];
    tagFxSeenOut = {};
    mySkill = null;          // 🎒 스킬은 판마다 새로 고름
    skillCdLeft = 0;
    if (me) { me.invLeft = 0; me.boostLeft = 0; }
    closeTagSetup();
    joystickActive = false;
    joystickStick.x = joystickBase.x; joystickStick.y = joystickBase.y;
    joystickMove = { x: 0, y: 0 };
    isNearMinigamePortal = false;
    isNearTagPortal = false;
    if (me && me.inMinigame) exitMinigameWorld();   // 미니게임 중이던 사람도 월드로 복귀
    // 벽 안에 끼어 있던 사람은 빈자리로 이동 (주로 중간에 들어온 사람)
    if (me && hitsTagWall(me.x, me.y, PLAYER_RADIUS)) { const sp = findTagSpawn(); me.x = sp.x; me.y = sp.y; }


  } else if (tag.phase === 'playing') {
    // 이 순간 이전에 탈락한 사람은 연출 없이 표시만 (중간 입장자가 옛 연출을 다시 보지 않도록)
    tagFxSeenOut = {};
    for (const id in tag.out) if (tag.out[id] === true) tagFxSeenOut[id] = true;
  } else if (tag.phase === 'ready') {
    if (me) {   // 술래는 중앙, 도망자는 바깥쪽 랜덤 위치
      const half = MAP_SIZE / 2 - PLAYER_RADIUS;
      if (tag.it === myId) {
        me.x = 0; me.y = 0;
      } else {
        const sp = findTagSpawn();   // 벽과 겹치지 않는 위치
        me.x = sp.x; me.y = sp.y;
      }
    }
  }
  setWorldLabel();
}


// ----- 방장 설정창 -----
const TAG_BTN_CSS = 'border:none;border-radius:10px;padding:8px 16px;font-weight:bold;cursor:pointer;font-size:14px;';


function createTagSetupPopup() {
  tagSetupOverlay = createDiv('');
  tagSetupOverlay.parent(canvasWrapper);
  tagSetupOverlay.style('position', 'absolute');
  tagSetupOverlay.style('top', '0');
  tagSetupOverlay.style('left', '0');
  tagSetupOverlay.style('width', '100%');
  tagSetupOverlay.style('height', '100%');
  tagSetupOverlay.style('background', 'rgba(0, 0, 0, 0.65)');
  tagSetupOverlay.style('z-index', '2100');
  tagSetupOverlay.style('display', 'flex');
  tagSetupOverlay.style('align-items', 'center');
  tagSetupOverlay.style('justify-content', 'center');
  tagSetupOverlay.hide();


  const card = createDiv('');
  card.id('tag-setup-card');
  card.parent(tagSetupOverlay);
  card.style('background', '#fff');
  card.style('border-radius', '15px');
  card.style('padding', '20px');
  card.style('width', '85%');
  card.style('max-width', '400px');
  card.style('max-height', '90%');
  card.style('overflow-y', 'auto');
  card.style('box-sizing', 'border-box');
  card.style('box-shadow', '0 10px 25px rgba(0,0,0,0.5)');
  card.style('color', '#333');
  card.style('font-family', 'sans-serif');
  card.style('text-align', 'left');
  card.html(
    '<div style="font-weight:bold;font-size:20px;margin-bottom:6px;">🏃 술래잡기 설정</div>' +
    '<div id="tag-setup-info" style="font-size:13px;color:#555;margin-bottom:12px;line-height:1.5;"></div>' +
    '<div style="font-weight:bold;font-size:14px;margin-bottom:6px;">제한 시간 (초)</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">' +
      [60, 120, 180, 300].map(s =>
        '<button class="tag-preset" data-sec="' + s + '" style="' + TAG_BTN_CSS + 'padding:6px 12px;background:#e5e7eb;">' + s + '</button>'
      ).join('') +
    '</div>' +
    '<input id="tag-time-input" type="number" inputmode="numeric" min="' + TAG_TIME_MIN + '" max="' + TAG_TIME_MAX + '" ' +
      'style="width:100%;box-sizing:border-box;height:38px;font-size:16px;text-align:center;border:1px solid #cbd5e1;border-radius:8px;outline:none;">' +
    '<div id="tag-setup-hint" style="font-size:12px;color:#6b7280;min-height:16px;margin-top:6px;">' +
      TAG_TIME_MIN + '~' + TAG_TIME_MAX + '초 사이로 입력하세요</div>' +
    '<div style="display:flex;justify-content:space-between;margin-top:14px;">' +
      '<button id="tag-cancel" style="' + TAG_BTN_CSS + 'background:#e5e7eb;">취소</button>' +
      '<button id="tag-start" style="' + TAG_BTN_CSS + 'background:#ef4444;color:#fff;">🎲 술래 뽑기 시작</button>' +
    '</div>'
  );


  tagTimeInput = select('#tag-time-input');
  tagTimeInput.elt.addEventListener('input', refreshTagSetup);
  tagTimeInput.elt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && !e.repeat && e.keyCode !== 229) { e.preventDefault(); confirmTagStart(); }
  });
  document.querySelectorAll('#tag-setup-card .tag-preset').forEach((b) => {
    b.addEventListener('click', () => { tagTimeInput.elt.value = b.dataset.sec; refreshTagSetup(); b.blur(); });
  });
  document.getElementById('tag-cancel').addEventListener('click', (e) => { closeTagSetup(); e.currentTarget.blur(); });
  document.getElementById('tag-start').addEventListener('click', (e) => { confirmTagStart(); e.currentTarget.blur(); });
}


function refreshTagSetup() {
  const n = Object.keys(players).length;
  const info = document.getElementById('tag-setup-info');
  if (info) {
    info.innerHTML = '현재 참가자 <b>' + n + '명</b> · 시작하면 모든 플레이어의 월드가 술래잡기 모드로 바뀌고, 술래가 랜덤으로 뽑혀요.' +
      (n < 2 ? '<br><span style="color:#dc2626;">참가자가 2명 이상이어야 시작할 수 있어요.</span>' : '');
  }
  const cur = parseInt(tagTimeInput.elt.value, 10);
  document.querySelectorAll('#tag-setup-card .tag-preset').forEach((b) => {
    b.style.background = (parseInt(b.dataset.sec, 10) === cur) ? '#fca5a5' : '#e5e7eb';
  });
}


function tagSetupHint(msg) {
  const h = document.getElementById('tag-setup-hint');
  if (!h) return;
  h.textContent = msg;
  h.style.color = '#dc2626';
  clearTimeout(h._t);
  h._t = setTimeout(() => {
    h.textContent = TAG_TIME_MIN + '~' + TAG_TIME_MAX + '초 사이로 입력하세요';
    h.style.color = '#6b7280';
  }, 1800);
}


function openTagSetup() {
  if (myRole !== 'host' || tag.phase !== 'off' || tagSetupVisible) return;
  tagSetupVisible = true;
  joystickActive = false;
  joystickStick.x = joystickBase.x; joystickStick.y = joystickBase.y;
  joystickMove = { x: 0, y: 0 };
  tagTimeInput.elt.value = lastTagDuration;
  refreshTagSetup();
  tagSetupOverlay.style('display', 'flex');
  focusInputLater(tagTimeInput, 50);
}


function closeTagSetup() {
  tagSetupVisible = false;
  if (tagSetupOverlay) tagSetupOverlay.hide();
}


function confirmTagStart() {
  if (!tagSetupVisible) return;
  if (Object.keys(players).length < 2) { tagSetupHint('참가자가 2명 이상이어야 시작할 수 있어요'); return; }
  const sec = parseInt(tagTimeInput.elt.value, 10);
  if (!Number.isFinite(sec) || sec < TAG_TIME_MIN || sec > TAG_TIME_MAX) {
    tagSetupHint('제한 시간은 ' + TAG_TIME_MIN + '~' + TAG_TIME_MAX + '초로 입력해 주세요');
    return;
  }
  lastTagDuration = sec;
  if (startTagGame(sec)) focusMainPage();
}


// ----- 그리기 -----
function drawTagPortal() {
  push();
  const p = tagPortal;
  const isHost = myRole === 'host';
  const busy = tag.phase !== 'off';
  const dim = !isHost || busy;


  if (dim) { fill(100, 100, 110, 150); stroke(150, 150, 160); }
  else { fill(239, 68, 68, 180); stroke(251, 146, 60); }
  strokeWeight(3);
  ellipse(p.x, p.y, p.size);


  noStroke(); fill(255);
  textAlign(CENTER, CENTER);
  textSize(28); text(p.icon, p.x, p.y - 10);
  textSize(11); textStyle(BOLD);
  text("술래잡기", p.x, p.y + 15);


  const sub = busy ? '진행 중' : (isHost ? '' : '🔒 방장 전용');
  if (sub) {
    fill(255, 220, 150); textSize(10);
    text(sub, p.x, p.y + p.size / 2 + 12);
  }
  pop();
}


function drawTagPortalUI() {
  let barW = min(width - 20, 440);
  fill(15, 23, 42, 230);
  stroke(239, 68, 68);
  strokeWeight(2);
  rect(width / 2 - barW / 2, 20, barW, 45, 20);


  noStroke(); fill(255, 255, 0);
  textSize(13); textAlign(CENTER, CENTER);
  text("🏃 [술래잡기] 포탈 (방장 전용)", width / 2, 33);
  fill(255); textSize(11);
  text("👉 [Enter] 키 또는 [술래잡기]를 눌러 게임을 설정하세요!", width / 2, 50);
}


// =====================================================
// 💥 탈락(잡힘) 연출: 아바타가 반으로 갈라지며 흩어짐 + 내 화면 붉게 점멸
// =====================================================
const TAG_FX_MS = 1000;        // 갈라짐 연출 길이
const TAG_FLASH_MS = 900;      // 내 화면 붉은 점멸 길이
let tagFx = [];                // 진행 중인 연출 {id, x, y, color, shape, t0}
let tagFxSeenOut = {};         // 이미 연출을 등록한 탈락자 (중복 방지)
let tagFlashStart = -99999;    // 내가 잡힌 순간 (붉은 화면 시작 시각)


// 새로 잡힌 사람을 감지해 연출 등록 (판정은 방장이 하지만 모든 기기가 같은 상태를 보므로 각자 감지)
function updateTagFx() {
  if (tag.phase !== 'playing') return;
  for (const id in tag.out) {
    if (tag.out[id] !== true || tagFxSeenOut[id]) continue;   // 'spec'(난입 관전)은 연출 없음
    tagFxSeenOut[id] = true;
    const p = players[id];
    if (!p) continue;
    tagFx.push({ id, x: p.x || 0, y: p.y || 0, color: p.color, shape: p.shape || 0, t0: millis() });
    if (id === myId) tagFlashStart = millis();
  }
}


// 반쪽 하나 그리기 (side: -1 왼쪽, 1 오른쪽)
function drawTagHalf(shape, c, side, off, rot, a) {
  const R = PLAYER_RADIUS;
  push();
  translate(side * off, 0);
  rotate(rot);
  fill(c[0], c[1], c[2], a);
  stroke(30, 0, 0, a);
  strokeWeight(2);
  if (shape === 1) {
    rectMode(CORNER);
    if (side < 0) rect(-R, -R, R, R * 2, 4);
    else rect(0, -R, R, R * 2, 4);
  } else {
    if (side < 0) arc(0, 0, R * 2, R * 2, HALF_PI, PI + HALF_PI, PIE);
    else arc(0, 0, R * 2, R * 2, -HALF_PI, HALF_PI, PIE);
  }
  // 절단면 (빨간 선)
  stroke(239, 68, 68, a);
  strokeWeight(2);
  line(0, -R, 0, R);
  pop();
}


// 💥 월드 좌표에 그리는 갈라짐 연출
function drawTagCatchFx() {
  const now = millis();
  for (const fx of tagFx) {
    const t = (now - fx.t0) / TAG_FX_MS;
    if (t < 0 || t >= 1) continue;
    const e = 1 - Math.pow(1 - t, 3);        // 빠르게 튀었다가 감속
    const off = e * 26;                      // 두 조각이 벌어지는 거리
    const rot = e * 0.4;                     // 조각이 살짝 기울어짐
    const a = 255 * (1 - t);
    const c = fx.color || [255, 255, 255];


    push();
    translate(fx.x, fx.y);


    // 충격파 링 (빨강)
    noFill();
    stroke(239, 68, 68, 200 * (1 - t));
    strokeWeight(3 + 3 * (1 - t));
    ellipse(0, 0, PLAYER_RADIUS * 2 + e * 60);


    // 반으로 갈린 아바타 두 조각
    drawTagHalf(fx.shape, c, -1, off, -rot, a);
    drawTagHalf(fx.shape, c, 1, off, rot, a);


    // 붉은 파편
    noStroke();
    fill(239, 68, 68, a);
    for (let i = 0; i < 8; i++) {
      const ang = i * (TWO_PI / 8) + 0.2;
      const d = PLAYER_RADIUS + e * 34;
      ellipse(cos(ang) * d, sin(ang) * d, 5 * (1 - t) + 2);
    }


    // 탈락 라벨 (위로 떠오르며 사라짐)
    fill(255, 90, 90, a);
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(13);
    text('💥 탈락!', 0, -PLAYER_RADIUS - 14 - e * 22);
    pop();
  }
  tagFx = tagFx.filter(fx => now - fx.t0 < TAG_FX_MS);
}


// 🔴 내가 잡혔을 때 화면 전체 붉은 점멸 (화면 좌표)
function drawTagFlash() {
  const el = millis() - tagFlashStart;
  if (el < 0 || el > TAG_FLASH_MS) return;
  const t = el / TAG_FLASH_MS;
  const a = 190 * (1 - t);


  push();
  rectMode(CORNER);
  noStroke();
  fill(220, 20, 20, a * 0.6);
  rect(0, 0, width, height);
  noFill();
  stroke(255, 40, 40, a);
  strokeWeight(16);
  rect(8, 8, width - 16, height - 16);
  if (t < 0.6) {
    noStroke();
    fill(255, 255, 255, 255 * (1 - t / 0.6));
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(min(36, width / 14));
    text('💥 잡혔어요!', width / 2, height / 2 + 90);
  }
  pop();
}


// =====================================================
// 🎒 도망자 스킬 (카운트다운 중 선택 → 게임 중 Shift로 사용, 쿨타임 10초)
//   - 👻 투명인간 5초: 술래 화면에서 사라짐 (잡힘 판정은 그대로)
//   - 💨 속도 1.25배 5초
// =====================================================
const TAG_SKILL_SEC = 5;
const TAG_SKILL_CD = 10;
const TAG_BOOST_MULT = 1.25;
const TAG_BOOM_CD = 20;        // 💥 폭발 쿨타임 (다른 스킬은 10초)
const TAG_BOOM_R = 130;        // 💥 폭발 반경 (벽 파괴 / 술래 정지 판정)
const TAG_BOOM_STUN = 5;       // 💥 술래 정지 시간
const SPRINT_MULT = 1.25;      // 🏃 술잡 아닐 때 Shift 달리기 배율


// 🏃 로비 대쉬 설정 (쿨타임 없음: Shift를 다시 누르면 즉시 재사용 가능)
const LOBBY_DASH_DISTANCE = 85;
const LOBBY_DASH_DURATION = 0.14;
let lobbyDashLeft = 0;
let lobbyDashCooldownUntil = 0;
let lobbyDashEffectUntil = 0;
let lobbyDashDir = { x: 1, y: 0 };
let lobbyDashSpeed = LOBBY_DASH_DISTANCE / LOBBY_DASH_DURATION;


// 🎉 로비 이모트 (멀티플레이에서도 표시되도록 종료 시각은 실제 시각 사용)
function triggerLobbyEmote(emoji) {
  const me = players[myId];
  if (!me || me.inMinigame || tag.phase !== 'off') return;
  me.emote = emoji;
  me.emoteUntil = Date.now() + 1600;
}


// 🎉 미니게임 안에서 보낸 이모트 (미니게임 화면에 표시되도록 같은 값을 갱신)
const MINIGAME_EMOTES = ['👋', '😎', '😂', '🔥'];
function triggerMinigameEmote(emoji) {
  const me = players[myId];
  if (!me || !me.inMinigame || !MINIGAME_EMOTES.includes(emoji)) return;
  me.emote = emoji;
  me.emoteUntil = Date.now() + 1600;
}


function setLobbyNotice(me, message, duration = 1300) {
  me.lobbyNotice = message;
  me.lobbyNoticeUntil = Date.now() + duration;
}


function updateLobbyPlay(me) {
  if (!me || tag.phase !== 'off' || me.inMinigame) return;
  const now = Date.now();
  if (!me.lobbyStarCollectedAt || typeof me.lobbyStarCollectedAt !== 'object') me.lobbyStarCollectedAt = {};
  if (!Number.isFinite(me.lobbyStars)) me.lobbyStars = 0;
  if (!Number.isFinite(me.lobbyStarPickups)) me.lobbyStarPickups = 0;
  ensureLobbyEconomy(me);
  ensureLobbyCoinsSpawned(me);
  if (!Number.isInteger(me.lobbyCreatorLevelNotified)) me.lobbyCreatorLevelNotified = getLobbyCreatorLevel(me);
  if (typeof me.lobbyMinigameUnlockNotified !== 'boolean') me.lobbyMinigameUnlockNotified = hasMinigameWorldUnlocked(me);


  // 🪙 바닥에 랜덤 생성된 코인을 획득. 코인 획득량이 월드 해금/제작자 진행도에도 반영됨.
  for (const coin of me.lobbyCoinDrops) {
    if (Number(coin.availableAt || 0) > now) continue;
    if (dist(me.x, me.y, coin.x, coin.y) <= PLAYER_RADIUS + coin.r) {
      me.lobbyCoins += 1;
      me.lobbyStars += 1;       // 기존 미니게임 월드 해금 진행도와 호환
      me.lobbyStarPickups += 1; // 기존 제작자 레벨 진행도와 호환
      const next = randomLobbyCoinPosition();
      coin.x = next.x; coin.y = next.y; coin.availableAt = now + LOBBY_COIN_RESPAWN_MS;
      setLobbyNotice(me, '🪙 코인 +1!', 1000);
    }
  }


  // 🏁 4개 체크포인트를 정해진 순서대로 통과하면 완주
  if (!Number.isInteger(me.lobbyCourseStep) || me.lobbyCourseStep < 0 || me.lobbyCourseStep >= LOBBY_CHECKPOINTS.length) {
    me.lobbyCourseStep = 0;
  }
  if (!Number.isInteger(me.lobbyLaps)) me.lobbyLaps = 0;
  const nextCp = LOBBY_CHECKPOINTS[me.lobbyCourseStep];
  if (nextCp && dist(me.x, me.y, nextCp.x, nextCp.y) < PLAYER_RADIUS + 25) {
    if (me.lobbyCourseStep === 0) me.lobbyCourseStartAt = now;
    me.lobbyCourseStep += 1;
    if (me.lobbyCourseStep >= LOBBY_CHECKPOINTS.length) {
      const lapMs = me.lobbyCourseStartAt ? Math.max(0, now - me.lobbyCourseStartAt) : 0;
      me.lobbyLaps += 1;
      me.lobbyLastLapMs = lapMs;
      if (!me.lobbyBestLapMs || (lapMs > 0 && lapMs < me.lobbyBestLapMs)) me.lobbyBestLapMs = lapMs;
      me.lobbyLapTokens = Math.max(0, Number(me.lobbyLapTokens) || 0) + 1; // 🧱 한 바퀴마다 스킨용 레고 토큰 +1
      me.lobbyCourseStep = 0;
      me.lobbyCourseStartAt = 0;
      setLobbyNotice(me, '🏆 코스 완주! 🧱 레고 토큰 +1', 2200);
    } else {
      setLobbyNotice(me, '🏁 체크포인트 ' + me.lobbyCourseStep + '/4');
    }
  }


  // 🎁 해금 보상 판정: 미니게임 월드는 코인 10개, 제작자 레벨은 수집 코인+완주 횟수
  const worldJustUnlocked = !me.lobbyMinigameUnlockNotified && hasMinigameWorldUnlocked(me);
  if (worldJustUnlocked) me.lobbyMinigameUnlockNotified = true;


  const oldNotifiedLevel = me.lobbyCreatorLevelNotified;
  const creatorLevel = getLobbyCreatorLevel(me);
  me.lobbyCreatorLevel = creatorLevel;
  if (creatorLevel > oldNotifiedLevel) me.lobbyCreatorLevelNotified = creatorLevel;


  if (worldJustUnlocked && creatorLevel > oldNotifiedLevel) {
    setLobbyNotice(me, '🔓 미니게임 월드 + 제작자 Lv.' + creatorLevel + ' 해금!', 3000);
  } else if (worldJustUnlocked) {
    setLobbyNotice(me, '🔓 코인 10개 달성! 미니게임 월드 해금!', 2600);
  } else if (creatorLevel > oldNotifiedLevel) {
    setLobbyNotice(me, '🏆 ' + CREATOR_LEVEL_NAMES[creatorLevel - 1] + ' 해금! (Lv.' + creatorLevel + ')', 3000);
  }


  // 🚀 부스터 패드: 밟으면 화살표 방향으로 강하게 튕겨 나감
  if (lobbyDashLeft <= 0 && Number(me.lobbyPadCooldownUntil || 0) <= now) {
    for (const pad of LOBBY_BOOST_PADS) {
      if (dist(me.x, me.y, pad.x, pad.y) <= PLAYER_RADIUS + pad.r) {
        lobbyDashDir = { x: Math.cos(pad.angle), y: Math.sin(pad.angle) };
        playerAngle = pad.angle;
        me.angle = playerAngle;
        lobbyDashLeft = LOBBY_PAD_DASH_DURATION;
        lobbyDashSpeed = LOBBY_PAD_DASH_DISTANCE / LOBBY_PAD_DASH_DURATION;
        me.lobbyPadCooldownUntil = now + 900;
        setLobbyNotice(me, '🚀 부스터 발동!');
        break;
      }
    }
  }
}


// 로비 장식: 나무·벤치는 모두 제거하고, 충돌 가능한 벽만 표시
function drawLobbyDecorations() {
  if (tag.phase !== 'off') return;
  push();
  rectMode(CORNER);
  const me = players[myId];
  for (const w of getActiveLobbyWalls(me)) {
    // 벽 본체
    fill(71, 85, 105);
    stroke(30, 41, 59);
    strokeWeight(3);
    rect(w.x, w.y, w.w, w.h, 3);


    // 벽 윗면 하이라이트
    noStroke();
    fill(148, 163, 184, 220);
    if (w.w >= w.h) {
      rect(w.x + 4, w.y + 3, Math.max(2, w.w - 8), 4, 2);
    } else {
      rect(w.x + 3, w.y + 4, 4, Math.max(2, w.h - 8), 2);
    }
  }
  pop();
}


// 로비 랜덤 코인, 부스터, 코스 체크포인트 그리기
function drawLobbyPlayObjects() {
  if (tag.phase !== 'off') return;
  const me = players[myId];
  const now = Date.now();
  push();


  // 코스 경로
  noFill();
  stroke(56, 189, 248, 55);
  strokeWeight(3);
  beginShape();
  for (const cp of LOBBY_CHECKPOINTS) vertex(cp.x, cp.y);
  vertex(LOBBY_CHECKPOINTS[0].x, LOBBY_CHECKPOINTS[0].y);
  endShape();


  // 🪙 플레이어별 랜덤 코인 드롭 표시
  if (me) {
    ensureLobbyCoinsSpawned(me);
    for (let i = 0; i < me.lobbyCoinDrops.length; i++) {
      const coin = me.lobbyCoinDrops[i];
      if (Number(coin.availableAt || 0) > now) continue;
      const bob = Math.sin(frameCount * 0.08 + i * 1.7) * 3;
      push();
      translate(coin.x, coin.y + bob);
      noStroke(); fill(250, 204, 21, 55); ellipse(0, 0, 34, 34);
      fill(250, 204, 21); stroke(180, 83, 9); strokeWeight(2); ellipse(0, 0, 22, 22);
      noStroke(); fill(120, 53, 15); textAlign(CENTER, CENTER); textStyle(BOLD); textSize(13); text('$', 0, -1);
      pop();
    }
  }


  // 🚀 방향 화살표가 있는 부스터 패드
  for (const pad of LOBBY_BOOST_PADS) {
    push();
    translate(pad.x, pad.y);
    noStroke();
    fill(14, 165, 233, 65);
    ellipse(0, 0, pad.r * 2.8, pad.r * 2.8);
    fill(14, 165, 233, 185);
    stroke(186, 230, 253);
    strokeWeight(2);
    ellipse(0, 0, pad.r * 2, pad.r * 2);
    rotate(pad.angle);
    noStroke();
    fill(255);
    triangle(15, 0, -7, -11, -7, 11);
    rect(-13, -4, 12, 8, 2);
    pop();
    noStroke();
    fill(224, 242, 254);
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(10);
    text('BOOST', pad.x, pad.y + 39);
  }


  // 🏁 코스 체크포인트 1~4. 각자 다음 순서가 은은하게 강조됨.
  const step = me && Number.isInteger(me.lobbyCourseStep) ? me.lobbyCourseStep : 0;
  for (let i = 0; i < LOBBY_CHECKPOINTS.length; i++) {
    const cp = LOBBY_CHECKPOINTS[i];
    const active = i === step;
    noFill();
    stroke(active ? 74 : 96, active ? 222 : 165, active ? 128 : 250, active ? 245 : 170);
    strokeWeight(active ? 5 : 3);
    ellipse(cp.x, cp.y, 58, 58);
    noStroke();
    fill(active ? color(34, 197, 94, 225) : color(15, 23, 42, 210));
    ellipse(cp.x, cp.y, 35, 35);
    fill(255);
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(15);
    text(String(i + 1), cp.x, cp.y);
    fill(226, 232, 240);
    textSize(10);
    text(active ? 'NEXT' : 'CP ' + (i + 1), cp.x, cp.y + 43);
  }


  pop();
}


// 로비 점수와 코스 진행도를 화면에 고정 표시
function drawLobbyPlayHUD() {
  const me = players[myId];
  const active = !!me && !me.inMinigame && tag.phase === 'off';
  syncLobbyInfo(active, me);       // 왼쪽 위 내 정보 패널(DOM) 표시/갱신
  if (!active) return;
  ensureLobbyEconomy(me);

  push();
  rectMode(CORNER);
  noStroke();

  if (me.lobbyNotice && Number(me.lobbyNoticeUntil || 0) > Date.now()) {
    const nw = Math.min(width - 24, 310);
    fill(8, 47, 73, 235);
    rect(width / 2 - nw / 2, 121, nw, 34, 10);
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(12);
    text(me.lobbyNotice, width / 2, 138);
  }
  pop();
  drawLobbyShopButton();
  if (lobbyShopOpen) drawLobbyShopOverlay();
}


// =====================================================
// 📊 로비 내 정보 패널 (왼쪽 위, DOM)
//   - ▲ 버튼: 툴바 닉네임 쪽으로 빨려 들어가듯 접힘
//   - 툴바 📊 버튼: 닉네임 쪽에서 스르륵 펼쳐짐
//   - 강조색 = 툴바 강조색(내 캐릭터 색)
// =====================================================
const LOBBY_INFO_CSS = `
#lobby-info {
  position: absolute; left: 10px; top: 10px; z-index: 900;
  width: 262px; max-width: calc(100% - 20px); box-sizing: border-box;
  padding: 9px 11px 9px 10px; border-radius: 16px;
  background: rgba(38, 42, 52, .92); box-shadow: 0 6px 18px rgba(0, 0, 0, .35);
  display: flex; gap: 10px; align-items: stretch;
  color: #e5e7eb; pointer-events: none; user-select: none; -webkit-user-select: none;
  font: 500 11px/1.25 system-ui, -apple-system, 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
}
#lobby-info .li-skin { flex: 0 0 62px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
#lobby-info .li-avatar { width: 34px; height: 34px; border: 2px solid rgba(255, 255, 255, .85); box-sizing: border-box; }
#lobby-info .li-avatar.ci { border-radius: 50%; }
#lobby-info .li-avatar.sq { border-radius: 4px; }
#lobby-info .li-skin-name { font-size: 10px; color: #cbd5e1; white-space: nowrap; }
#lobby-info .li-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
#lobby-info .li-stats { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 700; color: #fff; }
#lobby-info .li-stat { display: flex; align-items: center; gap: 3px; }
#lobby-info .li-ico { font-size: 13px; }
#lobby-info .li-abil { font-size: 11px; color: #64748b; }
#lobby-info .li-abil .on { color: var(--accent); font-weight: 600; }
#lobby-info .li-abil .sep { color: #475569; margin: 0 4px; }
#lobby-info .li-cur { color: var(--accent); font-weight: 700; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#lobby-info .li-next { font-size: 9.5px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#lobby-info .li-prog { display: flex; gap: 10px; font-size: 10px; color: #cbd5e1; margin-top: 2px; padding-right: 30px; }
#lobby-info .li-prog label { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
#lobby-info .li-box { width: 12px; height: 12px; box-sizing: border-box; border: 1.5px solid #64748b; border-radius: 3px;
  display: inline-flex; align-items: center; justify-content: center; font-size: 10px; line-height: 1; color: var(--accent); }
#lobby-info .li-box.on { border-color: var(--accent); }
#lobby-info .li-arrow { position: absolute; right: 8px; bottom: 7px; width: 24px; height: 22px; padding: 0; border: 0; border-radius: 7px;
  background: rgba(74, 222, 128, .2); color: #4ade80; font-size: 11px; line-height: 1; cursor: pointer; pointer-events: auto; }
#lobby-info .li-arrow:hover { background: rgba(74, 222, 128, .35); }
`;

let lobbyInfoEl = null;           // 패널 DOM
let lobbyInfoRefs = null;         // 패널 안의 갱신용 요소들
let lobbyInfoOpen = true;         // 펼침 상태 (로비를 떠났다 와도 유지)
let lobbyInfoAnim = null;         // 진행 중인 애니메이션
let lobbyInfoWasActive = false;   // 직전 프레임에 로비 패널이 보였는지
let lobbyInfoKey = '';            // 내용이 바뀐 경우에만 DOM 갱신

function createLobbyInfoPopup() {
  if (lobbyInfoEl || !canvasWrapper) return;

  const st = document.createElement('style');
  st.id = 'lobby-info-style';
  st.textContent = LOBBY_INFO_CSS;
  document.head.appendChild(st);

  const [r, g, b] = (myColor || [45, 212, 191]).map(Math.round);
  lobbyInfoEl = document.createElement('div');
  lobbyInfoEl.id = 'lobby-info';
  lobbyInfoEl.style.setProperty('--accent', `rgb(${r},${g},${b})`);
  lobbyInfoEl.style.visibility = lobbyInfoOpen ? 'visible' : 'hidden';
  lobbyInfoEl.innerHTML =
    '<div class="li-skin">' +
      '<div class="li-avatar ci" id="li-avatar"></div>' +
      '<div class="li-skin-name" id="li-skin-name">기본 스킨</div>' +
    '</div>' +
    '<div class="li-main">' +
      '<div class="li-stats">' +
        '<span class="li-stat"><span class="li-ico">🪙</span><span id="li-coins">0</span></span>' +
        '<span class="li-stat"><span class="li-ico">🧱</span><span id="li-lego">0</span></span>' +
        '<span class="li-stat">' +
          '<svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">' +
            '<path d="M2 12 A9 9 0 0 1 6.5 4.2" fill="none" stroke="#22c55e" stroke-width="3"/>' +
            '<path d="M6.5 4.2 A9 9 0 0 1 15.5 4.2" fill="none" stroke="#f59e0b" stroke-width="3"/>' +
            '<path d="M15.5 4.2 A9 9 0 0 1 20 12" fill="none" stroke="#ef4444" stroke-width="3"/>' +
            '<path d="M11 12 L15 8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>' +
          '</svg>' +
          '<span id="li-diff">1</span>' +
        '</span>' +
      '</div>' +
      '<div class="li-abil"><span id="li-dash">대쉬</span><span class="sep">|</span><span id="li-speed">속력 UP</span><span class="sep">|</span><span id="li-jump">점프</span></div>' +
      '<div class="li-cur">[현재] <span id="li-cur">LV.0 예비 제작자</span></div>' +
      '<div class="li-next">[NEXT] <span id="li-next">LV.1</span></div>' +
      '<div class="li-prog">' +
        '<label><span class="li-box" id="li-box-coin"></span>코인 <span id="li-prog-coin">0/10</span></label>' +
        '<label><span class="li-box" id="li-box-lap"></span>완주 <span id="li-prog-lap">0/5</span></label>' +
      '</div>' +
    '</div>' +
    '<button class="li-arrow" id="li-arrow" title="툴바로 접기">▲</button>';
  canvasWrapper.elt.appendChild(lobbyInfoEl);

  const $ = (id) => document.getElementById(id);
  lobbyInfoRefs = {
    avatar: $('li-avatar'), skinName: $('li-skin-name'),
    coins: $('li-coins'), lego: $('li-lego'), diff: $('li-diff'),
    dash: $('li-dash'), speed: $('li-speed'), jump: $('li-jump'),
    cur: $('li-cur'), next: $('li-next'),
    progCoin: $('li-prog-coin'), progLap: $('li-prog-lap'),
    boxCoin: $('li-box-coin'), boxLap: $('li-box-lap')
  };
  $('li-arrow').addEventListener('click', (e) => { e.stopPropagation(); setLobbyInfoOpen(false); });
}

function updateLobbyInfoContent(me) {
  if (!lobbyInfoRefs) return;
  const coins = me.lobbyInfiniteCoins ? '∞' : String(Math.max(0, Math.floor(Number(me.lobbyCoins || 0))));
  const lego = String(Math.max(0, Math.floor(Number(me.lobbyLapTokens || 0))));
  const diff = String(getLobbyDifficultyLevel(me));
  const picked = Math.max(0, Math.floor(Number(me.lobbyStarPickups || 0)));
  const laps = Math.max(0, Math.floor(Number(me.lobbyLaps || 0)));
  const level = getLobbyCreatorLevel(me);
  const maxed = level >= CREATOR_LEVEL_MAX;
  const nextLevel = Math.min(CREATOR_LEVEL_MAX, level + 1);
  const needCoin = nextLevel * CREATOR_LEVEL_STARS_STEP;
  const needLap = nextLevel * CREATOR_LEVEL_LAPS_STEP;
  const cur = 'LV.' + level + ' ' + getLobbyCreatorTitle(me);
  const next = maxed ? '최고 단계 달성!' : 'LV.' + nextLevel + ' ' + CREATOR_LEVEL_NAMES[nextLevel - 1];
  const skin = me.lobbySkinId && me.lobbySkinId !== 'default' ? LOBBY_SKINS.find(s => s.id === me.lobbySkinId) : null;
  const skinName = skin ? skin.name + ' 스킨' : '기본 스킨';
  const shapeCls = (me.shape || 0) === 1 ? 'sq' : 'ci';
  const avatarColor = me.color ? `rgb(${Math.round(me.color[0])},${Math.round(me.color[1])},${Math.round(me.color[2])})` : '#94a3b8';
  const coinMet = maxed || picked >= needCoin;
  const lapMet = maxed || laps >= needLap;

  const key = [coins, lego, diff, !!me.lobbyDashUnlocked, !!me.lobbySpeedUnlocked, !!me.lobbyJumpUnlocked,
    cur, next, picked, needCoin, laps, needLap, skinName, shapeCls, avatarColor, coinMet, lapMet].join('|');
  if (key === lobbyInfoKey) return;
  lobbyInfoKey = key;

  const R = lobbyInfoRefs;
  R.coins.textContent = coins;
  R.lego.textContent = lego;
  R.diff.textContent = diff;
  R.dash.classList.toggle('on', !!me.lobbyDashUnlocked);
  R.speed.classList.toggle('on', !!me.lobbySpeedUnlocked);
  R.jump.classList.toggle('on', !!me.lobbyJumpUnlocked);
  R.cur.textContent = cur;
  R.next.textContent = next;
  R.progCoin.textContent = maxed ? '완료' : picked + '/' + needCoin;
  R.progLap.textContent = maxed ? '완료' : laps + '/' + needLap;
  R.boxCoin.classList.toggle('on', coinMet);
  R.boxCoin.textContent = coinMet ? '✓' : '';
  R.boxLap.classList.toggle('on', lapMet);
  R.boxLap.textContent = lapMet ? '✓' : '';
  R.avatar.className = 'li-avatar ' + shapeCls;
  R.avatar.style.background = avatarColor;
  R.skinName.textContent = skinName;
}

// 패널이 접힐/펼쳐질 때 목적지: 툴바 닉네임 오른쪽 (툴바가 접혀 있으면 접기 버튼 위치)
function lobbyInfoTargetPoint() {
  const rectOf = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const rc = el.getBoundingClientRect();
    return rc.width > 0 && rc.height > 0 ? rc : null;
  };
  const nameRc = rectOf('tb-myname');
  if (nameRc) return { x: nameRc.right + 6, y: nameRc.top + nameRc.height / 2 };
  const foldRc = rectOf('tb-fold');
  if (foldRc) return { x: foldRc.left + foldRc.width / 2, y: foldRc.top + foldRc.height / 2 };
  return { x: window.innerWidth / 2, y: 0 };
}

function setLobbyInfoOpen(open) {
  lobbyInfoOpen = open;
  const btn = document.getElementById('tb-info');
  if (btn) {
    btn.classList.toggle('on', open);
    btn.title = open ? '내 정보 접기' : '내 정보 펼치기';
  }
  if (!lobbyInfoEl || !lobbyInfoWasActive) return;

  if (lobbyInfoAnim) { lobbyInfoAnim.cancel(); lobbyInfoAnim = null; }
  const r = lobbyInfoEl.getBoundingClientRect();
  const t = lobbyInfoTargetPoint();
  const dx = t.x - (r.left + r.width / 2);
  const dy = t.y - (r.top + r.height / 2);
  const shrunk = `translate(${dx}px, ${dy}px) scale(0.08)`;

  if (open) {
    // 툴바에서 스르륵 펼쳐짐
    lobbyInfoEl.style.visibility = 'visible';
    lobbyInfoAnim = lobbyInfoEl.animate([
      { transform: shrunk, opacity: 0, filter: 'blur(3px)' },
      { transform: 'translate(0, 0) scale(1)', opacity: 1, filter: 'blur(0px)' }
    ], { duration: 460, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  } else {
    // 툴바 닉네임 쪽으로 빨려 들어감
    const anim = lobbyInfoEl.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1, filter: 'blur(0px)' },
      { transform: shrunk, opacity: 0, filter: 'blur(3px)' }
    ], { duration: 420, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'forwards' });
    lobbyInfoAnim = anim;
    anim.onfinish = () => {
      if (!lobbyInfoOpen && lobbyInfoAnim === anim) lobbyInfoEl.style.visibility = 'hidden';
    };
  }
}

// 로비가 아닐 때(미니게임 / 술래잡기)는 패널과 툴바 버튼을 숨기고, 로비로 돌아오면 이전 상태대로 복원
function syncLobbyInfo(active, me) {
  const btn = document.getElementById('tb-info');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      setLobbyInfoOpen(!lobbyInfoOpen);
      e.currentTarget.blur();
    });
  }
  if (btn) btn.style.display = active ? '' : 'none';

  if (!active) {
    if (lobbyInfoEl && lobbyInfoWasActive) {
      if (lobbyInfoAnim) { lobbyInfoAnim.cancel(); lobbyInfoAnim = null; }
      lobbyInfoEl.style.visibility = 'hidden';
    }
    lobbyInfoWasActive = false;
    return;
  }

  if (!lobbyInfoEl) createLobbyInfoPopup();
  if (!lobbyInfoEl) return;
  if (!lobbyInfoWasActive) {
    lobbyInfoWasActive = true;
    lobbyInfoEl.style.visibility = lobbyInfoOpen ? 'visible' : 'hidden';
  }
  if (btn) btn.classList.toggle('on', lobbyInfoOpen);
  updateLobbyInfoContent(me);
}


function lobbyShopButtonRect() {
  return { x: width - 58, y: width < 410 ? 118 : 12, w: 48, h: 42 };
}


function lobbyShopLayout() {
  const w = Math.min(width - 28, 370);
  const h = Math.min(height - 24, 490);
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  return {
    x, y, w, h,
    close: { x: x + w - 34, y: y + 8, w: 25, h: 25 },
    speed: { x: x + 18, y: y + 78, w: w - 36, h: 48 },
    dash: { x: x + 18, y: y + 137, w: w - 36, h: 48 },
    jump: { x: x + 18, y: y + 196, w: w - 36, h: 48 },
    dev: { x: x + 18, y: y + 255, w: w - 36, h: 48 },
    skin1: { x: x + 18, y: y + 314, w: w - 36, h: 42 },
    skin2: { x: x + 18, y: y + 363, w: w - 36, h: 42 },
    skin3: { x: x + 18, y: y + 412, w: w - 36, h: 42 }
  };
}


function drawLobbyShopButton() {
  const b = lobbyShopButtonRect();
  push();
  rectMode(CORNER);
  stroke(125, 211, 252);
  strokeWeight(2);
  fill(lobbyShopOpen ? color(14, 116, 144, 245) : color(8, 47, 73, 230));
  rect(b.x, b.y, b.w, b.h, 10);
  noStroke();
  fill(255);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(19);
  text('🛒', b.x + b.w / 2, b.y + 15);
  textSize(9);
  text('상점 B', b.x + b.w / 2, b.y + 33);
  pop();
}


function drawLobbyShopOverlay() {
  const me = players[myId];
  if (!me) return;
  ensureLobbyEconomy(me);
  const r = lobbyShopLayout();
  push();
  rectMode(CORNER);
  noStroke();
  fill(0, 0, 0, 175);
  rect(0, 0, width, height);
  fill(9, 15, 30, 248);
  stroke(56, 189, 248);
  strokeWeight(2);
  rect(r.x, r.y, r.w, r.h, 16);
  noStroke();
  fill(255);
  textAlign(LEFT, CENTER);
  textStyle(BOLD);
  textSize(18);
  text('🛒 업그레이드 상점', r.x + 18, r.y + 27);
  textSize(12);
  fill(250, 204, 21);
  text('보유 코인: ' + (me.lobbyInfiniteCoins ? '∞ (무제한)' : Math.floor(me.lobbyCoins || 0)), r.x + 18, r.y + 53);
  fill(203, 213, 225);
  textAlign(CENTER, CENTER);
  textSize(12);
  text('닫기 ×', r.close.x + r.close.w / 2, r.close.y + r.close.h / 2);


  const speedBought = !!me.lobbySpeedUnlocked;
  fill(speedBought ? color(22, 101, 52, 230) : color(76, 29, 149, 235));
  stroke(speedBought ? color(74, 222, 128) : color(196, 181, 253));
  strokeWeight(1.5); rect(r.speed.x, r.speed.y, r.speed.w, r.speed.h, 10);
  noStroke(); fill(255); textAlign(LEFT, CENTER); textStyle(BOLD); textSize(14);
  text('1. 💨 속도 증가 ' + (speedBought ? '· 구매 완료' : '· 10 코인'), r.speed.x + 12, r.speed.y + 16);
  textStyle(NORMAL); textSize(10); text('영구 이동 속도 1.5배 · 게임 월드 연동', r.speed.x + 12, r.speed.y + 34);


  const dashBought = !!me.lobbyDashUnlocked;
  fill(dashBought ? color(22, 101, 52, 230) : color(30, 64, 95, 240));
  stroke(dashBought ? color(74, 222, 128) : color(56, 189, 248));
  strokeWeight(1.5); rect(r.dash.x, r.dash.y, r.dash.w, r.dash.h, 10);
  noStroke(); fill(255); textAlign(LEFT, CENTER); textStyle(BOLD); textSize(14);
  text('2. ⚡ 대쉬 ' + (dashBought ? '· 구매 완료' : '· 20 코인'), r.dash.x + 12, r.dash.y + 16);
  textStyle(NORMAL); textSize(10); text('Shift 대쉬 · 재사용 대기시간 1초', r.dash.x + 12, r.dash.y + 34);


  const jumpBought = !!me.lobbyJumpUnlocked;
  fill(jumpBought ? color(22, 101, 52, 230) : color(124, 45, 18, 235));
  stroke(jumpBought ? color(74, 222, 128) : color(251, 146, 60));
  strokeWeight(1.5); rect(r.jump.x, r.jump.y, r.jump.w, r.jump.h, 10);
  noStroke(); fill(255); textAlign(LEFT, CENTER); textStyle(BOLD); textSize(14);
  text('3. 🦘 점프 ' + (jumpBought ? '· 구매 완료' : '· 30 코인'), r.jump.x + 12, r.jump.y + 16);
  textStyle(NORMAL); textSize(10); text('Space로 점프해 로비 벽 넘기', r.jump.x + 12, r.jump.y + 34);


  fill(me.lobbyInfiniteCoins ? color(22, 101, 52, 230) : color(30, 41, 59, 245));
  stroke(me.lobbyInfiniteCoins ? color(74, 222, 128) : color(148, 163, 184));
  strokeWeight(1.5); rect(r.dev.x, r.dev.y, r.dev.w, r.dev.h, 10);
  noStroke(); fill(255); textAlign(LEFT, CENTER); textStyle(BOLD); textSize(14);
  text(me.lobbyInfiniteCoins ? '🔓 개발자 코드 인증 완료' : '🔑 개발자 코드 입력', r.dev.x + 12, r.dev.y + 16);
  textStyle(NORMAL); textSize(10); text(me.lobbyInfiniteCoins ? '코인을 소비하지 않고 구매 가능' : '코드 인증 시 코인 무제한 사용', r.dev.x + 12, r.dev.y + 34);


  ensureLobbyCoinsSpawned(me);
  const owned = me.lobbyOwnedSkins || [];
  for (let i = 0; i < LOBBY_SKINS.length; i++) {
    const skin = LOBBY_SKINS[i];
    const rectSkin = r['skin' + (i + 1)];
    const has = owned.includes(skin.id);
    const equipped = me.lobbySkinId === skin.id;
    fill(equipped ? color(22, 101, 52, 235) : has ? color(30, 64, 95, 235) : color(51, 65, 85, 240));
    stroke(equipped ? color(74, 222, 128) : color(skin.color[0], skin.color[1], skin.color[2]));
    strokeWeight(1.5); rect(rectSkin.x, rectSkin.y, rectSkin.w, rectSkin.h, 9);
    noStroke(); fill(skin.color[0], skin.color[1], skin.color[2]); ellipse(rectSkin.x + 18, rectSkin.y + 21, 18, 18);
    fill(255); textAlign(LEFT, CENTER); textStyle(BOLD); textSize(12);
    text(skin.name + ' 스킨 · ' + (equipped ? '착용 중' : has ? '보유 · 눌러서 착용' : skin.cost + ' 레고 토큰'), rectSkin.x + 34, rectSkin.y + 21);
  }


  fill(148, 163, 184);
  textAlign(CENTER, CENTER);
  textSize(10);
  text('코인은 맵에 랜덤 생성 · 한 바퀴 완주마다 레고 토큰 +1', width / 2, r.y + r.h - 12);
  pop();
}


function activateLobbyInfiniteCoins() {
  const me = players[myId];
  if (!me || me.inMinigame || tag.phase !== 'off') return false;
  ensureLobbyEconomy(me);
  if (me.lobbyInfiniteCoins) {
    setLobbyNotice(me, '🔓 이미 코인 무제한이 활성화되어 있어요!');
    return true;
  }
  const entered = window.prompt('개발자 코드를 입력하세요.');
  if (entered === null) return false;
  if (String(entered).trim().toUpperCase() !== LOBBY_DEV_COIN_CODE) {
    setLobbyNotice(me, '❌ 개발자 코드가 올바르지 않아요.', 2200);
    return false;
  }
  me.lobbyInfiniteCoins = true;
  setLobbyNotice(me, '🔓 인증 성공! 이제 코인을 무제한으로 사용할 수 있어요.', 3000);
  return true;
}


function buyLobbyUpgrade(type) {
  const me = players[myId];
  if (!me || me.inMinigame || tag.phase !== 'off') return false;
  ensureLobbyEconomy(me);
  const key = type === 'dash' ? 'lobbyDashUnlocked' : type === 'speed' ? 'lobbySpeedUnlocked' : type === 'jump' ? 'lobbyJumpUnlocked' : '';
  if (!key) return false;
  if (me[key]) {
    setLobbyNotice(me, type === 'dash' ? '⚡ 대쉬는 이미 구매했어요!' : type === 'speed' ? '💨 속도 증가는 이미 구매했어요!' : '🦘 점프는 이미 구매했어요!');
    return false;
  }
  const price = LOBBY_UPGRADE_PRICE[type];
  if (!me.lobbyInfiniteCoins && me.lobbyCoins < price) {
    setLobbyNotice(me, '🪙 코인이 부족해요! ' + price + '코인 필요', 1800);
    return false;
  }
  if (!me.lobbyInfiniteCoins) me.lobbyCoins -= price;
  me[key] = true;
  if (type === 'dash') {
    setLobbyNotice(me, '⚡ 대쉬 구매 완료! Shift로 사용 · 쿨타임 1초', 2200);
  } else if (type === 'speed') {
    setLobbyNotice(me, '💨 속도 증가 구매 완료! 영구 1.5배!', 2200);
  } else {
    setLobbyNotice(me, '🦘 점프 구매 완료! 로비에서 Space로 벽 넘기!', 2200);
  }
  sendGameWorldUpgrades();
  return true;
}




function buyOrEquipLobbySkin(skinId) {
  const me = players[myId];
  const skin = LOBBY_SKINS.find(item => item.id === skinId);
  if (!me || !skin) return false;
  ensureLobbyCoinsSpawned(me);
  if (!me.lobbyOwnedSkins.includes(skinId)) {
    if (Number(me.lobbyLapTokens || 0) < skin.cost) {
      setLobbyNotice(me, '🧱 레고 토큰이 부족해요! ' + skin.cost + '개 필요', 1800);
      return false;
    }
    me.lobbyLapTokens -= skin.cost;
    me.lobbyOwnedSkins.push(skinId);
  }
  me.lobbySkinId = skinId;
  me.color = skin.color.slice();
  setLobbyNotice(me, '🎨 ' + skin.name + ' 스킨 착용 완료!', 1800);
  return true;
}


function handleLobbyShopClick(mx, my) {
  const me = players[myId];
  if (!me || me.inMinigame || tag.phase !== 'off') return false;
  const b = lobbyShopButtonRect();
  const inRect = (p) => mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h;


  if (!lobbyShopOpen) {
    if (inRect(b)) { lobbyShopOpen = true; return true; }
    return false;
  }


  const r = lobbyShopLayout();
  if (inRect(r.close)) { lobbyShopOpen = false; return true; }
  if (inRect(r.dev)) { activateLobbyInfiniteCoins(); return true; }
  if (inRect(r.dash)) { buyLobbyUpgrade('dash'); return true; }
  if (inRect(r.jump)) { buyLobbyUpgrade('jump'); return true; }
  if (inRect(r.speed)) { buyLobbyUpgrade('speed'); return true; }
  for (let i = 0; i < LOBBY_SKINS.length; i++) {
    const skin = LOBBY_SKINS[i];
    if (inRect(r['skin' + (i + 1)])) { buyOrEquipLobbySkin(skin.id); return true; }
  }
  // 상점이 열려 있을 때 바깥쪽을 누르면 닫고, 입력이 이동으로 이어지지 않게 막음
  if (!inRect({ x: r.x, y: r.y, w: r.w, h: r.h })) lobbyShopOpen = false;
  return true;
}


let mySkill = null;         // 'invis' | 'boost' | null  (이번 판에 고른 스킬)
let skillCdLeft = 0;        // 쿨타임 남은 초
let tagPickHistory = {};    // 방장 전용: 이번 사이클에서 이미 술래가 된 사람
let tagLastIt = '';         // 방장 전용: 직전 판 술래


// 지금 내가 살아 있는 도망자인지 (술래 / 탈락 / 미니게임 중이면 false)
function isTagRunnerAlive() {
  const me = players[myId];
  return tag.phase !== 'off' && !!me && !me.inMinigame && tag.it !== myId && !tag.out[myId];
}


function skillName(type) {
  if (type === 'invis') return '👻 투명인간';
  if (type === 'boost') return '💨 속도 1.25배';
  return '💥 폭발';
}


// 카운트다운 중 스킬 선택 버튼 위치 (화면 좌표)
function skillPickRects() {
  const bw = Math.min(120, (width - 30) / 3 - 6), bh = 46;
  const gap = 6, x0 = (width - (bw * 3 + gap * 2)) / 2;
  const y = height * 0.74;
  return {
    invis: { x: x0, y: y, w: bw, h: bh },
    boost: { x: x0 + bw + gap, y: y, w: bw, h: bh },
    boom: { x: x0 + (bw + gap) * 2, y: y, w: bw, h: bh }
  };
}


// 모바일 스킬 버튼 위치
function skillBtnRect() {
  return { x: width - 70, y: height - 215, r: 32 };
}


function inBox(mx, my, b) {
  return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
}


// 스킬 사용 (Shift / 모바일 스킬 버튼)
function useTagSkill() {
  if (tag.phase !== 'playing' || !mySkill || skillCdLeft > 0 || !isTagRunnerAlive()) return false;
  const me = players[myId];
  if (mySkill === 'invis') me.invLeft = TAG_SKILL_SEC;
  else if (mySkill === 'boost') me.boostLeft = TAG_SKILL_SEC;
  else if (mySkill === 'boom') {   // 💥 위치를 실어 보내면 방장이 벽 파괴 / 술래 정지를 처리
    me.boomSeq = (me.boomSeq || 0) + 1;
    me.boomX = me.x;
    me.boomY = me.y;
  }
  skillCdLeft = mySkill === 'boom' ? TAG_BOOM_CD : TAG_SKILL_CD;   // 쿨타임은 사용한 순간부터
  return true;
}


// 캔버스 클릭/터치: 스킬 선택 버튼 / 모바일 스킬 버튼. 처리했으면 true
function handleTagSkillClick(mx, my) {
  if (!isTagRunnerAlive()) return false;
  if (tag.phase === 'ready') {
    const r = skillPickRects();
    if (inBox(mx, my, r.invis)) { mySkill = 'invis'; return true; }
    if (inBox(mx, my, r.boost)) { mySkill = 'boost'; return true; }
    if (inBox(mx, my, r.boom)) { mySkill = 'boom'; return true; }
  } else if (tag.phase === 'playing' && mySkill && isMobile) {
    const b = skillBtnRect();
    if (dist(mx, my, b.x, b.y) < b.r) { useTagSkill(); return true; }
  }
  return false;
}


// 쿨타임 / 효과 시간은 내 것만 줄임 (다른 사람 값은 동기화 메시지로 받음)
function updateTagSkillTimers() {
  const dt = Math.min(deltaTime, 100) / 1000;
  if (skillCdLeft > 0) skillCdLeft = Math.max(0, skillCdLeft - dt);
  const me = players[myId];
  if (me) {
    if (me.invLeft > 0) me.invLeft = Math.max(0, me.invLeft - dt);
    if (me.boostLeft > 0) me.boostLeft = Math.max(0, me.boostLeft - dt);
  }
}


// iframe 게임 월드로 업그레이드/대쉬 요청 전달
function getGameWorldUpgradeState(p) {
  ensureLobbyEconomy(p);
  return {
    dashUnlocked: !!(p && p.lobbyDashUnlocked),
    speedUnlocked: !!(p && p.lobbySpeedUnlocked),
    speedMultiplier: p && p.lobbySpeedUnlocked ? LOBBY_SPEED_UPGRADE_MULT : 1,
    dashDistance: 85,
    dashDuration: 0.14,
    dashCooldown: LOBBY_DASH_COOLDOWN,
    jumpUnlocked: !!(p && p.lobbyJumpUnlocked),
    difficultyLevel: getLobbyDifficultyLevel(p),
    completedLaps: Math.max(0, Math.floor(Number(p && p.lobbyLaps) || 0))
  };
}


function sendGameWorldMessage(message) {
  try {
    const win = minigameIframe && minigameIframe.elt && minigameIframe.elt.contentWindow;
    if (win) win.postMessage(message, '*');
  } catch (e) {}
}


function sendGameWorldUpgrades() {
  const me = players[myId];
  if (!me) return;
  sendGameWorldMessage({ type: 'GAMEWORLD_UPGRADES', upgrades: getGameWorldUpgradeState(me) });
}


// 게임 월드 업그레이드 브리지를 메인 파일 안에 포함해 경로/404 오류를 방지한다.
// 따라서 minigame_world_upgrade_bridge.js를 별도로 불러오지 않아도 된다.
const GAMEWORLD_UPGRADE_BRIDGE_SOURCE = "// 게임 월드 업그레이드 연결 브리지\n// 메인 파일은 같은 폴더에서 이 스크립트를 minigame.html 안에 자동 삽입합니다.\n// 전역 p5.js 스케치에서 player/myPlayer/localPlayer/character/avatar 등의 객체를 찾으면\n// 속도 속성을 자동 적용하고, Shift 대쉬는 좌표 이동으로 처리합니다.\n(function installGameWorldUpgradeBridge() {\n  if (window.GameWorldUpgradeAPI) {\n    window.parent?.postMessage({ type: 'GAMEWORLD_READY' }, '*');\n    return;\n  }\n\n  const state = {\n    dashUnlocked: false,\n    speedUnlocked: false,\n    speedMultiplier: 1,\n    dashDistance: 85,\n    dashDuration: 0.14,\n    dashCooldown: 1,\n    jumpUnlocked: false,\n    dashReadyAt: 0,\n    difficultyLevel: 1,\n    completedLaps: 0\n  };\n  const heldKeys = new Set();\n  const originalSpeeds = new WeakMap();\n  let pendingDashRequests = 0;\n\n  const speedKeys = ['speed', 'moveSpeed', 'walkSpeed', 'baseSpeed', 'maxSpeed'];\n  const playerNameCandidates = ['player', 'myPlayer', 'localPlayer', 'character', 'avatar', 'me'];\n\n  function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }\n\n  function getPlayerCandidates() {\n    const result = [];\n    // top-level `let player` 같은 p5.js 전역 스케치 변수도 확인\n    try { if (typeof player !== 'undefined') result.push(player); } catch (_) {}\n    try { if (typeof myPlayer !== 'undefined') result.push(myPlayer); } catch (_) {}\n    try { if (typeof localPlayer !== 'undefined') result.push(localPlayer); } catch (_) {}\n    try { if (typeof character !== 'undefined') result.push(character); } catch (_) {}\n    try { if (typeof avatar !== 'undefined') result.push(avatar); } catch (_) {}\n    try { if (typeof me !== 'undefined') result.push(me); } catch (_) {}\n    for (const name of playerNameCandidates) {\n      try { if (window[name]) result.push(window[name]); } catch (_) {}\n    }\n    try {\n      if (window.players && window.myId && window.players[window.myId]) result.push(window.players[window.myId]);\n    } catch (_) {}\n    return [...new Set(result)].filter(v => v && typeof v === 'object');\n  }\n\n  function findPositionObject(p) {\n    if (!p || typeof p !== 'object') return null;\n    if (isFiniteNumber(p.x) && isFiniteNumber(p.y)) return p;\n    for (const k of ['position', 'pos', 'location']) {\n      const pos = p[k];\n      if (pos && isFiniteNumber(pos.x) && isFiniteNumber(pos.y)) return pos;\n    }\n    if (p.body && p.body.position && isFiniteNumber(p.body.position.x) && isFiniteNumber(p.body.position.y)) return p.body.position;\n    return null;\n  }\n\n  function findPlayer() {\n    const candidates = getPlayerCandidates();\n    return candidates.find(p => findPositionObject(p)) || null;\n  }\n\n  function applySpeedToKnownPlayers() {\n    const multiplier = state.speedUnlocked ? state.speedMultiplier : 1;\n    for (const p of getPlayerCandidates()) {\n      if (!p || typeof p !== 'object') continue;\n      let base = originalSpeeds.get(p);\n      if (!base) {\n        base = {};\n        for (const key of speedKeys) if (isFiniteNumber(p[key])) base[key] = p[key];\n        originalSpeeds.set(p, base);\n      }\n      for (const key of Object.keys(base)) {\n        try { p[key] = base[key] * multiplier; } catch (_) {}\n      }\n    }\n    // API 사용 방식으로 속도를 계산하는 스케치에서 사용할 multiplier\n    window.gameWorldSpeedMultiplier = multiplier;\n  }\n\n  function movementDirection(p) {\n    let dx = 0, dy = 0;\n    if (heldKeys.has('KeyW') || heldKeys.has('ArrowUp')) dy -= 1;\n    if (heldKeys.has('KeyS') || heldKeys.has('ArrowDown')) dy += 1;\n    if (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft')) dx -= 1;\n    if (heldKeys.has('KeyD') || heldKeys.has('ArrowRight')) dx += 1;\n    if (dx || dy) {\n      const len = Math.hypot(dx, dy) || 1;\n      return { x: dx / len, y: dy / len };\n    }\n    const a = Number(p && (p.angle ?? p.rotation ?? p.heading));\n    if (Number.isFinite(a)) return { x: Math.cos(a), y: Math.sin(a) };\n    return { x: 1, y: 0 };\n  }\n\n  function showDashWindEffect(direction) {\n    try {\n      const fx = document.createElement('div');\n      const angle = Math.atan2(direction.y, direction.x) * 180 / Math.PI;\n      fx.setAttribute('aria-hidden', 'true');\n      fx.style.cssText = 'position:fixed;left:50%;top:50%;width:150px;height:72px;z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%) rotate(' + angle + 'deg);';\n      fx.innerHTML = '<span style=\"position:absolute;left:12px;top:12px;width:105px;height:4px;border-radius:8px;background:rgba(125,211,252,.95);box-shadow:0 0 12px #38bdf8;transform:skewX(-28deg)\"></span><span style=\"position:absolute;left:0;top:32px;width:145px;height:5px;border-radius:8px;background:rgba(255,255,255,.95);box-shadow:0 0 14px #7dd3fc;transform:skewX(-28deg)\"></span><span style=\"position:absolute;left:25px;top:53px;width:95px;height:4px;border-radius:8px;background:rgba(56,189,248,.9);box-shadow:0 0 10px #38bdf8;transform:skewX(-28deg)\"></span>';\n      (document.body || document.documentElement).appendChild(fx);\n      setTimeout(() => fx.remove(), 260);\n    } catch (_) {}\n  }\n\n  function doDash() {\n    if (!state.dashUnlocked || Date.now() < state.dashReadyAt) return false;\n    state.dashReadyAt = Date.now() + state.dashCooldown * 1000;\n    const p = findPlayer();\n    let movedAutomatically = false;\n    let direction = { x: 1, y: 0 };\n    if (p) {\n      direction = movementDirection(p);\n      const pos = findPositionObject(p);\n      if (pos) {\n        // 85 월드 단위 대쉬. 충돌 처리 함수를 제공하는 게임은 아래 이벤트를 받아\n        // 자체 충돌 판정 방식으로 이동을 처리할 수도 있습니다.\n        pos.x += direction.x * state.dashDistance;\n        pos.y += direction.y * state.dashDistance;\n        movedAutomatically = true;\n      }\n    }\n    pendingDashRequests = Math.min(20, pendingDashRequests + 1);\n    const detail = {\n      distance: state.dashDistance,\n      duration: state.dashDuration,\n      cooldown: state.dashCooldown,\n      direction,\n      player: p,\n      automaticallyMoved: movedAutomatically\n    };\n    window.dispatchEvent(new CustomEvent('gameworld:dash-request', { detail }));\n    showDashWindEffect(direction);\n    return movedAutomatically;\n  }\n\n  function doJump() {\n    if (!state.jumpUnlocked) return false;\n    const p = findPlayer();\n    let applied = false;\n    if (p) {\n      try {\n        if (typeof p.jump === 'function') { p.jump(); applied = true; }\n        else if (p.body && p.body.velocity && isFiniteNumber(p.body.velocity.y)) { p.body.velocity.y = -Math.max(7, Math.abs(p.body.velocity.y)); applied = true; }\n        else if (p.velocity && isFiniteNumber(p.velocity.y)) { p.velocity.y = -Math.max(7, Math.abs(p.velocity.y)); applied = true; }\n        else if (isFiniteNumber(p.vy)) { p.vy = -Math.max(7, Math.abs(p.vy)); applied = true; }\n        else if (isFiniteNumber(p.verticalVelocity)) { p.verticalVelocity = -Math.max(7, Math.abs(p.verticalVelocity)); applied = true; }\n      } catch (_) {}\n    }\n    window.dispatchEvent(new CustomEvent('gameworld:jump-request', { detail: { player: p, appliedAutomatically: applied } }));\n    return applied;\n  }\n\n  function applyUpgrades(next) {\n    if (!next || typeof next !== 'object') return;\n    state.dashUnlocked = next.dashUnlocked === true;\n    state.speedUnlocked = next.speedUnlocked === true;\n    state.speedMultiplier = state.speedUnlocked\n      ? Math.max(1, Number(next.speedMultiplier) || 1.5)\n      : 1;\n    state.dashDistance = Math.max(1, Number(next.dashDistance) || 85);\n    state.dashDuration = Math.max(0.01, Number(next.dashDuration) || 0.14);\n    state.dashCooldown = Math.max(1, Number(next.dashCooldown) || 1);\n    state.jumpUnlocked = next.jumpUnlocked === true;\n    state.difficultyLevel = Math.max(1, Math.min(6, Math.floor(Number(next.difficultyLevel) || 1)));\n    state.completedLaps = Math.max(0, Math.floor(Number(next.completedLaps) || 0));\n    applySpeedToKnownPlayers();\n    window.dispatchEvent(new CustomEvent('gameworld:upgrades-changed', { detail: { ...state } }));\n  }\n\n  window.addEventListener('keydown', e => { if (e.code) heldKeys.add(e.code); }, true);\n  window.addEventListener('keyup', e => { if (e.code) heldKeys.delete(e.code); }, true);\n  window.addEventListener('blur', () => heldKeys.clear());\n\n  window.addEventListener('message', function (event) {\n    if (event.source !== window.parent || !event.data) return;\n    const data = event.data;\n    if (data.type === 'GAMEWORLD_UPGRADES') {\n      applyUpgrades(data.upgrades);\n    } else if (data.type === 'SYNC_PLAYERS' && data.gameWorldUpgrades) {\n      applyUpgrades(data.gameWorldUpgrades);\n    } else if (data.type === 'GAMEWORLD_DASH' && state.dashUnlocked) {\n      doDash();\n    } else if (data.type === 'GAMEWORLD_JUMP' && state.jumpUnlocked) {\n      doJump();\n    }\n  });\n\n  window.GameWorldUpgradeAPI = {\n    getState() { return { ...state }; },\n    getSpeedMultiplier() { return state.speedUnlocked ? state.speedMultiplier : 1; },\n    applySpeed(baseSpeed) { return Number(baseSpeed) * this.getSpeedMultiplier(); },\n    getDifficultyLevel() { return state.difficultyLevel; },\n    jumpPlayer(playerObject) {\n      if (!state.jumpUnlocked || !playerObject) return false;\n      if (typeof playerObject.jump === 'function') { playerObject.jump(); return true; }\n      if (playerObject.body && playerObject.body.velocity) { playerObject.body.velocity.y = -Math.max(7, Math.abs(Number(playerObject.body.velocity.y) || 0)); return true; }\n      if (playerObject.velocity && typeof playerObject.velocity.y === 'number') { playerObject.velocity.y = -Math.max(7, Math.abs(playerObject.velocity.y)); return true; }\n      if (typeof playerObject.vy === 'number') { playerObject.vy = -Math.max(7, Math.abs(playerObject.vy)); return true; }\n      return false;\n    },\n    consumeDashRequest() {\n      if (pendingDashRequests <= 0) return false;\n      pendingDashRequests -= 1;\n      return true;\n    },\n    dashPlayer(playerObject) {\n      if (!state.dashUnlocked || !playerObject) return false;\n      const pos = findPositionObject(playerObject);\n      if (!pos) return false;\n      const dir = movementDirection(playerObject);\n      pos.x += dir.x * state.dashDistance;\n      pos.y += dir.y * state.dashDistance;\n      return true;\n    }\n  };\n\n  // 현재 전역 플레이어가 아직 준비되지 않았더라도, 다음 프레임에 찾으면 속도를 반영합니다.\n  let lastApplyFrame = 0;\n  function monitorKnownPlayerSpeed() {\n    if (!state.speedUnlocked) return;\n    if (typeof window.requestAnimationFrame !== 'function') return;\n    const tick = () => {\n      if (window.GameWorldUpgradeAPI) applySpeedToKnownPlayers();\n      window.requestAnimationFrame(tick);\n    };\n    if (!lastApplyFrame) {\n      lastApplyFrame = 1;\n      window.requestAnimationFrame(tick);\n    }\n  }\n  monitorKnownPlayerSpeed();\n\n  window.parent?.postMessage({ type: 'GAMEWORLD_READY' }, '*');\n})();\n";


function injectMinigameUpgradeBridge() {
  try {
    const frame = minigameIframe && minigameIframe.elt;
    const doc = frame && frame.contentDocument;
    if (!doc || !doc.head) return false;
    if (doc.getElementById('gameworld-upgrade-bridge-script')) {
      sendGameWorldUpgrades();
      return true;
    }


    const script = doc.createElement('script');
    script.id = 'gameworld-upgrade-bridge-script';
    script.textContent = GAMEWORLD_UPGRADE_BRIDGE_SOURCE;
    doc.head.appendChild(script);
    sendGameWorldUpgrades();
    return true;
  } catch (e) {
    console.error('게임 월드 업그레이드 연결 실패:', e);
    return false;
  }
}


function installMinigameUpgradeControls() {
  try {
    const childWin = minigameIframe && minigameIframe.elt && minigameIframe.elt.contentWindow;
    if (!childWin) return;
    if (minigameKeydownHandler) {
      try { childWin.removeEventListener('keydown', minigameKeydownHandler, true); } catch (e) {}
    }
    minigameKeydownHandler = (e) => {
      const me = players[myId];
      if (!me || !me.inMinigame || e.repeat) return;
      if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        ensureLobbyEconomy(me);
        if (!me.lobbyDashUnlocked) return;
        e.preventDefault();
        if (Date.now() < gameWorldDashCooldownUntil) return;
        gameWorldDashCooldownUntil = Date.now() + LOBBY_DASH_COOLDOWN * 1000;
        sendGameWorldMessage({ type: 'GAMEWORLD_DASH', requestedAt: Date.now(), distance: 85, duration: 0.14, cooldown: LOBBY_DASH_COOLDOWN, direction: 'current-movement-or-facing' });
      } else if (e.code === 'Space' && !e.repeat) {
        ensureLobbyEconomy(me);
        if (!me.lobbyJumpUnlocked) return;
        e.preventDefault();
        sendGameWorldMessage({ type: 'GAMEWORLD_JUMP', requestedAt: Date.now() });
      }
    };
    childWin.addEventListener('keydown', minigameKeydownHandler, true);
  } catch (e) {}
}


// Space를 누르면 공중 상태가 시작됨. 공중에 있는 동안 moveWithWalls가 벽 충돌을 무시함.
function startLobbyJump() {
  const me = players[myId];
  if (myRole === '' || !me || me.inMinigame || tag.phase !== 'off' || tagMoveLocked() || lobbyShopOpen) return false;
  ensureLobbyEconomy(me);
  if (!me.lobbyJumpUnlocked) {
    setLobbyNotice(me, '🛒 B 상점에서 30코인으로 점프를 구매하세요!', 1900);
    return false;
  }


  const now = Date.now();
  if (Number(me.lobbyJumpUntil || 0) > now) return false; // 공중에서 연속 점프 방지
  me.lobbyJumpStartedAt = now;
  me.lobbyJumpUntil = now + LOBBY_JUMP_DURATION_MS;
  return true;
}


// Shift를 누른 순간 대쉬 방향을 정함. 구매 후 로비에서 1초 쿨타임으로 사용 가능.
function startLobbyDash() {
  const me = players[myId];
  if (myRole === '' || !me || me.inMinigame || tag.phase !== 'off' || tagMoveLocked()) return false;
  ensureLobbyEconomy(me);
  if (!me.lobbyDashUnlocked) {
    setLobbyNotice(me, '🛒 B 상점에서 20코인으로 대쉬를 구매하세요!', 1900);
    return false;
  }
  const now = Date.now();
  if (now < lobbyDashCooldownUntil) {
    setLobbyNotice(me, '⚡ 대쉬 쿨타임 ' + ((lobbyDashCooldownUntil - now) / 1000).toFixed(1) + '초', 700);
    return false;
  }


  let dx = 0;
  let dy = 0;
  if (isHeld('KeyW') || isHeld('ArrowUp')) dy -= 1;
  if (isHeld('KeyS') || isHeld('ArrowDown')) dy += 1;
  if (isHeld('KeyA') || isHeld('ArrowLeft')) dx -= 1;
  if (isHeld('KeyD') || isHeld('ArrowRight')) dx += 1;
  if (isMobile && (joystickMove.x !== 0 || joystickMove.y !== 0)) {
    dx = joystickMove.x;
    dy = joystickMove.y;
  }


  if (dx === 0 && dy === 0) {
    dx = cos(playerAngle);
    dy = sin(playerAngle);
  }


  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  lobbyDashDir = { x: dx / len, y: dy / len };
  playerAngle = Math.atan2(lobbyDashDir.y, lobbyDashDir.x);
  lobbyDashSpeed = LOBBY_DASH_DISTANCE / LOBBY_DASH_DURATION;
  lobbyDashLeft = LOBBY_DASH_DURATION;
  lobbyDashCooldownUntil = now + LOBBY_DASH_COOLDOWN * 1000;
  lobbyDashEffectUntil = now + 360;
  return true;
}


// 대쉬도 기존 벽 충돌을 유지하도록 이동량을 작은 구간으로 나눔.
function moveDashWithWalls(p, dx, dy) {
  const distance = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(distance / 4));
  const stepX = dx / steps;
  const stepY = dy / steps;
  for (let i = 0; i < steps; i++) {
    const oldX = p.x;
    const oldY = p.y;
    moveWithWalls(p, stepX, stepY);
    if (p.x === oldX && p.y === oldY) break;
  }
}


function drawSkillBtn(b, title, sub, on) {
  push();
  rectMode(CORNER);
  strokeWeight(2);
  if (on) { fill(251, 191, 36, 235); stroke(254, 240, 138); }
  else { fill(15, 23, 42, 235); stroke(100, 116, 139); }
  rect(b.x, b.y, b.w, b.h, 12);
  noStroke();
  fill(on ? 15 : 255, on ? 23 : 255, on ? 42 : 255);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(13);
  text(title, b.x + b.w / 2, b.y + b.h / 2 - 8);
  textStyle(NORMAL);
  textSize(10);
  text(sub, b.x + b.w / 2, b.y + b.h / 2 + 10);
  pop();
}


// 게임 중 도망자 하단 스킬 상태 줄 + 모바일 스킬 버튼
function drawTagSkillHUD() {
  if (tag.phase === 'playing' && tag.it === myId && tag.itStun > 0) {
    push();
    textAlign(CENTER, CENTER);
    textSize(14);
    textStyle(BOLD);
    fill(147, 197, 253);
    text('💥 폭발에 맞아 정지! ' + Math.ceil(tag.itStun) + '초', width / 2, height - 40);
    pop();
  }
  if (tag.phase !== 'playing' || !isTagRunnerAlive()) return;
  const me = players[myId];
  const active = me.invLeft > 0 || me.boostLeft > 0;


  let s;
  if (!mySkill) s = '스킬 없음';
  else if (active) s = skillName(mySkill) + ' 사용 중!';
  else if (skillCdLeft > 0) s = skillName(mySkill) + ' 쿨타임 ' + Math.ceil(skillCdLeft) + '초';
  else s = skillName(mySkill) + ' 준비됨 — ' + (isMobile ? '스킬 버튼' : 'Shift') + '으로 사용';


  push();
  rectMode(CORNER);
  const tw = min(width - 20, 340);
  noStroke();
  fill(15, 23, 42, 230);
  rect(width / 2 - tw / 2, height - 34, tw, 26, 13);
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(12);
  textStyle(BOLD);
  text(s, width / 2, height - 21);


  if (isMobile && mySkill) {
    const b = skillBtnRect();
    const ready = !active && skillCdLeft <= 0;
    stroke(255);
    strokeWeight(2);
    fill(ready ? color(251, 191, 36, 230) : color(50, 50, 60, 200));
    ellipse(b.x, b.y, b.r * 2);
    noStroke();
    fill(ready ? 15 : 255);
    textSize(12);
    text(ready ? '스킬' : (active ? '사용중' : Math.ceil(skillCdLeft) + 's'), b.x, b.y);
  }
  pop();
}


// =====================================================
// 💥 폭발 스킬 처리
//   - 방장이 판정: 반경 안 벽 파괴 + 반경 안 술래 정지 → tag 상태로 전원에게 동기화
//   - 각 기기는 폭발 번호(boomSeq)가 바뀐 것을 보고 연출만 재생
// =====================================================
const boomSeen = {};     // 방장 전용: 사람별로 마지막에 판정한 폭발 번호
const boomFxSeen = {};   // 각 기기: 연출을 이미 재생한 폭발 번호
let tagBoomFx = [];      // 진행 중인 폭발 연출 {x, y, t0}
const TAG_BOOM_FX_MS = 600;


function isWallBroken(wi) {
  return !!(tag.broken && tag.broken.includes(wi));
}


// 방장 전용: 폭발 한 번 판정
function applyTagBoom(x, y) {
  if (tag.phase !== 'playing') return;
  if (!tag.broken) tag.broken = [];
  TAG_WALLS.forEach((w, wi) => {
    if (tag.broken.includes(wi)) return;
    const cx = constrain(x, w.x, w.x + w.w);
    const cy = constrain(y, w.y, w.y + w.h);
    if (dist(x, y, cx, cy) < TAG_BOOM_R) tag.broken.push(wi);
  });
  const it = players[tag.it];
  if (it && dist(x, y, it.x || 0, it.y || 0) < TAG_BOOM_R) tag.itStun = TAG_BOOM_STUN;
}


// 방장 전용: 모든 사람(방장 포함)의 폭발 번호가 올라갔는지 확인
function processTagBooms() {
  for (const id in players) {
    const p = players[id];
    if (!p || !p.boomSeq) continue;
    const seen = boomSeen[id] || 0;
    if (p.boomSeq > seen) {
      boomSeen[id] = p.boomSeq;
      applyTagBoom(p.boomX || 0, p.boomY || 0);
    }
  }
}


// 각 기기: 새 폭발을 감지해 연출 등록 (처음 보는 사람의 기존 번호는 무시)
function updateBoomFx() {
  for (const id in players) {
    const p = players[id];
    if (!p) continue;
    const seq = p.boomSeq || 0;
    if (boomFxSeen[id] === undefined) { boomFxSeen[id] = seq; continue; }
    if (seq > boomFxSeen[id]) {
      boomFxSeen[id] = seq;
      tagBoomFx.push({ x: p.boomX || 0, y: p.boomY || 0, t0: millis() });
    }
  }
}


function drawTagBoomFx() {
  const now = millis();
  for (const fx of tagBoomFx) {
    const t = (now - fx.t0) / TAG_BOOM_FX_MS;
    if (t < 0 || t >= 1) continue;
    const e = 1 - Math.pow(1 - t, 3);
    push();
    translate(fx.x, fx.y);
    // 채워진 폭발 구체 (주황)
    noStroke();
    fill(255, 160, 40, 90 * (1 - t));
    ellipse(0, 0, TAG_BOOM_R * 2 * e);
    // 충격파 링
    noFill();
    stroke(255, 200, 80, 220 * (1 - t));
    strokeWeight(6 * (1 - t) + 1);
    ellipse(0, 0, TAG_BOOM_R * 2 * e);
    // 파편
    noStroke();
    fill(120, 110, 100, 220 * (1 - t));
    rectMode(CENTER);
    for (let i = 0; i < 10; i++) {
      const ang = i * (TWO_PI / 10) + 0.4;
      const d = TAG_BOOM_R * 0.9 * e;
      rect(cos(ang) * d, sin(ang) * d, 6, 6);
    }
    pop();
  }
  tagBoomFx = tagBoomFx.filter(fx => now - fx.t0 < TAG_BOOM_FX_MS);
}


// =====================================================
// 🎵 배경음악 (Web Audio로 직접 만든 루프 - 외부 파일 필요 없음)
//   - 평소: 차분한 메인 테마 / 술래잡기 중: 빠른 긴장 테마
//   - 브라우저 정책상 화면을 한 번 클릭하거나 키를 누른 뒤부터 재생됨
// =====================================================
const BGM_VOL = 0.22;
const BGM_MAIN = {
  bpm: 110,
  mel: [
    [69, 72, 76, 72, 69, 67, 69, 72],   // Am
    [65, 69, 72, 69, 65, 64, 65, 69],   // F
    [67, 72, 76, 72, 67, 64, 67, 72],   // C
    [62, 67, 71, 67, 62, 59, 62, 67]    // G
  ],
  bass: [45, 41, 48, 43],               // 마디별 루트
  melType: 'triangle', melGain: 0.09, drums: false
};
const BGM_TAG = {
  bpm: 150,
  mel: [
    [64, 67, 71, 67, 64, 62, 64, 67],   // Em
    [60, 64, 67, 64, 60, 59, 60, 64],   // C
    [62, 66, 69, 66, 62, 61, 62, 66],   // D
    [59, 62, 66, 62, 59, 57, 59, 62]    // Bm
  ],
  bass: [40, 36, 38, 35],
  melType: 'square', melGain: 0.045, drums: true
};


const bgm = {
  ctx: null, master: null, noise: null,
  enabled: true, track: BGM_MAIN,
  step: 0, nextT: 0, timer: null
};


function midiFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}


function bgmEnsureCtx() {
  if (bgm.ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  bgm.ctx = new AC();
  bgm.master = bgm.ctx.createGain();
  bgm.master.gain.value = bgm.enabled ? BGM_VOL : 0;
  bgm.master.connect(bgm.ctx.destination);
  // 하이햇용 노이즈 버퍼 (한 번만 만듦)
  const len = Math.floor(bgm.ctx.sampleRate * 0.05);
  bgm.noise = bgm.ctx.createBuffer(1, len, bgm.ctx.sampleRate);
  const d = bgm.noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return true;
}


function bgmTone(freq, t, dur, type, gain) {
  const o = bgm.ctx.createOscillator();
  const g = bgm.ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(bgm.master);
  o.start(t);
  o.stop(t + dur + 0.02);
}


function bgmHat(t, gain) {
  const s = bgm.ctx.createBufferSource();
  const f = bgm.ctx.createBiquadFilter();
  const g = bgm.ctx.createGain();
  s.buffer = bgm.noise;
  f.type = 'highpass';
  f.frequency.value = 7000;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  s.connect(f);
  f.connect(g);
  g.connect(bgm.master);
  s.start(t);
  s.stop(t + 0.05);
}


function bgmKick(t) {
  const o = bgm.ctx.createOscillator();
  const g = bgm.ctx.createGain();
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  o.connect(g);
  g.connect(bgm.master);
  o.start(t);
  o.stop(t + 0.2);
}


// 8분음표 한 칸 연주 (마디 4개 = 32칸 반복)
function bgmScheduleStep(track, step, t, eighth) {
  const bar = Math.floor(step / 8) % 4;
  const idx = step % 8;
  bgmTone(midiFreq(track.mel[bar][idx]), t, eighth * 0.9, track.melType, track.melGain);
  if (idx % 2 === 0) {
    const root = track.bass[bar];
    const n = idx % 4 === 0 ? root : root + 12;
    bgmTone(midiFreq(n), t, eighth * 1.8, 'triangle', 0.12);
  }
  if (track.drums) {
    if (idx % 4 === 0) bgmKick(t);
    if (idx % 2 === 1) bgmHat(t, 0.06);
  }
}


// 미리 예약하는 방식 (타이머가 조금 늦어도 박자가 흔들리지 않음)
function bgmPump() {
  if (!bgm.ctx) return;
  const eighth = 60 / bgm.track.bpm / 2;
  while (bgm.nextT < bgm.ctx.currentTime + 0.15) {
    bgmScheduleStep(bgm.track, bgm.step, bgm.nextT, eighth);
    bgm.nextT += eighth;
    bgm.step++;
  }
}


function bgmStart() {
  if (!bgmEnsureCtx()) return;
  if (bgm.ctx.state === 'suspended') bgm.ctx.resume();
  if (!bgm.timer) {
    bgm.nextT = bgm.ctx.currentTime + 0.1;
    bgm.timer = setInterval(bgmPump, 40);
  }
}


// 현재 상태(메인 / 술래잡기)에 맞는 곡 선택
function bgmSync() {
  bgm.track = tag.phase !== 'off' ? BGM_TAG : BGM_MAIN;
}


function bgmToggle() {
  bgm.enabled = !bgm.enabled;
  if (bgm.enabled) bgmStart();
  if (bgm.master) bgm.master.gain.setTargetAtTime(bgm.enabled ? BGM_VOL : 0, bgm.ctx.currentTime, 0.05);
  const b = document.getElementById('tb-bgm');
  if (b) {
    b.style.opacity = bgm.enabled ? '1' : '0.4';
    b.title = bgm.enabled ? '배경음악 끄기' : '배경음악 켜기';
  }
}


// 첫 클릭 / 키 입력 때 음악 시작 (브라우저 자동재생 정책 대응)
function bgmInstallUnlock() {
  const go = () => bgmStart();
  window.addEventListener('pointerdown', go, { once: true });
  window.addEventListener('keydown', go, { once: true });
}


function drawTagHUD() {
  if (tag.phase === 'off') return;
  const me = players[myId];
  const runners = Object.keys(players).filter(id => id !== tag.it);
  const alive = runners.filter(id => !tag.out[id]);
  const cx = width / 2, cy = height / 2;


  push();
  textAlign(CENTER, CENTER);
  noStroke();


  // --- 단계별 중앙 연출 ---
  if (tag.phase === 'draw') {
    fill(0, 0, 0, 170); rect(0, 0, width, height);
    const elapsed = millis() - tagDrawStart;
    fill(255); textStyle(BOLD); textSize(16);
    text('🎲 술래를 뽑는 중...', cx, cy - 70);
    if (elapsed < 2500) {
      const names = Object.keys(players).map(id => tagNameOf(id));
      if (names.length) {
        const idx = Math.floor(Math.pow(elapsed / 1000, 0.6) * 14) % names.length;
        fill(255); textSize(min(40, width / 12));
        text(names[idx], cx, cy);
      }
    } else {
      fill(252, 165, 165); textSize(14);
      text('🎯 술래 결정!', cx, cy - 30);
      fill(239, 68, 68); textSize(min(44, width / 11));
      text(tagNameOf(tag.it), cx, cy + 15);
    }


  } else if (tag.phase === 'ready') {
    fill(0, 0, 0, 90); rect(0, 0, width, height);
    fill(255); textStyle(BOLD); textSize(min(90, height / 4));
    text(Math.max(1, Math.ceil(tag.timeLeft)), cx, cy - 10);
    textSize(16);
    const msg = tag.it === myId ? '당신이 술래예요! 카운트다운 후 출발!'
              : (tag.out[myId] ? '관전 중이에요' : '도망치세요! 술래가 곧 움직여요');
    text(msg, cx, cy + 55);


    // 🎒 도망자 스킬 선택 (카운트다운 안에 고르지 않으면 스킬 없음)
    if (isTagRunnerAlive()) {
      const r = skillPickRects();
      fill(255); textStyle(BOLD); textSize(12);
      text(mySkill
        ? '선택: ' + skillName(mySkill) + ' · 게임 중 ' + (isMobile ? '스킬 버튼' : 'Shift') + '으로 사용'
        : '스킬을 고르세요! 카운트다운 안에 안 고르면 스킬 없음',
        cx, r.invis.y - 14);
      drawSkillBtn(r.invis, '👻 투명인간', '5초 투명', mySkill === 'invis');
      drawSkillBtn(r.boost, '💨 가속', '1.25배 5초', mySkill === 'boost');
      drawSkillBtn(r.boom, '💥 폭발', '벽파괴·정지5초', mySkill === 'boom');
    }


  } else if (tag.phase === 'ended') {
    const pw = min(width - 30, 380), ph = 170;
    fill(15, 23, 42, 235); stroke(250, 204, 21); strokeWeight(3);
    rect(cx - pw / 2, cy - ph / 2, pw, ph, 20);
    noStroke(); textStyle(BOLD);
    fill(250, 204, 21); textSize(22);
    const title = tag.winner === 'tagger' ? '🔴 술래 승리!' : (tag.winner === 'runners' ? '🏃 도망자 승리!' : '🏁 게임 종료');
    text(title, cx, cy - 55);
    fill(255); textSize(13); textStyle(NORMAL);
    text(tag.reason || '', cx, cy - 25);
    if (tag.winner === 'runners' && alive.length) {
      let names = alive.map(id => tagNameOf(id)).join(', ');
      if (names.length > 36) names = names.substring(0, 36) + '…';
      fill(190, 242, 100); textSize(12);
      text('생존: ' + names, cx, cy + 5);
    }
    fill(148, 163, 184); textSize(12);
    text(Math.max(1, Math.ceil(tag.timeLeft)) + '초 후 원래 월드로 돌아갑니다', cx, cy + 50);
  }


  // --- 상단 정보 바 ---
  const barW = min(width - 20, 440);
  fill(15, 23, 42, 230); stroke(239, 68, 68); strokeWeight(2);
  rect(width / 2 - barW / 2, 10, barW, 48, 16);
  noStroke(); textStyle(BOLD); textSize(13); fill(255, 255, 0);
  let title = '🏁 게임 종료';
  if (tag.phase === 'draw') title = '🎲 술래 뽑는 중...';
  else if (tag.phase === 'ready') title = '⏳ ' + Math.max(1, Math.ceil(tag.timeLeft)) + '초 후 시작!';
  else if (tag.phase === 'playing') title = '🏃 술래잡기 진행중   ⏱ ' + fmtTagTime(tag.timeLeft);
  text(title, width / 2, 26);
  fill(255); textSize(11); textStyle(NORMAL);
  text('🔴 술래: ' + tagNameOf(tag.it) + '   |   생존 ' + alive.length + ' / ' + runners.length, width / 2, 44);


  // --- 내 상태 안내 ---
  if (tag.phase === 'playing' && me) {
    textStyle(BOLD); textSize(12);
    if (tag.it === myId) { fill(239, 68, 68); text('🔴 당신은 술래! 도망자를 잡으세요', width / 2, 74); }
    else if (tag.out[myId]) { fill(203, 213, 225); text('💀 탈락했어요 — 관전 중', width / 2, 74); }
    else if (inTagVine(me.x, me.y)) { fill(134, 239, 172); text('🌿 덩굴 속 은신 중 — 술래 눈에 보이지 않아요', width / 2, 74); }
  }
  pop();
}


// =====================================================
// 💬 채팅 (PeerJS 는 메인 페이지가 담당, chat.html 은 iframe 으로 postMessage 통신)
// =====================================================
function sanitizeChatText(v) {
  if (typeof v !== 'string') return '';
  const clean = v
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, CHAT_MAX_LEN).join('');
}

function createChatFrame() {
  chatFrame = document.createElement('iframe');
  chatFrame.id = 'chat-frame';
  chatFrame.src = 'chat.html';
  chatFrame.style.cssText =
    'position:fixed;right:12px;top:60px;width:min(320px,calc(100vw - 24px));' +
    'height:min(420px,60vh);border:1px solid #334155;border-radius:14px;' +
    'background:#0f172a;z-index:2000;display:none;box-shadow:0 10px 30px rgba(0,0,0,.5);';
  document.body.appendChild(chatFrame);

  // 채팅창(iframe) → 메인
  window.addEventListener('message', (e) => {
    if (!chatFrame || e.source !== chatFrame.contentWindow || !e.data) return;
    if (e.data.type === 'CHAT_SEND') sendChatMessage(e.data.text);
    else if (e.data.type === 'CHAT_CLOSE') closeChat();
  });
}

function isChatOpen() {
  return !!chatFrame && chatFrame.style.display !== 'none';
}
function openChat() {
  if (!chatFrame) return;
  clearHeldKeys();
  chatFrame.style.display = 'block';
  chatFrame.contentWindow.postMessage({ type: 'CHAT_OPEN' }, '*');
}
function closeChat() {
  if (!chatFrame) return;
  // 숨기기 전에 iframe 안의 포커스부터 풀어야 키 입력이 메인 페이지로 돌아온다
  try { chatFrame.contentWindow.postMessage({ type: 'CHAT_BLUR' }, '*'); } catch (e) {}
  chatFrame.style.display = 'none';
  focusMainPage();
}
function toggleChat() {
  if (isChatOpen()) closeChat(); else openChat();
  const b = document.getElementById('tb-chat');
  if (b) b.blur();
}

function sendChatMessage(raw) {
  if (myRole === '' || !players[myId]) return;
  const text = sanitizeChatText(raw);
  if (!text) return;
  const msg = {
    t: 'C',
    mid: myId + '-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
    from: myId,
    name: displayNameOf(myId, players[myId]),
    text
  };
  handleChatMessage(msg, null);                            // 내 화면에 먼저 표시
  connections.forEach(c => { if (c.open) c.send(msg); });  // 방장이면 전원, 게스트면 방장에게
}

// fromConn: 받은 연결 (내가 보낸 메시지는 null)
function handleChatMessage(msg, fromConn) {
  if (!msg || typeof msg.mid !== 'string' || typeof msg.from !== 'string') return;
  if (chatSeen.has(msg.mid)) return;
  chatSeen.add(msg.mid);
  if (chatSeen.size > 300) chatSeen.clear();

  const text = sanitizeChatText(msg.text);
  if (!text) return;
  const from = msg.from;
  const name = sanitizeNick(msg.name) || from.substring(0, 5);
  const mine = from === myId;

  // 방장: 게스트가 보낸 메시지를 나머지 참가자에게 중계 (보낸 사람 제외)
  if (fromConn && myRole === 'host') {
    connections.forEach(c => { if (c !== fromConn && c.open) c.send(msg); });
  }

  chatBubbles[from] = { text, until: Date.now() + CHAT_BUBBLE_MS };
  // 미니게임 화면에도 같은 말풍선 표시
  if (minigameIframe && minigameIframe.elt && minigameIframe.elt.contentWindow) {
    minigameIframe.elt.contentWindow.postMessage({ type: 'CHAT_BUBBLE', from: from, text: text }, '*');
  }
  if (chatFrame && chatFrame.contentWindow) {
    chatFrame.contentWindow.postMessage({ type: 'CHAT_MSG', name, text, mine }, '*');
  }
}

function drawChatBubble(msg, cy) {
  push();
  rectMode(CENTER);
  textAlign(CENTER, CENTER);
  textStyle(NORMAL);
  textSize(11);
  const w = textWidth(msg) + 16;
  noStroke();
  fill(255, 255, 255, 235);
  rect(0, cy, w, 22, 8);
  fill(15, 23, 42);
  text(msg, 0, cy);
  pop();
}