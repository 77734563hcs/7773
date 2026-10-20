/* ==========================================================================
   周末去哪 —— 目的地详情页
   data/destinations.js 给骨架（城市、预算、标签）
   data/details.js      给血肉（逐景点的开放时间/票价/预约方式、逐日行程、吃什么）
   ========================================================================== */
(function () {
  "use strict";

  var DATA = window.DESTINATIONS || [];
  var DET = window.DETAILS || {};

  var root = document.getElementById("detail");
  var loading = document.getElementById("loading");
  var notfound = document.getElementById("notfound");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function idFromUrl() {
    var m = location.search.match(/[?&]id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  var item = DATA.filter(function (d) { return d.id === idFromUrl(); })[0];

  if (!item) {
    loading.hidden = true;
    root.hidden = true;
    notfound.hidden = false;
    document.title = "没找到这座城 · 周末去哪";
    return;
  }

  var idx = DATA.map(function (d) { return d.id; }).indexOf(item.id);
  var info = DET[item.id] || null;

  /* ---------- 同主题推荐：共享标签最多的三座 ---------- */
  function related() {
    // 用 id 排除，不用对象身份。
    // 城市从 16 扩到 80 时出现了「桂林市」与「阳朔」两条都叫桂林方向的记录，
    // 只要数据结构被复用一次（比如详情页和地图页共享数组），
    // 引用就不是同一个，indexOf / !== 也会认不出来。id 是唯一可靠的钥匙。
    return DATA.filter(function (d) { return d.id !== item.id; })
      .map(function (d) {
        var shared = d.tags.filter(function (t) {
          return item.tags.indexOf(t) > -1;
        }).length;
        return { d: d, n: shared };
      })
      .sort(function (a, b) { return b.n - a.n || a.d.budget - b.d.budget; })
      .slice(0, 3)
      .map(function (x) { return x.d; });
  }

  /* ---------- 01 必去清单：一条景点一张参数条 ---------- */
  function spotHtml(sp, i) {
    var meta = [
      { k: "开放", v: sp.time },
      { k: "票价", v: sp.fee },
      { k: "怎么进", v: sp.way }
    ].map(function (r) {
      return '<div class="sp-meta-row"><dt>' + esc(r.k) + "</dt><dd>" + esc(r.v) + "</dd></div>";
    }).join("");

    return "<li>" +
      '<div class="sp-head">' +
        '<span class="dot">' + (i + 1) + "</span>" +
        "<h3>" + esc(sp.name) + "</h3>" +
      "</div>" +
      '<p class="sp-what">' + esc(sp.what) + "</p>" +
      '<dl class="sp-meta">' + meta + "</dl>" +
      (sp.tips
        ? '<p class="sp-tips"><b>现场</b>' + esc(sp.tips) + "</p>"
        : "") +
    "</li>";
  }

  /* ---------- 02 行程：按天，每天按时间排 ---------- */
  function planHtml(p, i) {
    var stops = p.stops.map(function (s) {
      return "<li>" +
        '<span class="pt">' + esc(s.time) + "</span>" +
        '<span class="pw">' + esc(s.what) + "</span>" +
      "</li>";
    }).join("");

    return "<li>" +
      '<div class="pl-head">' +
        '<span class="pl-day">' + esc(p.t) + "</span>" +
        '<span class="pl-n">' + pad2(i + 1) + "</span>" +
      "</div>" +
      '<h3 class="pl-title">' + esc(p.d) + "</h3>" +
      '<ol class="pl-stops">' + stops + "</ol>" +
      (p.note ? '<p class="pl-note">' + esc(p.note) + "</p>" : "") +
    "</li>";
  }

  /* ---------- 03 吃什么：按用途分组 ---------- */
  function eatsHtml(g) {
    var items = g.items.map(function (it) {
      return "<li>" +
        '<div class="et-head">' +
          '<h4>' + esc(it.name) + "</h4>" +
          '<span class="et-price">' + esc(it.price) + "</span>" +
        "</div>" +
        '<p class="et-shop">' + esc(it.shop) + "</p>" +
        '<p class="et-how">' + esc(it.how) + "</p>" +
      "</li>";
    }).join("");

    return '<div class="d-eatgroup">' +
      '<h3 class="d-eatk">' + esc(g.k) + "</h3>" +
      '<ul class="d-eatlist">' + items + "</ul>" +
    "</div>";
  }

  /* ---------- 预算 ---------- */
  function budgetRows() {
    if (info && info.budget) {
      return info.budget.map(function (r) {
        return { k: r.k, v: r.v, note: r.note };
      });
    }
    // 没有详情数据时的兜底，按常见比例估
    var b = item.budget;
    var stay = Math.round((b * 0.42) / 10) * 10;
    var food = Math.round((b * 0.33) / 10) * 10;
    var ticket = Math.round((b * 0.15) / 10) * 10;
    return [
      { k: "住宿", v: stay, note: (item.days > 2 ? item.days - 1 : 1) + " 晚" },
      { k: "吃饭", v: food, note: item.days + " 天" },
      { k: "门票", v: ticket, note: "主要景点" },
      { k: "交通", v: b - stay - food - ticket, note: "市内交通" }
    ];
  }

  /* ---------- 渲染 ---------- */
  var rel = related();
  var bRows = budgetRows();
  var bMax = Math.max.apply(null, bRows.map(function (r) { return r.v; }));

  var secNo = 0;
  function sec(t) {
    secNo++;
    return '<h2><span class="num">' + pad2(secNo) + "</span>" + t + "</h2>";
  }

  var heroStats =
    "<div><dt>天数</dt><dd>" + item.days + "<span>天</span></dd></div>" +
    "<div><dt>人均</dt><dd><span>¥</span>" + item.budget + "</dd></div>" +
    "<div><dt>最佳季节</dt><dd class=\"sm\">" + esc(item.best) + "</dd></div>" +
    "<div><dt>怎么去</dt><dd class=\"sm\">" + esc(item.transit) + "</dd></div>" +
    (info && info.hour
      ? "<div class=\"wide\"><dt>几点去最对</dt><dd class=\"sm\">" + esc(info.hour) + "</dd></div>"
      : "");

  var left =
    (info && info.known
      ? '<p class="d-known">' + esc(info.known) + "</p>"
      : "") +

    (info && info.spots
      ? '<section class="d-sec">' + sec("必去清单") +
          '<ol class="d-must">' +
            info.spots.map(spotHtml).join("") +
          "</ol>" +
        "</section>"
      : '<section class="d-sec">' + sec("必去清单") +
          '<ol class="d-must">' +
            item.mustSee.map(function (m, i) {
              return "<li>" +
                '<div class="sp-head"><span class="dot">' + (i + 1) + "</span><h3>" + esc(m) + "</h3></div>" +
                '<p class="sp-what">' + esc(item.vibe) + "</p>" +
              "</li>";
            }).join("") +
          "</ol>" +
        "</section>"
    ) +

    (info && info.plan
      ? '<section class="d-sec">' + sec(item.days + " 天怎么排") +
          '<ol class="d-plan">' + info.plan.map(planHtml).join("") + "</ol>" +
        "</section>"
      : ""
    ) +

    (info && info.eats
      ? '<section class="d-sec">' + sec("吃什么") +
          info.eats.map(function (g, i) {
            return i === 0 ? eatsHtml(g) : eatsHtml(g).replace('class="d-eatgroup"', 'class="d-eatgroup sep"');
          }).join("") +
        "</section>"
      : '<section class="d-sec">' + sec("吃什么") +
          '<p class="d-eat">' + esc(item.eat) + "</p>" +
        "</section>"
    );

  var side =
    '<div class="d-card">' +
      "<h3>预算拆解</h3>" +
      '<p class="d-card-sub">人均 ¥' + item.budget + " · " + item.days + " 天</p>" +
      '<ul class="d-budget">' +
        bRows.map(function (r) {
          return "<li>" +
            '<span class="k">' + esc(r.k) + "</span>" +
            '<span class="bar"><i style="width:' + Math.round((r.v / bMax) * 100) + '%"></i></span>' +
            '<span class="v">¥' + r.v + "</span>" +
            '<span class="note">' + esc(r.note) + "</span>" +
          "</li>";
        }).join("") +
      "</ul>" +
      '<p class="d-fine">不含往返大交通。门票按核实到的价格，旺季浮动可能到两成。</p>' +
    "</div>" +

    (info && info.stay
      ? '<div class="d-card"><h3>住在哪</h3>' +
          '<p class="d-stay">' + esc(info.stay) + "</p>" +
        "</div>"
      : "") +

    '<div class="d-card">' +
      "<h3>标签</h3>" +
      '<div class="d-tags">' +
        item.tags.map(function (t) {
          return '<a class="tag" href="index.html?q=' + encodeURIComponent(t) + '#explore">' + esc(t) + "</a>";
        }).join("") +
      "</div>" +
    "</div>";

  var cautions = (info && info.cautions && info.cautions.length)
    ? '<section class="d-caution">' +
        '<h3><span class="num">!</span>走之前确认这几件事</h3>' +
        "<ul>" +
          info.cautions.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") +
        "</ul>" +
      "</section>"
    : "";

  root.innerHTML =
    // 首屏
    '<section class="d-hero" style="--a:' + esc(item.accent) + '">' +
      '<div class="d-hero-media">' +
        '<img src="images/covers/' + esc(item.id) + '.jpg" ' +
          'alt="' + esc(item.city) + " · " + esc(item.mustSee[0]) + '" ' +
          'onerror="this.remove()">' +
      "</div>" +
      '<div class="wrap d-hero-inner">' +
        '<nav class="d-crumb" aria-label="面包屑">' +
          '<a href="index.html#explore">全部目的地</a>' +
          "<span>/</span>" +
          "<span>" + esc(item.region) + "</span>" +
          "<span>/</span>" +
          '<span aria-current="page">' + esc(item.city) + "</span>" +
        "</nav>" +
        '<div class="d-title-row">' +
          "<h1>" + esc(item.city) + "</h1>" +
          '<span class="d-no">' + pad2(idx + 1) + "</span>" +
        "</div>" +
        '<p class="d-tagline">' + esc(item.tagline) + "</p>" +
        '<p class="d-vibe">' + esc(item.vibe) + "</p>" +
        '<dl class="d-stats">' + heroStats + "</dl>" +
      "</div>" +
    "</section>" +

    '<div class="wrap d-body">' +
      '<div class="d-main">' + left + cautions + "</div>" +
      '<aside class="d-side">' + side + "</aside>" +
    "</div>" +

    // 相关
    '<section class="d-rel">' +
      '<div class="wrap">' +
        '<div class="section-head">' +
          '<div><span class="eyebrow">换个方向</span><h2>同主题的另外三个</h2></div>' +
        "</div>" +
        '<div class="rel-grid">' +
          rel.map(function (d) {
            return '<a class="rel-card" href="destination.html?id=' + encodeURIComponent(d.id) + '">' +
              '<div class="rel-cover">' +
                '<img src="images/covers/' + esc(d.id) + '.jpg" alt="' + esc(d.city) + '" loading="lazy" onerror="this.remove()">' +
                '<span class="rel-city">' + esc(d.city) + "</span>" +
              "</div>" +
              '<div class="rel-body">' +
                "<p>" + esc(d.tagline) + "</p>" +
                '<div class="rel-meta"><span>' + d.days + " 天</span><span>¥" + d.budget + "</span></div>" +
              "</div>" +
            "</a>";
          }).join("") +
        "</div>" +
      "</div>" +
    "</section>";

  /* ---------- 收尾 ---------- */
  loading.hidden = true;
  root.hidden = false;

  document.title = item.city + " 周末指南 · 周末去哪";
  var md = document.querySelector('meta[name="description"]');
  if (md) {
    md.setAttribute(
      "content",
      item.city + "，" + item.days + " 天人均 ¥" + item.budget + "。" + item.tagline +
      " 必去：" + item.mustSee.join("、") + "。" +
      (info && info.hour ? "最佳时段：" + info.hour + "。" : "")
    );
  }

  // 让浏览器返回时回到原位置：首页卡片链接带 id，这里给 body 一个锚
  document.body.dataset.city = item.city;

  // 页头吸顶状态
  var header = document.getElementById("siteHeader");
  var onScroll = function () {
    if (header) header.dataset.stuck = window.scrollY > 8 ? "true" : "false";
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();
