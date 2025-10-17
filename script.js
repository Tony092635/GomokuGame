/* Canvas 版五子棋（高级版）
   - 15x15 棋盘
   - Canvas绘制格线、棋子阴影、落子动画、最后一步高亮
   - 功能：落子、轮次、胜负判定、悔棋/重做、重开、AI（可选、轻量）
   - 注释较全，便于扩展
*/

const BOARD_SIZE = 15;
const CELL_SIZE = 40;            // 每格像素
const PADDING = 20;             // 画布内边距
const CANVAS_SIZE = PADDING*2 + CELL_SIZE * (BOARD_SIZE - 1); // 画布应覆盖格线坐标
// 注意：我们将格点定义为交叉点（15x15点），cell之间间距CELL_SIZE

// DOM
const canvas = document.getElementById('boardCanvas');
const ctx = canvas.getContext('2d');
canvas.width = CANVAS_SIZE + 40; // 留白以美观
canvas.height = CANVAS_SIZE + 40;

const turnInfoEl = document.getElementById('turn-info');
const statusEl = document.getElementById('game-status');

const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const restartBtn = document.getElementById('restartBtn');
const aiToggle = document.getElementById('aiToggle');
const aiLevelSel = document.getElementById('aiLevel');
const firstMoveRadios = document.getElementsByName('firstMove');

// 游戏状态
let board = [];                 // board[r][c] 0 = 空, 1 = 黑, 2 = 白
let currentPlayer = 1;          // 1=黑, 2=白
let moveHistory = [];           // {r,c,player}
let redoStack = [];
let gameOver = false;

// 动画状态
let animatingStones = [];       // 动画棋子：{r, c, player, startTime, duration}

// UI 状态
let aiEnabled = false;
let aiLevel = 'normal';
let playerIsFirst = true;

// 初始化
function init() {
  board = Array.from({length: BOARD_SIZE}, () => Array(BOARD_SIZE).fill(0));
  currentPlayer = 1;
  moveHistory = [];
  redoStack = [];
  gameOver = false;
  animatingStones = [];
  updateStatus();

  draw(); // 绘制棋盘

  if (aiEnabled && !playerIsFirst) {
    setTimeout(() => aiMove(), 300); // AI先手
  }
}

// 将鼠标坐标转换为棋点（最近交点）
function getGridCoordFromMouse(x, y) {
  const rect = canvas.getBoundingClientRect();
  const mx = x - rect.left - 20;
  const my = y - rect.top - 20;
  const fr = Math.round(mx / CELL_SIZE);
  const fc = Math.round(my / CELL_SIZE);
  if (fr < 0 || fr >= BOARD_SIZE || fc < 0 || fc >= BOARD_SIZE) return null;
  return { r: fr, c: fc };
}

// 将棋盘位置转换为画布坐标
function gridToCanvas(r, c) {
  const x = 20 + r * CELL_SIZE;
  const y = 20 + c * CELL_SIZE;
  return { x, y };
}

// 绘制棋盘和格线
function drawBoardBase() {
  ctx.clearRect(0, 0, canvas.width, canvas.height); // 清空画布

  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#e9cf9a');
  g.addColorStop(1, '#d8b36f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#6b4a2a';
  ctx.lineWidth = 4;
  roundRect(ctx, 10, 10, CANVAS_SIZE + 20, CANVAS_SIZE + 20, 8, false, true); // 边框

  ctx.strokeStyle = '#6b4a2a';
  ctx.lineWidth = 1;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const x = 20 + i * CELL_SIZE;
    const y0 = 20;
    const y1 = 20 + (BOARD_SIZE - 1) * CELL_SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
    const y = 20 + i * CELL_SIZE;
    const x0 = 20;
    const x1 = 20 + (BOARD_SIZE - 1) * CELL_SIZE;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
}

// 绘制已落子的棋子
function drawStaticStones() {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const v = board[r][c];
      if (v !== 0) {
        const animIndex = animatingStones.findIndex(a => a.r === r && a.c === c);
        if (animIndex === -1) {
          drawStone(r, c, v, 1.0, false); // 已完成棋子
        }
      }
    }
  }
}

// 绘制棋子：r,c,player,scale(0..1),highlight
function drawStone(r, c, player, scale = 1.0, highlight = false) {
  const {x, y} = gridToCanvas(r, c);
  const radius = CELL_SIZE * 0.38 * scale;

  // 阴影
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y + 4, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.fill();
  ctx.restore();

  // 棋子主体
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (player === 1) {
    const g = ctx.createRadialGradient(x - radius * 0.4, y - radius * 0.4, radius * 0.1, x, y, radius);
    g.addColorStop(0, '#4a4a4a');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.fill();
  } else {
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#bbb';
    ctx.stroke();
  }

  // 高亮显示最后一步（一个环）
  if (highlight) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 80, 0, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// 绘制动画棋子（根据时间插值）
function drawAnimatingStones(timeNow) {
  for (let i = animatingStones.length - 1; i >= 0; i--) {
    const a = animatingStones[i];
    const t = Math.min(1, (timeNow - a.startTime) / a.duration);
    const scale = easeOutBack(t);
    drawStone(a.r, a.c, a.player, scale, true);
    if (t >= 1) {
      animatingStones.splice(i, 1);
    }
  }
}

// Easing 函数，用于动画
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// 绘制棋盘的完整函数
function draw(timestamp) {
  if (!timestamp) timestamp = performance.now();
  const now = timestamp;

  // 绘制背景（底层）
  drawBoardBase();

  // 绘制静态棋子（不含动画）
  drawStaticStones();

  // 绘制动画棋子
  drawAnimatingStones(now);

  // 高亮最后一步棋子
  if (moveHistory.length > 0) {
    const last = moveHistory[moveHistory.length - 1];
    const inAnim = animatingStones.some(a => a.r === last.r && a.c === last.c);
    if (!inAnim) {
      const { x, y } = gridToCanvas(last.r, last.c);
      ctx.beginPath();
      ctx.arc(x, y, CELL_SIZE * 0.38 + 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 80, 0, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  requestAnimationFrame(draw); // 循环更新动画
}

// 为了更好的动画效果，可以通过点击事件来控制
canvas.addEventListener('click', (e) => {
  if (gameOver) return;
  const pt = getGridCoordFromMouse(e.clientX, e.clientY);
  if (!pt) return;
  const { r, c } = pt;
  if (aiEnabled && currentPlayer === AI_PLAYER) return; // AI 回合无法点击

  if (placeMove(r, c, currentPlayer)) {
    if (aiEnabled && !gameOver) {
      setTimeout(() => aiMove(), 200);
    }
  }
});

// 处理悔棋
function undo() {
  if (moveHistory.length === 0) return;
  const last = moveHistory.pop();
  board[last.r][last.c] = 0;
  redoStack.push(last);
  currentPlayer = last.player;
  gameOver = false;
  updateStatus();
}
undoBtn.addEventListener('click', undo);

// 处理重做
function redo() {
  if (redoStack.length === 0) return;
  const mv = redoStack.pop();
  board[mv.r][mv.c] = mv.player;
  moveHistory.push(mv);
  currentPlayer = mv.player === 1 ? 2 : 1;
  animatingStones.push({
    r: mv.r, c: mv.c, player: mv.player,
    startTime: performance.now(),
    duration: 300
  });
  updateStatus();
}
redoBtn.addEventListener('click', redo);

// 重新开始
restartBtn.addEventListener('click', () => {
  init();
});

// 更新状态
function updateStatus(message = null) {
  if (message) {
    statusEl.textContent = message;
    turnInfoEl.textContent = '';
  } else if (gameOver) {
    statusEl.textContent = '游戏已结束';
    turnInfoEl.textContent = '';
  } else {
    turnInfoEl.textContent = `当前轮到：${currentPlayer === 1 ? '黑棋' : '白棋'}`;
    statusEl.textContent = aiEnabled ? `模式：AI（${aiLevel}） | 玩家${playerIsFirst ? '先手' : '后手'}` : '模式：玩家对战';
  }
}

// 游戏初始化时执行
init();
requestAnimationFrame(draw);
