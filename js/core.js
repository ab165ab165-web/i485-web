/* I485Core —— 问卷可见性 + PDF 填表核心逻辑
 * 浏览器：<script src="js/core.js"> → window.I485Core
 * Node ：const I485Core = require('./js/core.js')
 * 说明：条件判断只解释 questions.js 里的 JSON DSL，不使用 eval / new Function。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.I485Core = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------- 条件 DSL ---------------- */
  var NUM = function (v) {
    var n = parseFloat(String(v == null ? '' : v).trim());
    return isNaN(n) ? 0 : n;
  };

  function evalCond(cond, ctx) {
    if (!cond) return true;
    var answers = ctx.answers || {};
    var groups = ctx.groups || {};
    switch (cond.op) {
      case 'checked':
        return answers[cond.id] === true;
      case 'filled': {
        var v = answers[cond.id];
        return typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null && v !== false;
      }
      case 'anyFilled':
        return (cond.ids || []).some(function (id) {
          var x = answers[id];
          return typeof x === 'string' ? x.trim() !== '' : !!x;
        });
      case 'and':
        return cond.of.every(function (c) { return evalCond(c, ctx); });
      case 'or':
        return cond.of.some(function (c) { return evalCond(c, ctx); });
      case 'not':
        return !evalCond(cond.of, ctx);
      case 'gte':
        return NUM(answers[cond.id]) >= cond.n;
      case 'gt': {
        var right = cond.n !== undefined ? cond.n : (evalCond(cond.than, ctx) ? cond.than.then : cond.than['else']);
        return NUM(answers[cond.id]) > right;
      }
      case 'if':
        return evalCond(cond.cond, ctx) ? cond.then : cond['else'];
      case 'category': {
        var ids = groups[cond.group] || [];
        return ids.some(function (id) { return answers[id] === true; });
      }
      case 'never':
        return false;
      default:
        return false;
    }
  }

  function isVisible(q, ctx) { return evalCond(q.cond, ctx); }

  function visibleQuestions(model, ctx) {
    return model.questions.filter(function (q) { return isVisible(q, ctx); });
  }

  /* ---------------- 文本清洗（PDF 标准字体 WinAnsi） ---------------- */
  var REPLACE = {
    '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"',
    '\u2013': '-', '\u2014': '-', '\u2022': '*', '\u2026': '...', '\u00a0': ' '
  };
  /* 拉丁扩展字母 → ASCII：这些是拉丁字母，不是「非拉丁字符」，不能整字丢掉。
   * 例：Łódź / Škoda / İstanbul 之前会被删成 "ód" / "koda" / "stanbul"。 */
  var LATIN_MAP = {
    '\u0141': 'L', '\u0142': 'l',   /* Ł ł */
    '\u0110': 'D', '\u0111': 'd',   /* Đ đ */
    '\u0130': 'I', '\u0131': 'i',   /* İ ı */
    '\u0160': 'S', '\u0161': 's',   /* Š š */
    '\u017d': 'Z', '\u017e': 'z',   /* Ž ž */
    '\u0150': 'O', '\u0151': 'o',   /* Ő ő */
    '\u0170': 'U', '\u0171': 'u',   /* Ű ű */
    '\u0162': 'T', '\u0163': 't',   /* Ţ ţ */
    '\u015e': 'S', '\u015f': 's',   /* Ş ş */
    '\u0164': 'T', '\u0165': 't',   /* Ť ť */
    '\u0154': 'R', '\u0155': 'r',   /* Ŕ ŕ */
    '\u014a': 'N', '\u014b': 'n'    /* Ŋ ŋ */
  };
  /* 越南语：声调符号一律去掉、保留基础字母（Nguyễn → Nguyen，Đà Nẵng → Da Nang）。
   * 只在串里出现越南语专用字母时才整串折叠，避免把 José / São Paulo 的 é / ã 也抹掉。 */
  /* 含越南语专用字母，或含组合音符（macOS 等输入法给的 NFD 分解串）→ 整串折叠 */
  var VIET_RE = /[\u1ea0-\u1ef9\u0110\u0111\u0300-\u036f]/;
  function stripMarks(s) {
    if (typeof s.normalize === 'function') return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s;
  }
  function pdfSafe(value) {
    var s = String(value == null ? '' : value);
    if (VIET_RE.test(s)) s = stripMarks(s);
    var out = '';
    var dropped = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (REPLACE[ch] !== undefined) { out += REPLACE[ch]; continue; }
      /* 组合音符（单独出现的重音符号）直接丢掉，不算「字符被删」 */
      if (ch >= '\u0300' && ch <= '\u036f') continue;
      if (LATIN_MAP[ch] !== undefined) { out += LATIN_MAP[ch]; continue; }
      var c = s.charCodeAt(i);
      if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) out += ch;
      else {
        /* 拉丁扩展 A/B 等（ź / ễ / ő …）：拆出基础字母，算「已映射」而不是丢弃 */
        var d = stripMarks(ch);
        var base = d.charAt(0);
        var rest = d.slice(1);
        if (base && /[A-Za-z]/.test(base) && /^[\u0300-\u036f]*$/.test(rest)) out += base;
        else dropped++;
      }
    }
    return { text: out, dropped: dropped };
  }

  /* ---------------- 长度预检：规范短写 ----------------
   * 官方 PDF 里少数格子有 maxLength（例：前配偶的出生国家 / 国籍只有 9 个字符）。
   * 超长先换成通用短写（国家名优先），仍超长才截断 —— 截断必须在完成页告诉用户。
   * 键一律小写、空白折叠后再比对。 */
  var SHORT_WRITE = {
    'united states': 'U.S.A.',
    'united states of america': 'U.S.A.',
    'south korea': 'S. Korea',
    'republic of korea': 'S. Korea',
    'korea, south': 'S. Korea',
    'south korea (rok)': 'S. Korea',
    'north korea': 'N. Korea',
    "korea, north": 'N. Korea',
    'north korea (dprk)': 'N. Korea',
    'philippines': 'Phil.',
    'the philippines': 'Phil.',
    'netherlands': 'Neth.',
    'the netherlands': 'Neth.',
    'puerto rico': 'P.R.',
    'united kingdom': 'U.K.',
    'great britain': 'U.K.',
    'united arab emirates': 'UAE',
    'saudi arabia': 'Saudi Ar.',
    'dominican republic': 'Dominican',
    'czech republic': 'Czechia',
    'czechia': 'Czechia',
    'new zealand': 'N. Zeal.',
    'south africa': 'S. Africa',
    'el salvador': 'El Salv.',
    'sierra leone': 'S. Leone',
    'costa rica': 'Costa R.',
    'papua new guinea': 'P.N.G.',
    'trinidad and tobago': 'Trinidad',
    'bosnia and herzegovina': 'Bosnia',
    'central african republic': 'C.A.R.',
    'equatorial guinea': 'Eq. Guin.',
    'liechtenstein': 'Liecht.',
    'turkmenistan': 'Turkmen.',
    'uzbekistan': 'Uzbekist.',
    'afghanistan': 'Afghan.',
    'azerbaijan': 'Azerbaij.',
    'kazakhstan': 'Kazakhst.',
    'switzerland': 'Switzerl.',
    'luxembourg': 'Luxembg.',
    'montenegro': 'Monteneg.',
    'south sudan': 'S. Sudan',
    "cote d'ivoire": "Cote d'Iv",
    'ivory coast': "Cote d'Iv",
    'north macedonia': 'N. Maced.',
    'venezuela': 'Venezuela',
    'mauritania': 'Maurit.',
    'mozambique': 'Mozamb.',
    'madagascar': 'Madag.',
    'bangladesh': 'Banglad.',
    'tajikistan': 'Tajikist.',
    'kyrgyzstan': 'Kyrgyzst.',
    'cape verde': 'Cape Ver.',
    'burkina faso': 'Burkina',
    'solomon islands': 'Solomons',
    'marshall islands': 'Marshall',
    'micronesia': 'Micrones.',
    'guinea-bissau': 'G.-Bissau',
    'democratic republic of the congo': 'Congo DR',
    'democratic republic of congo': 'Congo DR',
    'dr congo': 'Congo DR',
    'republic of the congo': 'Congo',
    'republic of congo': 'Congo',
    'congo': 'Congo',
    /* P10：原先走截断、出现 "Bolivia (" / "Republic" / "United Re" / "Congo, De" 这类
       残词或歧义的国名，补上通用短写（全部 ≤9 字符，适配唯一有 9 字符上限的格子）。 */
    'antigua and barbuda': 'Antigua',
    'antigua': 'Antigua',
    'saint lucia': 'St. Lucia',
    'st. lucia': 'St. Lucia',
    'saint kitts and nevis': 'St. Kitts',
    'st. kitts and nevis': 'St. Kitts',
    'saint vincent and the grenadines': 'St. Vin.',
    'st. vincent and the grenadines': 'St. Vin.',
    'seychelles': 'Seych.',
    'timor-leste': 'Timor',
    'timor leste': 'Timor',
    'brunei darussalam': 'Brunei',
    'republic of moldova': 'Moldova',
    'united republic of tanzania': 'Tanzania',
    'bolivia (plurinational state of)': 'Bolivia',
    'iran (islamic republic of)': 'Iran',
    'venezuela (bolivarian republic of)': 'Venezuela',
    'vatican city': 'Vatican',
    'san marino': 'S. Marino',
    'sao tome and principe': 'Sao Tome',
    'palestine': 'Palestine',
    'palestinian territory': 'Palestine',
    'the bahamas': 'Bahamas',
    'bahamas': 'Bahamas',
    'the gambia': 'Gambia',
    'gambia': 'Gambia',
    'cabo verde': 'Cape Ver.',
    'russia federation': 'Russia',
    'russian federation': 'Russia',
    'syrian arab republic': 'Syria',
    "lao people's democratic republic": 'Laos',
    'western sahara': 'W. Sahara',
    'french guiana': 'Fr. Gui.',
    /* 10 字符的 Guadeloupe / Martinique 在 9 字符格子里必须再短一档；
       法正给的 "Guadeloup." 本身也是 10 字符，按它给的备选 Gpe. 处理。 */
    'guadeloupe': 'Gpe.',
    'martinique': 'Martin.',
    /* P0-2：客户常把国名写成全称、缩写或中文。9 字符格子放不下全称时
       先映射成通用短写，认不出就直接不写（绝不截成 "People's" 这种残词）。
       政治敏感写法按客户原文映射，不做立场判断。 */
    "people's republic of china": 'China',
    'prc': 'China',
    '中华人民共和国': 'China',
    '中国': 'China',
    'republic of china': 'Taiwan',
    'roc': 'Taiwan',
    '台湾': 'Taiwan',
    'taiwan china': 'Taiwan',
    'taiwan, china': 'Taiwan',
    'chinese taipei': 'Taiwan',
    'hong kong sar': 'Hong Kong',
    'hong kong': 'Hong Kong',
    '香港': 'Hong Kong',
    'macau sar': 'Macau',
    'macao': 'Macau',
    '澳门': 'Macau',
    'myanmar (burma)': 'Myanmar',
    'burma': 'Myanmar',
    'myanmar': 'Myanmar',
    'kingdom of saudi arabia': 'Saudi Ar.',
    'dominican rep.': 'Dominican',
    'saint martin': 'St Martin',
    'st. martin': 'St Martin',
    /* Sint Maarten 与 Saint Martin 是两个实体，不能合并；9 字符格子里
       "St Maarten" 是 10 字符，按同样风格压到 9 字符 "St Maart."。 */
    'sint maarten': 'St Maart.',
    'uae': 'UAE',
    "democratic people's republic of korea": 'N. Korea',
    'dprk': 'N. Korea',
    'russia': 'Russia',
    'socialist republic of vietnam': 'Vietnam',
    'viet nam': 'Vietnam',
    'bolivarian republic of venezuela': 'Venezuela',
    'plurinational state of bolivia': 'Bolivia',
    'bolivia': 'Bolivia',
    'drc': 'Congo DR',
    'congo, dem. rep.': 'Congo DR'
  };

  function normKey(s) {
    var t = String(s == null ? '' : s);
    /* 重音折叠：Côte d'Ivoire 与 Cote d'Ivoire 命中同一条短写 */
    t = t.replace(/[\u0110]/g, 'D').replace(/[\u0111]/g, 'd')
         .replace(/[\u0141]/g, 'L').replace(/[\u0142]/g, 'l');
    t = stripMarks(t);
    /* 弯引号 / 重音符统一成直引号（题库里 Lao People’s 用的是 U+2019） */
    t = t.replace(/[\u2018\u2019\u02bc\u0060\u00b4]/g, "'");
    return t.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /* 补充别名：客户常见的全称 / 括号写法 / 缩写，先归一成一个已在
     SHORT_WRITE 里的键再查表。放在这里而不是加进 SHORT_WRITE，
     是为了不在「不同国家撞同一短写」的检查里堆同义键。 */
  var KEY_ALIAS = {
    'p.r. china': "people's republic of china",
    'p r china': "people's republic of china",
    'china (prc)': "people's republic of china",
    'mainland china': "people's republic of china",
    'mainland prc': "people's republic of china",
    'st. maarten': 'sint maarten'
  };

  /* 返回 { text, action }：action = 'none' | 'short' | 'blocked'
   * max 为空 / ≤0 时视为不限长。
   * 先查短写表（全称 / 缩写 / 中文都能命中）；认不出又超长时不再截断，
   * 返回空串 + 'blocked'，由调用方跳过这一格并让用户手写。
   * 短写结果和原文完全相同（如 Hong Kong）按 'none' 处理，不产生无意义的提示。 */
  function fitTextToMax(value, max) {
    var s = String(value == null ? '' : value);
    var lim = parseInt(max, 10);
    /* 没有限长就不做任何改写，原文照写（旧行为，避免无条件缩写出提示）。 */
    if (!lim || lim <= 0) return { text: s, action: 'none' };
    var key = normKey(s);
    var short = SHORT_WRITE[KEY_ALIAS[key] || key];
    if (short) {
      if (short.length <= lim) return { text: short, action: short === s ? 'none' : 'short' };
      /* 短写本身仍超长：不截短写，交给调用方按「没写进去」处理。 */
      return { text: '', action: 'blocked' };
    }
    if (s.length <= lim) return { text: s, action: 'none' };
    return { text: '', action: 'blocked' };
  }

  /* ---------------- 答案 → PDF 写入计划 ---------------- */
  function buildWrites(model, ctx) {
    var answers = ctx.answers || {};
    var writes = [];
    var seen = Object.create(null);
    var warnings = [];
    var qs = visibleQuestions(model, ctx);

    function push(w) {
      if (seen[w.pdf]) {
        var prev = seen[w.pdf];
        if (prev.value !== w.value || prev.kind !== w.kind) {
          warnings.push('同一 PDF 字段被多次写入：' + w.pdf);
        }
        return;
      }
      seen[w.pdf] = w;
      writes.push(w);
    }

    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      var qTitle = q.titleZh || q.title || q.id;
      /* item 含「续」时是官方编号的续行（如 "4 续"）：表上还是第 4 项，
       * 读成「第 4 项续行」才通顺，不能拼成「第 4 续 题」。 */
      var qItem = !q.item ? ''
        : (String(q.item).indexOf('续') >= 0
          ? '第 ' + String(q.item).replace(/\s*续\s*/, '') + ' 项续行'
          : '第 ' + q.item + ' 题');
      /* 门题（noPdf）只做界面分类，不写官方表任何格子 */
      if (q.noPdf) continue;
      if (q.options && q.options.length) {
        for (var j = 0; j < q.options.length; j++) {
          var o = q.options[j];
          var on = answers[o.id] === true;
          push({ pdf: o.pdf, kind: on ? 'check' : 'uncheck', value: on, question: q.id, inputId: o.id, item: qItem, title: qTitle, label: o.labelZh || o.label || '' });
        }
      }
      if (q.inputs && q.inputs.length) {
        for (var k = 0; k < q.inputs.length; k++) {
          var inp = q.inputs[k];
          var raw = answers[inp.id];
          if (typeof raw !== 'string' || raw.trim() === '') continue;
          var val = raw.trim();
          // 日期统一为 mm/dd/yyyy（浏览器 date 控件给的是 yyyy-mm-dd）
          if (inp.type === 'date') {
            var dm = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (dm) val = dm[2] + '/' + dm[3] + '/' + dm[1];
          }
          var safe = pdfSafe(val);
          /* 中英混填时去掉被丢掉字符留下的首尾空格：
             "China 中国" → "China"；"中国 China" → "China"（不留前导空格） */
          var safeText = String(safe.text).trim();
          if (safe.dropped > 0) {
            warnings.push(qItem + '「' + qTitle + '」的「' + (inp.labelZh || inp.label || inp.id) +
              '」里有 ' + safe.dropped + ' 个 PDF 标准字体不支持的字符（如中文、西里尔文），写入时已跳过；' +
              '建议改用英文或拼音。写入值 = "' + safeText + '"' +
              (safeText === '' ? '（空，这一格没有写入）' : ''));
          }
          if (safeText === '') continue;
          push({ pdf: inp.pdf, kind: 'text', value: safeText, question: q.id, inputId: inp.id, item: qItem, title: qTitle, label: inp.labelZh || inp.label || '' });
        }
      }
    }
    return { writes: writes, warnings: warnings, visible: qs.length };
  }

  /* ---------------- 填表 ---------------- */
  /* opts: { PDFDocument, pdfBytes, model, answers, groups, flatten }
   *
   * 口径（2026-11-08 老板 23:44 定）：官方表**零插页**。
   * A 文件 = 官方模板 + 填值，页数恒为 27，内容流与模板逐页一致。
   * 填写说明另出 B 文件（单独一页，不进 A）。本函数不再接受 cover 选项，
   * 也不再有 insertPage / removePage 路径 —— 插页会改动页序，违反「A 就是官方表」。 */
  function zhWhere(w) {
    var head = w.item ? w.item + '「' + w.title + '」' : '「' + w.title + '」';
    return w.label ? head + '的「' + w.label + '」' : head;
  }

  async function fillPdf(opts) {
    var PDFDocument = opts.PDFDocument;
    var doc;
    try {
      doc = await PDFDocument.load(opts.pdfBytes, { ignoreEncryption: true });
    } catch (e) {
      throw new Error('读不出官方 PDF 模板（文件可能损坏或版本不对）。建议：重新下载模板后重试。');
    }
    var form = doc.getForm();
    var existing = Object.create(null);
    form.getFields().forEach(function (f) { existing[f.getName()] = f; });
    /* 模板页数（官方表 = 27）。填值前后必须一致：这是「A 文件就是官方表」的硬约束。 */
    var pagesBefore = doc.getPageCount();
    var fieldsBefore = form.getFields().length;

    var plan = buildWrites(opts.model, { answers: opts.answers, groups: opts.groups || {} });
    var report = {
      visibleQuestions: plan.visible,
      planned: plan.writes.length,
      checked: 0,
      unchecked: 0,
      text: 0,
      missing: [],
      warnings: plan.warnings.slice(),
      errors: [],
      /* 被缩写的格子：完成页要逐条列出来（本项目不做任何截断） */
      adjustments: [],
      /* 缩写后仍放不下的格子：完成页提示「建议打印后手写覆盖」 */
      handwrite: [],
      /* 单个格子写不进去时的中文说明（其余格子照写，PDF 仍生成） */
      skipped: []
    };

    for (var i = 0; i < plan.writes.length; i++) {
      var w = plan.writes[i];
      var field = existing[w.pdf];
      if (!field) {
        report.missing.push(w.pdf);
        report.errors.push(zhWhere(w) + '：官方 PDF 模板里找不到这一格，已跳过（其余格子照常写入）；建议打印后手写补上。');
        continue;
      }
      try {
        if (w.kind === 'text') {
          if (typeof field.setText !== 'function') {
            report.errors.push(zhWhere(w) + '：官方 PDF 里这一格不是可填文本框，已跳过；建议打印后手写补上。');
            report.skipped.push(w.inputId);
            continue;
          }
          var maxLen = (typeof field.getMaxLength === 'function') ? field.getMaxLength() : 0;
          var fit = fitTextToMax(w.value, maxLen);
          if (fit.action === 'blocked') {
            /* 认不出的长值不截断：这一格不写，记进「没写进 PDF」清单让用户手写。 */
            var blk = {
              inputId: w.inputId, question: w.question, item: w.item, title: w.title, label: w.label,
              original: w.value, written: '', maxLength: maxLen, action: 'blocked'
            };
            report.adjustments.push(blk);
            report.handwrite.push(blk);
            report.skipped.push(w.inputId);
            continue;
          }
          if (fit.action !== 'none') {
            var adj = {
              inputId: w.inputId, question: w.question, item: w.item, title: w.title, label: w.label,
              original: w.value, written: fit.text, maxLength: maxLen, action: fit.action
            };
            report.adjustments.push(adj);
          }
          try {
            field.setText(fit.text);
          } catch (e2) {
            /* 本项目不做任何截断：写不进去就跳过这一格，绝不把用户内容截成歧义串。 */
            report.errors.push(zhWhere(w) + '：这一格写不进去，已跳过（其余格子照常写入）；建议把内容改短后重试，或打印后手写补上。');
            report.skipped.push(w.inputId);
            continue;
          }
          report.text++;
        } else if (w.kind === 'check') {
          if (typeof field.check !== 'function') {
            report.errors.push(zhWhere(w) + '：官方 PDF 里这一格不是复选框，已跳过；建议打印后手写勾上。');
            report.skipped.push(w.inputId);
            continue;
          }
          field.check();
          report.checked++;
        } else {
          if (typeof field.uncheck === 'function') field.uncheck();
          report.unchecked++;
        }
      } catch (e) {
        report.errors.push(zhWhere(w) + '：这一格写入异常，已跳过（其余格子照常写入）；建议把内容改短后重试，或打印后手写补上。');
        report.skipped.push(w.inputId);
      }
    }

    /* 单格失败不再中止整份 PDF：错误全部记进 report.errors（中文），照常 save()。 */

    if (opts.flatten) {
      try { form.flatten(); } catch (e) { report.warnings.push('这份 PDF 没能锁定成不可编辑版本，已保留可编辑表单。'); }
    }

    /* 不插页、不删页：页数恒等于模板页数（27）。
       防御性断言：万一以后有人又加了插页路径，这里当场拦住。 */
    if (doc.getPageCount() !== pagesBefore) {
      throw new Error('官方表页数被改动（应为 ' + pagesBefore + '，实际 ' + doc.getPageCount() +
        '），文件没有生成。请刷新页面后重试。');
    }
    /* 字段数断言：flatten 为真时，flatten() 会把表单域烘进页面内容流，
       getFields() 必然变成 0 —— 期望值按 0 计，不能再拿 748 去比。
       （2026-11-09 修：原先无条件比 fieldsBefore，flatten:true 时必然抛，
        埋着一条必炸的雷。页数断言不受影响。） */
    var expectFields = opts.flatten ? 0 : fieldsBefore;
    if (form.getFields().length !== expectFields) {
      throw new Error('官方表可填格子数被改动（应为 ' + expectFields + '，实际 ' + form.getFields().length +
        '），文件没有生成。请刷新页面后重试。');
    }
    report.pages = pagesBefore;
    report.fields = expectFields;

    var bytes;
    try {
      bytes = await doc.save();
    } catch (e) {
      throw new Error('PDF 保存失败（浏览器内存可能不够）。建议：关掉其它标签页后重试。');
    }
    report.bytes = bytes.length;
    return { bytes: bytes, report: report };
  }

  return {
    evalCond: evalCond,
    isVisible: isVisible,
    visibleQuestions: visibleQuestions,
    buildWrites: buildWrites,
    pdfSafe: pdfSafe,
    fitTextToMax: fitTextToMax,
    SHORT_WRITE: SHORT_WRITE,
    fillPdf: fillPdf
  };
});
