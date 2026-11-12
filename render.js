/* I485Render —— 渲染层（v9 批 2）
 *
 * 只做一件事：拿「题目 + 答案」出 HTML 字符串。经典 script，挂 window.I485Render。
 * 不读写浏览器存档、不碰全局状态、不挂事件监听 —— 事件绑定留在 app.js。
 *
 * 入口：
 *   I485Render.renderQuestion(q, answers)   题卡正文（#qBody 的 innerHTML）
 *   I485Render.renderHint(q, answers)       { hidden, cls, html }（#qHint）
 *   I485Render.renderOptions(q, answers)    选项区字符串
 *   I485Render.renderInputs(q, answers)     输入区字符串
 *   I485Render.renderLiveWarn(q, answers)   Part 9 即时提示（'' 或 <p>）
 *   I485Render.optionList(q)                渲染顺序的选项数组（事件回绑用）
 *   I485Render.renderAnswerSheet(answers, opts)  核对页入口
 *     opts.uncertain  已标记「不确定」的题（{qid:true}），行尾显示「待确认」
 *     opts.now        生成时间（默认 new Date()；验收脚本传入固定值）
 */
(function (root) {
  'use strict';

  /* 与 app.js 同一张 9 字符国名格清单（只影响提示与 data-pdf） */
  /* 只读契约：这张表是「9 字符国名格」的唯一事实源，app.js 也直接读它。
     冻结防止任何一处顺手往里加键 → 渲染层/写入层口径分叉。 */
  var LIMIT_FIELDS = Object.freeze({ priorspouse_country_birth: 1, priorspouse_nationality: 1 });
  var LIVE_WARN_TEXT = '这题答「是」要在 Part 9 另写一段解释。不用重填，答完统一给你清单。';
  var COND_NOTE = '这题只在前面某些答案成立时出现（条件题）。如果上一个问题答案改了，这题可能自动消失。';

  function isGate(q) { return !!q.noPdf; }
  function isNoneOpt(o) {
    return /none of the above|以上都不是/i.test(String(o.label || '') + String(o.labelZh || ''));
  }
  function answeredYes(q, answers) {
    return (q.options || []).some(function (o) {
      if (answers[o.id] !== true) return false;
      return !/^(no|n\/a)$/i.test(o.label || '');
    });
  }
  function hintLevel(q, answers) {
    if (isGate(q)) return 'warn';
    if ((q.inputs || []).some(function (i) { return LIMIT_FIELDS[i.pdf]; })) return 'warn';
    if (/^9[a-g]$/.test(String(q.section)) && q.hasDetailsField && answeredYes(q, answers)) return 'warn';
    return 'info';
  }
  function showLiveWarn(q, answers) {
    if (!/^9[a-g]$/.test(String(q.section))) return false;
    if (!q.hasDetailsField) return false;
    return answeredYes(q, answers);
  }
  /* 中文里已经带了这段英文原文时，下面那行英文小字不再重复 */
  function zhHasEn(zh, en) {
    if (!zh || !en) return false;
    var norm = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); };
    var a = norm(zh), b = norm(en);
    if (!b) return false;
    return a.indexOf(b) >= 0;
  }

  /* ---------- 转义 ---------- */
  function escText(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return escText(s).replace(/"/g, '&quot;');
  }

  /* ---------- 背景大数字（v9 批 5） ----------
   * mockup 真相源 = .shots/art-directions/{A-文书质感,B-冷静工具,C-暖纸朱红}.html
   *   <div class="numeral" aria-hidden="true">01</div>
   * 值的口径：该题在**整套题库**里的序号（1 起）补零到两位；
   * 超过 99 不补零（保持 String(n) 语义：100 → "100"，173 → "173"）。
   * 序号按题库固定，不随条件题的可见性增减而变（同一题永远同一个号）。 */
  function questionNumber(q) {
    var MODEL = root.I485_QUESTIONS;
    if (!MODEL || !MODEL.questions || !MODEL.questions.length) return '';
    for (var i = 0; i < MODEL.questions.length; i++) {
      if (MODEL.questions[i].id === q.id) {
        var n = String(i + 1);
        return n.length < 2 ? '0' + n : n;
      }
    }
    return '';
  }

  /* ---------- 选项 ---------- */
  function optionList(q) {
    var opts = (q.options || []).slice();
    /* 「以上都不是」不管数据排第几，渲染时永远放最后（只在门题上重排） */
    if (isGate(q)) opts.sort(function (a, b) { return (isNoneOpt(a) ? 1 : 0) - (isNoneOpt(b) ? 1 : 0); });
    return opts;
  }

  function renderOptions(q, answers, ctx) {
    if (!q.options || !q.options.length) return '';
    var out = ['<div>'];
    optionList(q).forEach(function (o) {
      var cls = 'opt' + (q.multi ? ' multi' : '') + (answers[o.id] === true ? ' sel' : '') +
        (isGate(q) && isNoneOpt(o) ? ' opt-none' : '');
      out.push('<button type="button" class="' + cls + '">');
      out.push('<span class="mark">' + (answers[o.id] === true ? '✓' : '') + '</span>');
      out.push('<span class="lbl"><span class="' + (o.labelZh ? 'zh' : '') + '">' +
        escText(o.labelZh || o.label) + '</span>');
      if (o.labelZh && !zhHasEn(o.labelZh, o.label)) out.push('<small>' + escText(o.label) + '</small>');
      out.push('</span></button>');
    });
    out.push('</div>');

    /* 次级出口：不确定就先标记，答案不写、直接下一题；回来可取消 */
    if (!isGate(q) && !q.gatesChildren) {
      var u = (ctx && ctx.uncertain) || {};
      var marked = u[q.id] === true;
      out.push('<button type="button" class="btn ghost uncertain-btn' + (marked ? ' marked' : '') + '">' +
        (marked ? '已标记：不确定' : '不确定，先标记') + '</button>');
      if (marked) out.push('<p class="tiny un-note">这题不会写进 PDF，完成页会提醒你回来核对。</p>');
    }
    return out.join('');
  }

  /* ---------- 输入 ---------- */
  function renderInputs(q, answers) {
    if (!q.inputs || !q.inputs.length) return '';
    var out = [];
    q.inputs.forEach(function (inp, i) {
      out.push('<div class="field"><label>');
      var labelText = inp.labelZh || inp.label || (q.inputs.length > 1 ? '第 ' + (i + 1) + ' 项' : q.title);
      out.push(escText(labelText));
      var enLabel = inp.labelZh ? (inp.label || '') : '';
      if (enLabel && !zhHasEn(inp.labelZh, enLabel)) out.push('<small>' + escText(enLabel) + '</small>');
      out.push('</label>');

      if (inp.type === 'select' && inp.options && inp.options.length) {
        out.push('<select><option value="">— 请选择 —</option>');
        inp.options.forEach(function (op) {
          out.push('<option value="' + escAttr(op.value) + '">' + escText(op.text || op.value) + '</option>');
        });
        out.push('</select>');
      } else {
        var type = inp.type === 'date' ? 'date' : (inp.type === 'number' ? 'number' : 'text');
        out.push('<input type="' + type + '"');
        if (inp.placeholder) out.push(' placeholder="' + escAttr(inp.placeholder) + '"');
        out.push(' autocomplete="off" spellcheck="false"');
        if (type === 'text' && LIMIT_FIELDS[inp.pdf]) out.push(' data-pdf="' + escAttr(inp.pdf) + '"');
        out.push('>');
      }

      if (inp.type !== 'select' || !(inp.options && inp.options.length)) {
        var type2 = inp.type === 'date' ? 'date' : (inp.type === 'number' ? 'number' : 'text');
        /* 常驻提示：PDF 只认拉丁字符 */
        if (type2 === 'text') out.push('<div class="sub">请用英文或拼音填写</div>');
        /* 9 字符国名格：题内当场判断（初始隐藏，app.js 按已有答案回填） */
        if (type2 === 'text' && LIMIT_FIELDS[inp.pdf]) out.push('<div class="sub limitmsg" hidden=""></div>');
        if (type2 === 'date') {
          out.push('<div class="sub">按官方格式 mm/dd/yyyy 写入 PDF（选择器给的是 yyyy-mm-dd，会自动转换）</div>');
        }
      }
      out.push('</div>');
    });
    return out.join('');
  }

  function renderLiveWarn(q, answers) {
    if (!showLiveWarn(q, answers)) return '';
    return '<p class="live-warn">' + escText(LIVE_WARN_TEXT) + '</p>';
  }

  /* ---------- 题卡正文 ---------- */
  function renderQuestion(q, answers, ctx) {
    answers = answers || {};
    var out = [];
    if (q.options && q.options.length) out.push(renderOptions(q, answers, ctx));
    out.push(renderInputs(q, answers));
    out.push(renderLiveWarn(q, answers));
    if (!isGate(q) && q.gatesChildren) {
      out.push('<p class="tiny gates-note">这题决定后面会问到哪些题，先按最接近的情况选；拿不准就在答完后回来改。</p>');
    }
    /* 背景大数字放在**最后**：app.js 按 kids[0] 取选项容器、
       按 class 取 field / uncertain-btn，数字节点插在前面会把下标打乱。
       位置无影响 —— 它是绝对定位（相对题卡），DOM 顺序只影响同层绘制次序，
       而内容层 z-index:1 恒在它之上。 */
    out.push('<div class="numeral" aria-hidden="true">' + questionNumber(q) + '</div>');
    return out.join('');
  }

  /* ---------- 提示 ---------- */
  function renderHint(q, answers) {
    answers = answers || {};
    var cls = 'hint ' + hintLevel(q, answers);
    var parts = [];
    if (q.hintZh) parts.push(q.hintZh);
    if (q.cond) parts.push(COND_NOTE);
    if (!parts.length) return { hidden: true, cls: cls, html: '' };
    var text = parts.join(' ');
    if (isGate(q)) {
      var m = /^[^。！？]{1,40}[。！？]/.exec(text);
      var lead = m ? m[0] : text.slice(0, 40);
      var rest = (m ? text.slice(m[0].length) : text.slice(40)).trim();
      var html = escText(lead);
      if (rest) {
        html += '<details><summary>展开看说明</summary><p class="hintmore">' + escText(rest) + '</p></details>';
      }
      return { hidden: false, cls: cls, html: html };
    }
    return { hidden: false, cls: cls, html: escText(text) };
  }

  /* ---------- 核对页（v9 批 3a） ----------
   * 只出 HTML 字符串：不碰 DOM / 浏览器存档 / 事件。
   * 题号算法与目录面板一致 —— 段内序号按「当前可见题」算（条件题跟着答案增减）。
   * 口径：
   *   · 只列答过的题；普通未答题不列，只在顶部计数里体现。
   *   · 标记「不确定」的题会列出来（行尾「待确认」），否则用户找不到要回头核对的题。
   *   · 顶部「未答 M」= 题库总数 - 已填 N（N+M = 题库总数），不确定 K 是其中一部分。
   *   · 题目标题超过 40 字截断，不做展开（整串放进 title 属性，鼠标悬停可看）。 */
  function clipTitle(s) {
    s = String(s == null ? '' : s);
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  }
  function answerPicked(q, answers) {
    var picked = [];
    (q.options || []).forEach(function (o) {
      if (answers[o.id] === true) picked.push(o.labelZh || o.label || o.id);
    });
    var inputs = q.inputs || [];
    inputs.forEach(function (inp) {
      var v = answers[inp.id];
      if (typeof v !== 'string' || !v.trim()) return;
      var label = inp.labelZh || inp.label || inp.id;
      /* 一题多个输入格时带格名，否则只显示值（单格题的口径：显示输入值） */
      picked.push(inputs.length > 1 ? (label + '：' + v.trim()) : v.trim());
    });
    return picked;
  }
  function fmtSheetTime(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function renderAnswerSheet(answers, opts) {
    answers = answers || {};
    opts = opts || {};
    var MODEL = root.I485_QUESTIONS;
    var SECTIONS = root.I485_SECTIONS || [];
    var CORE = root.I485Core;
    var uncertain = opts.uncertain || {};
    if (!MODEL || !MODEL.questions) return '<section class="answer-sheet"></section>';

    /* 当前可见题：与目录面板、PDF 填表同一条口径 */
    var visible = (CORE && CORE.visibleQuestions)
      ? CORE.visibleQuestions(MODEL, { answers: answers, groups: MODEL.part2Groups || {} })
      : MODEL.questions;

    var filled = 0, marked = 0, groups = [];
    SECTIONS.forEach(function (seg) {
      var items = visible.filter(function (q) { return seg.sections.indexOf(q.section) >= 0; });
      var segRows = [];
      items.forEach(function (q, i) {
        var isMarked = uncertain[q.id] === true;
        var picked = answerPicked(q, answers);
        if (isMarked) marked++;
        else if (picked.length) filled++;
        if (!isMarked && !picked.length) return;   /* 普通未答：不列 */

        var no = seg.n + '-' + (i + 1);             /* 与目录面板同一套编号 */
        var title = q.titleZh || q.title || q.id;
        var ansText = picked.length ? picked.join('、') : '未答';
        segRows.push('<li class="as-row" data-no="' + escAttr(no) + '" data-qid="' + escAttr(q.id) + '"' +
          (isMarked ? ' data-uncertain="1"' : '') + '>' +
          '<span class="as-no">' + escText(no) + '</span>' +
          '<span class="as-q" title="' + escAttr(title) + '">' + escText(clipTitle(title)) + '</span>' +
          '<span class="as-a' + (picked.length ? '' : ' as-a-empty') + '">' + escText(ansText) + '</span>' +
          (isMarked ? '<span class="as-tag">待确认</span>' : '') +
          '</li>');
      });
      if (segRows.length) {
        groups.push('<section class="as-seg" data-seg="' + String(seg.n) + '">' +
          '<h2 class="as-seg-h">第 ' + seg.n + ' 段 · ' + escText(seg.title) + '</h2>' +
          '<ul class="as-list">' + segRows.join('') + '</ul></section>');
      }
    });

    var total = MODEL.questions.length;
    var unanswered = Math.max(0, total - filled);
    var count = '<p class="as-count" data-filled="' + filled + '" data-unanswered="' + unanswered +
      '" data-uncertain="' + marked + '">你填了 <b>' + filled + '</b> 条 · 未答 <b>' + unanswered +
      '</b> 条 · 标记不确定 <b>' + marked + '</b> 条</p>';
    var empty = (!filled && !marked)
      ? '<p class="as-empty">还没有答任何题。回去答几题，这里就会列出你填过的内容。</p>'
      : '';
    var when = fmtSheetTime(opts.now || new Date());
    return '<section class="answer-sheet">' +
      '<h1 class="as-title">答案核对</h1>' + count + empty + groups.join('') +
      '<p class="as-foot">生成时间：' + escText(when) +
      ' · 本清单只供核对，不代替官方表格</p></section>';
  }

  root.I485Render = {
    renderQuestion: renderQuestion,
    renderHint: renderHint,
    renderOptions: renderOptions,
    renderInputs: renderInputs,
    renderLiveWarn: renderLiveWarn,
    renderAnswerSheet: renderAnswerSheet,
    optionList: optionList,
    questionNumber: questionNumber,
    hintLevel: hintLevel,
    answeredYes: answeredYes,
    showLiveWarn: showLiveWarn,
    isGate: isGate,
    isNoneOpt: isNoneOpt,
    zhHasEn: zhHasEn,
    LIMIT_FIELDS: LIMIT_FIELDS,
    LIVE_WARN_TEXT: LIVE_WARN_TEXT
  };
})(typeof window !== 'undefined' ? window : this);
