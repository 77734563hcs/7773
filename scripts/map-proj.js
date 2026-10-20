/**
 * 投影与视窗计算（供 map.js 与测试共用）
 *
 * 用墨卡托近似（Web Mercator），纬度先转 y=ln(tan(π/4+φ/2))，
 * 再把 (λ, y) 线性映射到画布。
 *
 * 关键是**视窗**的选择：中国全图（含南海诸岛到北纬 3.4°）在常规宽度下
 * 会让东部挤成一条，所以主图只画「有人住的那一块」，
 * 南海诸岛与十段线按惯例放进右下角小窗 —— 小窗里用的是同一套投影，
 * 换一组视窗参数即可，不另做一套坐标。
 */
(function (root) {
  "use strict";

  var W = 900;
  var H = 680;

  /** 主图视窗：西起帕米尔、东到东海，北起漠河、南到西沙以北 */
  var MAIN = { lng0: 72, lng1: 136.5, lat0: 15.5, lat1: 54.5 };

  /**
   * 窄屏专用视窗（竖版取景，画布同时换成 675×900）。
   * 主图是 900×680 的横版，塞进手机竖屏只占中间一条，
   * 上下两条全是海面，字号还得跟着缩到 0.46 倍。
   * 这里把画布换成 675×900，视窗也跟着调：
   *   经度 73.2–129.5  —— 喀什 75.99 在最西端，留出余量不贴边
   *   纬度 15.5–61     —— 比主图多放到北纬 61（漠河 53.5 已在框内），
   *                       目的是把竖版画布的高度撑起来，
   *                       否则 15.5–54.5 只能占到三分之二，头顶空一条
   * 余下的高度全压在底部，正好摆南海小窗和图例。
   */
  var NARROW = { lng0: 73.2, lng1: 131.5, lat0: 15.5, lat1: 58 };

  /** 小窗视窗：把北纬 3°（曾母暗沙）到 24° 拉满 */
  var INSET = { lng0: 105, lng1: 123, lat0: 2.5, lat1: 24.5 };

  var DEG = 180 / Math.PI;

  /**
   * 墨卡托的 y 坐标，**换算成"度"**。
   * 直写 ln(tan(π/4+φ/2)) 得到的是弧度，与经度的度数差两个数量级，
   * 横纵缩放比会疯掉。乘 180/π 之后 1 个单位 ≈ 1 度，与经度可直接比较。
   */
  function mercY(lat) {
    var r = (lat * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + r / 2)) * DEG;
  }

  function invMercY(y) {
    return Math.atan(Math.sinh(y / DEG)) * DEG;
  }

  /**
   * 生成一个投影器
   * @param {object} v 视窗 {lng0,lng1,lat0,lat1}
   * @param {number} w 画布宽
   * @param {number} h 画布高
   * @param {number} pad 四周留白（像素）
   * @param {object} [opt]
   * @param {number} [opt.alignY=0.5] 内容在画布里的纵向位置：0 贴顶、0.5 居中、1 贴底。
   *        竖版取景时地理跨度撑不满画布，留白全堆在下方正好放南海小窗和底注，
   *        所以窄屏传 0。
   */
  function projector(v, w, h, pad, opt) {
    pad = pad || 0;
    var alignY = opt && typeof opt.alignY === "number" ? opt.alignY : 0.5;

    var x0 = v.lng0;
    var x1 = v.lng1;
    /**
     * 墨卡托 y 随纬度升高而增大，所以北界（lat1）的 y 反而更大。
     * 屏幕上要求北方在上：屏幕 y = 起点 + (北界y - 当前y) × 缩放比
     * 这里的跨度 = mercY(北界) - mercY(南界)，是个正数。
     */
    var yNorth = mercY(v.lat1);
    var ySouth = mercY(v.lat0);
    var span = yNorth - ySouth;

    var iw = w - pad * 2;
    var ih = h - pad * 2;

    // 保持经纬比例，取较小的缩放比，避免图形被拉变形
    var sx = iw / (x1 - x0);
    var sy = ih / span;
    var s = Math.min(sx, sy);

    // 横向居中
    var ox = pad + (iw - (x1 - x0) * s) / 2;
    // 纵向按 alignY 落位
    var oy = pad + (ih - span * s) * alignY;

    return {
      scale: s,
      window: v,
      /** 经纬度 → 像素 */
      xy: function (lng, lat) {
        return [ox + (lng - x0) * s, oy + (yNorth - mercY(lat)) * s];
      },
      /** 像素 → 经纬度（缩放时判断指针落在哪用得上） */
      lngLat: function (px, py) {
        return [x0 + (px - ox) / s, invMercY(yNorth - (py - oy) / s)];
      },
      /** 该视窗下地图内容在画布上的实际包围盒 */
      box: function () {
        return {
          x: ox,
          y: oy,
          w: (x1 - x0) * s,
          h: span * s,
        };
      },
    };
  }

  /** 压平的一维环 [lng,lat,...] → SVG path 的 d 串 */
  function ringPath(ring, xy) {
    if (!ring || ring.length < 4) return "";
    var d = "";
    for (var i = 0; i < ring.length; i += 2) {
      var p = xy(ring[i], ring[i + 1]);
      d += (i === 0 ? "M" : "L") + round(p[0]) + " " + round(p[1]);
    }
    return d + "Z";
  }

  /** 一个多边形（外环 + 若干洞）→ 一条 path 的 d 串 */
  function polyPath(poly, xy) {
    var d = "";
    for (var i = 0; i < poly.length; i++) d += ringPath(poly[i], xy);
    return d;
  }

  function round(n) {
    return Math.round(n * 10) / 10;
  }

  root.MAPGEO = {
    W: W,
    H: H,
    MAIN: MAIN,
    NARROW: NARROW,
    INSET: INSET,
    mercY: mercY,
    invMercY: invMercY,
    projector: projector,
    ringPath: ringPath,
    polyPath: polyPath,
  };
})(window);
