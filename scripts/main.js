/* ==========================================================================
   周末去哪 —— 首页交互
   1) 按目的地主色程序化生成封面渐变（避免图片依赖，同时保证每张卡不同色）
   2) 主题筛选 + 密度切换
   3) 页头吸顶状态 / 入场动画触发
   ========================================================================== */
(function () {
  "use strict";

  var DATA = window.DESTINATIONS || [];
  var THEMES = window.THEMES || ["全部"];

  /* ---------- 工具：从 hex 取色相角 ---------- */
  function hueOf(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16) / 255;
    var g = parseInt(h.slice(2, 4), 16) / 255;
    var b = parseInt(h.slice(4, 6), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    var hue;
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
    return Math.round(hue * 10) / 10;
  }

  /**
   * 每张卡片的封面用「同色相三段渐变」拼出来，
   * 根据 id 做哈希决定渐变角度和结构，让同色相的城市也不撞。
   */
  function coverFor(item, i) {
    var h = hueOf(item.accent);
    var hash = 0;
    for (var k = 0; k < item.id.length; k++) hash = (hash * 31 + item.id.charCodeAt(k)) % 997;

    var angle = 140 + (hash % 5) * 12;            // 140–188 度
    var spread = 8 + (hash % 4) * 5;              // 色相偏移
    var l1 = 62 + (hash % 3) * 4;                 // 亮端
    var l2 = 26 + (hash % 4) * 3;                 // 暗端

    // oklch 的色相必须在 0–360 内，负值浏览器会整条声明失效
    function H(x) {
      return Math.round(((x % 360) + 360) % 360 * 10) / 10;
    }

    var stops = [
      "oklch(" + l1 + "% 10% " + H(h + spread) + ")",
      "oklch(" + (l1 - 16) + "% 9% " + H(h) + ")",
      "oklch(" + l2 + "% 6% " + H(h - spread / 2) + ")"
    ];

    switch (hash % 4) {
      case 0:
        return "linear-gradient(" + angle + "deg," + stops[0] + "," + stops[2] + ")";
      case 1:
        return "radial-gradient(120% 90% at " + (18 + (hash % 5) * 14) + "% " +
          (12 + (hash % 4) * 16) + "%," + stops[0] + " 0,transparent 62%)," +
          "linear-gradient(" + angle + "deg," + stops[1] + "," + stops[2] + ")";
      case 2:
        return "conic-gradient(from " + (hash % 360) + "deg at 30% 72%," +
          stops[0] + " 0 26%," + stops[1] + " 26% 58%," + stops[2] + " 58% 100%)";
      default:
        return "linear-gradient(" + angle + "deg," + stops[1] + " 0 46%," +
          stops[0] + " 46% 62%," + stops[2] + " 62% 100%)";
    }
  }

  /* ---------- 卡片 DOM ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function transitIcon() {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
      '<rect x="3" y="1.5" width="10" height="11" rx="2.5"/>' +
      '<path d="M3 8h10M5.5 15l1-2.5M10.5 15l-1-2.5" stroke-linecap="round"/></svg>';
  }

  function cardEl(item, i) {
    var el = document.createElement("article");
    el.className = "card";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", item.city + " 周末指南，人均 " + item.budget + " 元");
    el.dataset.id = item.id;
    el.style.setProperty("--a", item.accent);

    // 渐变先铺底，真实照片加载完成后才淡入；照片失败则一直留着渐变
    el.innerHTML =
      '<div class="card-cover">' +
        '<i class="card-cover-base" style="--cover:' + coverFor(item, i) + '"></i>' +
        '<img class="card-photo" alt="' + esc(item.city) + " · " + esc(item.mustSee[0]) + '" ' +
          'src="images/covers/' + item.id + '.jpg" ' +
          'width="1200" height="750" loading="' + (i < 4 ? "eager" : "lazy") + '" ' +
          'decoding="async" onload="this.classList.add(\'is-loaded\')" ' +
          'onerror="this.remove()">' +
        '<span class="card-index">' + String(i + 1).padStart(2, "0") + "</span>" +
        '<span class="card-transit">' + transitIcon() + item.transit + "</span>" +
      "</div>" +
      '<div class="card-body">' +
        '<div class="card-title-row">' +
          '<h3 class="card-city">' + item.city + "</h3>" +
          '<span class="card-region">' + item.region + "</span>" +
        "</div>" +
        '<p class="card-tagline">' + item.tagline + "</p>" +
        '<div class="card-tags">' +
          item.tags.slice(0, 3).map(function (t) {
            return '<span class="tag">' + t + "</span>";
          }).join("") +
        "</div>" +
        '<div class="card-meta">' +
          "<span>" + item.days + " 天</span>" +
          '<span class="dot"></span>' +
          "<span>" + item.best.split("、")[0] + "</span>" +
          '<span class="card-price">' +
            '<span class="cur">¥</span>' +
            '<span class="num">' + item.budget + "</span>" +
            '<span class="unit">/ 人均</span>' +
          "</span>" +
        "</div>" +
      "</div>";

    // 图片若在解析阶段就已从缓存命中，onload 不会触发，这里补一次判断
    var img = el.querySelector(".card-photo");
    if (img && img.complete && img.naturalWidth > 0) img.classList.add("is-loaded");

    return el;
  }

  /* ---------- 渲染 ---------- */
  var grid = document.getElementById("grid");
  var countEl = document.getElementById("count");
  var filtersEl = document.getElementById("filters");
  var state = { theme: "全部", q: "" };

  function themeCount(t) {
    if (t === "全部") return DATA.length;
    return DATA.filter(function (d) {
      return d.tags.indexOf(t) > -1 ||
        d.tags.some(function (x) { return x.indexOf(t) > -1; });
    }).length;
  }

  function match(item, t) {
    if (t === "全部") return true;
    return item.tags.indexOf(t) > -1 ||
      item.tags.some(function (x) { return x.indexOf(t) > -1; });
  }

  /* ---------- 关键词匹配 ---------- */
  /**
   * 三档权重，不是一个大的 haystack：
   *
   *   名字  city + region               —— 「这座城叫什么、在哪」
   *   属性  vibe + tags                 —— 「它是座什么城」（园林、海边、美食）
   *   描述  tagline / mustSee / eat / transit / best —— 「关于它的细节」
   *
   * 拆开的原因：80 座城之后，描述里到处都是别人的城市名。
   * 福州的交通写着「高铁 3 小时（厦门出发）」，塔什库尔干写着「飞机到喀什」，
   * 一条 haystack 就会让搜「厦门」搜出福州、搜「喀什」搜出塔什库尔干。
   *
   * 判定顺序：
   *   1. 任一词命中名字 → 只在这些名字命中的城里比，其余词也得落在名字上。
   *      搜「厦门」= 只有厦门本人。
   *   2. 名字全都没命中 → 先在属性和描述里找。命中后同理，只看这一档。
   *      搜「园林」得到苏州（副标题）和扬州（氛围），但不再牵扯交通里的城市名。
   *   3. 还是没命中 → 全字段兜底，别把「云冈」「火锅」这种词搜死。
   */
  function fieldOf(item) {
    if (!item._f) {
      item._f = {
        name: [item.city, item.region].join(" ").toLowerCase(),
        trait: [item.vibe, item.tags.join(" ")].join(" ").toLowerCase(),
        desc: [item.tagline, item.best, item.mustSee.join(" "),
               item.eat, item.transit].join(" ").toLowerCase()
      };
      item._f.all = item._f.name + " " + item._f.trait + " " + item._f.desc;
    }
    return item._f;
  }

  /** 名字档匹配：整句关键词全部落在城市名 / 省份上 */
  function matchName(item, keys) {
    var name = fieldOf(item).name;
    return keys.every(function (k) { return name.indexOf(k) > -1; });
  }

  /**
   * 一次搜索分两趟：
   *   第一趟只认名字，有结果就用第一趟的；
   *   没有才放宽到「属性 + 描述」，再没有才用全字段。
   * 写成「中心化」而不是逐项判断，是为了让「厦门」这种词
   * 一旦有城市自称厦门，别的城市就不许再靠描述挤进来。
   */
  function searchList(list, q) {
    if (!q) return list;
    var keys = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!keys.length) return list;

    function every(field) {
      return function (item) {
        return keys.every(function (k) { return field(item).indexOf(k) > -1; });
      };
    }

    var byName = list.filter(every(function (d) { return fieldOf(d).name; }));
    if (byName.length) return byName;

    var byTrait = list.filter(every(function (d) {
      return fieldOf(d).trait + " " + fieldOf(d).desc;
    }));
    if (byTrait.length) return byTrait;

    return list.filter(every(function (d) { return fieldOf(d).all; }));
  }

  function renderFilters() {
    filtersEl.innerHTML = THEMES.map(function (t) {
      return '<button class="chip" type="button" data-theme="' + t + '" aria-pressed="' +
        (t === state.theme) + '">' + t +
        '<span class="n">' + themeCount(t) + "</span></button>";
    }).join("");

    filtersEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".chip");
      if (!btn) return;
      state.theme = btn.dataset.theme;
      Array.prototype.forEach.call(filtersEl.children, function (c) {
        c.setAttribute("aria-pressed", String(c.dataset.theme === state.theme));
      });
      render();
    });
  }

  function render() {
    var list = searchList(DATA, state.q).filter(function (d) {
      return match(d, state.theme);
    });
    grid.innerHTML = "";

    if (!list.length) {
      var hasQ = !!state.q;
      grid.innerHTML =
        '<div class="empty">' +
          "<h3>" + (hasQ ? "没找到「" + esc(state.q) + "」" : "这个主题下还没有目的地") + "</h3>" +
          "<p>" +
            (hasQ
              ? "试试更短的关键词，比如「苏州」「园林」「海边」。"
              : "换一个看看——或者把「全部」打开，从零开始挑。") +
          "</p>" +
          '<button class="btn btn-ghost" type="button" id="resetFilter">' +
            (hasQ ? "清除关键词" : "看全部目的地") +
          "</button>" +
        "</div>";
      document.getElementById("resetFilter").addEventListener("click", function () {
        if (hasQ) {
          clearSearch();
        } else {
          state.theme = "全部";
          Array.prototype.forEach.call(filtersEl.children, function (c) {
            c.setAttribute("aria-pressed", String(c.dataset.theme === "全部"));
          });
          render();
        }
      });
    } else {
      var frag = document.createDocumentFragment();
      list.forEach(function (item, i) {
        var card = cardEl(item, i);
        // 逐个错开入场，但上限 400ms，避免后面卡片等待过久
        card.setAttribute("data-reveal", "");
        card.style.setProperty("--d", Math.min(i * 45, 400) + "ms");
        frag.appendChild(card);
      });
      grid.appendChild(frag);
    }

    var summary = "显示 <b>" + list.length + "</b> / " + DATA.length + " 个目的地";
    if (state.q) summary += ' · 关键词「' + esc(state.q) + "」";
    countEl.innerHTML = summary;

    // 只匹配到极少数结果时，把结果区带进视野，免得用户以为没反应
    if (state.q && list.length && list.length <= 3) {
      scrollToResults();
    }
  }

  function scrollToResults() {
    var top = grid.getBoundingClientRect().top + window.scrollY - 140;
    if (Math.abs(window.scrollY - top) > 40) {
      window.scrollTo({ top: top, behavior: "smooth" });
    }
  }

  /* ---------- 搜索框 ---------- */
  var formEl = document.getElementById("searchForm");
  var inputEl = document.getElementById("searchInput");
  var clearEl = document.getElementById("searchClear");

  /** 把输入框的值落到 state 并重绘；同时同步清除按钮的显隐 */
  function applySearch(q) {
    var next = (q || "").trim();
    if (clearEl) clearEl.hidden = !inputEl.value.trim();
    if (next === state.q) return;
    state.q = next;
    render();
  }

  /** 实时筛选做防抖，避免每敲一个字就重建整张网格（图片会重新请求） */
  var typingTimer = null;
  function queueSearch() {
    if (clearEl) clearEl.hidden = !inputEl.value.trim();
    clearTimeout(typingTimer);
    typingTimer = setTimeout(function () {
      applySearch(inputEl.value);
    }, 220);
  }

  function flushSearch() {
    clearTimeout(typingTimer);
    applySearch(inputEl.value);
  }

  function clearSearch() {
    clearTimeout(typingTimer);
    if (inputEl) inputEl.value = "";
    if (clearEl) clearEl.hidden = true;
    state.q = "";
    render();
    if (inputEl) inputEl.focus();
  }

  if (formEl && inputEl) {
    // 入口 1：点「搜索」按钮 → submit
    // 入口 2：输入框内按回车 → 同样走 submit
    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      flushSearch();
    });

    // 入口 3：输入即筛选（防抖），不等回车
    inputEl.addEventListener("input", queueSearch);

    // 清除按钮
    if (clearEl) {
      clearEl.addEventListener("click", function (e) {
        e.preventDefault();
        clearSearch();
      });
    }

    // ESC 一键还原
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && (inputEl.value || state.q)) {
        e.preventDefault();
        clearSearch();
      }
    });
  }

  /* ---------- 密度切换 ---------- */
  var densityGroup = document.querySelector(".density");
  if (densityGroup) {
    densityGroup.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      Array.prototype.forEach.call(densityGroup.children, function (c) {
        c.setAttribute("aria-pressed", String(c === btn));
      });
      grid.dataset.density = btn.dataset.density;
    });
  }

  /* ---------- 点击卡片 ---------- */
  grid.addEventListener("click", function (e) {
    var card = e.target.closest(".card");
    if (!card) return;
    openDetail(card.dataset.id);
  });
  grid.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var card = e.target.closest(".card");
    if (!card) return;
    e.preventDefault();
    openDetail(card.dataset.id);
  });

  function openDetail(id) {
    // 第二轮：详情页 destination.html
    if (typeof window.openDestination === "function") {
      window.openDestination(id);
      return;
    }
    location.href = "destination.html?id=" + encodeURIComponent(id);
  }

  /* ---------- 页头吸顶 ---------- */
  var header = document.getElementById("siteHeader");
  var onScroll = function () {
    header.dataset.stuck = window.scrollY > 8 ? "true" : "false";
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- 平滑锚点 ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-scroll]");
    if (!t) return;
    var target = document.querySelector(t.dataset.scroll);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ---------- 页脚主题快捷入口 ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-jump]");
    if (!t) return;
    e.preventDefault();
    var name = t.dataset.jump;
    var chip = filtersEl.querySelector('[data-theme="' + name + '"]');
    if (!chip) return;
    state.q = "";
    if (inputEl) { inputEl.value = ""; if (clearEl) clearEl.hidden = true; }
    chip.click();
    document.getElementById("explore").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ---------- 启动 ---------- */
  // 首屏的「N 座城市」与「¥xxx 最低预算」从数据算，不写死。
  // 之前这两个数是手填的，城市一扩就变成了谎话。
  (function fillHeroStats() {
    var n = document.getElementById("statCities");
    if (n) n.textContent = String(DATA.length);

    // 找人均预算最低的那座，标题里挂个 tooltip 说明是哪座
    var cheap = DATA.length
      ? DATA.reduce(function (a, b) { return b.budget < a.budget ? b : a; })
      : null;
    var money = document.querySelector(".hero-stats div:nth-child(3) dt");
    if (money && cheap) {
      money.textContent = "¥" + cheap.budget;
      money.title = "最低： " + cheap.city + " · " + cheap.days + " 天";
    }
  })();

  renderFilters();

  // 支持从详情页的标签跳回来：index.html?q=古城#explore
  var m = location.search.match(/[?&]q=([^&]+)/);
  var initialQ = m ? decodeURIComponent(m[1].replace(/\+/g, " ")).trim() : "";
  if (initialQ && inputEl) {
    inputEl.value = initialQ;
    state.q = initialQ;
    if (clearEl) clearEl.hidden = false;
  }

  render();
})();
