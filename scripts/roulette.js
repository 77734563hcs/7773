/* ==========================================================================
   周末转盘 —— roulette.js
   1) Canvas 画盘：每格占 1/n 圆心角，80 格也能读
   2) 指针固定在 12 点方向，转盘顺时针转，停下时反解指针落在哪个扇区
   3) 两种规则：不重复（抽走的退出盘面）/ 纯随机（每次都从全集抽）
   ========================================================================== */
(function () {
  "use strict";

  var DATA = (window.DESTINATIONS || []).slice();
  var THEMES = window.THEMES || ["全部"];

  var canvas = document.getElementById("wheelCanvas");
  var disc = document.getElementById("wheelDisc");
  var hub = document.getElementById("wheelHub");
  var hubCn = document.getElementById("hubCn");
  var spinBtn = document.getElementById("spinBtn");
  var needle = document.getElementById("wheelNeedle");
  var themesEl = document.getElementById("rlThemes");
  var budgetsEl = document.getElementById("rlBudgets");
  var poolEl = document.getElementById("rlPool");
  var progressEl = document.getElementById("rlProgress");
  var modesEl = document.querySelector(".rl-modes");
  var resultEl = document.getElementById("rlResult");

  if (!canvas) return;

  var ctx = canvas.getContext("2d");

  /* ---------- 状态 ---------- */
  var state = {
    theme: "全部",
    budget: Infinity,          // 上限，Infinity = 不限
    mode: "fair",              // fair | pure
    wheel: [],                 // 当前盘面上的城市
    drawn: [],                 // 本轮已抽中的 id（fair 模式退场依据）
    angle: 0,                  // 当前旋转角（弧度，顺时针为正）
    spinning: false,
    picked: null
  };

  var TAU = Math.PI * 2;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function matchesTheme(d, t) {
    if (t === "全部") return true;
    return d.tags.indexOf(t) > -1 ||
      d.tags.some(function (x) { return x.indexOf(t) > -1; });
  }

  /** 池子 = 主题 ∩ 预算。抽过的城市不退场，只是变灰。 */
  function pool(all) {
    return all.filter(function (d) {
      if (!matchesTheme(d, state.theme)) return false;
      if (d.budget > state.budget) return false;
      return true;
    });
  }

  /** 本轮已经抽走过：不再参与抽签 */
  function isTaken(d) {
    return state.mode === "fair" && state.drawn.indexOf(d.id) > -1;
  }

  /** 这一格要不要画成暗格。比 isTaken 宽松一条：刚落定的那格暂时留亮 */
  function isDrawn(d) {
    if (!isTaken(d)) return false;
    // 指针还压在它上面，马上转灰会让人以为看错了
    return !(state.picked && state.picked.id === d.id);
  }

  /* ---------- 画盘 ---------- */
  /**
   * 每格的文字方向：横向排（旋转到径向）。80 格时扇区只有 4.5°，
   * 沿半径写会挤成一团，所以先转到「扇区中线上」，再在半径方向写城市名。
   */
  function draw() {
    var n = state.wheel.length;
    var size = canvas.clientWidth || 480;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var cx = size / 2;
    var cy = size / 2;
    var R = size / 2 - 1;
    var hubR = R * 0.26;          // 中心按钮占掉的范围

    ctx.clearRect(0, 0, size, size);

    if (!n) {
      ctx.fillStyle = "oklch(92% 0.016 72)";
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fill();
      writeEmpty(cx, cy);
      return;
    }

    var step = TAU / n;

    for (var i = 0; i < n; i++) {
      var d = state.wheel[i];
      var a0 = i * step;
      var a1 = a0 + step;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();

      // 同色系相间：单双格一深一浅，80 格相邻两格才不会糊成一片
      var deep = i % 2 === 1;
      var base = deep ? shade(d.accent, 0.84) : d.accent;
      ctx.fillStyle = isDrawn(d) ? fade(base) : base;
      ctx.fill();
    }

    // 环带分隔：一条环线 + 一格一条短刻线，格子多的时候靠这个数得出「有多少格」
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.54, 0, TAU);
    ctx.strokeStyle = "oklch(99% 0.006 80 / 0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();

    for (var t = 0; t < n && n <= 60; t++) {
      var at = t * step;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(at) * R * 0.54, cy + Math.sin(at) * R * 0.54);
      ctx.lineTo(cx + Math.cos(at) * R, cy + Math.sin(at) * R);
      ctx.strokeStyle = "oklch(99% 0.006 80 / 0.28)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // 中心挖白，让「转」按钮压在干净的底上
    ctx.beginPath();
    ctx.arc(cx, cy, hubR + 3, 0, TAU);
    ctx.fillStyle = "oklch(99.4% 0.005 80)";
    ctx.fill();

    /* ---- 城市名：沿轮缘环写 ----
       一开始是沿半径方向写的，80 格时扇区只有 4.5°，
       字宽 28px 需要 36° 的弧长，80 个字在半径某个位置叠成一圈黑点。
       改成沿圆周逐字摆：每格一个固定半径，字沿着切线方向写，
       相邻格错开半个环带高度，密到这里也只能承认「挤」，
       但至少每个字都还认得出是哪个城。 */
    var labelR = R * 0.935;
    var fontSize = Math.max(5.6, Math.min(9.5, size / (n * 0.9)));
    if (n <= 12) fontSize = Math.max(13, Math.min(19, size / 26));
    if (n <= 40 && n > 12) fontSize = Math.min(11, fontSize + 1.4);

    ctx.font = '700 ' + fontSize.toFixed(1) + 'px "Source Han Sans SC","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (var j = 0; j < n; j++) {
      var item = state.wheel[j];
      var mid = (j + 0.5) * step;

      ctx.save();
      ctx.translate(cx + Math.cos(mid) * labelR, cy + Math.sin(mid) * labelR);
      // 把文字的「上」朝向圆心，读起来是从外往内
      ctx.rotate(mid + Math.PI / 2);

      ctx.fillStyle = isDrawn(item)
        ? "oklch(62% 0.008 70 / 0.75)"
        : isLight(item.accent)
          ? "oklch(20% 0.02 60)"
          : "oklch(99% 0.008 80)";
      ctx.fillText(item.city, 0, 0);
      ctx.restore();
    }
  }

  function writeEmpty(cx, cy) {
    ctx.save();
    ctx.fillStyle = "oklch(54% 0.016 64)";
    ctx.font = '600 15px "Source Han Sans SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("这个条件下一座城都没有", cx, cy - 22);
    ctx.font = '13px "Source Han Sans SC","Microsoft YaHei",sans-serif';
    ctx.fillText("放宽主题或预算试试", cx, cy + 2);
    ctx.restore();
  }

  /** 颜色加深：直接按 sRGB 通道乘系数，够用且不引入色彩库 */
  function shade(hex, k) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = Math.round(parseInt(h.slice(0, 2), 16) * k);
    var g = Math.round(parseInt(h.slice(2, 4), 16) * k);
    var b = Math.round(parseInt(h.slice(4, 6), 16) * k);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  /** 已经抽走的格子：往纸色里兑，兑到只剩一点原先的色调，看得出退场但不抢眼 */
  function fade(color) {
    var nums = String(color).match(/\d+/g);
    if (!nums) return color;
    var PAPER = [246, 242, 235];
    var rgb = nums.slice(0, 3).map(function (v, i) {
      return Math.round(Number(v) * 0.22 + PAPER[i] * 0.78);
    });
    return "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
  }

  /** 足够亮就用墨字：相对亮度按 sRGB 近似（0.299/0.587/0.114） */
  function isLight(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
  }

  /* ---------- 转 ---------- */
  /**
   * 停止位置反解：
   *   指针固定在 -90°（12 点）。盘转过 angle 之后，
   *   落在指针下的那一格，其扇区中线角度满足
   *     mid + angle ≡ -90°  (mod 360)
   * 所以先把目标格的中线算出来，再反推 angle 需要转到多少。
   */
  function spin() {
    if (state.spinning) return;

    var n = state.wheel.length;
    if (!n) return;

    // 能中的只有还没抽过的格子。全抽完了就把这一轮清零重开，让人接着转。
    var live = state.wheel.filter(function (d) { return !isTaken(d); });
    if (!live.length) {
      if (state.mode !== "fair") return;
      state.drawn = [];
      state.picked = null;
      draw();
      updateProgress();
      progressEl.textContent = "这一圈走完了，记录已清空，可以重新开始。";
      live = state.wheel.slice();
    }

    var liveIdx = Math.floor(Math.random() * live.length);
    var target = live[liveIdx];
    // 目标格在当前盘面上的下标：所有可见格按原顺序排，步长不变
    var idx = state.wheel.indexOf(target);

    var step = TAU / n;
    // 指针在 12 点 = -90°，canvas 的 0° 在 3 点方向，顺时针为正
    var needleAngle = -Math.PI / 2;
    var mid = (idx + 0.5) * step;

    // 指针落点希望是扇区中线，稍微随机偏一点，避免每次都停得板正
    var jitter = (Math.random() - 0.5) * step * 0.62;

    var want = needleAngle - (mid + jitter);
    var turns = reduceMotion ? 0 : 5 + Math.floor(Math.random() * 3);
    var base = state.angle;
    // 把 want 归一到 base 之后的第一个等价角，再加整圈
    var delta = ((want - base) % TAU + TAU) % TAU;
    var end = base + delta + turns * TAU;

    state.spinning = true;
    setBusy(true);

    var duration = reduceMotion ? 200 : 4200 + Math.random() * 900;
    animate(base, end, duration, function () {
      state.angle = end % TAU;
      // 落定后把盘面角也归一，避免长期累加产生浮点误差
      disc.style.transform = "rotate(" + state.angle + "rad)";
      state.spinning = false;
      setBusy(false);
      commit(target);
    });
  }

  /** 缓动：末尾要明显减速，否则看不出「慢慢停下」 */
  function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
  }

  function animate(from, to, ms, done) {
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / ms);
      var a = from + (to - from) * easeOutQuint(t);
      state.angle = a;
      // 用 transform 而不是重画：80 格每帧重画太贵，浏览器对 transform 有合成层优化
      disc.style.transform = "rotate(" + a + "rad)";
      if (t < 1) requestAnimationFrame(frame);
      else done();
    }
    requestAnimationFrame(frame);
  }

  function setBusy(busy) {
    spinBtn.disabled = busy;
    hub.disabled = busy;
    spinBtn.textContent = busy ? "转着……" : "转";
  }

  /* ---------- 落定 ---------- */
  function commit(item) {
    state.picked = item;

    if (state.mode === "fair") {
      if (state.drawn.indexOf(item.id) === -1) state.drawn.push(item.id);
    }

    // 指针弹一下
    needle.classList.remove("is-tick");
    void needle.offsetWidth;
    needle.classList.add("is-tick");

    showResult(item);
    updateProgress();

    // fair 模式：这一格标记为已经抽过，但不挪走、不重排。
    // 之前是在这里 rebuildWheel 把格子删掉重建的，盘面格数一变，
    // 同样的转角对应的就是另一座城——指针指着 A，卡片写着 B。
    // 现在盘面整轮不动，只有颜色变淡，指针和结果始终对得上。
    if (state.mode === "fair") draw();
  }

  function showResult(d) {
    var empty = document.getElementById("rlEmpty");
    var card = document.getElementById("rlCard");
    if (empty) empty.hidden = true;
    card.hidden = false;

    // 重播入场动画：连续抽签时新卡片要看得出来是新的
    card.style.animation = "none";
    void card.offsetWidth;
    card.style.animation = "";

    var img = document.getElementById("rlCover");
    img.src = "images/covers/" + d.id + ".jpg";
    img.alt = d.city + " · " + d.mustSee[0];

    document.getElementById("rlCity").textContent = d.city;
    document.getElementById("rlRegion").textContent = d.region;
    document.getElementById("rlTagline").textContent = d.tagline;
    document.getElementById("rlTags").innerHTML = d.tags.slice(0, 4).map(function (t) {
      return '<span class="tag">' + esc(t) + "</span>";
    }).join("");

    document.getElementById("rlDays").textContent = d.days + " 天";
    document.getElementById("rlBudget").textContent = "¥" + d.budget;
    document.getElementById("rlBest").textContent = d.best;
    document.getElementById("rlMustSee").textContent = d.mustSee.join(" · ");
    document.getElementById("rlEat").textContent = d.eat;
    document.getElementById("rlTransit").textContent = d.transit;

    document.getElementById("rlDetail").href =
      "destination.html?id=" + encodeURIComponent(d.id);
    // 地图页还不认 focus 参数，别拼一个假的深链——直接进地图，让人自己找
    document.getElementById("rlMap").href = "map.html";

    // 结果出来时轻轻带进视野，但别把转盘顶出去
    if (resultEl) {
      var top = resultEl.getBoundingClientRect().top + window.scrollY - 100;
      if (top > window.scrollY + window.innerHeight * 0.5) {
        window.scrollTo({ top: top, behavior: "smooth" });
      }
    }
  }

  /* ---------- 重建盘面 ---------- */
  function rebuildWheel() {
    var next = pool(DATA);

    state.wheel = next;
    draw();
    updatePool();
    updateProgress();

    // 换条件时把盘面转回 0，视觉上是「重新摆盘」
    state.angle = 0;
    disc.style.transition = "none";
    disc.style.transform = "rotate(0rad)";
    void disc.offsetWidth;
    disc.style.transition = "";

    spinBtn.disabled = !next.length;
    hub.disabled = !next.length;
    hubCn.textContent = next.length ? "转" : "空";
  }

  function updatePool() {
    var n = state.wheel.length;
    var total = DATA.length;
    var conds = [];
    if (state.theme !== "全部") conds.push("「" + state.theme + "」");
    if (state.budget !== Infinity) conds.push("人均 ¥" + state.budget + " 以内");

    // 之前这句只写「符合条件的 N 座」，不说是哪几个条件。
    // 用户切到「海边 + ¥600 内」看到 0 座，屏幕上一片茫然，
    // 得自己回想刚才按过哪两个按钮。把条件摊开写在明面上。
    var html;
    if (!n) {
      html = conds.length
        ? "<b>0</b> 座同时满足 " + conds.join(" 且 ") +
          "——放宽一项试试，盘面现在转不动。"
        : "盘是空的。";
    } else if (conds.length) {
      html = "同时满足 " + conds.join(" 且 ") + " 的有 <b>" + n +
        "</b> 座（全库 " + total + " 座），盘面按这 " + n + " 格均分。";
    } else {
      html = "全库 <b>" + n + "</b> 座城市，盘面按 " + n + " 格均分。";
    }
    poolEl.innerHTML = html;
  }

  function updateProgress() {
    if (state.mode !== "fair") {
      progressEl.textContent = "纯随机：每次都从当前盘面全量里抽。";
      return;
    }
    var left = state.wheel.length - state.drawn.length;
    progressEl.textContent = "本轮已抽 " + state.drawn.length + " 座，盘面还剩 " + left + " 座。" +
      (state.drawn.length ? "抽过的格子转灰，不会再中。" : "");
  }

  /* ---------- 筛选 UI ---------- */
  function themeCount(t) {
    return DATA.filter(function (d) { return matchesTheme(d, t); }).length;
  }

  function renderThemes() {
    // 「全部」+ 内容有交集的标签
    var list = THEMES.filter(function (t) {
      return t !== "全部" ? themeCount(t) > 0 : true;
    });
    themesEl.innerHTML = list.map(function (t) {
      return '<button class="chip" type="button" data-theme="' + t + '" aria-pressed="' +
        (t === state.theme) + '">' + t +
        '<span class="n">' + themeCount(t) + "</span></button>";
    }).join("");
  }

  var BUDGETS = [
    { v: Infinity, label: "不限" },
    { v: 600, label: "¥600 内" },
    { v: 1000, label: "¥1000 内" },
    { v: 2000, label: "¥2000 内" }
  ];

  function budgetCount(v) {
    return DATA.filter(function (d) {
      return matchesTheme(d, state.theme) && d.budget <= v;
    }).length;
  }

  function renderBudgets() {
    budgetsEl.innerHTML = BUDGETS.map(function (b) {
      return '<button class="chip" type="button" data-budget="' + b.v + '" aria-pressed="' +
        (b.v === state.budget) + '">' + b.label +
        '<span class="n">' + budgetCount(b.v) + "</span></button>";
    }).join("");
  }

  themesEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".chip");
    if (!btn || state.spinning) return;
    state.theme = btn.dataset.theme;
    Array.prototype.forEach.call(themesEl.children, function (c) {
      c.setAttribute("aria-pressed", String(c.dataset.theme === state.theme));
    });
    // 主题变了，预算档的数字也跟着变
    renderBudgets();
    state.drawn = [];
    rebuildWheel();
  });

  budgetsEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".chip");
    if (!btn || state.spinning) return;
    state.budget = Number(btn.dataset.budget);
    Array.prototype.forEach.call(budgetsEl.children, function (c) {
      c.setAttribute("aria-pressed", String(Number(c.dataset.budget) === state.budget));
    });
    state.drawn = [];
    rebuildWheel();
  });

  if (modesEl) {
    modesEl.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-mode]");
      if (!btn || state.spinning) return;
      state.mode = btn.dataset.mode;
      Array.prototype.forEach.call(modesEl.children, function (c) {
        c.setAttribute("aria-pressed", String(c.dataset.mode === state.mode));
      });
      state.drawn = [];
      rebuildWheel();
    });
  }

  /* ---------- 触发 ---------- */
  spinBtn.addEventListener("click", spin);
  hub.addEventListener("click", spin);

  // 空格 / 回车也能转，转盘本身可聚焦
  disc.tabIndex = -1;
  document.addEventListener("keydown", function (e) {
    if (e.key !== " " && e.key !== "Enter") return;
    var t = e.target;
    // 让按钮自己处理，避免一次按键触发两次
    if (t && (t.tagName === "BUTTON" || t.tagName === "A" || t.tagName === "INPUT")) return;
    e.preventDefault();
    spin();
  });

  document.getElementById("rlAgain").addEventListener("click", spin);

  /* ---------- 启动 ---------- */
  // 90 座城也好，80 也好，盘面格数完全由数据决定
  renderThemes();
  renderBudgets();
  rebuildWheel();

  // 视口变化时 canvas 要按新尺寸重画，否则会糊
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(draw, 160);
  });

  // 等字体就绪再画一次，否则首帧用的是回退字体，落下后字宽会变
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(draw);
  }
})();
