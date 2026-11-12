/* app.js —— 单页问卷 UI（无框架、无网络请求） */
(function () {
  'use strict';

  var MODEL = window.I485_QUESTIONS;
  var CORE = window.I485Core;
  var LS_KEY = 'i485web.v1';
  /* v9 批 1：皮肤选择独立存档键（与答案存档 LS_KEY 分开，互不影响）。
     只存皮肤名，不存答案。 */
  var THEME_KEY = 'i485web.theme';
  var THEMES = ['shenqing', 'nuanzhu', 'wenshu'];
  var DEFAULT_THEME = 'shenqing';
  var PDF_CANDIDATES = [
    'assets/fillvisa_i-485-acro.pdf'
  ];

  if (!MODEL || !CORE) {
    document.body.innerHTML = '<pre style="padding:24px">数据未加载：缺少 data/questions.js 或 js/core.js</pre>';
    return;
  }

  var GROUPS = MODEL.part2Groups || {};
  /* uncertain：被「不确定，先标记」的题（q.id -> true），有它的题不写任何 PDF 字段。
     seenSegs：已经看过过渡卡的段（段号 -> true），只在第一次进段时出现。
     两个字段都直接进存档；旧存档没有这两个键时按空对象处理。 */
  var state = { answers: {}, pos: 0, currentId: null, uncertain: {}, seenSegs: {} };

  /* ---------- 八段分段（sections.js） ---------- */
  var SEGMENTS = window.I485_SECTIONS || [];
  var SEG_TOTAL = SEGMENTS.length || 8;
  var BANK_INDEX = {};   /* question.id -> 题库序号（0 起），题号不随条件题增减漂移 */
  MODEL.questions.forEach(function (q, i) { if (!(q.id in BANK_INDEX)) BANK_INDEX[q.id] = i; });

  var el = function (id) { return document.getElementById(id); };
  var ctx = function () { return { answers: state.answers, groups: GROUPS }; };
  var list = function () { return CORE.visibleQuestions(MODEL, ctx()); };

  /* ---------------- 存档 ---------------- */
  var saveTimer = null;
  /* 立即落盘（不等 250ms 防抖）。
     save() 是防抖的：刚答完最后一笔就点「导出」，读 localStorage 拿到的是旧档，
     最后一笔就漏了。导出/导入这类「必须拿到最新一笔」的路径一律先 writeNow()。
     写盘成功后才更新时间戳：写失败（隐私模式）不谎报「已自动保存」。
     返回 true/false，调用方据此决定要不要说「已保存」。 */
  function writeNow() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        v: 1, answers: state.answers, pos: state.pos, currentId: state.currentId,
        uncertain: state.uncertain, seenSegs: state.seenSegs, at: Date.now()
      }));
      /* 存档写成功 → 更新「已自动保存 · HH:MM」。
         写在 setItem 之后：写失败（隐私模式）就不谎报“已保存”。 */
      setSaveTime(Date.now());
      return true;
    } catch (e) { return false; }   /* 隐私模式等写入失败 */
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      writeNow();
    }, 250);
  }
  /* 旧存档兼容：缺字段 / 类型不对 / 数组 / null 一律回落成空对象，只收 true。 */
  function readFlags(v) {
    var out = {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    Object.keys(v).forEach(function (k) { if (v[k] === true) out[k] = true; });
    return out;
  }
  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (!d || d.v !== 1) return false;
      state.answers = d.answers || {};
      /* pos 只接受整数：旧存档 / 手改存档里出现 "4"、3.7、null、NaN 时回 0，
         否则答题页会以小数下标取题，或把字符串拼进 `state.pos + 1`。 */
      var savedPos = Math.floor(Number(d.pos));
      state.pos = (isFinite(savedPos) && savedPos > 0) ? savedPos : 0;
      state.currentId = d.currentId || null;
      state.uncertain = readFlags(d.uncertain);
      state.seenSegs = readFlags(d.seenSegs);
      /* 「已自动保存 · HH:MM」按存档的 at 回填（刷新后仍显示上次的保存时刻） */
      setSaveTime(d.at);
      return true;
    } catch (e) { return false; }
  }
  function wipe() {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    state.answers = {}; state.pos = 0; state.currentId = null;
    state.uncertain = {}; state.seenSegs = {};
    /* 中途导出的快照也作废：重新开始后不许还说「你在第 X 题时导出的」 */
    partialExport = null;
  }

  /* ---------------- 皮肤切换（v9 批 1）----------------
   * 三套外观 = theme.css 里三组变量；切换只改 <html data-theme> 一个属性。
   * 关键纪律：**颜色只有一个定义源**（theme.css）。app.js 里不许出现颜色值，
   * 连 JS 直写颜色（段强调色 / 进度条色）都改成读 CSS 变量。
   * 存档键独立：i485web.theme（与答案存档 i485web.v1 分开）。
   */
  var currentTheme = DEFAULT_THEME;
  function readTheme() {
    var t = null;
    try { t = localStorage.getItem(THEME_KEY); } catch (e) { t = null; }
    return (t && THEMES.indexOf(t) >= 0) ? t : DEFAULT_THEME;
  }
  function applyTheme(name, persist) {
    if (THEMES.indexOf(name) < 0) name = DEFAULT_THEME;
    currentTheme = name;
    /* 皮肤要写在 <html> 上：theme.css 的选择器是 html[data-theme="..."]，
       写在 body 上则 JS 执行前整页没有颜色（首帧透明 / 白闪）。 */
    var de = document.documentElement;
    if (de && de.setAttribute) de.setAttribute('data-theme', name);
    /* body 上也放一份：JS 读 body 时不用绕 documentElement，且便于脚本断言 */
    if (document.body && document.body.setAttribute) document.body.setAttribute('data-theme', name);
    if (persist) {
      try { localStorage.setItem(THEME_KEY, name); } catch (e) { /* 隐私模式：忽略 */ }
    }
    /* 色点的选中态：aria-pressed 跟着当前皮肤走 */
    var dots = document.querySelectorAll ? document.querySelectorAll('.theme-dot') : [];
    Array.prototype.forEach.call(dots, function (d) {
      d.setAttribute('aria-pressed', d.getAttribute('data-theme') === name ? 'true' : 'false');
    });
    /* 段强调色与页面底色都写成 var() 引用：皮肤一变它们自动重解析。
       这里重写一次是为了保证「行内值永远来自唯一事实源」。 */
    refreshThemeColors();
  }
  function bindThemeDots() {
    var box = el('themeDots');
    if (!box) return;
    var dots = box.querySelectorAll ? box.querySelectorAll('.theme-dot') : [];
    Array.prototype.forEach.call(dots, function (d) {
      d.addEventListener('click', function () { applyTheme(d.getAttribute('data-theme'), true); });
    });
  }
  /* 皮肤切换后重写行内变量（全部是 var() 引用，不会把颜色写进 JS） */
  function refreshThemeColors() {
    var de = document.documentElement;
    if (de && de.style && de.style.setProperty) {
      de.style.setProperty('--seg-accent', 'var(--accent)');
    }
    if (document.body && document.body.style) {
      document.body.style.backgroundColor = 'var(--bg)';
    }
  }

  /* ---------------- 「已自动保存 · HH:MM」（v9 批 1）----------------
   * 仅答题页显示；时间取最后一次 save() 成功的时刻。
   * 刷新后按存档的 at 字段回填（at 是 save() 里写进去的 Date.now()）。 */
  var lastSavedAt = 0;
  function fmtHM(ms) {
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function paintSaveTime() {
    var n = el('saveTime');
    if (!n) return;
    n.textContent = lastSavedAt ? ('已自动保存 · ' + fmtHM(lastSavedAt)) : '';
    /* v9 批 7：这行文字出现/消失会改变固定页脚的高度（430 宽下会从 1 行变 2 行）。
       不重算 --foot-h，底栏就会按旧高度落位、压住页脚 30px（v9-style3 的 S2 抓到）。
       页脚隐藏的视图量到 0，无副作用。 */
    fitFooter();
  }
  /* 存档里的 at 字段（毫秒时间戳）；老存档没有就当没存过 */
  function setSaveTime(ms) {
    var v = Number(ms);
    if (!isFinite(v) || v <= 0) { lastSavedAt = 0; }
    else { lastSavedAt = v; }
    paintSaveTime();
  }

  /* ---------------- 视图切换 ----------------
   * 完成页拆成两屏：done = 结果屏（查验结果），handoff = 拿表屏（下载 + 后续）。
   * 两屏都不重算数据：数据在 showDone() 里算好，切屏只切 DOM。 */
  /* 当前视图名（intro / seg / q / done / handoff）。
     导入后要留在用户原来的屏上（Y4），所以得记住「导入前在哪一屏」。 */
  var currentView = 'intro';
  function setView(name) {
    currentView = name;
    ['intro', 'seg', 'q', 'done', 'handoff', 'sheet'].forEach(function (v) {
      var node = el('view-' + v);
      if (node) node.classList.toggle('active', v === name);
    });
    document.body.classList.toggle('intro', name === 'intro');
    document.body.classList.toggle('seg', name === 'seg');
    /* done / handoff / sheet 都是「已完成」态：没有底栏、没有页脚，页面底色统一。 */
    document.body.classList.toggle('done', name === 'done' || name === 'handoff' || name === 'sheet');
    /* v9 批 7：拿表屏要留页脚（brief 要求三屏都检查），但底栏仍然隐藏。
       单独一个 handoff 类，CSS 用 body.done.handoff #foot 把页脚放回来。 */
    document.body.classList.toggle('handoff', name === 'handoff');
    /* 门题屏的让位（隐藏页脚 / 顶栏点条）只在答题页生效；
       离开答题页必须把 gate 类摘掉，否则完成页也会跟着少页脚。 */
    if (name !== 'q') {
      document.body.classList.remove('gate');
      var qcard = document.querySelector('#view-q .card.question');
      if (qcard) qcard.classList.remove('gate');
    }
    /* 段强调色只在答题页有意义：回到开始页 / 完成页一律复位成默认蓝，
       不然会残留上一段的颜色，页脚和空标题前的圆点跟着串色。 */
    if (name !== 'q' && document.documentElement && document.documentElement.style) {
      document.documentElement.style.setProperty('--seg-accent', 'var(--accent)');
    }
    /* 切屏时把另一块的旧提示清掉（Y6 串屏的第二道保险） */
    clearOtherIoMsg(name);
    window.scrollTo(0, 0);
    /* 页脚/底栏的让位随视图变（拿表屏有页脚没底栏，完成页两者都无） */
    fitFooter();
  }

  function partOf(section) {
    for (var i = 0; i < MODEL.parts.length; i++) if (MODEL.parts[i].id === section) return MODEL.parts[i];
    return { title: section, no: '' };
  }

  /* ---------------- 分段：定位 / 进度条 / 点 / 横幅 ---------------- */
  function segIndexOf(section) {
    for (var i = 0; i < SEGMENTS.length; i++) {
      if (SEGMENTS[i].sections.indexOf(section) >= 0) return i;
    }
    return 0;
  }

  function computeSegRanges() {
    SEGMENTS.forEach(function (s) {
      s._start = Infinity; s._count = 0;
      MODEL.questions.forEach(function (q, i) {
        if (s.sections.indexOf(q.section) < 0) return;
        if (i < s._start) s._start = i;
        s._count++;
      });
      if (!isFinite(s._start)) s._start = 0;
    });
  }

  function buildSegBar() {
    var bar = el('segBar');
    if (!bar || !SEGMENTS.length) return;
    bar.innerHTML = '';
    SEGMENTS.forEach(function (s) {
      var d = document.createElement('div');
      d.className = 'seg-chunk';
      d.setAttribute('data-seg', String(s.n));
      d.setAttribute('title', '第 ' + s.n + ' 段 · ' + s.title + '（' + s._count + ' 题）· 点一下跳到这一段');
      d.setAttribute('role', 'button');
      d.setAttribute('tabindex', '0');
      d.setAttribute('aria-label', '跳到第 ' + s.n + ' 段：' + s.title);
      d.style.flexGrow = String(s._count || 1);
      d.appendChild(document.createElement('i'));
      /* 2026-11-09：进度条第 N 小节可点 = 跳到第 N 段的第一道当前可见题 */
      d.addEventListener('click', function () { jumpToSeg(s.n); });
      d.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpToSeg(s.n); }
      });
      bar.appendChild(d);
    });
  }

  /* ---------------- 段/题导航（2026-11-09）----------------
   * 老板要的是「跳回去选第几段的第几题」：
   *   ① 顶栏进度条第 N 小节可点 → 跳到第 N 段的第一道当前可见题；
   *   ② 顶栏「目录」按钮 → 一页清单，8 段分组，点任意一条跳到该题。
   *
   * 口径（写进 README 与面板里）：**段内序号按「当前可见题」算**，
   * 与顶栏「本段已答 a / b」同一套算法。原因：条件题跟着答案增减
   * （例：第 1 段把 i485_role 选成「衍生申请人」会多出条件题），
   * 用题库写死序号会跳错题。
   * 只读数据源：window.I485_QUESTIONS + window.I485_SECTIONS + list()（可见题）。
   * 不新造编号体系、不改题库。 */
  /* 当前可见题按段分组：每段 = { seg: 段定义, items: 该段当前可见题 } */
  function visibleBySeg() {
    var l = list();
    return SEGMENTS.map(function (s) {
      return {
        seg: s,
        items: l.filter(function (q) { return s.sections.indexOf(q.section) >= 0; })
      };
    });
  }
  /* 第 n 段第一道当前可见题在 list() 里的下标；没有则 -1 */
  function firstPosOfSeg(seg) {
    var l = list();
    for (var i = 0; i < l.length; i++) {
      if (seg.sections.indexOf(l[i].section) >= 0) return i;
    }
    return -1;
  }
  /* 跳到某段第一道当前可见题（跳过切段过渡卡：导航是「直接去那道题」，
     不是「第一次进入这一段」——过渡卡是给顺着往下走的人看的） */
  function jumpToSeg(n) {
    var seg = null;
    for (var i = 0; i < SEGMENTS.length; i++) { if (SEGMENTS[i].n === n) { seg = SEGMENTS[i]; break; } }
    if (!seg) return;
    var pos = firstPosOfSeg(seg);
    if (pos < 0) return;
    render(pos, true);
    window.scrollTo(0, 0);
    save();
  }
  /* 跳到指定题（目录里点一条） */
  function jumpToQuestion(qid) {
    var l = list();
    var pos = -1;
    for (var i = 0; i < l.length; i++) { if (l[i].id === qid) { pos = i; break; } }
    closeToc();
    if (pos < 0) return;
    render(pos, true);
    window.scrollTo(0, 0);
    save();
  }
  /* 状态标记：已答 / 未答 / 不确定
     口径与结果屏「已答 a / b」一致（不确定的题不算已答，它不写任何格子）。 */
  function tocStateOf(q) {
    if (isUncertain(q)) return 'uncertain';
    if (hasAnswer(q)) return 'answered';
    return 'unanswered';
  }
  var TOC_STATE_TEXT = { answered: '已答', unanswered: '未答', uncertain: '不确定' };
  /* 目录面板内容：8 段分组，每段标题 + 该段当前可见题数 + 该段题目列表 */
  function renderToc() {
    var box = el('tocList');
    if (!box) return;
    box.innerHTML = '';
    /* 完成页（结果屏 / 拿表屏）没有「当前题」这个概念：
       在完成页打开目录时，不高亮任何题（答题页照旧高亮当前题）。 */
    var doneView = !!(document.body && document.body.classList &&
      document.body.classList.contains('done'));
    visibleBySeg().forEach(function (g) {
      var wrap = document.createElement('div');
      wrap.className = 'toc-seg';
      wrap.setAttribute('data-seg', String(g.seg.n));

      var head = document.createElement('div');
      head.className = 'toc-seg-head';
      var no = document.createElement('span');
      no.className = 'toc-seg-n';
      no.textContent = '第 ' + g.seg.n + ' 段';
      var nm = document.createElement('span');
      nm.className = 'toc-seg-name';
      nm.textContent = g.seg.title;
      var ct = document.createElement('span');
      ct.className = 'toc-seg-count';
      ct.textContent = g.items.length + ' 题';
      head.appendChild(no); head.appendChild(nm); head.appendChild(ct);
      wrap.appendChild(head);

      g.items.forEach(function (q, i) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'toc-item';
        item.setAttribute('data-no', g.seg.n + '-' + (i + 1));
        item.setAttribute('data-qid', q.id);
        /* data-state 同时挂在这一行与状态徽标上：行级查询（哪几行是未答）不用逐个找徽标 */
        item.setAttribute('data-state', tocStateOf(q));
        if (!doneView && q.id === state.currentId) item.classList.add('is-current');

        var num = document.createElement('span');
        num.className = 'toc-no';
        num.textContent = g.seg.n + '-' + (i + 1);
        var tx = document.createElement('span');
        tx.className = 'toc-text';
        tx.textContent = q.titleZh || q.title || '';
        tx.setAttribute('title', q.titleZh || q.title || '');
        var st = document.createElement('span');
        st.className = 'toc-state';
        var sv = tocStateOf(q);
        st.setAttribute('data-state', sv);
        st.textContent = TOC_STATE_TEXT[sv];

        item.appendChild(num); item.appendChild(tx); item.appendChild(st);
        item.addEventListener('click', function () { jumpToQuestion(q.id); });
        wrap.appendChild(item);
      });
      box.appendChild(wrap);
    });
  }
  /* 面板开/关：只改 DOM，不动存档、不动当前题（除非点了某一条）。 */
  var tocOpen = false;
  function openToc() {
    var panel = el('tocPanel');
    if (!panel) return;
    renderToc();
    panel.hidden = false;
    var ov = el('tocOverlay');
    if (ov) ov.hidden = false;
    tocOpen = true;
  }
  function closeToc() {
    var panel = el('tocPanel');
    if (panel) panel.hidden = true;
    var ov = el('tocOverlay');
    if (ov) ov.hidden = true;
    tocOpen = false;
  }

  /* ---------------- 导出三选项面板（v9 批 9）----------------
     顶栏「导出」不再直接生成 PDF，点一下弹这个面板：
       ① 导出进度（只下答案 .json，不生成 PDF；下面带一行指导小字）
       ② 导出 PDF（等同 generate()）
       ③ 下载填写说明（等同 generateInstructions()）
     与目录面板同族：同样的 .toc-panel / .toc-overlay 样式（不带新配色），
     点遮罩或 ESC 关闭；打开后焦点进面板，Tab 焦点不出面板。
     一条原则：**不动答案、不动存档**。面板只做「开 / 关 + 调三个已有函数」。 */
  var expOpen = false;
  /* 打开面板前记下焦点在哪：关的时候还回去（键盘用户不至于丢位置） */
  var expLastFocus = null;
  function openExp() {
    var panel = el('expPanel');
    if (!panel) return;
    expLastFocus = document.activeElement;
    panel.hidden = false;
    var ov = el('expOverlay');
    if (ov) ov.hidden = false;
    expOpen = true;
    /* 焦点进面板：第一条（「导出进度」） */
    var first = el('btnExpProgress');
    if (first && first.focus) { try { first.focus(); } catch (e) { /* 老内核 */ } }
  }
  function closeExp(restoreFocus) {
    var panel = el('expPanel');
    if (panel) panel.hidden = true;
    var ov = el('expOverlay');
    if (ov) ov.hidden = true;
    expOpen = false;
    if (restoreFocus && expLastFocus && expLastFocus.focus) {
      try { expLastFocus.focus(); } catch (e) { /* 老内核 */ }
    }
    expLastFocus = null;
  }

  /* ---------------- 关于作者面板（开始页「关于作者」按钮）----------------
     与目录 / 导出面板同族：只改 DOM（hidden 属性 + 遮罩），不动答案、不动存档键。
     开始页是文档滚动，面板开着时把页面滚动锁住，关的时候把原来的 inline 值写回去。
     关闭时焦点还给 #btnAbout。 */
  var aboutOpen = false;
  var aboutLastFocus = null;
  /* 锁滚动：记下 html / body 原来的 inline overflow，关的时候原样恢复。 */
  var aboutPrevOverflow = null;
  function lockPageScroll() {
    if (aboutPrevOverflow) return;
    var h = document.documentElement, b = document.body;
    if (!h || !b) return;
    aboutPrevOverflow = { h: h.style.overflow, b: b.style.overflow };
    h.style.overflow = 'hidden';
    b.style.overflow = 'hidden';
  }
  function unlockPageScroll() {
    if (!aboutPrevOverflow) return;
    if (document.documentElement) document.documentElement.style.overflow = aboutPrevOverflow.h;
    if (document.body) document.body.style.overflow = aboutPrevOverflow.b;
    aboutPrevOverflow = null;
  }
  function openAbout() {
    var panel = el('aboutPanel');
    if (!panel) return;
    aboutLastFocus = document.activeElement;
    panel.hidden = false;
    var ov = el('aboutOverlay');
    if (ov) ov.hidden = false;
    aboutOpen = true;
    lockPageScroll();
    /* 焦点进面板：关闭按钮（面板里第一个可聚焦元素） */
    var c = el('aboutClose');
    if (c && c.focus) { try { c.focus(); } catch (e) { /* 老内核 */ } }
  }
  function closeAbout() {
    var panel = el('aboutPanel');
    if (panel) panel.hidden = true;
    var ov = el('aboutOverlay');
    if (ov) ov.hidden = true;
    aboutOpen = false;
    unlockPageScroll();
    var back = el('btnAbout') || aboutLastFocus;
    if (back && back.focus) { try { back.focus(); } catch (e) { /* 老内核 */ } }
    aboutLastFocus = null;
  }
  /* 焦点陷阱：Tab / Shift+Tab 在面板内循环，不跑到面板外面去。
     只在面板开着时接管 keydown（目录面板不接管，两套互不干扰）。 */
  function expFocusables() {
    var panel = el('expPanel');
    if (!panel) return [];
    var sel = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
    var out = [];
    var all = panel.querySelectorAll(sel);
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      var r = n.getBoundingClientRect();
      var cs = window.getComputedStyle(n);
      if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none') out.push(n);
    }
    return out;
  }
  function trapExpTab(e) {
    if (!expOpen || e.key !== 'Tab') return;
    var list = expFocusables();
    if (!list.length) { e.preventDefault(); return; }
    var first = list[0], last = list[list.length - 1];
    var cur = document.activeElement;
    /* 焦点不在面板里（点遮罩后焦点可能掉回 body）→ 直接拉回第一个 */
    if (!cur || !el('expPanel') || !el('expPanel').contains(cur)) {
      e.preventDefault();
      first.focus();
      return;
    }
    if (e.shiftKey && cur === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && cur === last) {
      e.preventDefault(); first.focus();
    }
  }

  /* 开场页的「八段地图」已移除（2026-11-11 老板精简开始页）：
     #segMap 节点不再存在，这里不留渲染函数，避免留下对着空节点的死代码。 */

  /* 进度条第 N 小节 = 第 N 段（段身份不靠颜色，靠小节位置 + 段名文字）。
     已走完的段填满 --bar-done；当前段填到哪算哪，用浅一档的 --bar-cur；
     还没走到的段只露底槽 --bar-track。
     这三个值定义在 theme.css（唯一颜色事实源）；这里用 var() 引用，
     切皮肤时浏览器自动重解析，app.js 里不留任何颜色值。 */
  var BAR_DONE = 'var(--bar-done)', BAR_CUR = 'var(--bar-cur)';
  function updateSegBar(q) {
    var bar = el('segBar');
    if (!bar) return;
    var idx = BANK_INDEX[q.id];
    var curSeg = segIndexOf(q.section);
    var chunks = bar.children;
    for (var i = 0; i < chunks.length; i++) {
      var s = SEGMENTS[i];
      if (!s) continue;
      var frac = (idx - s._start + 1) / (s._count || 1);
      if (frac < 0) frac = 0;
      if (frac > 1) frac = 1;
      var fill = chunks[i].firstChild;
      /* 当前段刚开头的 1–2 题也给一个看得见的胆量，避免进度条看起来没动 */
      var pct = frac > 0 ? Math.max(frac, 0.08) * 100 : 0;
      if (fill) fill.style.width = pct.toFixed(2) + '%';
      chunks[i].classList.toggle('done', frac >= 1);
      if (fill) {
        if (i < curSeg) fill.style.background = BAR_DONE;
        else if (i === curSeg) fill.style.background = (frac >= 1) ? BAR_DONE : BAR_CUR;
        else fill.style.background = 'transparent';
      }
    }
  }

  function hasAnswer(q) {
    var answered = (q.options || []).some(function (o) { return state.answers[o.id] === true; });
    if (answered) return true;
    return (q.inputs || []).some(function (i) {
      var v = state.answers[i.id];
      return typeof v === 'string' && v.trim() !== '';
    });
  }

  /* ---------------- 不确定，先标记 ----------------
   * 只对是/否题、单选、多选题提供出口；两类题不提供：
   *   ① 门题（noPdf）：只决定显示哪一组 Part 2 清单、本身不写任何格子；
   *   ② gatesChildren：它的答案被别的题的 cond 引用，清空后下游条件题会整段消失
   *      （不写 PDF、界面也不提示）。构建期在 questions.js 里算好标记，不靠运行时猜。 */
  function isUncertain(q) { return state.uncertain[q.id] === true; }
  function canMarkUncertain(q) { return !isGate(q) && !q.gatesChildren; }
  function clearQuestionAnswers(q) {
    (q.options || []).forEach(function (o) { delete state.answers[o.id]; });
    (q.inputs || []).forEach(function (i) { delete state.answers[i.id]; });
  }
  function goNext() {
    var l = list();
    if (state.pos >= l.length - 1) {
      /* 走完全部题：把中途导出的快照清掉，回到「答完了」口径 */
      partialExport = null;
      showDone();
    } else render(state.pos + 1);
  }
  function toggleUncertain(q) {
    /* 防御：门题 / 会决定下游可见性的题不提供这个出口，即使被脚本直接调用也不改状态 */
    if (!canMarkUncertain(q)) return;
    if (isUncertain(q)) {
      /* 取消标记：只删标记，不动其它题 */
      delete state.uncertain[q.id];
      save();
      render(state.pos);
      return;
    }
    state.uncertain[q.id] = true;
    /* 标了就不写答案：先清掉这题已有的勾选 / 输入，PDF 对应格子保持空白 */
    clearQuestionAnswers(q);
    save();
    goNext();
  }

  /* 顶栏的「本段已答 a / b」：只留这一行文字。
     原来每题一个圆点（最长 28 个点换行，顶栏多占 53px），已删 ——
     段身份改由「切段深色横幅 + 段名文字 + 进度条第 N 小节」承担，不靠圆点。 */
  function renderDots(seg, currentId) {
    var box = el('segDots');
    if (!box) return;
    box.innerHTML = '';
    /* 口径：与目录同源 —— 「当前可见题」（list()），不是题库静态全量。
       条件题跟着答案增减时，本段分母跟着变：目录里列几题，顶栏就显示几题，
       同一屏不再出现两个分母。 */
    var qs = list().filter(function (q) { return seg.sections.indexOf(q.section) >= 0; });
    var done = qs.filter(hasAnswer).length;
    var lab = document.createElement('span');
    lab.className = 'dots-label';
    lab.textContent = '本段已答 ' + done + ' / ' + qs.length;
    box.appendChild(lab);
  }

  /* ---------------- 切段横幅：淡入 → 停 → 淡出（v9 批 1）----------------
   * 原口径（硬切不渐变）已作废（DESIGN.md 同步改）。
   * 原因：hidden 属性 + [hidden]{display:none} 无法过渡 —— display:none 不可动画。
   * 改法：显隐全由 class 控制：
   *   .is-on  → 淡入 200ms（opacity 0→1）
   *   .is-out → 淡出 180ms（opacity 1→0），结束后才真正 hidden
   * 时序：淡入 200ms → 停 1.6s → 淡出 180ms。
   * 定时器清理：每次 showBanner 都先把上一个定时器清掉（三个定时器分阶段），
   * 快速连点「继续」时旧定时器不会让横幅重影。
   * prefers-reduced-motion: reduce 下 CSS 把 transition 关成 0（验收 A11）。
   */
  var bannerTimerIn = null, bannerTimerHold = null, bannerTimerOut = null, lastSegN = -1;
  function clearBannerTimers() {
    if (bannerTimerIn) { clearTimeout(bannerTimerIn); bannerTimerIn = null; }
    if (bannerTimerHold) { clearTimeout(bannerTimerHold); bannerTimerHold = null; }
    if (bannerTimerOut) { clearTimeout(bannerTimerOut); bannerTimerOut = null; }
  }
  /* 立刻收掉横幅（进完成页 / 进切段过渡卡时用）：不发淡出，直接隐藏 */
  function hideBannerNow() {
    clearBannerTimers();
    var b = el('segBanner');
    if (!b) return;
    b.classList.remove('is-on');
    b.classList.remove('is-out');
    b.hidden = true;
  }
  function showBanner(seg) {
    var b = el('segBanner');
    if (!b) return;
    /* 旧定时器先清：连点「继续」时上一次的分阶段定时器不得再跑，
       否则横幅会重影 / 提前消失。 */
    clearBannerTimers();
    var head = el('topbar');
    if (head && head.offsetHeight) b.style.height = head.offsetHeight + 'px';
    b.innerHTML = '';
    var main = document.createElement('div');
    main.className = 'sb-main';
    main.textContent = seg.title;
    var sub = document.createElement('div');
    sub.className = 'sb-sub';
    sub.textContent = '第 ' + seg.n + ' 段 / 共 ' + SEG_TOTAL + ' 段';
    b.appendChild(main);
    b.appendChild(sub);
    /* 先把 hidden 放开并重置到「不可见」态，再加 .is-on 触发淡入。
       classList.remove('is-out') 是为了上一次淡出未完时不会被卡在 .is-out。 */
    b.hidden = false;
    b.classList.remove('is-out');
    b.classList.remove('is-on');
    /* 强制重排：让 opacity 0 的初态先落地，再切 .is-on，浏览器才会做过渡。 */
    if (b.offsetHeight !== undefined) { /* 读一次即可触发 reflow */ void b.offsetHeight; }
    b.classList.add('is-on');
    /* 阶段 1：淡入 200ms 结束后停 1.6s */
    bannerTimerIn = setTimeout(function () {
      bannerTimerIn = null;
      bannerTimerHold = setTimeout(function () {
        bannerTimerHold = null;
        /* 阶段 2：淡出 180ms，结束后真正隐藏 */
        b.classList.remove('is-on');
        b.classList.add('is-out');
        bannerTimerOut = setTimeout(function () {
          bannerTimerOut = null;
          b.classList.remove('is-out');
          b.hidden = true;
        }, 200);
      }, 1600);
    }, 200);
  }

  /* 切段过渡卡：不计入题库，只在第一次进入某段时出现。
     看见就把该段记成已看过并立刻落盘，后退 / 刷新都不会再弹。 */
  var pendingPos = 0;
  function showSegCard(seg, pos) {
    pendingPos = pos;
    state.seenSegs[String(seg.n)] = true;
    save();
    lastSegN = seg.n;
    /* 进切段过渡卡：横幅直接收掉（不发淡出），并清掉它的分阶段定时器 */
    hideBannerNow();
    setView('seg');
    if (document.body.style) document.body.style.backgroundColor = 'var(--bg)';
    if (document.body.setAttribute) document.body.setAttribute('data-seg', String(seg.n));
    if (document.documentElement && document.documentElement.style) {
      document.documentElement.style.setProperty('--seg-accent', 'var(--accent)');
    }
    var dot = el('segDot');
    if (dot && dot.style) dot.style.background = 'var(--accent)';
    el('segNo').textContent = '第 ' + seg.n + ' 段 / 共 ' + SEG_TOTAL + ' 段';
    el('segTitle').textContent = seg.title;
    el('segBlurb').textContent = seg.blurb || '';
    el('partTitle').textContent = '第 ' + seg.n + ' 段 / 共 ' + SEG_TOTAL + ' 段 · ' + seg.title;
    el('counter').textContent = '第 ' + seg.n + ' 段';
    var dotsBox = el('segDots');
    if (dotsBox) dotsBox.innerHTML = '';
    window.scrollTo(0, 0);
    fitStage();
  }

  function applySegment(seg, q) {
    /* 页面底色硬切，卡片保持纯白；不做渐变 */
    if (document.body.style) document.body.style.backgroundColor = 'var(--bg)';
    if (document.body.setAttribute) document.body.setAttribute('data-seg', String(seg.n));
    /* 段强调色：题卡左竖条 / 段标题圆点 / 进度条填充共用这一个变量。
       值写 var(--accent)：三套皮肤各有各的强调色，JS 不再写死。 */
    if (document.documentElement && document.documentElement.style) {
      document.documentElement.style.setProperty('--seg-accent', 'var(--accent)');
    }
    el('partTitle').textContent = '第 ' + seg.n + ' 段 / 共 ' + SEG_TOTAL + ' 段 · ' + seg.title;
    updateSegBar(q);
    renderDots(seg, q.id);
    if (lastSegN && lastSegN !== seg.n) showBanner(seg);
    lastSegN = seg.n;
    fitStage();
  }

  /* 门题 = 决定 Part 2 Item 3 会不会整段空着的那道；题库里只有它带 noPdf */
  function isGate(q) { return !!q.noPdf; }

  /* 「第 n 题 / 约 N 题」按当前可见题算：条件题增减，分母跟着变 */
  function updateCounter(l, pos) {
    l = l || list();
    var p = (typeof pos === 'number') ? pos : state.pos;
    var total = l.length;
    if (!total) { el('counter').textContent = '—'; return; }
    if (p > total - 1) p = total - 1;
    if (p < 0) p = 0;
    el('counter').textContent = '第 ' + (p + 1) + ' 题 / 约 ' + total + ' 题';
  }

  /* 输入框改字不重绘（重绘会丢焦点），只把顶部计数与本段圆点重算 */
  function refreshLive() {
    var l = list();
    if (!l.length) return;
    var pos = Math.min(state.pos, l.length - 1);
    state.pos = pos;
    updateCounter(l, pos);
    var cur = null;
    for (var i = 0; i < l.length; i++) if (l[i].id === state.currentId) { cur = l[i]; break; }
    var seg = SEGMENTS[segIndexOf((cur || l[pos]).section)];
    if (seg) { renderDots(seg, state.currentId); fitStage(); }
    /* 目录开着时，输入框改字也要更新那一行的状态标记（已答 → 未答） */
    if (tocOpen) renderToc();
  }

  /* 顶栏高度会随「本段点」多少变（最长 28 个点可能换行），舞台顶距跟着量 */
  function fitStage() {
    var head = el('topbar'), stage = el('stage');
    if (head && stage && stage.style && typeof head.offsetHeight === 'number' && head.offsetHeight) {
      var gap = (typeof window.innerWidth === 'number' && window.innerWidth <= 480) ? 14 : 24;
      stage.style.paddingTop = (head.offsetHeight + gap) + 'px';
    }
    fitFooter();
  }

  /* v9 批 7：页脚钉底后的「让位」实测。
   * 页脚是 position:fixed，文档流不知道它占多高 —— 必须实测：
   *   --foot-h  = 页脚当前高度（底栏 #navbar 抬到它上方用）
   *   padding-bottom = 页脚 + 底栏 + 12px 净空（滚到底时最后一块内容在页脚上方）
   * 视图切换 / 渲染 / 缩放 / 开合技术说明都要重算（写进 fitStage 的出口，
   * 所有原来调 fitStage 的地方自动带上）。
   * 页脚隐藏的视图（完成页 / 核对页）量到 0，把底栏放回 bottom:0。 */
  function fitFooter() {
    var foot = el('foot'), nav = el('navbar'), stage = el('stage');
    var de = document.documentElement;
    if (!foot || !stage || !stage.style || !de || !de.style || !de.style.setProperty) return;
    var vis = function (n) { return !!n && window.getComputedStyle(n).display !== 'none'; };
    var fh = vis(foot) ? foot.offsetHeight : 0;
    var nh = vis(nav) ? nav.offsetHeight : 0;
    de.style.setProperty('--foot-h', fh + 'px');
    /* 内联值覆盖 style.css 的 padding-bottom（含安全区）：页脚高度里已经含
       env(safe-area-inset-bottom)，这里不再重复加。 */
    stage.style.paddingBottom = (fh + nh + 12) + 'px';
  }

  /* ---------------- 渲染题目 ---------------- */
  function render(pos, skipSegCard) {
    var l = list();
    /* 走到题目区尽头 = 这次是真的答完全部题了 → 清掉中途导出快照，
       结果屏回到「答完了」口径。（goNext() 里也清一次，两条路径都清。） */
    if (!l.length) { partialExport = null; showDone(); return; }
    if (pos < 0) pos = 0;
    if (pos > l.length - 1) { partialExport = null; showDone(); return; }
    state.pos = pos;
    var q = l[pos];
    state.currentId = q.id;

    var p = partOf(q.section);
    var seg = SEGMENTS[segIndexOf(q.section)] || { n: 1, title: p.title, bg: null, sections: [] };
    /* 第一次进这一段：先插一张过渡卡。看过就不再出现（seenSegs 落盘）。 */
    if (!skipSegCard && !state.seenSegs[String(seg.n)]) {
      showSegCard(seg, pos);
      return;
    }

    setView('q');
    applySegment(seg, q);
    /* 题号按当前可见题算：条件题出现/消失时，分母跟着变 */
    updateCounter(l, pos);
    /* 目录面板开着时，内容跟着当前答案重画（状态标记 / 可见题数 / 段内序号都会变） */
    if (tocOpen) renderToc();

    el('qChip').textContent = 'Part ' + p.no;
    el('qId').textContent = q.item ? ('Item ' + q.item) : '';
    el('qTitle').textContent = q.titleZh || q.title;
    /* 英文原文默认收起：只在有中文题面时给 details，点了才展开。 */
    var hasEn = !!(q.titleZh && q.title);
    var enBox = el('qEnBox');
    if (enBox) {
      enBox.hidden = !hasEn;
      enBox.open = false;
    }
    el('qEn').textContent = hasEn ? q.title : '';

    var hint = el('qHint');
    /* 提示文案由排版层出；hidden / class 仍由这里落 DOM。 */
    var hintR = I485Render.renderHint(q, state.answers);
    hint.hidden = hintR.hidden;
    hint.className = hintR.cls;
    hint.innerHTML = hintR.html;

    var body = el('qBody');
    body.innerHTML = '';
    body.classList.toggle('gate', isGate(q));
    /* 旧安卓 WebView 不支持 `:has` 选择器，门题让位改由显式类控制：
       body.gate 隐藏页脚与顶栏点条，.card.question.gate 压缩题头。 */
    document.body.classList.toggle('gate', isGate(q));
    var qcard = document.querySelector('#view-q .card.question');
    if (qcard) qcard.classList.toggle('gate', isGate(q));
    /* 门题会隐藏顶栏的「本段题点」一行，顶栏高度随之变小；
       上面的 fitStage() 是在加 gate 类之前跑的，这里必须按新高度重算，否则舞台顶部会多留 53px。 */
    fitStage();

    /* 题卡正文（选项 / 输入 / 即时提示）由排版层出字符串，这里只挂事件。 */
    body.innerHTML = I485Render.renderQuestion(q, state.answers, { uncertain: state.uncertain });
    var kids = Array.prototype.slice.call(body.children);

    if (q.options && q.options.length) {
      /* 渲染顺序 = optionList()（门题把「以上都不是」排到最后），按同一顺序回绑 */
      var opts = I485Render.optionList(q);
      var optBtns = Array.prototype.slice.call(kids[0].children);
      optBtns.forEach(function (b, i) {
        b.addEventListener('click', function () { choose(q, opts[i]); });
      });

      /* 次级出口：不确定就先标记，答案不写、直接下一题；回来可取消。 */
      if (!isGate(q) && !q.gatesChildren) {
        var ub = null;
        for (var ui = 0; ui < kids.length; ui++) {
          if (kids[ui].classList && kids[ui].classList.contains('uncertain-btn')) { ub = kids[ui]; break; }
        }
        if (ub) ub.addEventListener('click', function () { toggleUncertain(q); });
      }
    }

    if (q.inputs && q.inputs.length) {
      var fields = kids.filter(function (c) { return c.classList && c.classList.contains('field'); });
      q.inputs.forEach(function (inp, i) {
        var f = fields[i];
        var input = f.children[1];
        /* 字符串里不带 value 属性（与逐节点 createElement 的 outerHTML 一致），
           已有答案在这里回填；输入过程中只改当前值，不动属性。 */
        input.value = typeof state.answers[inp.id] === 'string' ? state.answers[inp.id] : '';
        input.addEventListener('input', function () {
          state.answers[inp.id] = input.value;
          /* 一旦开始填，就不再算「不确定」 */
          if (state.uncertain[q.id] && input.value.trim() !== '') delete state.uncertain[q.id];
          save();
          refreshLive();
        });
        input.addEventListener('change', function () {
          state.answers[inp.id] = input.value;
          if (state.uncertain[q.id] && input.value.trim() !== '') delete state.uncertain[q.id];
          save();
          refreshLive();
        });
        /* 9 字符国名格：题内当场判断，别等答完 135 题点生成才在完成页告知。
           失焦时按真实写入规则（fitTextToMax + 短写表）给结果。 */
        if (input.type === 'text' && I485Render.LIMIT_FIELDS[inp.pdf]) {
          var limitMsg = null;
          for (var ci = 0; ci < f.children.length; ci++) {
            if (f.children[ci].classList && f.children[ci].classList.contains('limitmsg')) { limitMsg = f.children[ci]; break; }
          }
          var checkLimit = function () {
            var raw = input.value;
            if (!raw || !raw.trim()) {
              limitMsg.hidden = true;
              limitMsg.textContent = '';
              limitMsg.className = 'sub limitmsg';
              return;
            }
            /* 与写入端同序：先 pdfSafe（中文等非拉丁字符会被丢掉），再查 9 字符上限。
               只查 fitTextToMax 会对纯中文给出「会写进 PDF 的是 China」的假承诺。 */
            var safe = CORE.pdfSafe(raw);
            var r = (!safe.text && raw.trim()) ? { text: '', action: 'blocked' } : CORE.fitTextToMax(safe.text, 9);
            if (r.action === 'blocked') {
              limitMsg.className = 'sub limitmsg bad';
              limitMsg.textContent = '这一格只容 9 个字符，机器认不出你写的国名，所以不会写进 PDF。' +
                '请改成英文短写（例如 China / Taiwan / Macau），或打印后手写。';
              limitMsg.hidden = false;
            } else if (r.action === 'short') {
              limitMsg.className = 'sub limitmsg';
              limitMsg.textContent = '会写进 PDF 的是：' + r.text;
              limitMsg.hidden = false;
            } else {
              limitMsg.hidden = true;
              limitMsg.textContent = '';
              limitMsg.className = 'sub limitmsg';
            }
          };
          /* 输入过程中就更新结论：只在 blur 更新会把上一格的判断留在屏幕上。 */
          input.addEventListener('input', checkLimit);
          input.addEventListener('blur', checkLimit);
          /* 恢复上次答案回到这题时，直接显示已有判断 */
          if (input.value.trim() !== '') checkLimit();
        }
      });
    }

    el('btnPrev').disabled = pos === 0;
    el('btnNext').textContent = (pos === l.length - 1) ? '完成' : '下一题';
  }

  function choose(q, o) {
    if (state.uncertain[q.id]) delete state.uncertain[q.id];
    var on = state.answers[o.id] === true;
    if (q.multi) {
      state.answers[o.id] = !on;
    } else {
      q.options.forEach(function (x) { delete state.answers[x.id]; });
      if (!on) state.answers[o.id] = true;
      /* 门题（Part 2 Item 3 的 7 组入口）一换，下面 7 组清单里之前勾的类别全部作废：
         不清的话，切换后旧类别的勾还留在状态里，但那一组已经隐藏、不会写进 PDF，
         新的一组又没勾 → Item 3 一个勾都没有，整段静默为空。 */
      if (q.radioGroup && /^gate_/.test(String(q.radioGroup))) {
        MODEL.questions.forEach(function (other) {
          if (other.mutexGroup !== 'part2_category') return;
          (other.options || []).forEach(function (x) { delete state.answers[x.id]; });
          (other.inputs || []).forEach(function (x) { delete state.answers[x.id]; });
        });
      }
      if (q.mutexGroup && !on) {
        MODEL.questions.forEach(function (other) {
          if (other.id === q.id || other.mutexGroup !== q.mutexGroup) return;
          (other.options || []).forEach(function (x) { delete state.answers[x.id]; });
        });
      }
    }
    save();
    render(state.pos);
  }

  /* ---------------- 完成页 ---------------- */
  /* 存档对账：uncertain 只保留「当前看得见、且本来允许标记」的题。
   * 父题改答案后，下游题可能整段消失；它的旧标记如果留着，会在用户改回来时
   * 突然复活成「不确定」。这里只清理标记，不动 answers / seenSegs 等其它字段。 */
  function reconcileUncertain() {
    var visible = Object.create(null);
    list().forEach(function (q) { if (canMarkUncertain(q)) visible[q.id] = true; });
    var changed = false;
    Object.keys(state.uncertain).forEach(function (id) {
      if (!visible[id]) { delete state.uncertain[id]; changed = true; }
    });
    if (changed) save();
  }

  function answerStats() {
    var l = list();
    var answered = 0, p9 = 0, p9answered = 0;
    l.forEach(function (q) {
      var has = !isUncertain(q) &&
                ((q.options || []).some(function (o) { return state.answers[o.id] === true; }) ||
                 (q.inputs || []).some(function (i) { return typeof state.answers[i.id] === 'string' && state.answers[i.id].trim() !== ''; }));
      if (has) answered++;
      if (/^9[a-g]$/.test(q.section)) {
        p9++;
        if (has) p9answered++;
      }
    });
    return { visible: l.length, answered: answered, p9: p9, p9answered: p9answered };
  }

  /* ---------------- 完成页：查验摘要分档（2–3 档） ----------------
   * 档 2 = Part 9（9a–9g）里的是/否题、答「是」的（9d 收入/资产这类多选一不算）；
   *        有说明字段的条目追加「还要另外写清楚经过」。
   * 档 3 = 其余已答题，只报条数。
   * 原「档 1」的说明字段题全是 Part 9 是/否题，已并入档 2，不再单列。 */
  /* 命中名单不截断标题：每档默认只列前 HIT_PREVIEW 条，其余折叠成「还有 N 条」，点开看全部。 */
  var HIT_PREVIEW = 3;
  function fullName(q) { return q.titleZh || q.title || ''; }

  /* 「是/勾选」只认 Yes 和勾上的多选项；选 No / N/A 不算。 */
  function checkedYes(q) {
    return (q.options || []).some(function (o) {
      if (state.answers[o.id] !== true) return false;
      return !/^(no|n\/a)$/i.test(o.label || '');
    });
  }

  /* 「是/否题」：选项里得有 label 为 No 的那一项。
   * 婚姻结束方式（Annulled/Divorced/…）这类多选一题会被 checkedYes 当成「答是」，
   * 但它们没有说明栏，不该进「表上要求你解释」。 */
  function isYesNo(q) {
    return (q.options || []).some(function (o) { return /^no$/i.test((o.label || '').trim()); });
  }

  function renderCheck() {
    var box = el('chkBox');
    if (!box) return;
    reconcileUncertain();
    var l = list();
    var b2 = [], b3 = 0, bU = [];
    l.forEach(function (q) {
      /* 标了「不确定」的题不进任何原档位，单独列一档让用户回去核对 */
      if (isUncertain(q)) { bU.push(q); return; }
      if (!hasAnswer(q)) return;
      var yes = checkedYes(q);
      /* 非是/否题（9d 的收入 / 资产多选一）不进档 2：它们的选项不是「答是」，
        只是被 checkedYes 当成勾选，列进「可能影响资格」会误导。 */
      if (yes && isYesNo(q) && /^9[a-g]$/.test(q.section)) b2.push(q);
      else b3++;
    });
    box.innerHTML = '';
    /* 一档一张卡片：档标题 20px/600 + 数量徽章；档 2 排第一，红左边框 */
    function tierCard(no, title, n, why, items, suffix, prefix, showAll) {
      var card = document.createElement('div');
      card.className = 'tier t' + no;

      var head = document.createElement('div');
      head.className = 'tier-head';
      /* 红档（档 2）加 ⚠ 图标（v9 批 1）：
         深青主色下红档与主色对红绿色盲不可分，必须有图标 + 文字标签，
         不能只靠色相区分。符号用 ⚠（U+26A0），不是 emoji（headless Chrome 会吞 emoji）。
         ⚠ 放在独立的 span 里，不进 h3.textContent —— 标题文字「可能影响资格」保持逐字不变
         （既有验收脚本按标题取档位，改了会全线红）。 */
      if (no === 2) {
        var icon = document.createElement('span');
        icon.className = 'tier-warn-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '⚠';
        head.appendChild(icon);
      }
      var h = document.createElement('h3');
      h.textContent = title;
      var badge = document.createElement('span');
      badge.className = 'tier-badge';
      badge.textContent = n ? n + ' 条' : '没有';
      head.appendChild(h);
      head.appendChild(badge);
      card.appendChild(head);

      var w = document.createElement('p');
      w.className = 'tier-why';
      w.textContent = why;
      card.appendChild(w);

      if (items && items.length) {
        var ol = document.createElement('ol');
        ol.className = 'tier-list';
        card.appendChild(ol);
        var expanded = false;
        function paint() {
          ol.innerHTML = '';
          var shown = (expanded || showAll) ? items : items.slice(0, HIT_PREVIEW);
          shown.forEach(function (q) {
            var li = document.createElement('li');
            li.textContent = (prefix ? prefix(q) : '') + fullName(q) + (suffix ? suffix(q) : '');
            ol.appendChild(li);
          });
        }
        paint();
        var rest = showAll ? 0 : items.length - HIT_PREVIEW;
        if (rest > 0) {
          var more = document.createElement('button');
          more.type = 'button';
          more.className = 'morelink';
          more.textContent = '再看 ' + rest + ' 条';
          more.addEventListener('click', function () {
            expanded = true;
            paint();
            if (more.parentNode) more.parentNode.removeChild(more);
          });
          card.appendChild(more);
        }
      }
      box.appendChild(card);
    }
    if (bU.length) {
      tierCard(1, '这 ' + bU.length + ' 题要回去核对', bU.length,
        '这些题你标了不确定，PDF 对应格子会保持空白。回去重新选一次；拿不准的，先看表上原文或找移民律师确认。',
        bU, null, function (q) {
          var idx = l.indexOf(q) + 1;
          return idx ? ('第 ' + idx + ' 题 · ') : '';
        }, true);
    }
    tierCard(2, '可能影响资格', b2.length,
      '这类问题答「是」，移民局通常会要求你写清经过。这可能影响资格，递表前请找移民律师看一下。',
      b2, function (q) { return q.hasDetailsField ? '（这一项还要另外写清楚经过）' : ''; });
    tierCard(3, '例行确认', b3,
      '其余已答题只报条数，你填的内容已经写进 PDF。打印后可以照这份清单逐条核对。',
      [], null);
  }

  /* 手写清单由 build-questions.js 从 fieldmap + 题库生成（data/handwrite.json），
     页面只负责按 Part 渲染，不再维护一份手写文案。 */
  function renderHandwrite() {
    var box = el('hwList');
    if (!box) return;
    var H = window.I485_HANDWRITE;
    box.innerHTML = '';
    if (!H || !H.parts || !H.parts.length) return;
    H.parts.forEach(function (p) {
      var li = document.createElement('li');
      var b = document.createElement('b');
      b.textContent = p.title + '（' + p.count + ' 格）';
      li.appendChild(b);
      li.appendChild(document.createTextNode('：' + (p.cats || []).join('、') + '。'));
      /* 具体格子按表上印刷的题面列出，默认收起：一屏先给类目，需要核对时再展开。 */
      var det = document.createElement('details');
      var sum = document.createElement('summary');
      sum.textContent = '看具体格子';
      det.appendChild(sum);
      var more = document.createElement('p');
      more.className = 'tiny hwmore';
      more.textContent = p.groups.map(function (g) { return g.label; }).join('；');
      det.appendChild(more);
      li.appendChild(det);
      box.appendChild(li);
    });
  }

  /* ---------------- 随时导出（2026-11-09）----------------
   * 老板要求：答题途中也能导出，没答的题按「跳过」处理（PDF 里留空）。
   *
   * 口径（与产品口径一致）：
   *   · 未答数量 N 的算法与 hasAnswer() 完全一致：有选项题勾了一个算已答，
   *     输入题有非空文本算已答；标了「不确定」的题也不写任何格子 → 算未答。
   *   · **不改默认状态**：不把所有题预先标成「不确定」。PDF 效果与留空相同，
   *     但那样结果页会变成「不确定 107 题」、说明页会写「另有 107 题要回去核对」，
   *     反而误导客户。
   *   · **不改存档结构**：导出后回来还能接着答；导出会顺手清掉当前不可见题的
   *     「不确定」标记（与答完时同一条规则 reconcileUncertain→save），
   *     但存档的键与字段结构不变，不新增 key。
   *   · 官方表只有是/否格子，没有「不确定」格 —— 留空 = 跳过，这是物理事实。
   */
  /* 中途导出的快照：{ at, visible, unanswered }，供结果屏 / 拿表屏改文案用 */
  var partialExport = null;

  /* 当前可见题里还没答的数量（口径与 hasAnswer() 一致）。
     标了「不确定」的题也不写任何格子 → 算未答。
     （标记动作本身会清掉该题的答案，所以 hasAnswer() 实际已经把它们算成未答；
       这里再显式排除一次，防止两者口径漂移。） */
  function unansweredCount() {
    var n = 0;
    list().forEach(function (q) { if (!isUncertain(q) && !hasAnswer(q)) n++; });
    return n;
  }

  /* 「随时导出」按钮：答题页（不含切段过渡卡）常驻顶栏右侧。
     N > 0 先弹确认；取消 = 什么都不做、不生成文件（不写存档、不改视图）。
     N = 0 直接导出。
     ⚠ v9 批 9：顶栏「导出」不再直接调这个函数，而是弹三选项面板
     （#expPanel：导出进度 / 导出 PDF / 下载填写说明）。本函数保留：
     ①「导出 PDF」选项需要「答到一半也能导出」的完整链路（确认 → 快照 → 拿表屏）；
     ② 旧的入口语义（随时导出 = 中途导出口径）不许被悄悄改掉。 */
  async function exportAnytime() {
    var l = list();
    if (!l.length) return false;
    var n = unansweredCount();
    if (n > 0) {
      var msg = '还有 ' + n + ' 题没答，这些格子在 PDF 里会留空（等同跳过）。现在导出吗？';
      /* 取消：什么都不做，并告诉调用方「用户取消了」——
         导出面板已经关掉了，不给一句话用户会以为页面卡住。 */
      if (!confirm(msg)) return false;
    }
    /* 快照：导到第几题、共几题可见、几题留空 */
    var pos = Math.min(state.pos, l.length - 1);
    var at = Math.max(1, pos + 1);
    partialExport = { at: at, visible: l.length, unanswered: n };

    /* 切到结果屏（中途口径），再切拿表屏 —— 两颗下载按钮（#btnPdf / #btnInstr）都在拿表屏，
       不新造第三套下载界面。 */
    showDone(partialExport);
    setView('handoff');
    fitStage();

    /* 直接把 A 文件（官方表 + 填值）生成并开始下载：走现有 generate() 链路
       （CORE.fillPdf），不另写一套生成逻辑。
       generate() 自己会写 #pdfStatus / #pdfNotes，并且不管成败都把按钮恢复可用。 */
    var btn = el('btnExport');
    if (btn) btn.disabled = true;
    try {
      await generate();
    } finally {
      if (btn) btn.disabled = false;
    }
    return true;
  }

  /* 结果屏（view-done）：算好数据 + 渲染查验分档。
     拿表屏（view-handoff）只负责下载与后续，数据不重算。
     partial = 中途导出时的快照（{at, visible, unanswered}）：
       有它 → 文案改成「先导出目前的进度」，不许说「答完了」；
       没有 → 正常走完全部题的老口径。 */
  function showDone(partial) {
    setView('done');
    reconcileUncertain();
    /* 完成页不属于任何一段，切段横幅如果还在显示就直接收掉（含定时器清理） */
    hideBannerNow();
    /* 🟡 2026-11-09：清掉上一次导出的残留状态行。
       复现链：中途导出（状态行写「已生成…共 1687 KB」）→ 回去接着答完 →
       进拿表屏 → 状态行还是上一次中途导出的那句，客户以为「完整版已经生成过了」
       就不去点按钮，最后打印的是旧文件。
       完整路径（!partial）必须清；中途导出时不能清（generate() 紧接着就要写）。 */
    if (!partial) {
      var ps = el('pdfStatus');
      if (ps) { ps.textContent = ''; ps.className = 'tiny'; }
      var is = el('instrStatus');
      if (is) { is.textContent = ''; is.className = 'tiny'; }
      var pn = el('pdfNotes');
      if (pn) pn.innerHTML = '';
    }
    var s = answerStats();
    var l = list();
    el('counter').textContent = partial ? '已导出' : '已完成';
    document.body.style.backgroundColor = 'var(--bg)';
    if (document.body.removeAttribute) document.body.removeAttribute('data-seg');
    el('partTitle').textContent = '';
    var dotsBox = el('segDots');
    if (dotsBox) dotsBox.innerHTML = '';
    fitStage();
    var bar = el('segBar');
    if (bar) {
      if (partial) {
        /* 中途导出：进度条不能全亮（那等于在说「全部作答」）。
           按当前所在题的位置画，与答题页同一口径（updateSegBar）。 */
        var cur = null;
        for (var qi = 0; qi < l.length; qi++) if (l[qi].id === state.currentId) { cur = l[qi]; break; }
        if (cur) {
          updateSegBar(cur);
        } else {
          for (var pi = 0; pi < bar.children.length; pi++) {
            var pf = bar.children[pi].firstChild;
            if (pf) { pf.style.width = '0%'; pf.style.background = BAR_DONE; }
            bar.children[pi].classList.remove('done');
          }
        }
      } else {
        for (var ci = 0; ci < bar.children.length; ci++) {
          var f = bar.children[ci].firstChild;
          if (f) { f.style.width = '100%'; f.style.background = BAR_DONE; }
          bar.children[ci].classList.add('done');
        }
      }
    }
    /* 标题与摘要：中途导出与答完全程两套口径，绝不出现矛盾表述。 */
    var titleEl = el('doneTitle');
    if (titleEl) titleEl.textContent = partial ? '先导出目前的进度' : '答完了';
    if (partial) {
      /* 口径：「你在第 X 题时导出的」，不写「已导出到第 X 题」——
         用户可能答过 107 题又退回第 3 题才导出，「导出到第 3 题」与
         「已答 107 题」会自相矛盾。位置只说明「当时停在哪」，答案数单独说。 */
      el('doneSummary').textContent =
        '你在第 ' + partial.at + ' 题时导出的（共 ' + partial.visible + ' 题可见），' +
        '已答的 ' + s.answered + ' 题已经写进 PDF，' +
        '未答的 ' + partial.unanswered + ' 题在表上留空（等同跳过）。';
    } else {
      el('doneSummary').textContent = '共 ' + s.visible + ' 题（按你的答案动态显示），已作答 ' + s.answered + ' 题。';
    }
    var pills = el('donePills');
    pills.innerHTML = '';
    function pill(text, cls) {
      var d = document.createElement('span');
      d.className = 'pill' + (cls ? ' ' + cls : '');
      d.textContent = text;
      pills.appendChild(d);
    }
    pill('已答 ' + s.answered + ' / ' + s.visible, s.answered === s.visible ? 'ok' : 'warn');
    pill('Part 9 已答 ' + s.p9answered + ' / ' + s.p9, s.p9answered === s.p9 ? 'ok' : 'warn');
    var uN = list().filter(isUncertain).length;
    if (uN) pill('不确定 ' + uN + ' 题', 'warn');
    pill('未答的题会保持空白');
    renderHandwrite();
    renderCheck();
    /* 拿表屏的「中途导出」说明行：只有中途导出才出现，说清这版是半成品。 */
    var note = el('exportNote');
    if (note) {
      if (partial) {
        note.hidden = false;
        /* 警告样式（底色 + 左侧竖条 + 加粗首句）：视觉上要压过下面那颗蓝色主按钮，
           否则客户一眼只看到「下载填好的表 → 寄走」。 */
        note.className = 'lead export-note';
        note.innerHTML = '';
        var warnHead = document.createElement('b');
        warnHead.className = 'export-note-head';
        warnHead.textContent = '这是半成品，先别寄！';
        note.appendChild(warnHead);
        note.appendChild(document.createTextNode(
          '你在第 ' + partial.at + ' 题时导出的（共 ' + partial.visible + ' 题可见），' +
          '未答的 ' + partial.unanswered + ' 题在表上留空（等同跳过）。' +
          '答完再导出一次才是要交的那份。'));
      } else {
        note.hidden = true;
        note.className = 'lead export-note';
        note.textContent = '';
      }
    }
    /* 手写清单的引子：中途导出时不能说「其余格子已填好」（未答的格子也是空的）。 */
    var hwIntro = el('hwIntro');
    if (hwIntro) {
      hwIntro.textContent = partial
        ? '你答过的格子已按答案填好，不要覆盖；未答的题目和下面这些格子生成时留空，' +
          '你可以在 PDF 里直接键入，也可以打印后用黑笔手写。'
        : '其余格子已按你的答案填好，不要覆盖；下面这些格子生成时留空，' +
          '你可以在 PDF 里直接键入，也可以打印后用黑笔手写。';
    }
    /* 🔴 拿表屏的两套口径（法正 2026-11-09 复审 D1）：
       中途导出时，拿表屏不许再教客户「寄走」「一份要交」「别空着交」——
       否则客户会把自己明知有几十题留空的 I-485 寄出去（后果：退回 / 补件）。
       完整答题路径（partial 为假）这里的每一个字都不动。
       文案全部走 JS 分支（不用 CSS 文字替换）。 */
    applyHandoffCopy(!!partial, partial);
  }

  /* ---------------- 答案核对页（v9 批 3a） ----------------
   * 只做三件事：清掉不可见的「不确定」标记、切视图、把渲染层的字符串挂进 DOM。
   * 不改答案、不改存档结构；渲染细节全在 render.js（那里不碰 DOM/localStorage）。 */
  function paintAnswerSheet() {
    var box = el('sheetBody');
    if (!box) return;
    box.innerHTML = window.I485Render.renderAnswerSheet(state.answers, { uncertain: state.uncertain });
  }
  var sheetReturnView = 'done';
  function showSheet() {
    reconcileUncertain();
    /* v9 批 7：记住从哪一屏进来的（答题页 / 结果屏 / 拿表屏），
       「← 回到结果」按原路返回。只有这一处记、只有一处读 —— 不新写第二套逻辑。 */
    if (currentView !== 'sheet') sheetReturnView = currentView;
    setView('sheet');
    paintAnswerSheet();
    fitStage();
  }

  /* ---------------- 拿表屏文案：完整路径 vs 半成品路径 ----------------
   * 完整路径：与 index.html 里写死的一模一样。实现上先把 DOM 里的原文拓一份
   *   （HANDOFF_ORIG），完整路径直接写回这份原文 —— 保证「一个字不动」。
   * 半成品路径：主按钮改成「下载半成品表（27 页）」，说明行改成「先别寄」，
   *   「拿到 PDF 之后怎么走」里与交件相关的段落全部收起：
   *   第 1 条（只打印 27 页）、第 3 条（签名）、第 4 条（配材料）、
   *   签名提示、官网 Filing 提示 —— 对半成品都没意义，整块隐藏，不给客户误导链条；
   *   只留第 2 条，换成半成品口径（先别寄 + 还差几题）。
   * 文案切换全部走 JS 分支（不用 CSS 文字替换）。 */
  var HANDOFF_ORIG = null;
  /* 只收「纯文本」节点：#guideNote 里带 <a>、#guideSign 里带 <b>，
     重写它们的 textContent 会把链接 / 加粗子节点抹掉 —— 这两个只藏不换。 */
  var HANDOFF_TEXT_IDS = [
    'handoffLead', 'btnPdf', 'dlHintA', 'dlHintB', 'guideTitle',
    'guideStep2b', 'guideStep2s'
  ];
  function handoffText(id) {
    var n = el(id);
    return n ? n.textContent : '';
  }
  function captureHandoffOrig() {
    if (HANDOFF_ORIG) return HANDOFF_ORIG;
    HANDOFF_ORIG = {};
    HANDOFF_TEXT_IDS.forEach(function (id) { HANDOFF_ORIG[id] = handoffText(id); });
    return HANDOFF_ORIG;
  }
  function applyHandoffCopy(isPartial, partial) {
    var orig = captureHandoffOrig();
    if (!isPartial) {
      /* 完整路径：把原文一字不改写回去（切段时可能被改过，这里保证幂等）。 */
      HANDOFF_TEXT_IDS.forEach(function (id) {
        var n = el(id);
        if (n) n.textContent = orig[id];
      });
      ['guideStep1', 'guideStep2', 'guideStep3', 'guideStep4'].forEach(function (id) {
        var n = el(id);
        if (n) n.hidden = false;
      });
      var n2 = el('guideNote'); if (n2) n2.hidden = false;
      var s2 = el('guideSign'); if (s2) s2.hidden = false;
      return;
    }
    /* 半成品路径 */
    var lead = el('handoffLead');
    if (lead) lead.textContent = '这两份 PDF 只是半成品，先别寄。';
    var btn = el('btnPdf');
    if (btn) btn.textContent = '下载半成品表（27 页）';
    var hintA = el('dlHintA');
    if (hintA) {
      hintA.textContent = '半成品：还有 ' + (partial ? partial.unanswered : 0) +
        ' 题在表上留空，先别寄 —— 答完再导出一次才是要交的那份。';
    }
    var hintB = el('dlHintB');
    if (hintB) hintB.textContent = '自己留着对照，不用交';
    /* 「拿到 PDF 之后怎么走」：半成品路径下整块收起，只留一条「先别寄」。
       第 1 条（只打印官方表那 27 页）、第 3 条（签名）、第 4 条（配材料）、
       签名提示、官网 Filing 提示 —— 对半成品都没意义：
       客户看到「打印这一份」就会去打印、看到「配齐材料再寄」就会去寄。
       只留第 2 条（已换成「先别寄 + 还差几题」），不给客户任何「可以寄了」的链条。 */
    var gTitle = el('guideTitle');
    if (gTitle) gTitle.textContent = '这份还不能寄：先把题答完';
    /* 第 2 条换口径（不是隐藏：改成「先别寄 + 还差几题」） */
    var s2b = el('guideStep2b');
    if (s2b) s2b.textContent = '先别寄：这份还有 ' + (partial ? partial.unanswered : 0) + ' 题是空的';
    var s2s = el('guideStep2s');
    if (s2s) s2s.textContent = '答完再导出一次，那一份才是要交的。这份只用来存着对照。';
    /* 第 1/3/4 条、签名提示、官网 Filing 提示：
       对半成品没有意义（客户还没到寄件那一步）—— 整块隐藏。 */
    ['guideStep1', 'guideStep3', 'guideStep4'].forEach(function (id) {
      var n = el(id);
      if (n) n.hidden = true;
    });
    var gNote = el('guideNote');
    if (gNote) gNote.hidden = true;
    var gSign = el('guideSign');
    if (gSign) gSign.hidden = true;
  }

  /* ---------------- 生成 PDF ---------------- */
  function fmtDate(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function loadPdfBytes() {
    /* 双击 index.html（file://）时 fetch 会被浏览器拦掉，所以模板同时内联在
       data/template-b64.js；有内联数据就优先用，完全没有该全局变量才回退 fetch。 */
    var inline = window.__I485_TEMPLATE_B64__;
    if (typeof inline === 'string' && inline.length > 0) {
      try {
        return b64ToBytes(inline);
      } catch (e) {
        throw new Error('模板数据损坏，请重新下载网页文件后再试。');
      }
    }
    var lastErr = null;
    for (var i = 0; i < PDF_CANDIDATES.length; i++) {
      try {
        var r = await fetch(PDF_CANDIDATES[i]);
        if (!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + PDF_CANDIDATES[i]);
        return await r.arrayBuffer();
      } catch (e) { lastErr = e; }
    }
    throw new Error(
      '读不到官方 PDF 模板（内置模板缺失或损坏）。\n' +
      '请刷新页面重试；若仍不行，用 https 或本地服务重新打开。'
    );
  }

  /* 完成页：把「哪一题、哪一格被缩写 / 没写进去」讲清楚（全中文） */
  function renderPdfNotes(rep) {
    var box = el('pdfNotes');
    if (!box) return;
    box.innerHTML = '';
    if (!rep) return;
    function add(text, cls) {
      var p = document.createElement('p');
      p.className = 'tiny' + (cls ? ' ' + cls : '');
      p.style.margin = '8px 0 0';
      p.textContent = text;
      box.appendChild(p);
    }
    function where(a) {
      var head = a.item ? a.item + '「' + a.title + '」' : '「' + a.title + '」';
      return a.label ? head + '的「' + a.label + '」' : head;
    }
    var adj = rep.adjustments || [];
    /* 同一格可能先后记两条 adjustment：按 inputId 去重、保留最后一条，
       与状态行的「格数」口径一致。 */
    var adjOrder = [];
    var adjByKey = Object.create(null);
    adj.forEach(function (a) {
      var key = a.inputId || a.pdf || (a.item + '|' + a.label + '|' + a.original);
      if (!adjByKey[key]) adjOrder.push(key);
      adjByKey[key] = a;
    });
    adj = adjOrder.map(function (k) { return adjByKey[k]; });
    if (adj.length) {
      add('这些格子的官方位置放不下你填的原文，已按规则处理，打印前请核对：');
      adj.forEach(function (a) {
        /* 认不出、也没法安全缩写的值：这一格压根没写，单独在下面手写清单里说明。 */
        if (a.action === 'blocked') return;
        if (a.action === 'short') {
          add('· ' + where(a) + '：' + a.original + ' → ' + a.written +
            '（这一格最多 ' + a.maxLength + ' 个字符，已按通用短写缩写）');
        } else {
          add('· ' + where(a) + '：' + a.original + ' → ' + a.written +
            '（这一格最多 ' + a.maxLength + ' 个字符，已按规则处理）');
        }
      });
    }
    var hw = rep.handwrite || [];
    var hwBlocked = hw.filter(function (a) { return a.action === 'blocked'; });
    var hwTrunc = hw.filter(function (a) { return a.action !== 'blocked'; });
    hwBlocked.forEach(function (a) {
      add('· ' + where(a) + '：这一格只容 ' + a.maxLength + ' 个字符，机器认不出你写的国名，所以没有写进去。' +
        '请在 PDF 上手写：国家名用英文短写，例如 China / Taiwan / Macau。', 'noteWarn');
    });
    if (hwTrunc.length) {
      var hwN = hwTrunc.length;
      add('缩写后仍溢出的格子：' + (hwN === 1 ? '这 1 格' : (hwN === 2 ? '这两格' : '这 ' + hwN + ' 格')) +
        '建议打印后手写覆盖。', 'noteWarn');
    }
    (rep.errors || []).forEach(function (m) { add('· ' + m, 'noteErr'); });
    /* 警告必须逐条渲染：否则中文输入被 pdfSafe 丢掉时，页面显示成功、格子却是空的。 */
    (rep.warnings || []).forEach(function (m) { add('· ' + m, 'noteWarn'); });
  }

  function zhError(e) {
    var m = e && e.message ? String(e.message) : '';
    if (/[\u4e00-\u9fff]/.test(m)) return m;
    return '生成 PDF 时出了意外，文件没有下载成功。建议：刷新页面后重试；仍然失败就换一个浏览器。';
  }

  /* ---------------- 填写说明页（B 文件）----------------
   * 口径（2026-11-08 老板 23:44）：官方表零插页，说明页**单独一份 PDF**。
   *   A 文件 = 官方表 + 填值（27 页，内容流与模板逐页一致）
   *   B 文件 = 填写说明（1 页，Letter 612×792）
   *
   * 中文怎么办：**构建期预渲染**成静态 PNG（assets/cover-instructions.png
   * + assets/uncertain-N.png），运行时只 fetch + 贴图 —— 不用 canvas 画中文，
   * 不依赖客户设备字体，低端机也不背 35MB canvas 位图。 */
  /* 清单口径：data/handwrite.json 的 12 个 Part（由 build-questions.js 从 fieldmap + 题库生成，
     315 格归并成 12 行）。「标了不确定」的题数 = state.uncertain 里当前仍然可见的题数。 */
  function coverParts() {
    var H = window.I485_HANDWRITE;
    if (!H || !H.parts || !H.parts.length) return null;
    return H.parts.map(function (p) {
      return { no: p.no, title: p.title, count: p.count, cats: p.cats || [] };
    });
  }
  function uncertainCount() {
    reconcileUncertain();
    var n = 0;
    list().forEach(function (q) { if (isUncertain(q)) n++; });
    return n;
  }

  /* 取静态图字节。
   * 顺序：先 fetch（线上只在下说明页时才付这 234KB），fetch 失败再回退内联 b64
   * （file:// 双击打开时 fetch 会被浏览器拦掉）。
   * 反过来写（优先内联）会让每个页面访问都白背 320KB，用户不点「下载填写说明」也亏。
   *
   * file:// 直接走内联、不试 fetch —— 否则浏览器会往 console 里打一条
   * "URL scheme file is not supported" 的错误，污染控制台验收。 */
  var ASSET_B64 = window.__I485_ASSETS_B64__ || {};
  var IS_FILE = false;
  try { IS_FILE = window.location && window.location.protocol === 'file:'; } catch (e) { IS_FILE = false; }
  async function loadAssetBytes(rel) {
    if (!IS_FILE) {
      try {
        var r = await fetch(rel);
        if (r.ok) return new Uint8Array(await r.arrayBuffer());
      } catch (e) { /* 回退内联 */ }
    }
    var inline = ASSET_B64[rel];
    if (typeof inline === 'string' && inline.length) {
      return b64ToBytes(inline);
    }
    throw new Error('读不到说明页图片（' + rel + '）。请刷新页面后重试。');
  }

  /* 生成 B 文件：1 页 Letter，把整页图贴满；N>0 时再贴对应那张整句小图。
     * 不用 canvas：中文已经在构建期烘成 PNG 了。 */
  async function buildInstructionsPdf(PDFDocument, n) {
    var INSTR = window.I485Instructions || window.I485Cover;
    if (!INSTR) throw new Error('说明页组件没加载，请刷新页面后重试。');
    var parts = coverParts();
    if (!parts || !parts.length) throw new Error('手写清单数据没加载，请刷新页面后重试。');
    var layout = INSTR.buildLayout({
      parts: parts,
      totalFields: (window.I485_HANDWRITE && window.I485_HANDWRITE.totalFields) || 0,
      uncertainCount: n
    });
    var baseBytes = await loadAssetBytes(INSTR.baseAssetName());
    if (!baseBytes || !baseBytes.length) throw new Error('说明页图片没加载到，请刷新页面后重试。');

    var doc = await PDFDocument.create();
    var W = layout.width, H = layout.height;
    var page = doc.addPage([W, H]);
    var img = await doc.embedPng(baseBytes);
    page.drawImage(img, { x: 0, y: 0, width: W, height: H });

    /* 「另有 N 题…」整句：构建期已按 N 烘好一张图，运行时贴对应那张；N=0 不贴。 */
    if (n > 0) {
      var slotName = INSTR.stripAssetName(n);
      if (slotName) {
        var slotBytes = await loadAssetBytes(slotName);
        var slot = layout.uncertainSlot;
        var slotImg = await doc.embedPng(slotBytes);
        page.drawImage(slotImg, { x: slot.x, y: slot.y, width: slot.w, height: slot.h });
      }
    }
    var bytes = await doc.save();
    return { bytes: bytes, layout: layout };
  }

  function downloadBytes(bytes, filename) {
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
  }

  async function generate() {
    var btn = el('btnPdf');
    var st = el('pdfStatus');
    var notes = el('pdfNotes');
    if (notes) notes.innerHTML = '';
    btn.disabled = true;
    st.className = 'tiny';
    st.textContent = '正在生成，请稍候';
    try {
      /* 生成前先算 Part 2 Item 3 到底勾了几个类别（以实际写入计划为准，不看界面） */
      var prePlan = CORE.buildWrites(MODEL, ctx());
      var catQ = Object.create(null);
      MODEL.questions.forEach(function (q) { if (q.mutexGroup === 'part2_category') catQ[q.id] = true; });
      var item3Checks = 0;
      prePlan.writes.forEach(function (w) {
        if (w.kind === 'check' && w.value === true && catQ[w.question]) item3Checks++;
      });
      var bytes = await loadPdfBytes();
      /* A 文件 = 官方表 + 填值。零插页：不插页、不删页，页数恒为 27。 */
      var out = await CORE.fillPdf({
        PDFDocument: window.PDFLib.PDFDocument,
        pdfBytes: bytes,
        model: MODEL,
        answers: state.answers,
        groups: GROUPS,
        flatten: false
      });
      downloadBytes(out.bytes, 'I-485-填好-' + fmtDate(new Date()) + '.pdf');
      var r = out.report;
      if (item3Checks === 0) {
        r.warnings.push('Part 2 Item 3 没有勾中任何申请类别，这张表可能被退回。请回到「你按哪一类申请？」重新选一组，并勾一个具体类别。');
      } else if (item3Checks > 1) {
        r.warnings.push('Part 2 Item 3 勾了多个类别（' + item3Checks + ' 个），只能勾一个。请回到 Part 2 只保留一项。');
      }
      renderPdfNotes(r);
      st.className = 'tiny';
      var wN = (r.warnings || []).length;
      /* 提示条数 ≠ 格子数：同一条提示可能同时说「格子被跳过」，不能再按「格」重复计一次。
         缩写格数单独统计，并按格子去重（同一格可能先后记两条 adjustment）。 */
      var adjSeen = Object.create(null);
      var blockedN = 0;
      (r.adjustments || []).forEach(function (a) {
        if (a.action === 'blocked') { blockedN++; return; }
        adjSeen[a.inputId || a.pdf || (a.item + '|' + a.label + '|' + a.original)] = true;
      });
      var adjN = Object.keys(adjSeen).length;
      st.textContent = (wN
        ? '已生成：有 ' + wN + ' 条提示需要你核对（见下面说明）：'
        : '已生成并开始下载：') +
        '勾选 ' + r.checked + ' 个、文本 ' + r.text + ' 项、清空 ' + r.unchecked +
        ' 个未选项；共 ' + Math.round(r.bytes / 1024) + ' KB。' +
        ((r.errors || []).length ? ' 有 ' + r.errors.length + ' 格没写进去，见下面说明。' : '') +
        (blockedN ? ' 有 ' + blockedN + ' 格国名认不出、没有写进去，见下面说明。' : '') +
        (adjN ? ' 其中 ' + adjN + ' 格做了缩写，见下面说明。' : '') +
        /* 兜底：Safari 等浏览器可能拦掉「异步后 a.click()」的下载（手势链）。
           静态不可判，所以给一句人话补救路径；不改变下载逻辑。 */
        '没看到下载，就再点一次按钮。';
      if (wN) st.className = 'tiny noteWarn';
    } catch (e) {
      st.className = 'err';
      st.textContent = '生成失败：' + zhError(e);
      /* 死代码已删：core 不把 report 挂到 error 上，这里永远拿不到 r；
         失败时下面没有可核对的内容，只保留错误文案。 */
    } finally {
      btn.disabled = false;
    }
  }

  /* 生成 B 文件（填写说明，1 页）。单独一个按钮，与 A 互不影响。 */
  async function generateInstructions() {
    var btn = el('btnInstr');
    var st = el('instrStatus');
    if (btn) btn.disabled = true;
    if (st) { st.className = 'tiny'; st.textContent = '正在生成填写说明…'; }
    try {
      var n = uncertainCount();
      var out = await buildInstructionsPdf(window.PDFLib.PDFDocument, n);
      downloadBytes(out.bytes, 'I-485-填写说明.pdf');
      if (st) {
        st.className = 'tiny';
        st.textContent = '填写说明已生成并开始下载（1 页）。' +
          (n > 0 ? '里面标出了你标了不确定的 ' + n + ' 题。' : '');
      }
    } catch (e) {
      if (st) { st.className = 'err'; st.textContent = '生成失败：' + zhError(e); }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ---------------- 答案导出 / 导入（v9 批 1）----------------
   * 只做答案 JSON，不做核对页。
   * 导出：i485-answers-YYYYMMDD.json（文件名不带姓名等个人信息）
   *       内容 = 现存档 + exportedAt
   * 导入：<input type="file"> + File API
   *       校验 d.v === 1 且 d.answers 是对象；不合法给中文原因，不许静默失败
   * 合并：合并且新档优先，不删除现有答案；导入前弹确认
   *
   * ⚠ 存档格式（v:1 / answers 结构）不因导出导入而改变：
   *   导出的文件就是存档本身 + 一个 exportedAt 字段，
   *   导入时只读 v / answers / uncertain / seenSegs / pos / currentId，
   *   读进来的值一律经过与 load() 相同的校验函数。
   */
  function exportPayload() {
    /* 先把当前内存状态立即落盘，再读存档原文 ——
       否则刚答完最后一笔就导出，save() 的 250ms 防抖还没落盘，
       导出的文件里没有最后一笔（Y2）。 */
    writeNow();
    /* 优先直接读存档原文：保证导出的内容与浏览器里存的一模一样。
       存档不存在（还没答过一题）时用当前内存状态拼一份。 */
    var base = null;
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) base = JSON.parse(raw);
    } catch (e) { base = null; }
    if (!base || base.v !== 1) {
      base = {
        v: 1, answers: state.answers, pos: state.pos, currentId: state.currentId,
        uncertain: state.uncertain, seenSegs: state.seenSegs, at: lastSavedAt || Date.now()
      };
    }
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    out.exportedAt = new Date().toISOString();
    return out;
  }
  function exportAnswers() {
    var payload = exportPayload();
    var name = 'i485-answers-' + fmtDate(new Date()) + '.json';
    var text = JSON.stringify(payload, null, 2);
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
    var n = countAnswers(payload.answers);
    ioMsg('', '已导出 ' + n + ' 条答案（' + name + '）。', 'ok');
    return name;
  }
  /* 统计 answers 里的有效条数（布尔 true / 非空字符串） */
  function countAnswers(ans) {
    if (!ans || typeof ans !== 'object') return 0;
    var n = 0;
    Object.keys(ans).forEach(function (k) {
      var v = ans[k];
      if (v === true) n++;
      else if (typeof v === 'string' && v.trim() !== '') n++;
    });
    return n;
  }
  /* 导入：错误一律用中文原因写进提示行，不静默失败。
     返回值：true = 导入成功（已落盘）；false = 拒绝 / 取消。
     Y4：成功后**留在导入前的视图**（不在开始页导入却把人扔进答题页）。 */
  function importAnswersText(text) {
    var d;
    try {
      d = JSON.parse(text);
    } catch (e) {
      ioMsg('', '导入失败：文件不是合法的 JSON（可能是文件被截断了，或不是本工具导出的文件）。', 'bad');
      return false;
    }
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      ioMsg('', '导入失败：文件内容不是一个对象（格式不对）。', 'bad');
      return false;
    }
    if (d.v !== 1) {
      ioMsg('', '导入失败：版本不对（这个文件是 v' + (d.v === undefined ? '（缺失）' : d.v) + '，只支持 v1）。', 'bad');
      return false;
    }
    if (!d.answers || typeof d.answers !== 'object' || Array.isArray(d.answers)) {
      ioMsg('', '导入失败：文件里没有 answers（答案字段格式不对）。', 'bad');
      return false;
    }
    /* 导入前的答案条数（用于「覆盖 M 条」的提示） */
    var before = countAnswers(state.answers);
    var incoming = countAnswers(d.answers);
    var msg = '导入 ' + incoming + ' 条答案，覆盖 ' + before + ' 条？'
      + '（同时会同步进度与标记，不删除现有答案）';
    if (!confirm(msg)) {
      ioMsg('', '已取消导入，现有答案未变。', '');
      return false;
    }
    /* 合并且新档优先：不删除现有答案 */
    var merged = {};
    Object.keys(state.answers).forEach(function (k) { merged[k] = state.answers[k]; });
    Object.keys(d.answers).forEach(function (k) {
      var v = d.answers[k];
      if (v === true || (typeof v === 'string' && v.trim() !== '')) merged[k] = v;
    });
    state.answers = merged;
    /* Y3：标记按「新档优先、不删旧」合并 ——
       原来整份替换（state.uncertain = readFlags(d.uncertain)），
       新档里没有的旧标记会被清空。空对象/缺失 = 不动现有标记。 */
    if (d.uncertain && typeof d.uncertain === 'object' && !Array.isArray(d.uncertain)) {
      var incU = readFlags(d.uncertain);
      Object.keys(incU).forEach(function (k) { state.uncertain[k] = true; });
    }
    if (d.seenSegs && typeof d.seenSegs === 'object' && !Array.isArray(d.seenSegs)) {
      var incS = readFlags(d.seenSegs);
      Object.keys(incS).forEach(function (k) { state.seenSegs[k] = true; });
    }
    var savedPos = Math.floor(Number(d.pos));
    if (isFinite(savedPos) && savedPos > 0) state.pos = savedPos;
    if (d.currentId) state.currentId = d.currentId;
    /* Y5：先写盘，**写成功**后才更新时间戳 ——
       原来 save() 是防抖的（250ms 后才落盘），
       紧接着 setSaveTime(Date.now()) 等于还没写盘就说「已自动保存」= 谎报。
       writeNow() 同步落盘，写成功才 setSaveTime（与 save() 内部同口径）。 */
    var saved = writeNow();
    if (!saved) {
      ioMsg('', '导入完成，但存档写入失败（浏览器可能禁止了本地存储），请刷新前先检查答案。', 'bad');
      return false;
    }
    var after = countAnswers(state.answers);
    /* Y3：措辞按真实情况分三种 —— 纯新增 / 纯覆盖 / 混合。
       原来固定写「新增或覆盖 N 条」（N = after - before），
       纯覆盖时 N = 0，会说成「新增或覆盖 0 条」= 表述不准。 */
    var added = 0, overwritten = 0;
    Object.keys(d.answers).forEach(function (k) {
      var v = d.answers[k];
      if (!(v === true || (typeof v === 'string' && v.trim() !== ''))) return;
      if (Object.prototype.hasOwnProperty.call(state.answers, k)) overwritten++;
      else added++;
    });
    var how = added > 0 && overwritten > 0 ? ('新增 ' + added + ' 条、覆盖 ' + overwritten + ' 条')
      : (added > 0 ? ('新增 ' + added + ' 条') : ('覆盖 ' + overwritten + ' 条'));
    ioMsg('', '导入完成：现有答案 ' + before + ' 条 → ' + after + ' 条（' + how
      + '，进度与标记已同步；现有答案未被删除）。', 'ok');
    return true;
  }
  /* 导入文件：先看体积（Y7），再读。
     Y7：超大文件会把主线程卡死（JSON.parse 一个几百 MB 的字符串），
     所以读之前先卡上限（2MB），超了直接给中文错返回，不进 FileReader。 */
  var IMPORT_MAX_BYTES = 2 * 1024 * 1024;   /* 2MB */
  function importAnswersFile(file) {
    if (!file) return;
    /* Y7：体积上限 —— 超大文件直接报错返回，不读不解析 */
    if (typeof file.size === 'number' && file.size > IMPORT_MAX_BYTES) {
      var mb = (file.size / 1024 / 1024).toFixed(1);
      ioMsg('', '导入失败：文件太大（' + mb + ' MB）。这个工具的答案文件上限是 2 MB，请确认选的是本工具导出的答案文件。', 'bad');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var ok = importAnswersText(String(reader.result || ''));
      if (ok) {
        /* Y4：导入后**留在原来的视图** ——
           原来无条件 render(state.pos, true)，从开始页导入会被人扔进答题页。
           只有当前本来就在答题视图，才重画当前题（答案变了，勾要更新）。 */
        if (currentView === 'q') render(state.pos, true);
      }
    };
    reader.onerror = function () {
      ioMsg('', '导入失败：文件读不了（请检查文件是否还在原处、是否有读取权限）。', 'bad');
    };
    try {
      reader.readAsText(file);
    } catch (e) {
      ioMsg('', '导入失败：文件读不了（' + (e && e.message ? e.message : '未知错误') + '）。', 'bad');
    }
  }
  /* ---------------- 轻提示（toast，v9 批 9）----------------
     导出三选项面板的「导出进度」执行后要给一条当场可见的提示。
     复用已有的 #toast 元素（CSS 已存在，一直没用上）+ 现有令牌
     （--dark-bg / --on-dark），**不引入新颜色**。
     同时也写一条 ioMsg（就近提示行）——两处都有，不靠单一通道。 */
  var toastTimer = null;
  function toast(text, ms) {
    var box = el('toast');
    if (!box) return;
    box.textContent = text;
    box.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastTimer = null;
      box.hidden = true;
      box.textContent = '';
    }, ms || 3200);
  }
  /* 提示行：两处入口（intro / handoff）各有一行，就近显示。
     Y6：只写**当前视图**对应的那一块，另一块必须清空 ——
     原来两个都写，于是从拿表屏导入时，开始页那行也冒出「导入完成」，
     切回开始页就看到上一条消息（串屏）。 */
  function ioMsg(scope, text, cls) {
    /* scope 为空 = 「就近显示」：按当前视图选那一条提示行。 */
    var target = scope === 'handoff' ? 'handoff'
      : (scope === 'intro' ? 'intro'
        : (currentView === 'handoff' ? 'handoff' : 'intro'));
    var ids = target === 'handoff' ? ['ioMsgHandoff', 'ioMsgIntro'] : ['ioMsgIntro', 'ioMsgHandoff'];
    ids.forEach(function (id, i) {
      var n = el(id);
      if (!n) return;
      /* i === 0 是当前视图对应的那块：写内容；另一块：清空（不留旧消息）。 */
      if (i === 0) {
        n.textContent = text;
        n.className = 'io-msg' + (cls ? ' ' + cls : '');
      } else {
        n.textContent = '';
        n.className = 'io-msg';
      }
    });
  }
  /* 当前视图对应的提示行 id（拿表屏用 handoff 那行，其余用 intro 那行）。
     setView 切屏时调用：把另一块的旧消息清掉（串屏的第二道保险）。 */
  function clearOtherIoMsg(view) {
    var keep = view === 'handoff' ? 'ioMsgHandoff' : 'ioMsgIntro';
    var other = keep === 'ioMsgHandoff' ? 'ioMsgIntro' : 'ioMsgHandoff';
    var n = el(other);
    if (!n) return;
    if (n.textContent) { n.textContent = ''; n.className = 'io-msg'; }
  }
  function bindIoLinks() {
    var pairs = [
      ['btnExportJson', 'btnImportJson', 'fileImportJson'],
      ['btnExportJson2', 'btnImportJson2', 'fileImportJson2']
    ];
    pairs.forEach(function (p) {
      var eb = el(p[0]), ib = el(p[1]), fi = el(p[2]);
      if (eb) eb.addEventListener('click', function () { exportAnswers(); });
      if (ib && fi) {
        ib.addEventListener('click', function () { fi.click(); });
        fi.addEventListener('change', function () {
          var f = fi.files && fi.files[0];
          /* 重置 value：同一个文件再选一次也要能触发 change */
          fi.value = '';
          if (f) importAnswersFile(f);
        });
      }
    });
  }

  /* ---------------- 关于作者（v9 批 1.7 / 批 8）----------------
     一份事实源 = #aboutIntro（开始页那份）。拿表屏那份与目录面板底部那份
     都由 cloneAboutPanel() 克隆而来，三处文案永远一致（改文案只改 index.html 里那一处）。
     克隆用 DOM 克隆而不是手写第二份，是为了杜绝「两处文案不一致」这种漂移。 */
  var ABOUT_EMAIL = 'chenbinyu0@gmail.com';
  /* 把开始页那份克隆一份挂到指定挂载点。
     克隆的是面板本体（details），id 要改掉（不然页面里出现两个 aboutIntro），
     默认收起（cloneNode 会带上 open 属性，这里显式关掉）。 */
  function mountAboutClone(slot) {
    if (!slot || slot.firstChild) return null;
    var src = el('aboutIntro');
    if (!src) return null;
    var copy = src.cloneNode(true);
    copy.removeAttribute('id');
    copy.classList.add('about-clone');
    /* 克隆体默认收起（cloneNode 会带上 open 属性，这里显式关掉） */
    copy.removeAttribute('open');
    var m = copy.querySelector('.about-msg');
    if (m) m.textContent = '';
    slot.appendChild(copy);
    return copy;
  }
  function cloneAboutPanel() {
    /* 拿表屏（#aboutHandoffSlot）+ 目录面板底部（#aboutTocSlot）各挂一份。
       两处都是占位容器，文案只从 #aboutIntro 克隆 —— 全站一份事实源。 */
    mountAboutClone(el('aboutHandoffSlot'));
    mountAboutClone(el('aboutTocSlot'));
  }
  /* 复制按钮：走 navigator.clipboard；不可用 / 被拒时退回 execCommand；
     两条路都失败必须给中文提示，不许静默。 */
  function aboutSay(btn, text, ok) {
    var box = btn.closest ? btn.closest('.about') : null;
    var msg = box ? box.querySelector('.about-msg') : null;
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'about-msg ' + (ok ? 'ok' : 'bad');
  }
  function aboutLegacyCopy() {
    try {
      var ta = document.createElement('textarea');
      ta.value = ABOUT_EMAIL;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var done = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!done;
    } catch (e) {
      return false;
    }
  }
  function aboutCopyFallback(btn) {
    if (aboutLegacyCopy()) {
      aboutSay(btn, '已复制：' + ABOUT_EMAIL, true);
    } else {
      aboutSay(btn, '复制失败，请手动选中复制', false);
    }
  }
  function bindAboutCopy() {
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.about-copy') : null;
      if (!btn) return;
      ev.preventDefault();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ABOUT_EMAIL).then(function () {
          aboutSay(btn, '已复制：' + ABOUT_EMAIL, true);
        }, function () {
          aboutCopyFallback(btn);
        });
      } else {
        aboutCopyFallback(btn);
      }
    });
  }

  /* ---------------- 事件 ---------------- */
  el('btnStart').addEventListener('click', function () {
    render(clampResumePos());
  });
  el('btnSegGo').addEventListener('click', function () {
    render(pendingPos, true);
  });
  el('btnNext').addEventListener('click', function () {
    goNext();
  });
  el('btnPrev').addEventListener('click', function () { render(Math.max(0, state.pos - 1)); });
  el('btnPdf').addEventListener('click', generate);
  el('btnInstr').addEventListener('click', generateInstructions);
  /* 「导出」（v9 批 9）：顶栏这颗不再直接生成 PDF，点一下弹三选项面板。
     面板里三条：导出进度（只下 .json）/ 导出 PDF / 下载填写说明。
     旧的 exportAnytime()（中途导出完整链路）现在由「导出 PDF」那条调用。 */
  var expBtn = el('btnExport');
  if (expBtn) expBtn.addEventListener('click', function () {
    if (expOpen) closeExp(true); else openExp();
  });
  var expCloseBtn = el('expClose');
  if (expCloseBtn) expCloseBtn.addEventListener('click', function () { closeExp(true); });
  var expOverlayEl = el('expOverlay');
  if (expOverlayEl) expOverlayEl.addEventListener('click', function () { closeExp(true); });
  /* ① 导出进度：只下载答案 .json，**不生成 PDF**。关面板 + 给一条状态提示。 */
  var expProgressBtn = el('btnExpProgress');
  if (expProgressBtn) expProgressBtn.addEventListener('click', function () {
    closeExp(true);
    /* exportAnswers() 自己会写提示行（ioMsg）；再补一条 toast，让用户当场知道文件已下载。 */
    try {
      var name = exportAnswers();
      toast('已导出进度文件：' + name + '（换设备后用「导入答案文件」导入它就能接着填）');
    } catch (e) {
      ioMsg('', '导出进度失败：' + zhError(e), 'bad');
    }
  });
  /* ② 导出 PDF：等同现有 generate()（生成填好的官方表并下载）。
     走 exportAnytime() 而不是直接 generate()：保留「随时导出」的老链路
     （未答题弹确认 → 快照 → 切拿表屏 → generate() 下载 A 文件）。
     用户在确认框点「取消」→ 面板已关，给一句提示告诉ta「没导出」，
     不让页面看起来像卡住。 */
  var expPdfBtn = el('btnExpPdf');
  if (expPdfBtn) expPdfBtn.addEventListener('click', function () {
    closeExp(true);
    Promise.resolve(exportAnytime()).then(function (ok) {
      if (ok === false) toast('已取消导出：没有生成文件，答案没变。');
    });
  });
  /* ③ 下载填写说明：等同现有 generateInstructions()（1 页说明）。 */
  var expInstrBtn = el('btnExpInstr');
  if (expInstrBtn) expInstrBtn.addEventListener('click', function () {
    closeExp(true);
    generateInstructions();
  });
  /* 「目录」：打开/关闭段/题导航面板。
     开/关只改 DOM，不写存档、不改当前题。 */
  var tocBtn = el('btnToc');
  if (tocBtn) tocBtn.addEventListener('click', function () {
    if (tocOpen) closeToc(); else openToc();
  });
  var tocCloseBtn = el('tocClose');
  if (tocCloseBtn) tocCloseBtn.addEventListener('click', closeToc);
  var tocOverlay = el('tocOverlay');
  if (tocOverlay) tocOverlay.addEventListener('click', closeToc);
  /* 「关于作者」（开始页）：同一套开/关写法 —— 只改 hidden，不碰答案与存档。 */
  var aboutBtn = el('btnAbout');
  if (aboutBtn) aboutBtn.addEventListener('click', function () {
    if (aboutOpen) closeAbout(); else openAbout();
  });
  var aboutCloseBtn = el('aboutClose');
  if (aboutCloseBtn) aboutCloseBtn.addEventListener('click', closeAbout);
  var aboutOverlayEl = el('aboutOverlay');
  if (aboutOverlayEl) aboutOverlayEl.addEventListener('click', closeAbout);
  /* 目录 → 「回看查验结果」（v9 批 7）：关目录 → 打开 #view-sheet。
     复用同一个 showSheet()（它自己记住从哪屏进来），不新写第二套切屏逻辑。 */
  var tocSheetBtn = el('tocSheetLink');
  if (tocSheetBtn) tocSheetBtn.addEventListener('click', function () {
    closeToc();
    showSheet();
  });
  /* 目录 → 「导入页」（v9 批 9）：关目录 → 回到开始页 #view-intro。
     **答案不许清空**：只切视图，不碰 state.answers、不碰存档键。
     回到开始页后「开始填表」会变成「继续上次（第 N 题）」，用户从那里接着填。 */
  var tocImportBtn = el('tocImportLink');
  if (tocImportBtn) tocImportBtn.addEventListener('click', function () {
    closeToc();
    setView('intro');
    fitStage();
  });
  /* 结果屏 → 拿表屏：只切视图，不重算数据。 */
  el('btnToHandoff').addEventListener('click', function () {
    setView('handoff');
    fitStage();
  });
  /* 拿表屏 → 结果屏：只切视图，不重算数据。 */
  el('btnBackToResult').addEventListener('click', function () {
    setView('done');
    fitStage();
  });
  /* 答案核对页（v9 批 3a）：两处入口都是文字链接；返回固定回结果屏。 */
  el('btnSheetFromDone').addEventListener('click', function (e) {
    if (e && e.preventDefault) e.preventDefault();
    showSheet();
  });
  el('btnSheetFromHandoff').addEventListener('click', showSheet);
  el('btnSheetBack').addEventListener('click', function () {
    /* v9 批 7：按打开前的页面返回（答题页 / 结果屏 / 拿表屏）；
       没记到（理论上不会）就回结果屏，保持旧行为兜底。 */
    if (sheetReturnView === 'q') { render(state.pos); return; }
    setView(sheetReturnView === 'handoff' ? 'handoff' : 'done');
    fitStage();
  });
  /* 「有要改的，回去接着答」：回到最后一题（用户改答案后能从下一题接着走）。
     中途导出过（partialExport 有值）时回到「导出时的那一题」，不是最后一题 ——
     不然用户从拿表屏点回来会直接被扔到最后一题，看不到自己导到哪了。 */
  el('btnEditAnswers').addEventListener('click', function (e) {
    if (e && e.preventDefault) e.preventDefault();
    var l = list();
    if (partialExport) {
      var back = Math.max(0, Math.min(l.length - 1, partialExport.at - 1));
      render(back);
      return;
    }
    render(Math.max(0, l.length - 1));
  });
  el('btnRestart2').addEventListener('click', function () {
    if (!confirm('清空全部答案并从第一题重新开始？')) return;
    wipe(); save(); render(0);
  });

  document.addEventListener('keydown', function (e) {
    /* ESC 先关导出面板（开着导出面板时不该触发目录 / 快捷键逻辑）。
       ESC 关的是**最上面那层**：两个面板同时开着时先关导出面板。 */
    if (e.key === 'Escape' && expOpen) { closeExp(true); return; }
    if (e.key === 'Escape' && tocOpen) { closeToc(); return; }
    if (e.key === 'Escape' && aboutOpen) { closeAbout(); return; }
    /* 焦点陷阱：导出面板开着时 Tab 在面板内循环，不跑出去。 */
    trapExpTab(e);
    if (expOpen) return;   /* 面板开着时不做「回车下一题」等快捷键 */
    if (document.body.classList.contains('intro') || document.body.classList.contains('done')) return;
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    el('btnNext').click();
  });

  /* ---------------- 启动 ---------------- */
  function clampResumePos() {
    var l = list();
    if (!l.length) return 0;
    if (state.pos < 0) return 0;
    return state.pos > l.length - 1 ? l.length - 1 : state.pos;
  }

  (function boot() {
    var m = MODEL.meta || {};
    var st = (m.stats || {});
    el('introMeta').textContent =
      '题库：' + (st.questions || MODEL.questions.length) + ' 题（含 ' + (st.conditionalQuestions || 0) +
      ' 道条件题）· 由 ' + (st.controls || '') + ' 个表单控件生成 · 已排除 ' + (st.piiExcluded || 0) +
      ' 个个人信息字段 · 官方表 ' + (m.pdfFieldsInForm || '') + ' 个可填格子。';
    /* 皮肤：先读存档再上色（早于 setView，避免第一帧闪一下默认色）。
       存档键与答案存档分开（i485web.theme vs i485web.v1）。 */
    applyTheme(readTheme(), false);
    bindThemeDots();
    /* 开始页的「技术说明」展开/收起会改变固定页脚的高度：
       展开后立刻重算 --foot-h 与 #stage 的底部让位，否则展开内容会盖住正文。 */
    var techBox = document.querySelector('#foot .tech');
    if (techBox && techBox.addEventListener) techBox.addEventListener('toggle', fitFooter);
    /* 页脚高度只要变了（字体替换、文字换行、安全区变化）就同步 --foot-h 与让位。
       ResizeObserver 不可用的老 WebView 由 paintSaveTime / resize / setView 三次重算兜底。 */
    if (window.ResizeObserver && el('foot')) {
      try { new ResizeObserver(function () { fitFooter(); }).observe(el('foot')); } catch (e) { /* 老内核 */ }
    }
    bindIoLinks();
    /* 关于作者：拿表屏那份从开始页那份克隆（同一事实源） */
    cloneAboutPanel();
    bindAboutCopy();
    var resumed = load();
    if (resumed) {
      state.pos = clampResumePos();
      el('btnStart').textContent = '继续上次（第 ' + (state.pos + 1) + ' 题）';
    }
    /* 关键：初始视图必须在启动时显式激活，否则 .view 全部 display:none → 白屏 */
    setView('intro');
    computeSegRanges();
    buildSegBar();
    /* 开始页精简时删掉了 8 段地图 #segMap，那个地图构建函数也随之删除；
       这里原来还留着一行对它的调用，控制台报 ReferenceError（函数名已随风格删除）。
       已删。段/题导航走 #tocPanel（openToc），不恢复地图。 */
    fitStage();
    if (typeof window.addEventListener === 'function') window.addEventListener('resize', fitStage);

    /* 调试入口只在 ?debug=1 下挂载：window.__i485 句柄 + #q=<可见题序号> 深链。
       发版页面不带 query 时，这两个入口都不存在。 */
    var DEBUG = /(?:^|[?&])debug=1(?:&|$)/.test((window.location && window.location.search) || '');
    if (DEBUG) {
      window.__i485 = {
        state: state, render: render, list: list, showDone: showDone,
        /* 验收钩子：端到端脚本用它对「要回去核对」条数与说明页里的 N 做交叉断言 */
        uncertainCount: uncertainCount,
        buildInstructionsPdf: buildInstructionsPdf,
        /* 验收钩子：随时导出（中途导出） */
        exportAnytime: exportAnytime,
        unansweredCount: unansweredCount,
        partialExport: function () { return partialExport; },
        /* 验收钩子：导出三选项面板（v9 批 9） */
        openExp: openExp,
        closeExp: closeExp,
        expOpen: function () { return expOpen; },
        /* 验收钩子：目录 →「导入页」回开始页（v9 批 9） */
        goImportPage: function () { setView('intro'); fitStage(); },
        /* 验收钩子：段/题导航（2026-11-09） */
        jumpToSeg: jumpToSeg,
        jumpToQuestion: jumpToQuestion,
        openToc: openToc,
        closeToc: closeToc,
        tocOpen: function () { return tocOpen; },
        visibleBySeg: visibleBySeg,
        currentId: function () { return state.currentId; },
        /* 验收钩子：直接改状态（不经过 UI），用来测条件题联动与状态标记 */
        setAnswer: function (id, v) { state.answers[id] = v; save(); },
        canMarkUncertain: canMarkUncertain,
        toggleUncertain: toggleUncertain,
        showHandoff: function () { setView('handoff'); fitStage(); },
        showSheet: showSheet,
        /* 验收钩子：切段横幅的真实显示路径（A11 用，不许合成 classList） */
        showBanner: showBanner,
        /* 验收钩子：皮肤切换（v9 批 1） */
        applyTheme: applyTheme,
        currentTheme: function () { return currentTheme; },
        readTheme: readTheme,
        /* 验收钩子：答案导出 / 导入（v9 批 1） */
        exportPayload: exportPayload,
        importAnswersText: importAnswersText,
        countAnswers: countAnswers,
        saveTime: function () { return lastSavedAt; }
      };
      var hm = /^#q=(\d+)$/.exec((window.location && window.location.hash) || '');
      if (hm) {
        var tl = list();
        if (tl.length) {
          var want = parseInt(hm[1], 10) || 0;
          render(Math.max(0, Math.min(tl.length - 1, want)), true);
        }
      }
    }
  })();
})();
