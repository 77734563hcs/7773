/**
 * 目的地分布页
 *
 * 左地图 + 右清单，两边双向联动：
 *   - 地图标记：点一下进详情；泉州/厦门、苏州/杭州这类挨得近的会先合并成一个点，
 *     点开再散开，散开后点具体的城市才跳转
 *   - 清单项：鼠标移上去地图上对应标记放大，点击进详情
 *   - 窄屏：清单一律收进底部抽屉，地图全宽
 */
(function () {
  "use strict";

  var DATA = window.DESTINATIONS || [];
  var COORDS = window.COORDS || {};
  var GEO = window.GEO || null;
  var PRJ = window.MAPGEO;
  if (!DATA.length || !PRJ) return;

  var $ = function (id) {
    return document.getElementById(id);
  };

  /* ==========================================================
     0. 转义（必须定义在调用之前）
     ========================================================== */

  // 这几个以前挂在文件末尾。函数声明会被提升所以没事，
  // 但 escAttr 是 var 赋值，提升上去只是 undefined——
  // buildMarks() 一开始调它就抛 TypeError，整页死在第一行标记上。
  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var escAttr = escHtml;
  var escXml = escHtml;

  var svg = $("mapSvg");
  var landG = $("mapLand");
  var marksG = $("mapMarks");
  var insetEl = $("mapInset");
  var insetGEl = $("insetLand");
  var tip = $("mapTip");
  var listGroups = $("listGroups");
  var listCount = $("listCount");
  var listScroll = $("listScroll");
  var listEmpty = $("listEmpty");
  var filtersEl = $("listFilters");
  var searchInput = $("listSearch");
  var searchForm = $("listSearchForm");
  var clearBtn = $("listClear");
  var listRoot = $("mapList");
  var mapCanvas = $("mapCanvas");

  // 标记与分组的状态容器放在最前面初始化：
  // rebuild() 在启动时就会被调用，那时它们必须已经是数组
  var MERGE_R = 14; // 两个标记靠得比这个更近就合并
  var marks = []; // {item, x, y, el, spot, hidden}
  var groups = []; // {x, y, members:[mark], open}

  var isNarrow = function () {
    return window.matchMedia("(max-width: 900px)").matches;
  };

  /* ==========================================================
     1. 投影与底图
     ========================================================== */

  // 窄屏换成竖版画布，否则 900×680 塞进手机只占中间一条，
  // 上下全是海面，字号还得缩到一半
  var VB = { w: 900, h: 680 };

  function applyViewBox() {
    VB.w = isNarrow() ? 675 : 900;
    VB.h = isNarrow() ? 900 : 680;
    svg.setAttribute("viewBox", "0 0 " + VB.w + " " + VB.h);
  }

  function makeProj() {
    var narrow = isNarrow();
    var v = narrow ? PRJ.NARROW : PRJ.MAIN;
    // 窄屏：地理跨度（15.5–54.5°N）撑不满竖版画布，留白全压到底部，
    // 正好让南海小窗和图例站在海面上，别在头顶浪费一条白
    return PRJ.projector(v, VB.w, VB.h, narrow ? 10 : 26, narrow ? { alignY: 0 } : null);
  }

  var proj = null;
  var mainBox = null;

  function drawBase() {
    if (!GEO) {
      // 底图没加载出来时退化成纯色块，标记仍然可用
      landG.innerHTML = "";
      return;
    }
    var d = "";
    GEO.provinces.forEach(function (p) {
      p.polys.forEach(function (poly) {
        d += PRJ.polyPath(poly, proj.xy);
      });
    });
    landG.innerHTML = '<path class="map-province" d="' + d + '"></path>';
  }

  /** 右下角小窗：南海诸岛 + 十段线，用同一套投影换个视窗 */
  function drawInset() {
    if (!GEO || !GEO.jd) return;
    var box = insetEl.viewBox.baseVal;
    var w = box && box.width ? box.width : 132;
    var h = box && box.height ? box.height : 176;
    var ip = PRJ.projector(PRJ.INSET, w, h, 8);
    var d = "";
    GEO.jd.polys.forEach(function (poly) {
      d += PRJ.polyPath(poly, ip.xy);
    });
    insetGEl.innerHTML =
      '<path class="inset-hainan" d="' +
      (function () {
        // 海南岛也画进小窗，读者才认得出这是一块海域
        var hn = GEO.provinces.filter(function (p) {
          return p.name === "海南省";
        })[0];
        var out = "";
        if (hn) {
          hn.polys.forEach(function (poly) {
            var r = poly[0];
            // 只画北纬 17.5 以南的主岛，避免小窗塞进海南全省
            var keep = [];
            for (var i = 0; i < r.length; i += 2) {
              if (r[i + 1] >= 17.5) keep.push(r[i], r[i + 1]);
            }
            if (keep.length >= 8) out += PRJ.ringPath(keep, ip.xy);
          });
        }
        return out;
      })() +
      '"></path>' +
      '<path class="inset-jd" d="' + d + '"></path>';
  }

  /**
   * 窄屏下把挤出来的空档算清楚：
   * 投影保持经纬比例，竖版画布（675×900）装不下所有余量，
   * 图本身只占中间一段，上下会各剩一截海面。
   * 上面那截交给「海面就是海」，下面那截量出来喂给 CSS——
   * 图例、底注、南海小窗都定位在那条带里，不能靠自己猜高度。
   */
  function syncNarrowBands() {
    if (!mapCanvas) return;
    if (!isNarrow() || !mainBox) {
      mapCanvas.style.removeProperty("--band-bottom");
      mapCanvas.style.removeProperty("--band-top");
      return;
    }
    var k = mapCanvas.clientHeight / VB.h;
    var top = mainBox.y * k;
    var bottom = (VB.h - (mainBox.y + mainBox.h)) * k;
    mapCanvas.style.setProperty("--band-top", top.toFixed(1) + "px");
    mapCanvas.style.setProperty("--band-bottom", bottom.toFixed(1) + "px");
  }

  /** 重新算投影并重画底图（横竖屏切换时走这条路） */
  function rebuild() {
    applyViewBox();
    proj = makeProj();
    mainBox = proj.box();
    drawBase();
    // 标记是按旧投影算的坐标，得跟着重排
    if (marks.length) {
      marks.forEach(function (m) {
        var c = COORDS[m.item.id];
        if (!c) return;
        var xy = proj.xy(c.lng, c.lat);
        m.x = xy[0];
        m.y = xy[1];
      });
      cluster();
      // 重建时若正在搜索，可见集合得先算出来，
      // 否则 layout() 会把所有标记当可见，筛完又被盖回去
      var visible = {};
      DATA.filter(matches).forEach(function (d) {
        visible[d.id] = true;
      });
      marks.forEach(function (m) {
        m.hidden = !visible[m.item.id];
      });
      layout();
    } else {
      buildMarks();
    }
    syncNarrowBands();
  }

  drawInset();

  /* ==========================================================
     2. 标记（含近距合并）
     ========================================================== */

  // MERGE_R / marks / groups 已在文件开头初始化，见那里的说明

  var marksBound = false;

  function buildMarks() {
    marksG.innerHTML = "";
    marks = [];

    DATA.forEach(function (item) {
      var c = COORDS[item.id];
      if (!c) return;
      var xy = proj.xy(c.lng, c.lat);
      var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "mark");
      g.setAttribute("data-id", item.id);
      // 整组是键盘可达的按钮语义：SVG 里用 role/tabindex 代替 <button>
      g.setAttribute("role", "button");
      g.setAttribute("tabindex", "0");
      g.setAttribute("aria-label", item.city + "，" + (c.spot || "") + "，打开详情");

      g.innerHTML =
        '<circle class="mark-halo" r="13"></circle>' +
        '<circle class="mark-dot" r="5.6"></circle>' +
        '<text class="mark-label" x="0" y="-13" text-anchor="middle">' +
        escXml(item.city) +
        "</text>";

      var node = { item: item, x: xy[0], y: xy[1], el: g, spot: c.spot };
      g.__mark = node;
      marksG.appendChild(g);
      marks.push(node);
    });

    cluster();

    // 指针 / 键盘交互统一在容器上代理。
    // 只在第一次绑定：重建标记时的 addEventListener 不会因为
    // innerHTML 被清空而消失，重复绑会一次点击触发两三次跳转
    if (marksBound) return;
    marksBound = true;

    marksG.addEventListener("click", onMarkClick);
    marksG.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var g = e.target.closest(".mark");
      if (!g) return;
      e.preventDefault();
      onMarkClick(e);
    });
    marksG.addEventListener("mouseover", onMarkEnter);
    marksG.addEventListener("focusin", onMarkEnter);
    marksG.addEventListener("mouseout", onMarkLeave);
    marksG.addEventListener("focusout", onMarkLeave);
  }

  /**
   * 贪心分组：按 x 排序后逐个并到最近的组里
   * 只算分组，不碰 DOM——视口里还没确定要显示谁，先排版会把全组藏掉
   */
  function cluster() {
    var sorted = marks.slice().sort(function (a, b) {
      return a.x - b.x;
    });
    groups = [];

    sorted.forEach(function (m) {
      var home = null;
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        var dx = g.x - m.x;
        var dy = g.y - m.y;
        if (Math.sqrt(dx * dx + dy * dy) < MERGE_R) {
          home = g;
          break;
        }
      }
      if (home) {
        home.members.push(m);
        // 组成员变化后重算重心，避免链条式越并越偏
        var n = home.members.length;
        home.x = home.members.reduce(function (s, k) {
          return s + k.x;
        }, 0) / n;
        home.y = home.members.reduce(function (s, k) {
          return s + k.y;
        }, 0) / n;
      } else {
        groups.push({ x: m.x, y: m.y, members: [m], open: false });
      }
    });
  }

  /**
   * 把分组状态写回 DOM
   *
   * 摆完之后还要处理一件事：城市名会互相压住。
   * 手机上画布只有 412px 宽，苏州、杭州、南京在屏幕上只差十几像素，
   * 三个两字标签叠在一起，「苏州」被「杭州」盖掉一半——认不出是哪儿。
   * 所以排完先算一遍标签位置，压住的挪到点的另一边。
   */
  function layout() {
    // 先全部藏起来，再按分组摆
    marks.forEach(function (m) {
      m.el.style.display = "none";
      m.el.classList.remove("is-grouped");
    });
    Array.prototype.slice
      .call(marksG.querySelectorAll(".mark-cluster"))
      .forEach(function (n) {
        n.remove();
      });

    // 这一轮里实际露在外面的城市标签（聚合点自己就是数字，不参与）
    var labelled = [];

    groups.forEach(function (grp) {
      // 只看当前可见的成员：筛选后组里剩下谁，聚合点就数谁
      var live = grp.members.filter(function (m) {
        return !m.hidden;
      });
      if (!live.length) return;

      if (live.length === 1) {
        var only = live[0];
        place(only.el, only.x, only.y);
        only.el.classList.remove("is-grouped");
        labelled.push(only);
        return;
      }

      if (grp.open) {
        // 散开：围绕重心摆成一圈，半径随成员数增长
        var n = live.length;
        var r = n <= 2 ? 17 : 21;
        live.forEach(function (m, i) {
          var a = (Math.PI * 2 * i) / n - Math.PI / 2;
          place(m.el, grp.x + Math.cos(a) * r, grp.y + Math.sin(a) * r);
          m.el.classList.add("is-grouped");
          labelled.push(m);
        });
      } else {
        // 合并：只留一个计数点
        var c = document.createElementNS("http://www.w3.org/2000/svg", "g");
        c.setAttribute("class", "mark mark-cluster");
        c.setAttribute("data-group", String(groups.indexOf(grp)));
        c.setAttribute("role", "button");
        c.setAttribute("tabindex", "0");
        c.setAttribute("aria-label", "这里相邻有 " + live.length + " 个目的地，展开");
        c.innerHTML =
          '<circle class="cluster-halo" r="12"></circle>' +
          '<circle class="cluster-dot" r="11"></circle>' +
          '<text class="cluster-n" text-anchor="middle" dy="0.34em">' +
          live.length +
          "</text>";
        c.__cluster = grp;
        place(c, grp.x, grp.y);
        c.addEventListener("click", function (e) {
          e.stopPropagation();
          openCluster(grp);
        });
        c.addEventListener("keydown", function (e) {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          openCluster(grp);
        });
        c.addEventListener("mouseover", function () {
          var names = live
            .map(function (m) {
              return m.item.city;
            })
            .join("、");
          showTip(c.__cx, c.__cy, names, "点开选择");
        });
        c.addEventListener("mouseout", hideTip);
        marksG.appendChild(c);
      }
    });

    resolveLabels(labelled);

    // 散开时是重点看的场合，藏起来的名字全放出来——
    // 最多 6 个，挤一点也比「一圈红点没名字」强
    if (labelled.length && labelled.some(function (m) { return m.el.classList.contains("is-grouped"); })) {
      labelled.forEach(function (m) {
        if (!m.quiet) return;
        m.quiet = false;
        var t = m.el.querySelector(".mark-label");
        if (!t) return;
        t.classList.remove("is-quiet");
        t.setAttribute("x", "0");
        t.setAttribute("y", "-13");
        t.setAttribute("text-anchor", "middle");
      });
    }
    syncLabelTier();
  }

  /* ---------- 标签避让 ---------- */

  // 标签默认在点上方 13px，字高按 9.5px 字号算上描边约 12px
  var LABEL_H = 12;
  var LABEL_DY = 13;

  // 能尝试的落点：[纵向偏移(相对点), 锚点, 横向偏移]。
  // 半径 1 → 半径 2 → 半径 3，每个半径先上后下、先近后远。
  // 早先只有 5 个固定落点，80 座城一来就全挤在苏州那一块，
  // 五个位置都被占掉之后只能「退回默认位置」，于是叠成一片。
  var LABEL_SLOTS = (function () {
    var out = [
      { dx: 0, dy: -LABEL_DY, anchor: "middle" },
      { dx: 0, dy: LABEL_DY + 9, anchor: "middle" },
    ];
    [12, 22, 32, 44].forEach(function (r) {
      out.push({ dx: r, dy: -LABEL_DY, anchor: "start" });
      out.push({ dx: r, dy: LABEL_DY + 9, anchor: "start" });
      out.push({ dx: -r, dy: -LABEL_DY, anchor: "end" });
      out.push({ dx: -r, dy: LABEL_DY + 9, anchor: "end" });
      out.push({ dx: 0, dy: -LABEL_DY - r, anchor: "middle" });
      out.push({ dx: 0, dy: LABEL_DY + 9 + r, anchor: "middle" });
    });
    return out;
  })();

  /**
   * 给标签找位置。
   *
   * 三件事按顺序做，缺一件都会在 80 城规模上露馅：
   *
   * 1. 「点位」也算占位。以前只避让标签之间，不管圆点——
   *    结果标签能端端正正压在旁边那个点的圆心上，标签写着「南京」，
   *    底下盖着的却是扬州的点。
   *
   * 2. 挑不出位置的宁可**不显示**，也别硬塞。退回默认位置 = 叠字，
   *    两张字糊成一块谁都读不出来，比少一个标签更糟。
   *    少掉的那些靠悬停/选中/列表来补，见 syncLabelTier。
   *
   * 3. 谁先落位要公平：离热点越远（邻居越少）的点越先摆，
   *    它们的标签本来就容易放；长三角那一团留到最后，
   *    反正它们的名字可以从清单和悬停里读到。
   */
  function resolveLabels(list) {
    if (!list.length) return;
    var k = vbScale();

    // 已落位的标签框。圆点不放进这里——见下面那句注释
    var freeBoxes = [];

    // 先把所有圆点占掉，标签不能压在点上
    var dots = list.map(function (m) {
      return { owner: m, box: dotBox(m.x, m.y, k) };
    });

    // 邻居计数：半径 26px 内还有几个点，越少越先摆
    var crowded = list.map(function (m) {
      var n = 0;
      list.forEach(function (o) {
        if (o === m) return;
        if (Math.hypot(o.x - m.x, o.y - m.y) < 26 * k) n++;
      });
      return { m: m, n: n };
    });

    crowded
      .sort(function (a, b) {
        return a.n - b.n || a.m.x - b.m.x || a.m.y - b.m.y;
      })
      .forEach(function (rec) {
        var m = rec.m;
        var t = m.el.querySelector(".mark-label");
        if (!t) return;

        // 自己的那个点不算障碍。
        // 之前把所有 dot 一股脑塞进 taken，连自己的一起算——
        // 于是「上方居中」这个位置永远判定为撞了自己的圆心，
        // 标签被逼到邻居的头顶上，图上出现「天津 济南」共用一处、
        // 却谁都不挨着自己那个点的情况。
        var taken = [];
        dots.forEach(function (d) {
          if (d.owner !== m) taken.push(d.box);
        });
        freeBoxes.forEach(function (b) {
          taken.push(b);
        });

        var w = (t.getComputedTextLength && t.getComputedTextLength()) || 18;
        var box = chooseLabelBox(m.x, m.y, w, taken, k);

        if (!box) {
          // 放不下：藏起来，但保留字的位置信息，等它被悬停时再显形
          t.removeAttribute("x");
          t.removeAttribute("y");
          t.removeAttribute("text-anchor");
          t.classList.add("is-quiet");
          m.quiet = true;
          return;
        }
        t.classList.remove("is-quiet");
        m.quiet = false;
        freeBoxes.push(box);
        // 坐标是相对点算的（<g> 上有 translate），这里换回相对偏移
        t.setAttribute("x", String(Math.round(box.dx * 10) / 10));
        t.setAttribute(
          "y",
          String(Math.round((box.y - m.y + LABEL_H - 2) * 10) / 10)
        );
        t.setAttribute("text-anchor", box.anchor);
      });
  }

  /** 圆点的占位框：直径 11.2 的圆，按 kp 折回地图坐标 */
  function dotBox(cx, cy, px) {
    var r = 8 * px;
    return { x: cx - r, y: cy - r, w: r * 2, h: r * 2, dot: true };
  }

  /** 屏幕 1px 对应多少 viewBox 单位（宽屏 ≈1.1，窄屏 ≈1.3） */
  function vbScale() {
    var rect = svg.getBoundingClientRect();
    if (!rect.width || !VB.w) return 1;
    return VB.w / rect.width;
  }

  /**
   * 标签距自己圆点的最远横/纵向偏移。
   *
   * 只看「放不放得下」不够：密集区里 44px 半径的槽位也能塞进去，
   * 但标签已经跑到邻居的地盘上，读者会把它认成邻居的名字。
   * 反过来卡得太死也不行——北京、天津、济南挨得近，
   * 16px 以内根本挤不下三个名字，一卡就三个全藏，地图上剩三颗红点。
   *
   * 所以上限取一个「还认得出是它自己」的距离：横向一个字宽左右，
   * 纵向不超过两行字。超出这个数才让位。
   */
  var LABEL_MAX_DX = 26;
  var LABEL_MAX_DY = 34;

  function chooseLabelBox(cx, cy, w, taken, px) {
    // 三个量纲要分清，混了就会算错：
    //   w           文字宽度，getComputedTextLength() 给的是 **viewBox 单位**
    //   LABEL_H/DY  设计稿上的 **屏幕像素**
    //   px          1 屏幕像素 = 多少 viewBox 单位
    var h = LABEL_H * px;
    var gap = px; // 1px 缝隙
    for (var i = 0; i < LABEL_SLOTS.length; i++) {
      var s = LABEL_SLOTS[i];
      if (Math.abs(s.dx) > LABEL_MAX_DX) continue;
      if (Math.abs(s.dy) > LABEL_DY + LABEL_MAX_DY) continue;
      var dx = s.dx * px;
      var left =
        s.anchor === "middle" ? cx + dx - w / 2 :
        s.anchor === "start" ? cx + dx :
        cx + dx - w;
      var top = cy + s.dy * px - h;
      var box = { x: left, y: top, w: w, h: h, anchor: s.anchor, dx: dx };
      var clash = false;
      for (var j = 0; j < taken.length; j++) {
        var t = taken[j];
        if (
          box.x < t.x + t.w + gap &&
          t.x < box.x + box.w + gap &&
          box.y < t.y + t.h + gap &&
          t.y < box.y + box.h + gap
        ) {
          clash = true;
          break;
        }
      }
      if (!clash) return box;
    }
    // 一个位置都空不出来：返回 null，由调用方决定怎么降级。
    // 以前这里返回默认位置，等于「宁可叠也不空着」——
    // 两个字的标签叠在另一个上面，谁也认不出，比不显示更差
    return null;
  }


  function place(el, x, y) {
    el.setAttribute("transform", "translate(" + r1(x) + " " + r1(y) + ")");
    // layout() 开头把所有标记设成了 display:none，摆到这里就得显回来，
    // 否则「只在 DOM 里存在、屏幕上没有」——所有点都变成看不见的幽灵
    el.style.display = "";
    el.__cx = x;
    el.__cy = y;
  }

  function openCluster(grp) {
    groups.forEach(function (g) {
      if (g !== grp) g.open = false;
    });
    grp.open = true;
    layout();
    // 展开后把焦点交给第一个成员，键盘用户不至于丢失位置
    var first = grp.members[0].el;
    first.focus({ preventScroll: true });
  }

  function collapseOthers(keepGrp) {
    var changed = false;
    groups.forEach(function (g) {
      if (g.open && g !== keepGrp) {
        g.open = false;
        changed = true;
      }
    });
    if (changed) layout();
  }

  /* ---------- 标记事件 ---------- */

  function onMarkClick(e) {
    var g = e.target.closest(".mark");
    if (!g || !g.__mark) return;
    e.stopPropagation();
    var m = g.__mark;
    select(m.item.id);
    openDetail(m.item.id);
  }

  function onMarkEnter(e) {
    var g = e.target.closest(".mark");
    if (!g || !g.__mark) return;
    var m = g.__mark;
    // 标记自己也得点亮。之前只同步了清单项，标记靠 :hover 假装高亮——
    // 键盘 focus 和自动化测试都拿不到 :hover，于是「亮没亮」根本无从判断
    if (hovered !== m) {
      if (hovered) hovered.el.classList.remove("is-hover");
      hovered = m;
      m.el.classList.add("is-hover");
      // 挤不下而藏起来的名字，指过去的时候要显形
      syncLabelTier();
    }
    highlightList(m.item.id, true);
    showTip(
      g.__cx,
      g.__cy,
      m.item.city,
      (m.spot ? m.spot + " · " : "") + m.item.tagline
    );
  }

  function onMarkLeave(e) {
    var g = e.target.closest(".mark");
    if (!g || !g.__mark) return;
    // 指针从圆点挪到同一组的文字上也会触发 mouseout，
    // 但两个节点的 closest('.mark') 是同一个，不该当成离开
    if (e.relatedTarget && g.contains(e.relatedTarget)) return;
    if (hovered === g.__mark) {
      g.__mark.el.classList.remove("is-hover");
      hovered = null;
    }
    highlightList(g.__mark.item.id, false);
    syncLabelTier();
    hideTip();
  }

  // 当前被点亮的那个标记，切走时要知道先关谁
  var hovered = null;

  /* ---------- 悬停小卡 ---------- */

  function showTip(x, y, title, sub) {
    if (!tip) return;
    tip.innerHTML =
      '<strong>' + escHtml(title) + "</strong>" +
      '<span>' + escHtml(sub || "") + "</span>" +
      '<em>点击查看 →</em>';
    tip.hidden = false;

    // SVG 坐标 → 画布像素
    var rect = svg.getBoundingClientRect();
    var par = mapCanvas.getBoundingClientRect();
    var vb = svg.viewBox.baseVal;
    var k = rect.width / vb.width;
    var px = rect.left - par.left + x * k;
    var py = rect.top - par.top + y * k;

    tip.style.left = px + "px";
    tip.style.top = py + "px";
    // 翻到哪边由 CSS 的 translate 决定，越界时补一个修正类
    var tw = tip.offsetWidth || 180;
    tip.classList.toggle("flip-x", px + tw / 2 > par.width - 8);
    tip.classList.toggle("flip-y", py - 60 < 0);
  }

  function hideTip() {
    if (tip) tip.hidden = true;
  }

  /* ==========================================================
     3. 缩放与拖拽
     ========================================================== */

  var view = { k: 1, x: 0, y: 0 };
  var K_MAX = 3.2;

  function applyView() {
    var cx = PRJ.W / 2;
    var cy = PRJ.H / 2;
    svg.style.transformOrigin = cx + "px " + cy + "px";
    svg.style.transform =
      "translate(" + view.x + "px," + view.y + "px) scale(" + view.k + ")";
    svg.classList.toggle("is-zoomed", view.k > 1.02);
    hideTip();
    queueRelayout();
  }

  /**
   * 缩放之后必须重排标签。
   *
   * 标签位置是按「屏幕像素」算的（字高 12px、缝隙 1px），
   * 而屏幕像素随缩放变——放大两倍，同样的 viewBox 距离就只占一半屏幕。
   * 不重排的话，放大后标签还按原来的密度挤在一起，
   * 那缩放就只是把挤的样子放大了，一点没变清楚。
   *
   * 用 rAF 合并：拖动时每一帧都会 applyView，不能每帧都重排。
   */
  var relayoutTimer = null;
  function queueRelayout() {
    if (relayoutTimer) return;
    relayoutTimer = requestAnimationFrame(function () {
      relayoutTimer = null;
      if (!marks.length) return;
      layout();
    });
  }

  function zoomBy(ratio, anchor) {
    var next = Math.min(K_MAX, Math.max(1, view.k * ratio));
    if (Math.abs(next - view.k) < 0.001) return;
    var a = anchor || { x: 0, y: 0 };
    // 以锚点为中心缩放：位移按比例修正，视觉上指针下的那块不动
    view.x = a.x - (a.x - view.x) * (next / view.k);
    view.y = a.y - (a.y - view.y) * (next / view.k);
    view.k = next;
    if (view.k <= 1.001) {
      view.k = 1;
      view.x = 0;
      view.y = 0;
    }
    clampPan();
    applyView();
  }

  function clampPan() {
    // 放大后最多拖到图边，别把地图拖出画布
    var maxX = ((view.k - 1) * PRJ.W) / 2;
    var maxY = ((view.k - 1) * PRJ.H) / 2;
    view.x = Math.min(maxX, Math.max(-maxX, view.x));
    view.y = Math.min(maxY, Math.max(-maxY, view.y));
  }

  var zoomBar = document.querySelector(".map-zoom");
  if (zoomBar) {
    zoomBar.addEventListener("click", function (e) {
      var b = e.target.closest("[data-zoom]");
      if (!b) return;
      var act = b.dataset.zoom;
      if (act === "in") zoomBy(1.45);
      else if (act === "out") zoomBy(1 / 1.45);
      else {
        view.k = 1;
        view.x = 0;
        view.y = 0;
        applyView();
      }
    });
  }

  // 滚轮缩放：只在指针位于地图上时接管，避免整页滚动被吃掉
  mapCanvas.addEventListener(
    "wheel",
    function (e) {
      if (!e.ctrlKey && !svg.classList.contains("is-zoomed")) {
        // 未放大时滚轮照常滚页面，横向捏合才缩放
        return;
      }
      if (Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      var r = svg.getBoundingClientRect();
      var vb = svg.viewBox.baseVal;
      var k = r.width / vb.width;
      var ax = (e.clientX - r.left) / k + vb.width / 2;
      var ay = (e.clientY - r.top) / k + vb.height / 2;
      zoomBy(e.deltaY < 0 ? 1.14 : 1 / 1.14, {
        x: ax - PRJ.W / 2,
        y: ay - PRJ.H / 2,
      });
    },
    { passive: false }
  );

  // 指针拖拽（鼠标与单指）
  var drag = null;
  var moved = false;

  svg.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    moved = false;
  });

  svg.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x;
    var dy = e.clientY - drag.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    moved = true;
    svg.setPointerCapture && svg.setPointerCapture(e.pointerId);
    view.x = drag.vx + dx;
    view.y = drag.vy + dy;
    clampPan();
    applyView();
    mapCanvas.classList.add("is-dragging");
  });

  function endDrag() {
    if (!drag) return;
    drag = null;
    mapCanvas.classList.remove("is-dragging");
    // 拖过之后紧接着的 click 不应触发标记跳转
    if (moved) {
      setTimeout(function () {
        moved = false;
      }, 0);
    }
  }

  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  // 拖拽结束时吞掉那次 click
  marksG.addEventListener(
    "click",
    function (e) {
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
        moved = false;
      }
    },
    true
  );

  /* ---------- 触摸：双指缩放 ---------- */

  var pinch = null;

  svg.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches.length !== 2) return;
      drag = null;
      var a = e.touches[0];
      var b = e.touches[1];
      pinch = {
        d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        k: view.k,
        cx: (a.clientX + b.clientX) / 2,
        cy: (a.clientY + b.clientY) / 2,
      };
    },
    { passive: true }
  );

  svg.addEventListener(
    "touchmove",
    function (e) {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      var a = e.touches[0];
      var b = e.touches[1];
      var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (!pinch.d) return;
      var target = Math.min(K_MAX, Math.max(1, (pinch.k * d) / pinch.d));
      var r = svg.getBoundingClientRect();
      var vb = svg.viewBox.baseVal;
      var kk = r.width / vb.width;
      zoomBy(target / view.k, {
        x: (pinch.cx - r.left) / kk - PRJ.W / 2,
        y: (pinch.cy - r.top) / kk - PRJ.H / 2,
      });
    },
    { passive: false }
  );

  svg.addEventListener("touchend", function (e) {
    if (e.touches.length < 2) pinch = null;
  });

  /* ==========================================================
     4. 清单
     ========================================================== */

  var state = { q: "", theme: "全部", selected: null };

  /* 清单按出行方式分段。分段标签是推断出来的，不是写死的结论：
     泉州 2 天 620、喀什 3 天 2400，预算差四倍，价格本身就
     说明了远近，不适合用「2 小时」「半天」这种对每个出发地都不成立的绝对时辰。 */
  var REACH_ORDER = [
    { key: "near", label: "不坐飞机", note: "一张高铁票就走" },
    { key: "far", label: "要飞一趟", note: "预留一整个白天" },
  ];

  /**
   * 粗分出行方式。只看车次串里有没有「飞机」，够用且能解释：
   * 厦门的「高铁 / 飞机」写明飞机，就归 far——同省的泉州只坐高铁，
   * 归 near。所以按省份猜一律是错的。
   */
  function reachOf(item) {
    return /飞机|航班/.test(item.transit || "") ? "far" : "near";
  }

  var THEMES = ["全部", "古城", "海边", "美食", "徒步", "夜景", "远行"];

  function renderFilters() {
    filtersEl.innerHTML = THEMES.map(function (t) {
      return (
        '<button type="button" class="list-chip" data-theme="' +
        escAttr(t) +
        '" aria-pressed="' +
        (state.theme === t ? "true" : "false") +
        '">' +
        escHtml(t) +
        "</button>"
      );
    }).join("");
  }

  function matches(item) {
    if (state.theme !== "全部") {
      var hit = item.tags.some(function (t) {
        return t.indexOf(state.theme) >= 0;
      });
      if (!hit && item.vibe.indexOf(state.theme) >= 0) hit = true;
      if (!hit) return false;
    }
    if (!state.q) return true;
    var q = state.q.toLowerCase();
    var words = q.split(/\s+/);

    // 两个字段，权重不同：
    //  city  城市名 / 省名 / 情绪标签 —— 这几项是「这座城是什么」。
    //  other 交通、季节、标签、必去、吃什么 —— 这些是「描述」。
    //        城市扩到 80 座之后，「高铁 1 小时（杭州出发）」这种句子
    //        会让搜「杭州」也搜出湖州、台州，属于典型的误召回。
    //
    // 规则：任一关键词命中城市字段 → 只认城市字段，描述不参与。
    //       一个都没命中城市字段 → 退回全字段，搜「火锅」这类需求还得好使。
    var city = [item.city, item.region, item.vibe].join(" ").toLowerCase();
    var other = [
      item.tagline,
      item.best,
      item.transit,
      item.tags.join(" "),
      item.mustSee.join(" "),
      item.eat,
    ]
      .join(" ")
      .toLowerCase();
    var hay = city + " " + other;

    var hitCity = words.some(function (w) {
      return city.indexOf(w) >= 0;
    });
    var pool = hitCity ? city : hay;
    return words.every(function (w) {
      return pool.indexOf(w) >= 0;
    });
  }

  function renderList() {
    var shown = DATA.filter(matches);

    // 城市名命中的排最前：搜「杭州」时，杭州必须在第一行。
    // 之前按出行半径分组排，湖州（杭州出发 1 小时）会排到杭州前面——
    // 用户只是想找杭州，却被两个「从杭州出发」的邻居顶掉。
    if (state.q) {
      var q = state.q.toLowerCase();
      shown.sort(function (a, b) {
        var ca = a.city.toLowerCase().indexOf(q) >= 0 ? 0 : 1;
        var cb = b.city.toLowerCase().indexOf(q) >= 0 ? 0 : 1;
        return ca - cb;
      });
    }

    var byReach = { near: [], far: [] };
    shown.forEach(function (d) {
      byReach[reachOf(d)].push(d);
    });

    var html = "";
    REACH_ORDER.forEach(function (r) {
      var arr = byReach[r.key];
      if (!arr.length) return;
      html +=
        '<section class="list-group" data-reach="' +
        r.key +
        '">' +
        '<h2 class="list-group-head"><span>' +
        escHtml(r.label) +
        "</span><em>" +
        escHtml(r.note) +
        "</em><b>" +
        arr.length +
        "</b></h2>" +
        '<ul class="list-items">' +
        arr
          .map(function (d) {
            return (
              '<li><button type="button" class="list-item" data-id="' +
              escAttr(d.id) +
              '">' +
              '<span class="li-city">' +
              escHtml(d.city) +
              "</span>" +
              '<span class="li-meta">' +
              escHtml(d.region) +
              " · " +
              d.days +
              " 天 · ¥" +
              d.budget +
              "</span>" +
              '<span class="li-tags">' +
              d.tags
                .slice(0, 2)
                .map(function (t) {
                  return "<i>" + escHtml(t) + "</i>";
                })
                .join("") +
              "</span>" +
              '<svg class="li-go" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
              '<path d="M3 8h10M9 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
              "</button></li>"
            );
          })
          .join("") +
        "</ul></section>";
    });

    listGroups.innerHTML = html;
    listCount.textContent = shown.length;
    listCount.hidden = !shown.length;
    listEmpty.hidden = shown.length > 0;

    // 首屏那句「N 个周末，落在这一张图上」也从数据来，别再手写数字
    var introN = $("introCount");
    if (introN) introN.textContent = String(DATA.length);
    var mapTitle = $("mapTitle");
    if (mapTitle) {
      mapTitle.textContent = "中国地图上的 " + DATA.length + " 个周末目的地";
    }

    // 地图上只保留当前可见的目的地
    var visible = {};
    shown.forEach(function (d) {
      visible[d.id] = true;
    });
    marks.forEach(function (m) {
      m.hidden = !visible[m.item.id];
    });
    // 可见集合变了就重排一次，否则聚合点会数错人
    layout();
  }

  filtersEl.addEventListener("click", function (e) {
    var b = e.target.closest(".list-chip");
    if (!b) return;
    state.theme = b.dataset.theme;
    Array.prototype.forEach.call(
      filtersEl.querySelectorAll(".list-chip"),
      function (x) {
        x.setAttribute(
          "aria-pressed",
          x.dataset.theme === state.theme ? "true" : "false"
        );
      }
    );
    renderList();
  });

  listGroups.addEventListener("click", function (e) {
    var b = e.target.closest(".list-item");
    if (!b) return;
    select(b.dataset.id);
    openDetail(b.dataset.id);
  });

  listGroups.addEventListener("mouseover", function (e) {
    var b = e.target.closest(".list-item");
    if (!b) return;
    hoverMark(b.dataset.id, true);
  });

  listGroups.addEventListener("mouseout", function (e) {
    var b = e.target.closest(".list-item");
    if (!b) return;
    hoverMark(b.dataset.id, false);
  });

  // 键盘：上下键在清单里走
  listGroups.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    var items = Array.prototype.slice.call(
      listGroups.querySelectorAll(".list-item")
    );
    var i = items.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    var next = items[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) next.focus();
  });

  /* ---------- 搜索 ---------- */

  var timer = null;

  function queueSearch() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      state.q = searchInput.value.trim();
      clearBtn.hidden = !state.q;
      renderList();
    }, 200);
  }

  searchInput.addEventListener("input", queueSearch);
  searchForm.addEventListener("submit", function (e) {
    e.preventDefault();
    clearTimeout(timer);
    state.q = searchInput.value.trim();
    clearBtn.hidden = !state.q;
    renderList();
  });
  clearBtn.addEventListener("click", function () {
    searchInput.value = "";
    state.q = "";
    clearBtn.hidden = true;
    renderList();
    searchInput.focus();
  });

  var resetBtn = $("listReset");
  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      searchInput.value = "";
      state.q = "";
      state.theme = "全部";
      clearBtn.hidden = true;
      renderFilters();
      renderList();
    });
  }

  /* ---------- 联动高亮 ---------- */

  function highlightList(id, on) {
    var el = listGroups.querySelector('.list-item[data-id="' + id + '"]');
    if (el) el.classList.toggle("is-hover", on);
  }

  function hoverMark(id, on) {
    var m = null;
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].item.id !== id) continue;
      m = marks[i];
      break;
    }
    if (!m) return;
    m.el.classList.toggle("is-hover", on);
    syncLabelTier();
    if (!on) {
      // 从清单移开时，聚合点上的临时定格也要撤掉
      Array.prototype.forEach.call(
        marksG.querySelectorAll(".mark-cluster.is-hover"),
        function (c) {
          c.classList.remove("is-hover");
        }
      );
      return;
    }
    if (m.el.style.display !== "none") return;
    // 被折叠进聚合点时，点亮它所在的那个聚合点——只点这一个，
    // 不是把版面上所有聚合点一起点亮
    groups.forEach(function (g) {
      if (g.open || g.members.indexOf(m) < 0) return;
      var c = marksG.querySelector(
        '.mark-cluster[data-group="' + groups.indexOf(g) + '"]'
      );
      if (c) c.classList.add("is-hover");
    });
  }

  function select(id) {
    state.selected = id;
    marks.forEach(function (m) {
      m.el.classList.toggle("is-active", m.item.id === id);
    });
    Array.prototype.forEach.call(
      listGroups.querySelectorAll(".list-item"),
      function (el) {
        el.classList.toggle("is-active", el.dataset.id === id);
      }
    );
    syncLabelTier();
  }

  /* ---------- 标签分档 ---------- */

  /**
   * 挤不下的标签平时不画，但用户指向它时必须能看见名字。
   *
   * is-quiet 的标签是「让位」的：它没抢到位置，字符还挂在 DOM 上，
   * 只是暂时不画。所以悬停、键盘聚焦、列表选中这三条路径上，
   * 都要把它显回来——否则地图上就真成了一个认不出名字的红点。
   */
  function syncLabelTier() {
    marks.forEach(function (m) {
      if (!m.quiet) return;
      var on =
        m.el.classList.contains("is-hover") ||
        m.el.classList.contains("is-active") ||
        m.el.contains(document.activeElement);
      m.el.classList.toggle("is-loud", on);
    });
  }

  /* ==========================================================
     5. 跳转 / 移动端抽屉
     ========================================================== */

  function openDetail(id) {
    location.href = "destination.html?id=" + encodeURIComponent(id);
  }

  var grip = $("listGrip");

  function setDrawer(open) {
    listRoot.dataset.open = open ? "true" : "false";
    if (grip) grip.setAttribute("aria-expanded", open ? "true" : "false");
    // 抽屉展开时锁住背后页面的滚动，否则手指滑到抽屉外整页跟着跑
    document.body.classList.toggle("is-drawer-open", open && isNarrow());
  }

  if (grip) {
    grip.addEventListener("click", function () {
      setDrawer(listRoot.dataset.open !== "true");
    });
  }

  /** 点抽屉里的空白处（不看地图）也允许降下去 */
  var startY = null;
  if (grip) {
    grip.addEventListener(
      "touchstart",
      function (e) {
        startY = e.touches[0].clientY;
      },
      { passive: true }
    );
    grip.addEventListener(
      "touchend",
      function (e) {
        if (startY == null) return;
        var dy = e.touches[0] ? e.touches[0].clientY : startY;
        var d = dy - startY;
        startY = null;
        if (d > 40) setDrawer(false);
        else if (d < -40) setDrawer(true);
      },
      { passive: true }
    );
  }

  function syncDrawer() {
    if (isNarrow()) {
      if (!listRoot.dataset.open) setDrawer(false);
    } else {
      delete listRoot.dataset.open;
      document.body.classList.remove("is-drawer-open");
      if (grip) grip.setAttribute("aria-expanded", "true");
    }
  }

  /**
   * 收起态的 peek 条会挡住页面最下面一条。
   * 地图还在视野里时留着它（那是入口），一旦往下滚过地图
   * 就滑走——否则滚到底也看不全最后几行，只是个固定的挡板
   */
  var mapPanel = $("mapPanel");
  var peekHidden = false;

  function syncPeek() {
    if (!isNarrow() || !mapPanel) return;
    var hide = mapPanel.getBoundingClientRect().bottom < 0;
    if (hide === peekHidden) return;
    peekHidden = hide;
    listRoot.classList.toggle("is-peek-away", hide);
  }

  if (mapPanel) {
    window.addEventListener("scroll", syncPeek, { passive: true });
  }

  // 横竖屏切换会换一套投影，只在窄/宽真正翻转时重建，
  // 否则手机上拖一下地址栏都会触发 resize，白白重排一次
  var wasNarrow = isNarrow();
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    syncDrawer();
    hideTip();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var now = isNarrow();
      if (now !== wasNarrow) {
        wasNarrow = now;
        rebuild();
        applyView();
      } else {
        // 只是尺寸变了（横竖屏、地址栏收起），留白带得重新量
        syncNarrowBands();
      }
    }, 160);
  });

  /* ==========================================================
     6. 启动
     ========================================================== */

  renderFilters();
  rebuild(); // 里面会调 buildMarks，投影和 viewBox 得先就位
  renderList();
  syncDrawer();
  applyView();

  // 点地图空白处：收起聚合、取消选中
  svg.addEventListener("click", function (e) {
    if (e.target.closest(".mark")) return;
    var changed = false;
    groups.forEach(function (g) {
      if (g.open) {
        g.open = false;
        changed = true;
      }
    });
    if (changed) layout();
    select(null);
  });

  // Esc：先收聚合，再清搜索
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var anyOpen = groups.some(function (g) {
      return g.open;
    });
    if (anyOpen) {
      groups.forEach(function (g) {
        g.open = false;
      });
      layout();
      return;
    }
    if (state.q) {
      searchInput.value = "";
      state.q = "";
      clearBtn.hidden = true;
      renderList();
    }
  });

  /* ---------- 小工具 ---------- */

  function r1(n) {
    return Math.round(n * 10) / 10;
  }

  // 暴露给测试用
  window.MAP_APP = {
    state: state,
    marks: marks,
    groups: groups,
    reachOf: reachOf,
    matches: matches,
    select: select,
    renderList: renderList,
    zoomBy: zoomBy,
    setDrawer: setDrawer,
    view: view,
    // 投影器会在横竖屏切换时被整个换掉，导出必须走取值函数，
    // 否则测试拿到的永远是启动时那一个
    proj: function () {
      return proj;
    },
    vb: function () {
      return { w: VB.w, h: VB.h };
    },
    rebuild: rebuild,
  };
})();
