/**
 * 首屏三层错落海报 · 主题切换
 *
 * 规则：
 *   - 每张海报维护一条自己的主题队列，点卡片 = 切到下一个
 *   - 下方按钮组可跨海报跳转；按钮上的数字显示它当前是第几张
 *   - 图片按需预加载，加载完才淡入；失败就留着渐变兜底层，不影响可读性
 *   - 只切一张卡时，同组其它卡不动，避免三张同时闪
 */
(function () {
  "use strict";

  var DATA = window.POSTERS || [];
  if (!DATA.length) return;

  var set = document.getElementById("posterSet");
  var dots = document.getElementById("posterDots");
  if (!set || !dots) return;

  var SLOTS = {};
  var state = {}; // slot -> 当前主题索引
  var cache = {}; // img src -> true/false，记加载结果

  /* ---------- 工具 ---------- */

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  /** 先探一张图能不能用，成功后再决定要不要真的换上去 */
  function probe(src) {
    return new Promise(function (resolve) {
      if (cache[src] !== undefined) return resolve(cache[src]);
      var im = new Image();
      im.onload = function () {
        cache[src] = im.naturalWidth > 0;
        resolve(cache[src]);
      };
      im.onerror = function () {
        cache[src] = false;
        resolve(false);
      };
      im.src = src;
    });
  }

  /** 把 --focus 转成 object-position，横向取景靠左就少裁右边 */
  function focusPos(f) {
    if (typeof f !== "number") return "50%";
    return Math.round(Math.max(0, Math.min(1, f)) * 100) + "%";
  }

  /** 把「青岛 · 汇泉湾与红瓦」拼成一行，窄海报里不至于折成两行 */
  function plate(t) {
    return t.city + " · " + t.caption;
  }

  /** 切图和切字统一走这里，避免两处写得不一致 */
  function paint(card, t, img, labelTxt, cityEl) {
    img.src = t.img;
    img.alt = plate(t);
    card.classList.add("is-loaded");
    labelTxt.textContent = t.key;
    cityEl.textContent = plate(t);
    card.setAttribute("aria-label", "换一张：" + t.key);
    syncDots();
  }

  /* ---------- 构建 ---------- */

  DATA.forEach(function (group) {
    var card = set.querySelector('.poster[data-slot="' + group.slot + '"]');
    if (!card) return;

    // 补上小字节点，并把它塞进标签那一栏（与主题名共用同一块底纹）
    var label = card.querySelector(".poster-label");
    var city = el("span", "poster-city");
    var txt = label ? label.querySelector(".txt") : null;

    if (label && !txt) {
      txt = el("span", "txt");
      txt.textContent = label.textContent.trim();
      label.textContent = "";
      label.appendChild(city);
      label.appendChild(txt);
    } else if (label) {
      label.insertBefore(city, label.firstChild);
    } else {
      card.appendChild(city);
    }

    SLOTS[group.slot] = { group: group, card: card, city: city };

    card.addEventListener("click", function () {
      step(group.slot, 1);
    });
  });

  // 点的是三张卡重叠的部分时，浏览器会给最上层那张 —— z-index 已定好，不用额外处理

  /* ---------- 渲染按钮 ---------- */

  // 用第 2、3 张海报的主题做横向按钮组容易让人误解，
  // 所以按钮组平铺三张卡的全部主题，用一个前缀点住是谁的。
  var DOT_ITEMS = [];
  DATA.forEach(function (group) {
    group.themes.forEach(function (t, i) {
      DOT_ITEMS.push({ slot: group.slot, index: i, key: t.key, theme: t });
    });
  });

  function buildDots() {
    dots.textContent = "";
    var lastSlot = null;
    DOT_ITEMS.forEach(function (item) {
      var b = el("button", "poster-dot");
      b.type = "button";
      b.setAttribute("data-slot", item.slot);
      b.setAttribute("data-index", item.index);
      b.setAttribute("aria-pressed", "false");
      // 每换一组前面加一道细分隔，视觉上按海报分组
      if (lastSlot !== null && item.slot !== lastSlot) {
        b.classList.add("is-group-start");
      }
      lastSlot = item.slot;
      b.appendChild(el("i"));
      b.appendChild(document.createTextNode(item.key));
      b.title = item.theme.city + " · " + item.theme.caption;
      b.addEventListener("click", function () {
        go(item.slot, item.index);
      });
      dots.appendChild(b);
    });
  }

  function syncDots() {
    var btns = dots.querySelectorAll(".poster-dot");
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var slot = parseInt(b.getAttribute("data-slot"), 10);
      var idx = parseInt(b.getAttribute("data-index"), 10);
      b.setAttribute("aria-pressed", state[slot] === idx ? "true" : "false");
    }
  }

  /* ---------- 核心：把某张卡切到某个主题 ---------- */

  function apply(slot, index, opts) {
    var ref = SLOTS[slot];
    if (!ref) return Promise.resolve();

    var themes = ref.group.themes;
    if (!themes.length) return Promise.resolve();
    if (index < 0) index = themes.length - 1;
    if (index >= themes.length) index = 0;

    var t = themes[index];
    var card = ref.card;

    // 同主题重复触发只补状态，不再走一遍过渡
    if (state[slot] === index && card.classList.contains("is-loaded") && !(opts && opts.instant)) {
      return Promise.resolve();
    }

    var img = card.querySelector(".poster-img");
    var labelTxt = card.querySelector(".poster-label .txt");
    var instant = opts && opts.instant;

    // 快速连点同一个主题时，等上一次的过渡收尾
    if (!instant) card.classList.remove("is-swapping");

    state[slot] = index;

    // 兜底渐变始终先写进去，图片万一挂了画面也是对的
    card.style.setProperty("--focus", focusPos(t.focus));
    var bg = card.querySelector(".poster-bg");
    if (bg && t.fallback) bg.style.background = t.fallback;

    if (instant) {
      paint(card, t, img, labelTxt, ref.city);
      return Promise.resolve();
    }

    // 换字先淡出，图片加载完再一起淡入
    card.classList.add("is-swapping");

    return probe(t.img).then(function (ok) {
      if (!SLOTS[slot] || state[slot] !== index) return; // 期间又换了，让后一次说了算

      if (ok) {
        paint(card, t, img, labelTxt, ref.city);
      } else {
        // 加载失败：撤掉图片、露出渐变，字照换
        img.removeAttribute("src");
        img.alt = "";
        card.classList.remove("is-loaded");
        labelTxt.textContent = t.key;
        ref.city.textContent = plate(t);
        card.setAttribute("aria-label", "换一张：" + t.key);
        syncDots();
      }

      // 下一帧再撤掉 is-swapping，让过渡跑起来
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          card.classList.remove("is-swapping");
        });
      });
    });
  }

  function step(slot, delta) {
    var ref = SLOTS[slot];
    if (!ref) return;
    var next = (state[slot] + delta + ref.group.themes.length) % ref.group.themes.length;
    apply(slot, next);
  }

  function go(slot, index) {
    if (state[slot] === index) return;
    apply(slot, index);
  }

  /* ---------- 自动轮播 ---------- */

  var timer = null;
  var DELAY = 5200;
  var reduce =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function advanceAll() {
    // 三张一起换会很像幻灯片，改成每轮只推一张，顺次循环
    var slotOrder = DATA.map(function (g) {
      return g.slot;
    });
    var i = advanceAll._i || 0;
    step(slotOrder[i % slotOrder.length], 1);
    advanceAll._i = (i + 1) % slotOrder.length;
  }

  function start() {
    if (reduce || timer) return;
    timer = setInterval(advanceAll, DELAY);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  /* ---------- 启动 ---------- */

  buildDots();

  // 首屏第一帧直接给图，不做淡入，避免空白
  DATA.forEach(function (group) {
    apply(group.slot, 0, { instant: true });
  });
  set.setAttribute("data-ready", "1");

  // 先把其余图片悄悄预热，切换时就不会有加载停顿
  var warm = [];
  DATA.forEach(function (g) {
    g.themes.slice(1).forEach(function (t) {
      warm.push(probe(t.img));
    });
  });

  var host = document.getElementById("heroArt") || set;

  host.addEventListener("mouseenter", stop);
  host.addEventListener("mouseleave", start);
  host.addEventListener("focusin", stop);
  host.addEventListener("focusout", start);

  // 标签页切走就别转了，省带宽
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else start();
  });

  Promise.all(warm).then(start);
})();
