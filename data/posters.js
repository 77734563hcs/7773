/**
 * 首屏三层错落海报：可切换的主题与配图
 *
 * 每张海报（poster-1/2/3）各自维护一条主题队列，点一下就能换成下一个，
 * 也可以点海报下方的主题按钮直接跳过去。
 *
 * 图片来自 images/covers（16 城封面，统一 1200x750 横图）。
 * 海报是 3:4.1 的竖版，object-fit: cover 必然裁掉约 60% 的宽度，
 * 所以每张图都带一个 focus —— 横向裁切时的取景位置，0 靠左、1 靠右。
 * 选图原则：竖裁之后主体仍然完整、且水印落在裁切框之外。
 */
window.POSTERS = [
  {
    slot: 1,
    label: "古城",
    tone: "城",
    themes: [
      {
        key: "古城",
        img: "images/covers/quanzhou.jpg",
        city: "泉州",
        caption: "开元寺双塔",
        focus: 0.3,
        // 渐变兜底色，图片没加载出来时接住画面
        fallback:
          "repeating-linear-gradient(-32deg, oklch(94% 0.03 60 / 0.5) 0 2px, transparent 2px 9px), linear-gradient(165deg, oklch(58% 0.13 32), oklch(34% 0.09 30))",
      },
      {
        key: "海岛",
        img: "images/covers/xiamen.jpg",
        city: "厦门",
        caption: "鼓浪屿红瓦",
        focus: 0.46,
        fallback:
          "linear-gradient(168deg, oklch(66% 0.11 52), oklch(38% 0.08 42))",
      },
      {
        key: "夜色",
        img: "images/covers/lhasa.jpg",
        city: "拉萨",
        caption: "布达拉宫倒影",
        focus: 0.34,
        fallback:
          "linear-gradient(186deg, oklch(72% 0.06 250), oklch(30% 0.06 262))",
      },
      {
        key: "土城",
        img: "images/covers/xinjiang.jpg",
        city: "喀什",
        caption: "高台民居",
        focus: 0.42,
        fallback:
          "linear-gradient(172deg, oklch(74% 0.09 68), oklch(44% 0.08 52))",
      },
    ],
  },
  {
    slot: 2,
    label: "海边",
    tone: "海",
    themes: [
      {
        key: "海边",
        img: "images/covers/qingdao.jpg",
        city: "青岛",
        caption: "汇泉湾与红瓦",
        focus: 0.52,
        // 原图中央有一圈淡淡的图库水印，竖裁到 0.52 正好把它推到框外
        fallback:
          "radial-gradient(circle at 50% 118%, oklch(96% 0.02 70) 0 38%, transparent 39%), linear-gradient(190deg, oklch(72% 0.09 200), oklch(46% 0.07 215))",
      },
      {
        key: "山顶",
        img: "images/covers/guilin.jpg",
        city: "阳朔",
        caption: "遇龙河峰林",
        focus: 0.64,
        fallback:
          "linear-gradient(200deg, oklch(66% 0.1 148), oklch(40% 0.08 152))",
      },
      {
        key: "江边",
        img: "images/covers/fenghuang.jpg",
        city: "凤凰",
        caption: "沱江吊脚楼",
        focus: 0.6,
        fallback:
          "linear-gradient(190deg, oklch(58% 0.08 262), oklch(34% 0.06 250))",
      },
      {
        key: "雪园",
        img: "images/covers/suzhou.jpg",
        city: "苏州",
        caption: "雪后拙政园",
        focus: 0.28,
        fallback:
          "linear-gradient(178deg, oklch(92% 0.01 80), oklch(56% 0.03 150))",
      },
    ],
  },
  {
    slot: 3,
    label: "山野",
    tone: "野",
    themes: [
      {
        key: "山野",
        img: "images/covers/hangzhou.jpg",
        city: "杭州",
        caption: "龙井茶山",
        focus: 0.36,
        fallback:
          "conic-gradient(from 200deg at 62% 34%, oklch(84% 0.07 130) 0 22%, transparent 22%), linear-gradient(200deg, oklch(66% 0.1 148), oklch(40% 0.08 152))",
      },
      {
        key: "晒秋",
        img: "images/covers/wuyuan.jpg",
        city: "婺源",
        caption: "篁岭晒秋",
        focus: 0.5,
        fallback:
          "linear-gradient(172deg, oklch(80% 0.12 78), oklch(46% 0.13 36))",
      },
      {
        key: "石窟",
        img: "images/covers/datong.jpg",
        city: "大同",
        caption: "云冈大佛",
        focus: 0.46,
        fallback:
          "linear-gradient(174deg, oklch(78% 0.06 62), oklch(48% 0.07 46))",
      },
    ],
  },
];
