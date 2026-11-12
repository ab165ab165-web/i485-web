/* instructions.js —— 填写说明页（B 文件）的版面定义 + 运行时资产清单
 *
 * 口径（2026-11-08 老板 23:44）：官方表**零插页**，说明页**单独一份 PDF**。
 *   A 文件 = 官方表 + 填值（27 页，内容流与模板逐页一致）
 *   B 文件 = 填写说明（1 页，Letter 612×792）
 *
 * 中文怎么来的：**构建期预渲染**。
 *   build/build-instructions.js → app/build/render-cover.py（本机 Noto CJK）
 *   → app/assets/cover-instructions.png（整页）+ app/assets/uncertain-N.png（13 张小句）
 * 运行时**只做 fetch + 贴图**，不再用 canvas 画中文：
 *   ① 不依赖客户设备上装没装中文字体；
 *   ② 低端机不用背 35MB 的 canvas 位图。
 *
 * 版面只有一处真相：buildLayout() 产出纯 JSON 坐标，构建期渲染器照它出图；
 * 运行时用 layout.uncertainSlot 知道「另有 N 题…」那句贴在哪个位置。
 *
 * 全局名同时挂 I485Instructions 和 I485Cover（旧验收脚本按 I485Cover.buildLayout
 * 做 monkey-patch，两个名字都指向同一份实现）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    module.exports.I485Cover = api;
    module.exports.I485Instructions = api;
  } else {
    root.I485Instructions = api;
    root.I485Cover = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Letter（pt）—— 与官方 I-485 表同尺寸，本机打印不混纸 */
  var LETTER = { width: 612, height: 792 };
  /* 300dpi 等效：1pt = 300/72 px（宽 2550 ≥ 2400、高 3300 ≥ 3000） */
  var SCALE = 300 / 72;

  /* 顶部安全边：红条与页面上沿至少留 10mm（≈28.35pt），取 34pt ≈ 12mm。
     打印机不可打印区通常在 5–10mm，字压太靠上会被切掉。 */
  var SAFE_TOP = 34;
  var MM_PER_PT = 25.4 / 72;

  var COLOR = {
    banner: '#C02626',
    onBanner: '#FFFFFF',
    title: '#111827',
    body: '#374151',
    count: '#111827',
    rule: '#9CA3AF',
    warn: '#B45309'
  };

  /* 版面常量（pt） */
  var M = 45;                 /* 左右页边距 */
  var RIGHT = LETTER.width - M; /* 右对齐基准线 */
  var BANNER_H = 86;          /* 红条高 */
  var BANNER_TOP = LETTER.height - SAFE_TOP;   /* 红条上沿 */
  var BANNER_BOTTOM = BANNER_TOP - BANNER_H;   /* 红条下沿 */
  var ROW_STEP = 40;          /* 12 行清单行距 */
  var ROW_FIRST = BANNER_BOTTOM - 76;          /* 清单首行基线 */
  var RULE_Y = 132;           /* 分隔线 */
  var BOTTOM_Y = 104;         /* 底部一句基线 */
  var SIGN_Y = 82;            /* 「签名必须手写」基线 */
  /* 「另有 N 题…」贴图槽位（pt，PDF 坐标：原点在左下）。
     槽高 26pt：Noto CJK 在 10.5pt 时的 ascent ≈ 12.5pt、descent ≈ 3.2pt，
     槽太矮会把字顶切掉（构建期实测过）。 */
  var SLOT = { x: M, y: 40, w: RIGHT - M, h: 26 };

  /* 不确定题数上限：构建期只预渲染 N = 0..12 共 13 张整句小图。
     N > 12 走 overflow 图（见 stripAssetName）。 */
  var MAX_UNCERTAIN = 12;

  /* 「Part 1 · 关于你（Information About You）」→「Part 1 · 关于你」 */
  function stripParen(t) {
    return String(t == null ? '' : t).replace(/[（(][^）)]*[）)]\s*$/, '').trim();
  }
  function joinCats(cats) {
    return (cats && cats.length) ? cats.join('、') : '其他';
  }
  function opText(group, o) {
    o.t = 'text';
    o.group = group;
    return o;
  }

  /* 顶部两行 + 底部一句（老板 23:44 定的口径） */
  var BANNER_TEXT_CN = '这份是填写说明，不是要提交的表格。';
  var BANNER_TEXT_EN = 'INSTRUCTIONS ONLY — NOT FOR SUBMISSION.';
  /* 口径（2026-11-09）：与完成页「这些格子工具不会填，可以在电脑里直接键入，
     也可以打印后手写」对齐 —— 说明页标题不再说「需要你手写」（B 文件可以键入，
     手写只是备选）。单行放得下：27 字 × 15pt ≈ 408pt < 可用宽 522pt。 */
  var TITLE_TEXT = '以下格子工具不会填：可以在电脑里键入，也可以打印后手写';
  var BOTTOM_TEXT = '其余格子已按你的答案填好，不要覆盖。';
  var SIGN_TEXT = '签名必须手写，盖章或打字的签名 USCIS 不接受。';

  /* opts: { parts:[{no,title,count,cats}], totalFields:number, uncertainCount:number }
   * uncertainCount 只影响「另有 N 题…」那一句 —— 而那句话在构建期已经烘进
   * 13 张小图里，本函数不画它，只把数字与槽位位置带出去。 */
  function buildLayout(opts) {
    opts = opts || {};
    var parts = opts.parts || [];
    var total = Number(opts.totalFields || 0);
    if (!total) {
      parts.forEach(function (p) { total += Number(p.count || 0); });
    }
    var uncertain = Math.max(0, Math.floor(Number(opts.uncertainCount || 0)));

    var ops = [];

    /* 顶部红条（离页面上沿 SAFE_TOP）+ 两行「不是要提交的表格」 */
    ops.push({ t: 'rect', group: 'banner', x: 0, y: BANNER_BOTTOM, w: LETTER.width, h: BANNER_H, fill: COLOR.banner });
    ops.push(opText('bannerText', {
      x: M, y: BANNER_TOP - 28, size: 13, bold: true, color: COLOR.onBanner, maxW: RIGHT - M,
      text: BANNER_TEXT_CN
    }));
    ops.push(opText('bannerText', {
      x: M, y: BANNER_TOP - 50, size: 10.5, bold: true, color: COLOR.onBanner, maxW: RIGHT - M,
      text: BANNER_TEXT_EN
    }));

    /* 标题 + 总数说明 */
    ops.push(opText('title', {
      x: M, y: BANNER_BOTTOM - 26, size: 15, bold: true, color: COLOR.title, maxW: RIGHT - M,
      text: TITLE_TEXT
    }));
    ops.push(opText('sub', {
      x: M, y: BANNER_BOTTOM - 50, size: 10.5, bold: false, color: COLOR.body, maxW: RIGHT - M,
      text: '共 ' + total + ' 格，按表上的 Part 归并如下（每一行 = 一个 Part）：'
    }));

    /* 12 行 Part 清单：左边 Part 名 + 类别，右边格数 */
    var y = ROW_FIRST;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i] || {};
      var label = stripParen(p.title) + '：' + joinCats(p.cats);
      ops.push(opText('rows', {
        x: M, y: y, size: 10.5, bold: false, color: COLOR.body, maxW: (RIGHT - M) - 70, text: label
      }));
      ops.push(opText('rows', {
        x: RIGHT, y: y, size: 10.5, bold: true, color: COLOR.count, maxW: 62, align: 'right',
        text: (Number(p.count || 0) + ' 格')
      }));
      y -= ROW_STEP;
    }

    /* 分隔线 + 底部一句 */
    ops.push({ t: 'line', group: 'rule', x1: M, y1: RULE_Y, x2: RIGHT, y2: RULE_Y, color: COLOR.rule, width: 0.75 });
    ops.push(opText('bottom', {
      x: M, y: BOTTOM_Y, size: 10.5, bold: false, color: COLOR.title, maxW: RIGHT - M,
      text: BOTTOM_TEXT
    }));
    ops.push(opText('bottom', {
      x: M, y: SIGN_Y, size: 10.5, bold: true, color: COLOR.warn, maxW: RIGHT - M,
      text: SIGN_TEXT
    }));

    return {
      version: 2,
      width: LETTER.width,
      height: LETTER.height,
      scale: SCALE,
      ops: ops,
      partCount: parts.length,
      totalFields: total,
      uncertainCount: uncertain,
      /* 「另有 N 题…」小图的贴图槽位（pt，PDF 坐标：原点在左下） */
      uncertainSlot: { x: SLOT.x, y: SLOT.y, w: SLOT.w, h: SLOT.h }
    };
  }

  /* 「另有 N 题你标了不确定…」整句小图的 layout（构建期单独渲染成 PNG）。
   * 背景留白（渲染器铺白），贴到整页图上不会露出接缝。 */
  function buildUncertainLayout(n) {
    var text;
    if (n > MAX_UNCERTAIN) {
      text = '你标了不确定的题超过 ' + MAX_UNCERTAIN + ' 题，对应格子已留空，请先核对再提交。';
    } else {
      text = '另有 ' + n + ' 题你标了不确定，对应格子已留空，请先核对再提交。';
    }
    return {
      version: 2,
      width: SLOT.w,
      height: SLOT.h,
      scale: SCALE,
      ops: [opText('uncertain', {
        x: 0, y: 13.5, size: 10.5, bold: true, color: COLOR.warn, maxW: SLOT.w, text: text
      })],
      uncertainCount: n
    };
  }

  /* 运行时按 N 选哪张小图。N=0 → 不贴（返回 null）。 */
  function stripAssetName(n) {
    n = Math.max(0, Math.floor(Number(n || 0)));
    if (n === 0) return null;
    if (n > MAX_UNCERTAIN) return 'assets/uncertain-overflow.png';
    return 'assets/uncertain-' + n + '.png';
  }

  function baseAssetName() { return 'assets/cover-instructions.png'; }

  return {
    LETTER: LETTER,
    SCALE: SCALE,
    SAFE_TOP: SAFE_TOP,
    MM_PER_PT: MM_PER_PT,
    COLOR: COLOR,
    MAX_UNCERTAIN: MAX_UNCERTAIN,
    BANNER_TEXT_CN: BANNER_TEXT_CN,
    BANNER_TEXT_EN: BANNER_TEXT_EN,
    TITLE_TEXT: TITLE_TEXT,
    BOTTOM_TEXT: BOTTOM_TEXT,
    SIGN_TEXT: SIGN_TEXT,
    buildLayout: buildLayout,
    buildUncertainLayout: buildUncertainLayout,
    stripAssetName: stripAssetName,
    baseAssetName: baseAssetName,
    stripParen: stripParen
  };
});
