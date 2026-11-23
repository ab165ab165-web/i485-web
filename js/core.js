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
  /* 多行输入 → 一段：按行拆，去掉每行首尾空白，跳过空行，用「; 」连接。
   * 后面还接着下一项的行，去掉它行尾自带的分号 / 逗号（免得成「;;」）；最后一行原样保留，
   * 只有一行时内容不变（只去首尾空白）。 */
  function joinLines(value) {
    var lines = String(value == null ? '' : value).split(/\r\n|\r|\n/)
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l !== ''; });
    return lines.map(function (l, i) {
      return i < lines.length - 1 ? l.replace(/[;,；，、]+$/, '').trim() : l;
    }).join('; ');
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
  /* ---------------- 住址：Part 1 Item 18 + Part 14 续写 ----------------
   * 口径来源：
   *   ① Part 1 Item 18 的「Have you resided at your current address for at least 5 years?」
   *      由工具按入住日期自动判定，**不问用户**（brief v10 批 B）；
   *   ② 表上只留一个 Prior Address 块，第 2 条及更早的住址写进 Part 14
   *      （每行 4 格：Page Number / Part Number / Item Number / Description）。
   * 字段名与行数一律从题库里的 model.residence 读，不在 core 里写死。
   */
  function parseResidenceDate(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    var m;
    if ((m = s.match(/^(\d{1,2})\/(\d{4})$/))) {
      var mm = parseInt(m[1], 10), yy = parseInt(m[2], 10);
      if (mm < 1 || mm > 12) return null;
      return { y: yy, m: mm, d: 1, monthOnly: true };
    }
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
      var m2 = parseInt(m[1], 10), d2 = parseInt(m[2], 10), y2 = parseInt(m[3], 10);
      if (m2 < 1 || m2 > 12 || d2 < 1 || d2 > 31) return null;
      return { y: y2, m: m2, d: d2, monthOnly: false };
    }
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
      return { y: parseInt(m[1], 10), m: parseInt(m[2], 10), d: parseInt(m[3], 10), monthOnly: false };
    }
    return null;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtMDY(d) { return pad2(d.m) + '/' + pad2(d.d) + '/' + d.y; }
  function fmtMY(d) { return pad2(d.m) + '/' + d.y; }

  /* 从某个入住日期算到 now（默认今天）。
   * 只算到「月」：起租日按当月 1 日算，所以满 60 个月 = 满 5 年。
   * 返回 null = 没填 / 认不出；否则 { start, months, years, restMonths, met, text } */
  function residenceSpan(startVal, now) {
    var st = parseResidenceDate(startVal);
    if (!st) return null;
    var to = now instanceof Date ? now : new Date();
    var months = (to.getFullYear() - st.y) * 12 + (to.getMonth() + 1 - st.m);
    if (st.d > to.getDate()) months -= 1;   /* 具体到日：还没过当月那一天，差一个月 */
    if (months < 0) months = 0;
    var years = Math.floor(months / 12);
    var rest = months % 12;
    return {
      start: st,
      months: months,
      years: years,
      restMonths: rest,
      met: months >= 60,
      text: years + ' 年' + (rest ? ' ' + rest + ' 个月' : '') +
        '（' + years * 12 + (rest ? '+' + rest : '') + ' 个月，从 ' + fmtMDY(st) + ' 起算）'
    };
  }

  /* 自动判定的答案：住满 5 年 → residing_address_yes，否则 no。
   * 只在 model.residence 存在时生效；日期没填 → 两个键都不设（表上两格都留空，
   * 不替用户猜「未满五年」）。 */
  function deriveAnswers(model, answers, now) {
    var r = model && model.residence;
    var src = answers || {};
    if (!r || !r.yes || !r.no) return src;
    var out = Object.assign({}, src);
    delete out[r.yes];
    delete out[r.no];
    var span = residenceSpan(src[r.dateInput], now);
    if (!span) return out;
    out[span.met ? r.yes : r.no] = true;
    return out;
  }

  /* Part 14 每行的说明文字（三行英文，寄表用的陈述写法）。
   * 单位写法跟着官方表：Apt. / Ste. / Flr. + 号码。 */
  function part14RowText(model, answers, rowIndex) {
    var r = model && model.residence;
    if (!r) return null;
    var p = r.rowPrefix + rowIndex + '_';
    var a = answers || {};
    var street = String(a[p + 'street'] || '').trim();
    if (!street) return null;
    var unitKind = a[p + 'apt'] === true ? 'Apt.' : (a[p + 'ste'] === true ? 'Ste.' : (a[p + 'flr'] === true ? 'Flr.' : ''));
    var unitNo = String(a[p + 'number'] || '').trim();
    var line1 = street + (unitKind && unitNo ? ', ' + unitKind + ' ' + unitNo : (unitKind ? ', ' + unitKind : ''));
    var city = String(a[p + 'city'] || '').trim();
    var us = a[p + 'in_us_yes'] === true;
    var region, country;
    if (us) {
      var state = String(a[p + 'state'] || '').trim();
      var zip = String(a[p + 'zip'] || '').trim();
      region = [state, zip].filter(Boolean).join(' ');
      country = 'U.S.A.';
    } else {
      var prov = String(a[p + 'province'] || '').trim();
      var postal = String(a[p + 'postal'] || '').trim();
      region = [prov, postal].filter(Boolean).join(' ');
      country = String(a[p + 'country'] || '').trim();
    }
    var line2 = [city, region, country].filter(Boolean).join(', ');
    var from = parseResidenceDate(a[p + 'from']);
    var to = parseResidenceDate(a[p + 'to']);
    /* 住址起止日期的口径（2026-11-16，法正 P2）：
     *   from + to 都有 → "Dates of residence: <from> to <to>"
     *   只有 from     → "Dates of residence: <from>"（不拼裸 "to"，否则印出半截 "01/2020 to "）
     *   只有 to       → "Dates of residence: to <to>"
     *   都空          → 不输出这一行
     * 「还住在这里」那一说已随上个住址的 To 题删除，present 没有来源，故不再拼。 */
    var dates = '';
    if (from && to) dates = 'Dates of residence: ' + fmtMY(from) + ' to ' + fmtMY(to);
    else if (from) dates = 'Dates of residence: ' + fmtMY(from);
    else if (to) dates = 'Dates of residence: to ' + fmtMY(to);
    var lines = [line1];
    if (line2) lines.push(line2);
    if (dates) lines.push(dates);
    return { lines: lines, text: lines.join('\n') };
  }

  /* 附加白纸（v12）：住址条数超过表上容量后，更早的那几条不写 PDF，排进一张独立打印纸。
   * 条目文字**直接调 part14RowText**——与 Part 14 同一套格式化函数，口径不许分叉。
   * 返回 [{ no, lines }]；no = 历史住址序号（18 起），也就是白纸上印的序号。 */
  function extraSheetEntries(model, answers) {
    var r = model && model.residence;
    if (!r || !r.part14) return [];
    var p = r.part14;
    var start = (p.rows || 0) + (p.rowOffset || 0);        /* 18 = 表上最后一行的下一条 */
    var last = start + (p.extraRows || 0) - 1;
    var out = [];
    for (var i = start; i <= last; i++) {
      var t = part14RowText(model, answers, i);
      if (t) out.push({ no: i, lines: t.lines, text: t.text });
    }
    return out;
  }

  /* 白纸表头要印的 `Page 3 · Part 1 · Item 18`：与 Part 14 每行写的 pgno/ptno/itno 同源，
   * 不另立一套常量。没有 residence 契约时返回 null。 */
  function extraSheetMeta(model) {
    var r = model && model.residence;
    var p = r && r.part14;
    if (!p) return null;
    return { pgno: String(p.pgno), ptno: String(p.ptno), itno: String(p.itno),
      rows: p.rows, extraRows: p.extraRows || 0 };
  }

  /* 说明文字的容量口径（承项目「放不下就整条跳过，绝不截断」）：
   * description 格实测 518.98×71.42pt、默认外观 /Helv 12 Tf（pdf-lib 从模板读）。
   *
   * 2026-11-15 修（法正必改 3）：原来按 6.0pt/字符 估、78 字符/行，实测 Helvetica
   * 12pt 的大写均值 ≈ 8.13pt/字符 → 78 字符必超过 519pt。pdf-lib 的 appearance
   * 不换行、超出部分被裁剪框吃掉：/V 里还在，打印出来少字。
   * 现在用 pdf-lib 的 widthOfTextAtSize 量真实宽度（每行 ≤ 519pt，行数 ≤ 4）；
   * 量不出来（没有字体对象）才回退保守常数 60 字符/行。
   * 放不下的整条不写，进「没写进 PDF」清单 —— 不裁、不静默。
   *
   * 2026-11-19 改口径：字体换成 USCIS 要求的 Courier New 粗体（见 TYPE_SIZES 一节），
   * 按整档 10 → 9 → 8pt 试，每行可用宽 = 格宽 − 左右各 TYPE_PAD；8pt 仍放不下才整条不写。
   * 量不出来（没有字体对象）时按等宽 0.6em/字符估 —— Courier 是等宽字，这个估法是精确值。 */
  var PART14_FIELD_W = 518.9;    /* 模板实测 518.9782pt，向下取，宽度判定只会偏严 */
  var PART14_MAX_LINES = 4;
  /* measure(text, size) → pt 宽度；不传则按 Courier 等宽 0.6em 估 */
  function part14Fits(text, measure) {
    var lines = String(text).split('\n');
    var limit = PART14_FIELD_W - 2 * TYPE_PAD;
    var widthAt = function (t, size) {
      var w = typeof measure === 'function' ? measure(t, size) : NaN;
      return isFinite(w) ? w : t.length * 0.6 * size;
    };
    var size = 0, widest = 0, over = [];
    for (var s = 0; s < TYPE_SIZES.length; s++) {
      widest = 0; over = [];
      for (var i = 0; i < lines.length; i++) {
        var w = widthAt(lines[i], TYPE_SIZES[s]);
        if (w > widest) widest = w;
        if (w > limit) over.push(i + 1);
      }
      if (!over.length) { size = TYPE_SIZES[s]; break; }
    }
    return {
      fits: lines.length <= PART14_MAX_LINES && over.length === 0,
      lines: lines.length,
      size: size,               /* 能放下的最大整档字号；0 = 8pt 也放不下 */
      widest: widest,           /* 放下时 = 该字号下最宽一行；放不下时 = 8pt 下最宽一行 */
      widthLimit: limit,
      overLines: over,
      measured: typeof measure === 'function'
    };
  }

  /* 完成页「说明」（不是警告）：日期补全、五年判定依据、境外现住址、超过 Part 14 行数。
   * 一律陈述事实 + 让用户核对，不写「请务必」这类命令句。 */
  function residenceNotes(model, answers, now) {
    var r = model && model.residence;
    var notes = [];
    if (!r) return notes;
    var a = answers || {};
    var st = parseResidenceDate(a[r.dateInput]);
    if (st) {
      if (st.monthOnly) {
        notes.push('入住日期只填到月（' + fmtMY(st) + '），PDF 里按当月 1 日写成 ' + fmtMDY(st) + '。请核对。');
      }
      var span = residenceSpan(a[r.dateInput], now);
      if (span) {
        notes.push('现住址从 ' + fmtMDY(span.start) + ' 起算，到今天 ' + span.text.split('（')[0] +
          '，' + (span.met ? '满 5 年：第 18 项勾了 Yes。' : '未满 5 年：第 18 项勾了 No，下面按五年内的住址继续问。'));
      }
    }
    if (a['phys_in_us_no'] === true) {
      notes.push('现住址填的是美国境外地址：Part 1 这一块只有州和 ZIP 的格子，没有 Province / Postal Code / Country 三格，这三项只在答案里，PDF 上要手写。');
    }
    /* 表上容量 = 1 现住址 + 1 前住址 + Part 14 的 16 行 = 18 条；再往前的排进附加白纸。 */
    var extra = extraSheetEntries(model, a);
    if (extra.length) {
      notes.push('住址超过 18 条：表上 Part 14 只有 ' + (r.part14 && r.part14.rows) +
        ' 行，第 ' + extra[0].no + ' 条起的 ' + extra.length +
        ' 个更早住址排进了附加白纸（随表一起打印），生成 PDF 时这几条不写入。');
    }
    return notes;
  }

  /* 住址段「工具会写」的格：Part 1 的物理格由题目的 inputs/options 自带，这里补两类
   * 不在题目里声明的 —— 自动判定的 residing_address_yes/no、Part 14 每行 4 格。
   * build-questions 与 check-handwrite 都用这一份，避免两处各算一套。 */
  function residenceFields(model) {
    var r = model && model.residence;
    var out = [];
    if (!r) return out;
    if (r.yes) out.push(r.yes);
    if (r.no) out.push(r.no);
    var p = r.part14;
    if (!p) return out;
    var names = ['pgno', 'ptno', 'itno', 'description'];
    for (var n = 1; n <= (p.rows || 0); n++) {
      for (var i = 0; i < names.length; i++) out.push((p.prefix || 'additional_info_') + names[i] + '_' + n);
    }
    return out;
  }

  /* ---------------- 单位换算（v11：身高厘米 / 体重公斤） --------------
   * 纯函数：界面上的「已换算：…」与写进 PDF 的那组数**同源** ——
   * 两边都调这里，不各算一遍（brief v11 的硬约束）。
   * 返回 { ok:true, … } 或 { ok:false, error:'中文提示' }：
   * 超出范围一律 ok:false，调用方不得写半个值。 */
  var CM_MIN = 100, CM_MAX = 250;
  var KG_MIN = 0.5, KG_MAX = 453;

  function cmToFtIn(cm) {
    var raw = String(cm == null ? '' : cm).trim();
    if (!/^\d+$/.test(raw)) {
      return { ok: false, error: '厘米请填整数（' + CM_MIN + '–' + CM_MAX + '），这一题不会写入任何格。' };
    }
    var n = Number(raw);
    if (n < CM_MIN || n > CM_MAX) {
      return {
        ok: false,
        error: '厘米请填 ' + CM_MIN + '–' + CM_MAX + ' 之间的数（' + CM_MIN + ' 约 3 英尺 3 英寸，' +
          CM_MAX + ' 约 8 英尺 2 英寸），这一题不会写入任何格。'
      };
    }
    /* 先合成总英寸再拆：170 / 2.54 = 66.93 → 67 → 5 英尺 7 英寸 */
    var totalIn = Math.round(n / 2.54);
    var feet = Math.floor(totalIn / 12);
    var inches = totalIn % 12;
    return {
      ok: true, cm: n, feet: feet, inches: inches, totalIn: totalIn,
      values: [String(feet), String(inches)],
      display: '已换算：' + feet + ' 英尺 ' + inches + ' 英寸（' + n + ' 厘米）'
    };
  }

  function kgToLb(kg) {
    var raw = String(kg == null ? '' : kg).trim();
    /* 允许一位小数（68 / 68.5）；两位小数或带别的字符一律拒 */
    if (!/^\d+(\.\d)?$/.test(raw)) {
      return { ok: false, error: '公斤请填数字，最多一位小数（' + KG_MIN + '–' + KG_MAX + '），这一题不会写入任何格。' };
    }
    var n = Number(raw);
    if (!isFinite(n) || n < KG_MIN || n > KG_MAX) {
      return { ok: false, error: '公斤请填 ' + KG_MIN + '–' + KG_MAX + ' 之间（大约 ' +
        Math.round(KG_MIN * 2.2046226) + '–' + Math.round(KG_MAX * 2.2046226) + ' 磅），这一题不会写入任何格。' };
    }
    var lb = Math.round(n * 2.2046226);
    return {
      ok: true, kg: n, lb: lb,
      values: [String(lb)],
      display: '已换算：' + lb + ' 磅（' + n.toFixed(1) + ' 公斤）'
    };
  }

  /* split → 换算函数。认不出的 split 直接抛（与 buildWrites 的其它 split 同口径）。 */
  function convertMetric(split, raw) {
    if (split === 'cm2ftin') return cmToFtIn(raw);
    if (split === 'kg2lb') return kgToLb(raw);
    throw new Error('未知的换算类型：' + String(split));
  }

  function buildWrites(model, ctx) {
    var answers = ctx.answers || {};
    /* 自动判定的答案（住址满五年与否）在这里补上：条件判定与写入共用同一份答案，
     * 不然 residing_address_no 永远为假、历史住址整段消失。 */
    answers = deriveAnswers(model, answers, ctx.now);
    var writes = [];
    var seen = Object.create(null);
    var warnings = [];
    var qs = visibleQuestions(model, { answers: answers, groups: ctx.groups || {} });

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
          /* 不写 PDF 的选项（例如「这个住址在美国境内吗？」）：只决定后面问哪几格 */
          if (!o.pdf) continue;
          var on = answers[o.id] === true;
          push({ pdf: o.pdf, kind: on ? 'check' : 'uncheck', value: on, question: q.id, inputId: o.id, item: qItem, title: qTitle, label: o.labelZh || o.label || '' });
        }
      }
      if (q.inputs && q.inputs.length) {
        for (var k = 0; k < q.inputs.length; k++) {
          var inp = q.inputs[k];
          var raw = answers[inp.id];
          if (typeof raw !== 'string' || raw.trim() === '') continue;
          /* skipWhen 的选项勾上时，这一格不写（表上留空，如单位制英制/公制互斥） */
          if (inp.skipWhen && answers[inp.skipWhen] === true) continue;
          var val = raw.trim();
          /* 多行框（第 62 项「一行写一项」）：每行去掉首尾空白、跳过空行，用「; 」连成一段。
           * 换行符不能直接往下传：pdfSafe 会把它当不支持的字符丢掉，前后两项粘成一个词。 */
          if (inp.multiline) val = joinLines(val);
          // 日期统一为 mm/dd/yyyy（浏览器 date 控件给的是 yyyy-mm-dd）
          if (inp.type === 'date') {
            var dm = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (dm) val = dm[2] + '/' + dm[3] + '/' + dm[1];
          }
          /* 住址日期：允许只写 mm/yyyy，PDF 里按当月 1 日补成 mm/dd/yyyy
             （完成页会逐条列出「已按当月 1 日补全」，不静默改）。 */
          if (inp.dateFlex) {
            var pd = parseResidenceDate(val);
            if (!pd) {
              warnings.push(qItem + '「' + qTitle + '」的「' + (inp.labelZh || inp.label || inp.id) +
                '」认不出是日期（填的是 "' + val + '"），这一格没有写入；请按 mm/yyyy 或 mm/dd/yyyy 填写。');
              continue;
            }
            val = fmtMDY(pd);
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
          /* 定长数字（A-Number 9 位）：先剥掉非数字（用户常把「A-」和连字符一起粘进来），
           * 位数不符就一格都不写 —— 不写占位符、不截断、不猜。 */
          if (inp.digits) {
            var onlyDigits = String(safeText).replace(/\D/g, '');
            if (onlyDigits.length !== inp.digits) {
              /* 一个数字都没有（例如只填了字母）时不说「你填的是 0 位」，直接说里面没有数字 */
              warnings.push(qItem + '「' + qTitle + '」：' + (onlyDigits.length === 0
                ? '你填的「' + safeText + '」里面没有数字（应为 ' + inp.digits + ' 位数字）'
                : 'A-Number 应为 ' + inp.digits + ' 位，你填的是 ' + onlyDigits.length + ' 位') +
                '，页眉与 Part 1 已留空，请核对后重填或打印后手写。');
              continue;
            }
            safeText = onlyDigits;
          }
          /* 一条输入 → 多个 PDF 格（体重 3 个单字符格）。
           * 规则只在 split 里定义；认不出的 split 直接抛，不做静默兜底。 */
          if (inp.pdfMany) {
            /* same：同一个值原样写到每一格（A-Number 28 格同值）
             * digits3：三位逐位写（体重 3 个单字符格） */
            var parts;
            if (inp.split === 'same') {
              parts = inp.pdfMany.map(function () { return safeText; });
            } else if (inp.split === 'digits3') {
              if (!/^\d{1,3}$/.test(safeText)) {
                warnings.push(qItem + '「' + qTitle + '」的「' + (inp.labelZh || inp.label || inp.id) +
                  '」只支持 1–999 的整数，填的是 "' + safeText + '"，这一格没有写入；建议改成本位的整数后重新生成。');
                continue;
              }
              var padded = safeText.padStart(3, ' ');
              parts = [padded.charAt(0), padded.charAt(1), padded.charAt(2)];
            } else if (inp.split === 'cm2ftin' || inp.split === 'kg2lb') {
              /* 公制输入（v11）：厘米 → 英尺/英寸（2 格），公斤 → 磅（再拆 3 格）。
                 越界 / 格式不对 → 中文提示 + 一格不写（不许写半个值）。 */
              var conv = convertMetric(inp.split, safeText);
              if (!conv.ok) {
                warnings.push(qItem + '「' + qTitle + '」的「' + (inp.labelZh || inp.label || inp.id) +
                  '」：' + conv.error + '你填的是 "' + safeText + '"。');
                continue;
              }
              if (inp.split === 'cm2ftin') {
                parts = conv.values.slice();
              } else {
                var lbStr = conv.values[0];
                if (!/^\d{1,3}$/.test(lbStr)) {
                  warnings.push(qItem + '「' + qTitle + '」换算出的 ' + lbStr + ' 磅超过 3 位数，这三格写不下，没有写入。');
                  continue;
                }
                var paddedLb = lbStr.padStart(3, ' ');
                parts = [paddedLb.charAt(0), paddedLb.charAt(1), paddedLb.charAt(2)];
              }
            } else {
              throw new Error('未知的 pdfMany.split：' + String(inp.split) + '（只支持 same / digits3 / cm2ftin / kg2lb）');
            }
            /* 纵深防御：份数与格数必须一一对应。
               以前 2 格 digits3 会静默只写 2 格（第 3 格空着），看不出来。 */
            if (parts.length !== inp.pdfMany.length) {
              throw new Error('pdfMany 与 split 产出的份数不一致：pdfMany ' + inp.pdfMany.length +
                ' 格，split 产出 ' + parts.length + ' 份（' + inp.id + '）');
            }
            for (var pi = 0; pi < inp.pdfMany.length; pi++) {
              push({
                pdf: inp.pdfMany[pi], kind: 'text', value: parts[pi],
                question: q.id, inputId: inp.id, item: qItem, title: qTitle, label: inp.labelZh || inp.label || ''
              });
            }
            continue;
          }
          /* 没有对应 PDF 格的输入（第 2 条起的历史住址：只用来拼 Part 14 的说明文字，
           * 表上没有它的格子）——不产生写入，别让空 pdf 混进写入计划。 */
          if (!inp.pdf) continue;
          push({ pdf: inp.pdf, kind: 'text', value: safeText, question: q.id, inputId: inp.id, item: qItem, title: qTitle, label: inp.labelZh || inp.label || '' });
        }
      }
    }

    /* ---- Part 1 Item 18：住满五年与否（自动判定，不问用户） ---- */
    var res = model.residence;
    if (res && res.yes && res.no) {
      var span = residenceSpan(answers[res.dateInput], ctx.now);
      if (span) {
        push({
          pdf: span.met ? res.yes : res.no, kind: 'check', value: true,
          question: 'residence|auto', inputId: span.met ? res.yes : res.no,
          item: '第 18 项', title: '现住址住满五年了吗', label: span.met ? '是' : '否'
        });
        push({
          pdf: span.met ? res.no : res.yes, kind: 'uncheck', value: false,
          question: 'residence|auto', inputId: span.met ? res.no : res.yes,
          item: '第 18 项', title: '现住址住满五年了吗', label: span.met ? '否' : '是'
        });
      }
    }

    /* ---- Part 14：第 2 条起的历史住址（每行 4 格） ---- */
    var overflows = [];
    if (res && res.part14) {
      var p14 = res.part14;
      for (var row = 1; row <= (p14.rows || 0); row++) {
        var rowText = part14RowText(model, answers, row + (p14.rowOffset || 2) - 1);
        if (!rowText) continue;
        var fit = part14Fits(rowText.text, ctx.measureLine);
        if (!fit.fits) {
          /* 不裁、不静默：整条不写，进「没写进 PDF」清单（fillPdf 转成 report.handwrite）。
             判据是量出来的真实宽度（每行 ≤ 519pt、总行数 ≤ 4），量不出才回退 60 字符/行。 */
          overflows.push({
            inputId: (res.rowPrefix || 'h') + (row + (p14.rowOffset || 2) - 1) + '_street',
            question: 'residence|p14:' + row,
            item: '第 18 项续行',
            title: 'Part 14 附加信息第 ' + row + ' 行',
            label: 'Additional Information',
            original: rowText.text,
            written: '',
            maxLength: null,
            action: 'overflow',
            reason: 'part14-width',
            widest: Math.round(fit.widest * 10) / 10,
            widthLimit: fit.widthLimit,
            measured: fit.measured,
            row: row
          });
          continue;
        }
        var fixed = [
          { pdf: 'pgno_' + row, value: String(p14.pgno), label: 'Page Number' },
          { pdf: 'ptno_' + row, value: String(p14.ptno), label: 'Part Number' },
          { pdf: 'itno_' + row, value: String(p14.itno), label: 'Item Number' },
          { pdf: 'description_' + row, value: rowText.text, label: 'Additional Information' }
        ];
        for (var fi = 0; fi < fixed.length; fi++) {
          push({
            pdf: (p14.prefix || 'additional_info_') + fixed[fi].pdf,
            kind: 'text', value: fixed[fi].value,
            question: 'residence|p14:' + row, inputId: p14.rowPrefix + (row + (p14.rowOffset || 2) - 1) + '_street',
            item: '第 18 项续行', title: 'Part 14 附加信息第 ' + row + ' 行', label: fixed[fi].label
          });
        }
      }
    }
    return { writes: writes, warnings: warnings, overflows: overflows, visible: qs.length };
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

  /* ---------------- 打字字体：USCIS 口径 Courier New 10pt 粗体（2026-11-19） ----------------
   * 官方原文（https://www.uscis.gov/forms/filing-guidance/tips-for-filing-forms-by-mail）：
   *   "For typewritten responses, use font Courier New, size 10, bold."
   * 工具写进 PDF 的文本值一律用这一种字体；表上印刷字不动。
   *
   * 宽度检查（不许静默裁字）：写入前用 widthOfTextAtSize 量宽度与格宽比，
   *   放不下按整档缩 10 → 9 → 8pt；8pt 仍放不下 → 这一格不写，进「没写进 PDF」清单
   *   （report.handwrite，action = 'toowide'）。
   *   例外只有第 62 项（多行横线格）：8pt 仍超过 8 行时写前 8 行，其余截断并报告
   *   （action = 'truncated'，written / rest 两段都进清单）。
   *
   * 字体：优先用官方空表里自带的 Courier New 粗体 —— 模板已完整嵌入（不是子集）一份
   *   /TrueType /CourierNewPS-BoldMT（WinAnsi、/FontFile2、0–255 字宽全是 600；2026-11-19 实测为 2685 0 R）。
   *   直接引用这个对象：真字形、任何阅读器出字都一样、文件不变大，也不涉及再分发（字体随官方表发布）。
   *   找不到（换了模板）才退到「不嵌入的 Courier New 粗体」：/TrueType /BaseFont /CourierNew,Bold +
   *   WinAnsi + 每字 600 的字宽表（Word 导出不嵌入字体的写法；装了 Courier New 的机器按它出字，
   *   没装的按 PDF 标准别名退到 Courier-Bold，字宽一样）。
   * 量宽度：pdf-lib 自带的标准 14 字体 Courier-Bold 字宽表（widthOfTextAtSize）。Courier New 粗体与
   *   Courier-Bold 同为等宽 600/1000；引用模板字体前先核它的 /Widths 全是 600，量的与印的一致。 */
  var TYPE_RES = 'CourierNewBold';      /* /DA 与外观流里的字体资源名（AcroForm /DR 里登记） */
  var TYPE_BASEFONT = 'CourierNew,Bold';
  var TYPE_SIZES = [10, 9, 8];          /* 整档缩，不出现 9.5 这类小数字号 */
  var TYPE_PAD = 2;                     /* 单行 / 多行格左右留白（pt） */
  var TYPE_LEADING = 1.2;               /* 非横线多行格的行距 = 1.2 × 字号 */

  function typeDA(size) { return '/' + TYPE_RES + ' ' + size + ' Tf 0 g'; }

  /* 第 62 项（list_certification）：格子里印了 8 条横线，间距 18pt，最下一条在页面 y=156
   * （pdfplumber 实测，格子下沿 156.82）。按横线逐行排，基线落在横线上方 4pt。
   * Courier 粗体 10pt：下伸部 1.6pt（基线下）、上伸部 6.3pt —— 基线在横线上 4pt 时
   * 字底离本行横线 2.4pt、字顶离上一条横线 7.7pt，不压线、不穿线。 */
  var RULED = {
    list_certification: { pitch: 18, lowestRuleY: 156, rows: 8, baselineAboveRule: 4, insetX: 2, truncate: true }
  };
  /* Part 14 每行的说明格（additional_info_description_1…16，第 24–27 页每页 4 格）也印了横线：
   * 每格 4 行、间距 18pt（pdfplumber 实测，格高 71.4pt）。最下一条横线按格子在页上的位置是
   * y = 480 / 342 / 204 / 60（4 页相同；description_n 取第 (n−1) mod 4 个）。
   * 按 1.2 倍行距排会压线（第 2 行正好穿过横线），所以与第 62 项一样按横线排、基线在横线上方 4pt。
   * 与第 62 项不同：放不下不截断 —— 整条不写、进清单（part14Fits 在写入计划阶段已先挡掉）。 */
  var P14_LOWEST_RULE = [480, 342, 204, 60];
  function ruledOf(name) {
    if (RULED[name]) return RULED[name];
    var m = /^additional_info_description_(\d+)$/.exec(name || '');
    if (m) return { pitch: 18, lowestRuleY: P14_LOWEST_RULE[(Number(m[1]) - 1) % 4], rows: 4, baselineAboveRule: 4, insetX: 2 };
    return null;
  }

  function setDA(field, size) {
    var da = typeDA(size);
    field.acroField.setDefaultAppearance(da);
    field.acroField.getWidgets().forEach(function (w) {
      if (w.dict !== field.acroField.dict && typeof w.setDefaultAppearance === 'function') w.setDefaultAppearance(da);
    });
  }

  /* 字号 = 0（自动）：官方表上 32 个 /Cour 0 Tf 梳齿格（A-Number、USCIS Online Account Number、
   * I-94 …）+ 3 个继承 AcroForm /Helv 0 Tf 的格（第 62 项、身高两格）。
   * pdf-lib 遇到 0 会按格子撑满（第 62 项 25–57pt、梳齿 A-Number 与 uscis_number 上下两排字号不一致），
   * 这些格子不论工具写不写都定成 Courier New 粗体 10pt：用户之后在阅读器里手打也是这个字号。 */
  function isAutoSizeField(field) {
    /* 鸭子类型认文本格（不用 instanceof：调用方与这里可能拿到不同的 pdf-lib 模块实例） */
    if (typeof field.setText !== 'function' || typeof field.isCombed !== 'function') return false;
    var w = field.acroField.getWidgets()[0];
    var da = (w && w.getDefaultAppearance()) || field.acroField.getDefaultAppearance() || '';
    var m = /([\d.]+)\s+Tf/.exec(da);
    return !m || Number(m[1]) === 0;   /* 没有 /DA → 继承 AcroForm 的 /Helv 0 Tf */
  }

  /* 在模板里找完整嵌入的 Courier New 粗体：非子集（BaseFont 不带 ABCDEF+ 前缀）、TrueType、WinAnsi、
   * 有 /FontFile2、32–255 的字宽全是 600（与量宽度用的 Courier-Bold 一致）。找不到返回 null。 */
  function findEmbeddedCourierNewBold(PDFLib, doc) {
    var N = function (k) { return PDFLib.PDFName.of(k); };
    var found = null;
    doc.context.enumerateIndirectObjects().some(function (pair) {
      var obj = pair[1];
      if (!(obj instanceof PDFLib.PDFDict)) return false;
      if (String(obj.get(N('Type'))) !== '/Font' || String(obj.get(N('Subtype'))) !== '/TrueType') return false;
      if (!/^\/CourierNew(PS)?-?,?Bold(MT)?$/.test(String(obj.get(N('BaseFont'))))) return false;
      if (String(obj.get(N('Encoding'))) !== '/WinAnsiEncoding') return false;
      var fd = obj.lookupMaybe(N('FontDescriptor'), PDFLib.PDFDict);
      if (!fd || !fd.get(N('FontFile2'))) return false;
      var ws = obj.lookupMaybe(N('Widths'), PDFLib.PDFArray);
      var fc = obj.lookupMaybe(N('FirstChar'), PDFLib.PDFNumber);
      if (!ws || !fc) return false;
      var first = fc.asNumber(), arr = ws.asArray();
      if (first > 32 || first + arr.length - 1 < 255) return false;
      for (var c = 32; c <= 255; c++) {
        var w = arr[c - first];
        if (!w || typeof w.asNumber !== 'function' || w.asNumber() !== 600) return false;
      }
      found = pair[0];
      return true;
    });
    return found;
  }

  /* 退路字体字典：不嵌入的 Courier New 粗体（见本节开头）。 */
  function registerCourierNewBoldRef(PDFLib, doc, afm) {
    var widths = [];
    for (var c = 32; c <= 255; c++) widths.push(600);
    var desc = doc.context.register(doc.context.obj({
      Type: 'FontDescriptor', FontName: TYPE_BASEFONT,
      Flags: 1 + 32,  /* FixedPitch + Nonsymbolic */
      FontBBox: afm.FontBBox, ItalicAngle: 0,
      Ascent: afm.Ascender, Descent: afm.Descender, CapHeight: afm.CapHeight,
      StemV: afm.StdVW || 106, FontWeight: 700
    }));
    return doc.context.register(doc.context.obj({
      Type: 'Font', Subtype: 'TrueType', BaseFont: TYPE_BASEFONT, Encoding: 'WinAnsiEncoding',
      FirstChar: 32, LastChar: 255, Widths: widths, FontDescriptor: desc
    }));
  }

  /* 返回给外观流用的字体对象：量宽度 / 编码借 Courier-Bold（另起一个空文档里取，不进本文档），
   * 资源名 = TYPE_RES、引用 = 上面找到或新建的 Courier New 粗体字典。
   * 用 Object.create 包一层：pdf-lib 的 updateAppearances 只认 PDFFont 实例，取的是 name 与 ref；
   * 这个对象不在本文档的字体表里，保存时不会被 pdf-lib 重写成 Type1 字典。 */
  async function setupTypeFont(PDFLib, doc) {
    var scratch = await PDFLib.PDFDocument.create();
    var metrics = scratch.embedStandardFont(PDFLib.StandardFonts.CourierBold);
    var embedded = findEmbeddedCourierNewBold(PDFLib, doc);
    var ref = embedded || registerCourierNewBoldRef(PDFLib, doc, metrics.embedder.font);
    var acro = doc.getForm().acroForm.dict;
    var dr = acro.lookupMaybe(PDFLib.PDFName.of('DR'), PDFLib.PDFDict);
    if (!dr) { dr = doc.context.obj({}); acro.set(PDFLib.PDFName.of('DR'), dr); }
    var fonts = dr.lookupMaybe(PDFLib.PDFName.of('Font'), PDFLib.PDFDict);
    if (!fonts) { fonts = doc.context.obj({}); dr.set(PDFLib.PDFName.of('Font'), fonts); }
    fonts.set(PDFLib.PDFName.of(TYPE_RES), ref);
    return Object.create(metrics, {
      name: { value: TYPE_RES },
      ref: { value: ref },
      embeddedFromTemplate: { value: !!embedded }
    });
  }

  /* 按词折行。显式 \n 分段；一行放不下的超长单词按字符拆到下一行（字不丢）。
   * 返回 [{ text, end }]：end = 这一行最后一个字符在原文里的下标 + 1（截断时据此切原文）。 */
  function wrapLines(font, text, size, maxW) {
    var s = String(text), out = [], i = 0;
    var W = function (t) { return font.widthOfTextAtSize(t, size); };
    for (;;) {
      var nl = s.indexOf('\n', i);
      if (nl < 0) nl = s.length;
      var para = s.slice(i, nl), line = '', lineEnd = nl, re = /\S+/g, m;
      while ((m = re.exec(para))) {
        var word = m[0], ws = i + m.index;
        var cand = line ? line + ' ' + word : word;
        if (W(cand) <= maxW) { line = cand; lineEnd = ws + word.length; continue; }
        if (line) out.push({ text: line, end: lineEnd });
        while (word.length > 1 && W(word) > maxW) {
          var k = word.length - 1;
          while (k > 1 && W(word.slice(0, k)) > maxW) k--;
          out.push({ text: word.slice(0, k), end: ws + k });
          word = word.slice(k); ws += k;
        }
        line = word; lineEnd = ws + word.length;
      }
      out.push({ text: line, end: line ? lineEnd : nl });
      if (nl >= s.length) break;
      i = nl + 1;
    }
    return out;
  }

  function rectOf(field) {
    var ws = field.acroField.getWidgets();
    var w = Infinity, h = Infinity, y = 0;
    ws.forEach(function (x) { var r = x.getRectangle(); if (r.width < w) { w = r.width; y = r.y; } if (r.height < h) h = r.height; });
    return { width: w, height: h, y: y };
  }

  /* 量宽度、定字号：返回 { ok:true, kind, size, lines?, truncated? } 或
   * { ok:false, reason, widest, limit }（widest / limit 都是 8pt 下的值，单位 pt）。 */
  function layoutText(PDFLib, field, text, font) {
    var afm = font.embedder.font;
    var r = rectOf(field);
    var name = field.getName();
    var ink = function (size) { return size * (afm.Ascender - afm.Descender) / 1000; };
    var W = function (t, size) { return font.widthOfTextAtSize(t, size); };
    var k, size, lines;
    var ruled = ruledOf(name);
    if (ruled) {
      var limitR = r.width - 2 * ruled.insetX;
      for (k = 0; k < TYPE_SIZES.length; k++) {
        size = TYPE_SIZES[k];
        lines = wrapLines(font, text, size, limitR);
        if (lines.length <= ruled.rows) return { ok: true, kind: 'ruled', size: size, lines: lines };
      }
      if (!ruled.truncate) {
        return { ok: false, reason: 'lines', linesNeeded: lines.length, rowsAvail: ruled.rows, limit: limitR,
          widest: lines.reduce(function (a, l) { return Math.max(a, W(l.text, size)); }, 0) };
      }
      var keep = lines.slice(0, ruled.rows);
      var cut = keep[keep.length - 1].end;
      return {
        ok: true, kind: 'ruled', size: size, lines: keep,
        truncated: { kept: String(text).slice(0, cut).replace(/\s+$/, ''), rest: String(text).slice(cut).trim(),
          linesNeeded: lines.length }
      };
    }
    if (field.isMultiline()) {
      var limitM = r.width - 2 * TYPE_PAD;
      var widest = 0;
      for (k = 0; k < TYPE_SIZES.length; k++) {
        size = TYPE_SIZES[k];
        lines = wrapLines(font, text, size, limitM);
        var needH = (lines.length - 1) * TYPE_LEADING * size + ink(size);
        if (needH <= r.height - 2 * TYPE_PAD) return { ok: true, kind: 'multi', size: size, lines: lines };
      }
      lines.forEach(function (l) { widest = Math.max(widest, W(l.text, size)); });
      return { ok: false, reason: 'lines', widest: widest, limit: limitM, linesNeeded: lines.length,
        rowsAvail: Math.max(0, Math.floor((r.height - 2 * TYPE_PAD - ink(size)) / (TYPE_LEADING * size)) + 1) };
    }
    var one = String(text).replace(/[\r\n]+/g, ' ');
    var maxLen = field.getMaxLength ? field.getMaxLength() : 0;
    if (field.isCombed() && maxLen) {
      var cell = r.width / maxLen;
      var chars = one.split('');
      for (k = 0; k < TYPE_SIZES.length; k++) {
        size = TYPE_SIZES[k];
        var cw = chars.reduce(function (a, ch) { return Math.max(a, W(ch, size)); }, 0);
        if (chars.length <= maxLen && cw <= cell - 1 && ink(size) <= r.height - 2) return { ok: true, kind: 'comb', size: size, cell: cell };
      }
      return { ok: false, reason: 'comb', widest: cw, limit: cell - 1 };
    }
    var limitS = r.width - 2 * TYPE_PAD;
    var tw;
    for (k = 0; k < TYPE_SIZES.length; k++) {
      size = TYPE_SIZES[k];
      tw = W(one, size);
      if (tw <= limitS && ink(size) <= r.height - 2) return { ok: true, kind: 'single', size: size, text: one };
    }
    return { ok: false, reason: 'width', widest: tw, limit: limitS };
  }

  /* 按 layoutText 的结果画外观流。字宽已在 layoutText 里核过（10→9→8pt 整档缩，
   * 8pt 仍放不下就整格不写）。这里**不能**指望「算错了字会露在格子外面被看见」：
   * 外观流的 /BBox 就是格子矩形（实测与 widget 矩形相同），超出部分会被 PDF 规范裁掉、
   * 打印出来是半截字。所以唯一的防线是写入前的宽度断言，不是「看得见」。 */
  function drawLayout(PDFLib, field, lay, font) {
    var afm = font.embedder.font;
    var size = lay.size;
    var capY = function (h) {  /* 单行：大写字高在格子里垂直居中，且下伸部不出格 */
      return Math.max((h - size * afm.CapHeight / 1000) / 2, -size * afm.Descender / 1000 + 0.5);
    };
    field.updateAppearances(font, function (f, widget, fnt) {
      var rect = widget.getRectangle();
      var ops = [
        PDFLib.beginMarkedContent('Tx'), PDFLib.pushGraphicsState(), PDFLib.beginText(),
        PDFLib.setFillingGrayscaleColor(0), PDFLib.setFontAndSize(fnt.name, size)
      ];
      var put = function (x, y, t) {
        ops.push(PDFLib.setTextMatrix(1, 0, 0, 1, +x.toFixed(3), +y.toFixed(3)));
        ops.push(PDFLib.showText(fnt.encodeText(t)));
      };
      var k;
      if (lay.kind === 'ruled') {
        var rl = ruledOf(f.getName());
        for (k = 0; k < lay.lines.length; k++) {
          put(rl.insetX, rl.lowestRuleY + rl.baselineAboveRule + (rl.rows - 1 - k) * rl.pitch - rect.y, lay.lines[k].text);
        }
      } else if (lay.kind === 'multi') {
        var lh = TYPE_LEADING * size;
        var rows = Math.floor((rect.height - 2 * TYPE_PAD - size * (afm.Ascender - afm.Descender) / 1000) / lh) + 1;
        var top = rows <= 1 ? capY(rect.height) : rect.height - TYPE_PAD - size * afm.Ascender / 1000;
        for (k = 0; k < lay.lines.length; k++) put(TYPE_PAD, top - k * lh, lay.lines[k].text);
      } else if (lay.kind === 'comb') {
        var cell = rect.width / f.getMaxLength();
        var t = f.getText() || '';
        for (k = 0; k < t.length; k++) {
          put(k * cell + (cell - fnt.widthOfTextAtSize(t[k], size)) / 2, capY(rect.height), t[k]);
        }
      } else {
        var q = f.acroField.getQuadding() || 0;
        var tw = fnt.widthOfTextAtSize(lay.text, size);
        var x = q === 1 ? (rect.width - tw) / 2 : q === 2 ? rect.width - TYPE_PAD - tw : TYPE_PAD;
        put(x, capY(rect.height), lay.text);
      }
      ops.push(PDFLib.endText(), PDFLib.popGraphicsState(), PDFLib.endMarkedContent());
      return ops;
    });
    setDA(field, size);
  }

  async function fillPdf(opts) {
    var PDFDocument = opts.PDFDocument;
    /* 字体与外观流要用 pdf-lib 的标准字体与绘制函数：浏览器传 window.PDFLib；
       Node 脚本没传时从同目录的 libs/ 取（与调用方 require 的是同一个文件、同一个模块实例）。 */
    var PDFLib = opts.PDFLib || (typeof globalThis !== 'undefined' ? globalThis.PDFLib : null);
    if (!PDFLib && typeof module === 'object' && typeof require === 'function') {
      try { PDFLib = require('../libs/pdf-lib.min.js'); } catch (e) { PDFLib = null; }
    }
    if (!PDFLib || !PDFLib.StandardFonts) {
      throw new Error('PDF 组件没有加载完整（缺字体模块），文件没有生成。请刷新页面后重试。');
    }
    var doc;
    try {
      doc = await PDFDocument.load(opts.pdfBytes, { ignoreEncryption: true });
    } catch (e) {
      throw new Error('读不出官方 PDF 模板（文件可能损坏或版本不对）。建议：重新下载模板后重试。');
    }
    var form = doc.getForm();
    var existing = Object.create(null);
    form.getFields().forEach(function (f) { existing[f.getName()] = f; });
    /* USCIS 打字口径：Courier New 粗体 10pt（见 TYPE_SIZES 一节）。 */
    var typeFont = await setupTypeFont(PDFLib, doc);
    /* 字号 = 0（自动）的格子先定成 Courier New 粗体 10pt —— 工具写不写都定，
       用户之后在阅读器里手打也按这个字号出字（uscis_number 工具不写，只改 /DA）。 */
    form.getFields().forEach(function (f) { if (isAutoSizeField(f)) setDA(f, TYPE_SIZES[0]); });
    /* 本次写过的格子：只给这些格子生成外观（见保存前的说明） */
    var touched = Object.create(null);
    /* 写过的文本格 → 量好的排版（字号 / 行），保存前按它画外观 */
    var layouts = Object.create(null);
    /* 模板页数（官方表 = 27）。填值前后必须一致：这是「A 文件就是官方表」的硬约束。 */
    var pagesBefore = doc.getPageCount();
    var fieldsBefore = form.getFields().length;

    var plan = buildWrites(opts.model, {
      answers: opts.answers, groups: opts.groups || {},
      /* 量不出（WinAnsi 编不了的字）返回 NaN → part14Fits 按等宽 0.6em 估，不让整份 PDF 失败 */
      measureLine: function (t, size) { try { return typeFont.widthOfTextAtSize(t, size); } catch (e) { return NaN; } }
    });
    var report = {
      visibleQuestions: plan.visible,
      planned: plan.writes.length,
      checked: 0,
      unchecked: 0,
      text: 0,
      missing: [],
      warnings: plan.warnings.slice(),
      errors: [],
      /* 完成页的「说明」：不是警告，是让用户核对的判定依据（日期补全 / 五年判定） */
      notes: residenceNotes(opts.model, opts.answers, opts.now),
      /* 被缩写的格子：完成页要逐条列出来（本项目不做任何截断） */
      adjustments: [],
      /* v13：Part 14 实际写进去的行数（完成页向客户报告，验收脚本对账用） */
      part14Rows: 0,
      /* 缩写后仍放不下的格子：完成页提示「建议打印后手写覆盖」 */
      handwrite: [],
      /* 单个格子写不进去时的中文说明（其余格子照写，PDF 仍生成） */
      skipped: [],
      /* 10pt 放不下、按整档缩过字号的格子：{ pdf, inputId, size }（不是错误，验收与排查用） */
      fontShrunk: [],
      /* 打字字体来源：'template-embedded' = 引用官方表自带的 Courier New 粗体；'non-embedded' = 退路字典 */
      typeFont: typeFont.embeddedFromTemplate ? 'template-embedded' : 'non-embedded'
    };

    /* Part 14 放不下的行：进「没写进 PDF」清单（report.handwrite + skipped），
       不许裁、不许静默 —— 完成页会逐条告诉用户哪一条要打印后手写。 */
    (plan.overflows || []).forEach(function (o) {
      report.handwrite.push(o);
      report.skipped.push(o.inputId);
    });

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
          /* 宽度检查：量宽度与格宽比，10 → 9 → 8pt 整档缩；8pt 仍放不下 → 不写、进清单，不裁字。 */
          var lay = layoutText(PDFLib, field, fit.text, typeFont);
          if (!lay.ok) {
            var wide = {
              inputId: w.inputId, question: w.question, item: w.item, title: w.title, label: w.label,
              pdf: w.pdf, original: w.value, written: '', maxLength: maxLen, action: 'toowide', reason: lay.reason,
              widest: Math.round(lay.widest * 10) / 10, widthLimit: Math.round(lay.limit * 10) / 10,
              minSize: TYPE_SIZES[TYPE_SIZES.length - 1]
            };
            if (lay.linesNeeded) { wide.linesNeeded = lay.linesNeeded; wide.rowsAvail = lay.rowsAvail; }
            report.handwrite.push(wide);
            report.skipped.push(w.inputId);
            continue;
          }
          var toWrite = lay.truncated ? lay.truncated.kept : fit.text;
          try {
            field.setText(toWrite);
          } catch (e2) {
            /* 本项目不做任何截断：写不进去就跳过这一格，绝不把用户内容截成歧义串。 */
            report.errors.push(zhWhere(w) + '：这一格写不进去，已跳过（其余格子照常写入）；建议把内容改短后重试，或打印后手写补上。');
            report.skipped.push(w.inputId);
            continue;
          }
          report.text++;
          touched[w.pdf] = field;
          layouts[w.pdf] = lay;
          if (lay.size !== TYPE_SIZES[0]) {
            /* item / title / label：完成页据此写「哪一格缩到了几号字」 */
            report.fontShrunk.push({ pdf: w.pdf, inputId: w.inputId, size: lay.size,
              item: w.item, title: w.title, label: w.label });
          }
          if (lay.truncated) {
            /* 只有第 62 项走这里：8pt 仍超过 8 条横线，写前 8 行，其余截断并报告。 */
            report.handwrite.push({
              inputId: w.inputId, question: w.question, item: w.item, title: w.title, label: w.label,
              pdf: w.pdf, original: w.value, written: lay.truncated.kept, rest: lay.truncated.rest,
              maxLength: 0, action: 'truncated', reason: 'rows', size: lay.size,
              linesNeeded: lay.truncated.linesNeeded, rowsAvail: lay.lines.length
            });
          }
          /* Part 14 实际写进去的行数（v13）：与写入计划同一条循环数出来，
             完成页据此报「Part 14 写了 N 行」，验收脚本拿它与 PDF 里的
             非空 description 行数对账（不另写一套计数逻辑）。 */
          if (/^additional_info_description_\d+$/.test(w.pdf || '')) report.part14Rows = (report.part14Rows || 0) + 1;
        } else if (w.kind === 'check') {
          if (typeof field.check !== 'function') {
            report.errors.push(zhWhere(w) + '：官方 PDF 里这一格不是复选框，已跳过；建议打印后手写勾上。');
            report.skipped.push(w.inputId);
            continue;
          }
          field.check();
          touched[w.pdf] = field;
          report.checked++;
        } else {
          if (typeof field.uncheck === 'function') { field.uncheck(); touched[w.pdf] = field; }
          report.unchecked++;
        }
      } catch (e) {
        report.errors.push(zhWhere(w) + '：这一格写入异常，已跳过（其余格子照常写入）；建议把内容改短后重试，或打印后手写补上。');
        report.skipped.push(w.inputId);
      }
    }

    /* 单格失败不再中止整份 PDF：错误全部记进 report.errors（中文），照常 save()。 */

    /* 外观只给本次写过的格子生成（2026-11-19）。
       原来交给 doc.save() 默认的 updateFieldAppearances：pdf-lib 会给模板里所有
       「没有外观流」的文本格（350 个）重生成外观，并把 /DA 改写成固定字号 ——
       uscis_number / A-Number 这类官方 /Cour 0 Tf（自动）的格子被改成 /Helvetica 24 Tf，
       值是空的也照改。现在没写的格子保持官方模板原样（字号 0 的格子除外，已定成 10pt）；
       写过的文本格按 layoutText 量好的字号与行画 Courier New 粗体外观（drawLayout），
       复选框仍走 pdf-lib 的 needsAppearancesUpdate → defaultUpdateAppearances。 */
    try {
      Object.keys(touched).forEach(function (name) {
        var f = touched[name];
        if (layouts[name]) { drawLayout(PDFLib, f, layouts[name], typeFont); return; }
        /* 复选框：pdf-lib 同一个判断与同一个默认外观函数（ZapfDingbats 勾） */
        if (typeof f.needsAppearancesUpdate === 'function' && f.needsAppearancesUpdate()) f.defaultUpdateAppearances();
      });
    } catch (e) {
      throw new Error('PDF 保存失败（浏览器内存可能不够）。建议：关掉其它标签页后重试。');
    }

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
      /* 外观已在上面按格子生成；这里不再让 pdf-lib 全表重生成（flatten 路径在
         form.flatten() 里自己会全表生成一次，不受影响）。 */
      bytes = await doc.save({ updateFieldAppearances: false });
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
    joinLines: joinLines,
    fitTextToMax: fitTextToMax,
    SHORT_WRITE: SHORT_WRITE,
    parseResidenceDate: parseResidenceDate,
    fmtMDY: fmtMDY,
    fmtMY: fmtMY,
    residenceSpan: residenceSpan,
    deriveAnswers: deriveAnswers,
    part14RowText: part14RowText,
    part14Fits: part14Fits,
    /* v11 单位换算：界面与写入共用这三个纯函数 */
    cmToFtIn: cmToFtIn,
    kgToLb: kgToLb,
    convertMetric: convertMetric,
    CM_MIN: CM_MIN,
    CM_MAX: CM_MAX,
    KG_MIN: KG_MIN,
    KG_MAX: KG_MAX,
    residenceNotes: residenceNotes,
    residenceFields: residenceFields,
    /* v12 附加白纸：条目文字与 Part 14 同源（都走 part14RowText） */
    extraSheetEntries: extraSheetEntries,
    extraSheetMeta: extraSheetMeta,
    fillPdf: fillPdf
  };
});
