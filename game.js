(() => {
  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const $score = document.getElementById("score");
  const $best = document.getElementById("best");
  const $speed = document.getElementById("speed");
  const $overlay = document.getElementById("overlay");
  const $overlayTitle = document.getElementById("overlayTitle");
  const $overlaySub = document.getElementById("overlaySub");
  const $board = document.getElementById("board");
  const $playerName = document.getElementById("playerName");
  const $submitScore = document.getElementById("submitScore");
  const $refreshBoard = document.getElementById("refreshBoard");
  const $netHint = document.getElementById("netHint");
  const $tabAll = document.getElementById("tabAll");
  const $tabDaily = document.getElementById("tabDaily");
  const $tabWeekly = document.getElementById("tabWeekly");

  const W = canvas.width;
  const H = canvas.height;

  const GROUND_Y = 205;
  const GRAVITY = 2400; // px/s^2
  const JUMP_V0 = 760; // px/s
  const FAST_FALL = 3600; // px/s^2 추가 하강

  const COLORS = {
    sky: "#ffffff",
    ink: "#111827",
    muted: "#6b7280",
    ground: "#111827",
    groundShadow: "#e5e7eb",
    cactus: "#111827",
    bird: "#111827",
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const now = () => performance.now();

  const bestKey = "dinoish_best_v1";
  const readBest = () => {
    const n = Number(localStorage.getItem(bestKey) || "0");
    return Number.isFinite(n) ? n : 0;
  };
  const writeBest = (n) => localStorage.setItem(bestKey, String(n | 0));

  let best = readBest();
  $best.textContent = String(best);

  // --- Supabase (Leaderboard) ---
  const LB_TABLE = "leaderboard_scores";
  const nameKey = "dinoish_name_v1";
  const periodKey = "dinoish_period_v1";
  const getName = () => String(localStorage.getItem(nameKey) || "").trim();
  const setName = (v) => localStorage.setItem(nameKey, v);
  /** @returns {"all"|"daily"|"weekly"} */
  const getPeriod = () =>
    /** @type {any} */ (localStorage.getItem(periodKey) || "all");
  /** @param {"all"|"daily"|"weekly"} v */
  const setPeriod = (v) => localStorage.setItem(periodKey, v);

  function supabaseReady() {
    return (
      typeof window.supabase !== "undefined" &&
      typeof window.SUPABASE_URL === "string" &&
      typeof window.SUPABASE_ANON_KEY === "string" &&
      window.SUPABASE_URL.startsWith("http") &&
      window.SUPABASE_ANON_KEY.length > 20
    );
  }

  /** @returns {import("@supabase/supabase-js").SupabaseClient | null} */
  function getSupabase() {
    if (!supabaseReady()) return null;
    try {
      return window.supabase.createClient(
        window.SUPABASE_URL,
        window.SUPABASE_ANON_KEY,
        {
          auth: { persistSession: false, autoRefreshToken: false },
        }
      );
    } catch {
      return null;
    }
  }

  function setHint(msg) {
    if (!$netHint) return;
    $netHint.textContent = msg || "";
  }

  function safeName(input) {
    const s = String(input || "").trim();
    // 너무 공격적인 필터링 대신: 길이/공백 정리만
    return s.replace(/\s+/g, " ").slice(0, 16);
  }

  function renderBoard(rows) {
    if (!$board) return;
    $board.innerHTML = "";
    if (!rows || rows.length === 0) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="name">아직 기록이 없어요</span><span class="score">-</span>`;
      $board.appendChild(li);
      return;
    }
    for (const r of rows) {
      const li = document.createElement("li");
      const nm = safeName(r.name) || "익명";
      li.innerHTML = `<span class="name">${escapeHtml(
        nm
      )}</span><span class="score">${Number(r.score || 0).toLocaleString(
        "ko-KR"
      )}</span>`;
      $board.appendChild(li);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function periodStartISO(period) {
    const d = new Date();
    if (period === "all") return "1970-01-01";
    if (period === "daily") {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    // weekly (월요일 시작, 로컬 기준)
    const day = d.getDay(); // 0..6 (일..토)
    const diffToMon = (day + 6) % 7;
    d.setDate(d.getDate() - diffToMon);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  function setActiveTab(period) {
    const tabs = [
      [$tabAll, "all"],
      [$tabDaily, "daily"],
      [$tabWeekly, "weekly"],
    ];
    for (const [el, key] of tabs) {
      if (!el) continue;
      const active = key === period;
      el.classList.toggle("active", active);
      el.setAttribute("aria-selected", active ? "true" : "false");
    }
  }

  async function fetchLeaderboard(period = getPeriod()) {
    const sb = getSupabase();
    if (!sb) {
      setHint("Supabase 설정이 없어서 랭킹 기능이 비활성화되어 있어요.");
      return;
    }
    setHint("랭킹 불러오는 중...");
    const period_start = periodStartISO(period);
    const { data, error } = await sb
      .from(LB_TABLE)
      .select("name,score,created_at")
      .eq("period_type", period)
      .eq("period_start", period_start)
      .order("score", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(10);
    if (error) {
      setHint(`랭킹 로드 실패: ${error.message}`);
      return;
    }
    setHint("");
    renderBoard(data);
  }

  async function submitScore(scoreValue, period = getPeriod()) {
    const sb = getSupabase();
    if (!sb) {
      setHint("Supabase 설정이 없어서 점수 등록이 불가능해요.");
      return;
    }
    const nm = safeName($playerName?.value || "");
    if (!nm) {
      setHint("닉네임을 입력해주세요.");
      $playerName?.focus?.();
      return;
    }
    const score = Math.max(0, Number(scoreValue) | 0);
    setHint("점수 등록 중...");
    const period_start = periodStartISO(period);
    const { error } = await sb.from(LB_TABLE).upsert(
      {
        name: nm,
        score,
        period_type: period,
        period_start,
        user_agent: navigator.userAgent,
      },
      { onConflict: "period_type,period_start,name", ignoreDuplicates: false }
    );
    if (error) {
      setHint(`등록 실패: ${error.message}`);
      return;
    }
    setHint("등록 완료! 랭킹을 갱신했어요.");
    setName(nm);
    await fetchLeaderboard(period);
  }

  const state = {
    running: false,
    gameOver: false,
    tPrev: 0,
    score: 0,
    finalScore: 0,
    speedMul: 1,
    baseSpeed: 360, // px/s
    spawnTimer: 0,
    nextSpawnIn: 0,
    dayPhase: 0,
  };

  const player = {
    x: 120,
    y: GROUND_Y,
    w: 34,
    h: 40,
    vy: 0,
    onGround: true,
    ducking: false,
  };

  /** @type {{x:number,y:number,w:number,h:number,kind:"cactus"|"bird",vy?:number}[]} */
  let obstacles = [];

  function reset() {
    state.running = false;
    state.gameOver = false;
    state.score = 0;
    state.finalScore = 0;
    state.speedMul = 1;
    state.spawnTimer = 0;
    state.nextSpawnIn = 0.85;
    state.dayPhase = 0;
    player.y = GROUND_Y;
    player.vy = 0;
    player.onGround = true;
    player.ducking = false;
    obstacles = [];
    setOverlay(true, "대기 중", "Space / ↑ 로 시작");
    syncHud();
    draw(0);
    setHint("");
  }

  function start() {
    if (state.running) return;
    state.running = true;
    state.gameOver = false;
    state.tPrev = now();
    setOverlay(false);
    requestAnimationFrame(loop);
  }

  function restart() {
    reset();
    start();
  }

  function setOverlay(show, title = "", sub = "") {
    if (show) $overlay.classList.remove("hidden");
    else $overlay.classList.add("hidden");
    if (title) $overlayTitle.textContent = title;
    if (sub) $overlaySub.textContent = sub;
  }

  function syncHud() {
    $score.textContent = String(state.score | 0);
    $best.textContent = String(best | 0);
    $speed.textContent = state.speedMul.toFixed(2);
  }

  function jump() {
    if (!state.running) start();
    if (state.gameOver) return;
    if (!player.onGround) return;
    player.vy = -JUMP_V0;
    player.onGround = false;
  }

  function setDuck(on) {
    if (!state.running) return;
    if (state.gameOver) return;
    player.ducking = on;
  }

  function spawnObstacle() {
    const speed = state.baseSpeed * state.speedMul;
    const farEnough =
      obstacles.length === 0 || obstacles[obstacles.length - 1].x < W - 240;
    if (!farEnough) return;

    const birdChance = clamp((state.speedMul - 1.2) / 2.2, 0, 0.55);
    const isBird = Math.random() < birdChance;

    if (isBird) {
      const y = Math.random() < 0.5 ? GROUND_Y - 56 : GROUND_Y - 90;
      obstacles.push({ x: W + rand(10, 80), y, w: 44, h: 26, kind: "bird" });
    } else {
      const tall = Math.random() < clamp((state.speedMul - 1) / 2, 0, 0.6);
      obstacles.push({
        x: W + rand(10, 80),
        y: GROUND_Y,
        w: tall ? 18 : 14,
        h: tall ? 48 : 34,
        kind: "cactus",
      });
      if (Math.random() < 0.22) {
        obstacles.push({
          x: W + rand(90, 160),
          y: GROUND_Y,
          w: 14,
          h: 34,
          kind: "cactus",
        });
      }
    }

    const density = clamp(1.15 - (state.speedMul - 1) * 0.22, 0.55, 1.15);
    state.nextSpawnIn = rand(0.75, 1.25) * density * (520 / speed);
  }

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function playerHitbox() {
    const padX = 6;
    const padY = 6;
    const w = player.ducking ? player.w + 6 : player.w;
    const h = player.ducking ? Math.floor(player.h * 0.62) : player.h;
    const x = player.x + padX;
    const y = player.y - h + padY;
    return { x, y, w: w - padX * 2, h: h - padY * 2 };
  }

  function obstacleHitbox(o) {
    if (o.kind === "bird") {
      return { x: o.x + 6, y: o.y - o.h + 6, w: o.w - 12, h: o.h - 12 };
    }
    return { x: o.x + 2, y: o.y - o.h + 2, w: o.w - 4, h: o.h - 4 };
  }

  function update(dt) {
    state.dayPhase += dt * 0.05;

    // 점수 & 속도 증가
    state.score += dt * 100 * state.speedMul;
    state.speedMul = 1 + (state.score / 1200) * 0.18;
    state.speedMul = clamp(state.speedMul, 1, 3.25);

    // 플레이어 물리
    const extraFall = player.ducking && !player.onGround ? FAST_FALL : 0;
    player.vy += (GRAVITY + extraFall) * dt;
    player.y += player.vy * dt;
    if (player.y >= GROUND_Y) {
      player.y = GROUND_Y;
      player.vy = 0;
      player.onGround = true;
    }

    // 스폰
    state.spawnTimer += dt;
    if (state.spawnTimer >= state.nextSpawnIn) {
      state.spawnTimer = 0;
      spawnObstacle();
    }

    // 장애물 이동
    const speed = state.baseSpeed * state.speedMul;
    for (const o of obstacles) o.x -= speed * dt;
    obstacles = obstacles.filter((o) => o.x + o.w > -40);

    // 충돌 검사
    const p = playerHitbox();
    for (const o of obstacles) {
      const b = obstacleHitbox(o);
      if (aabb(p.x, p.y, p.w, p.h, b.x, b.y, b.w, b.h)) {
        endGame();
        break;
      }
    }

    syncHud();
  }

  function endGame() {
    state.running = false;
    state.gameOver = true;

    const finalScore = state.score | 0;
    state.finalScore = finalScore;
    if (finalScore > best) {
      best = finalScore;
      writeBest(best);
    }
    syncHud();
    setOverlay(true, "게임 오버", "R 로 재시작 (또는 Space / ↑)");
  }

  function draw(t) {
    // 배경
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, W, H);

    // 바닥
    ctx.fillStyle = COLORS.groundShadow;
    ctx.fillRect(0, GROUND_Y + 6, W, 3);
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, GROUND_Y + 10, W, 2);

    // 먼지(패럴랙스)
    const speed = state.baseSpeed * state.speedMul;
    ctx.fillStyle = "#d1d5db";
    for (let i = 0; i < 26; i++) {
      const x = (i * 74 - ((t * 0.04 * speed) % 74) + W) % W;
      const y = GROUND_Y + 18 + (i % 3);
      ctx.fillRect(x, y, 10, 2);
    }

    // 장애물
    for (const o of obstacles) {
      ctx.fillStyle = o.kind === "bird" ? COLORS.bird : COLORS.cactus;
      if (o.kind === "bird") {
        // 새(간단 픽셀)
        pixelRect(o.x, o.y - o.h, o.w, o.h, 2);
        const flap = Math.sin((t / 1000) * 16) > 0 ? 1 : 0;
        ctx.fillRect(o.x + 6, o.y - 10 - flap * 6, 10, 2);
        ctx.fillRect(o.x + 28, o.y - 10 - flap * 6, 10, 2);
      } else {
        // 선인장(간단 픽셀)
        pixelRect(o.x, o.y - o.h, o.w, o.h, 2);
        ctx.fillRect(o.x - 6, o.y - Math.floor(o.h * 0.55), 8, 6);
      }
    }

    // 플레이어(공룡 느낌의 네모 픽셀)
    ctx.fillStyle = COLORS.ink;
    const pH = player.ducking ? Math.floor(player.h * 0.62) : player.h;
    const pW = player.ducking ? player.w + 6 : player.w;
    const px = player.x;
    const pyTop = player.y - pH;
    pixelRect(px, pyTop, pW, pH, 2);
    // 얼굴/눈
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(px + (player.ducking ? 22 : 18), pyTop + 10, 6, 6);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(px + (player.ducking ? 25 : 21), pyTop + 12, 2, 2);
    // 다리 애니
    if (player.onGround && state.running) {
      const step = Math.sin((t / 1000) * 18) > 0 ? 1 : 0;
      ctx.fillRect(px + 8 + step * 6, player.y - 6, 6, 6);
      ctx.fillRect(px + 18 - step * 6, player.y - 6, 6, 6);
    }
  }

  function pixelRect(x, y, w, h, s) {
    const ix = Math.floor(x / s) * s;
    const iy = Math.floor(y / s) * s;
    const iw = Math.floor(w / s) * s;
    const ih = Math.floor(h / s) * s;
    ctx.fillRect(ix, iy, iw, ih);
  }

  function loop(t) {
    if (!state.running) {
      draw(t);
      return;
    }
    const dt = clamp((t - state.tPrev) / 1000, 0, 0.033);
    state.tPrev = t;
    update(dt);
    draw(t);
    requestAnimationFrame(loop);
  }

  // 입력
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      if (state.gameOver) restart();
      else jump();
      return;
    }
    if (e.code === "KeyR") {
      e.preventDefault();
      restart();
      return;
    }
    if (e.code === "ArrowDown") {
      e.preventDefault();
      setDuck(true);
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowDown") setDuck(false);
  });

  // 클릭/터치로도 점프
  canvas.addEventListener("pointerdown", () => {
    if (state.gameOver) restart();
    else jump();
  });

  // 리더보드 UI 이벤트
  if ($playerName) {
    $playerName.value = getName();
    $playerName.addEventListener("change", () =>
      setName(safeName($playerName.value))
    );
    $playerName.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        submitScore(state.gameOver ? state.finalScore : state.score | 0);
    });
  }
  $refreshBoard?.addEventListener("click", () => fetchLeaderboard());
  $submitScore?.addEventListener("click", () =>
    submitScore(state.gameOver ? state.finalScore : state.score | 0)
  );

  reset();
  // 탭/기간 선택
  const initialPeriod = getPeriod();
  setActiveTab(initialPeriod);
  $tabAll?.addEventListener("click", () => {
    setPeriod("all");
    setActiveTab("all");
    fetchLeaderboard("all");
  });
  $tabDaily?.addEventListener("click", () => {
    setPeriod("daily");
    setActiveTab("daily");
    fetchLeaderboard("daily");
  });
  $tabWeekly?.addEventListener("click", () => {
    setPeriod("weekly");
    setActiveTab("weekly");
    fetchLeaderboard("weekly");
  });

  // 첫 화면에서 랭킹 로드 시도
  fetchLeaderboard(initialPeriod);
})();
