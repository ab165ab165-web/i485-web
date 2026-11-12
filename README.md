# I-485 中文填表助手（MVP）

一页一题的中文问卷，答完在**本地**生成填好的官方 I-485 PDF（09/18/26 版）。
无后端、无框架、无 CDN、不联网。

**定位：查验工具，不是代填工具。** 它做的是把「你会不会有麻烦」逐条问清楚、落到表上；
姓名、地址这些格子保持空白，由客户自己手填。

## 怎么打开

**直接双击 `app/index.html`** 就能用：PDF 模板已经内联，`file://` 下也能正常生成。
也可以起一个本地静态服务再打开 `/app/`：

```bash
cd i485-web        # 进项目目录
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/app/
```

（双击 `index.html` 或起本地服务都能用。若浏览器拦截下载/读取，用 https 或本地服务打开。
若直接用 `cd app` 起服务，程序会退回到本目录的 `assets/fillvisa_i-485-acro.pdf` 副本，功能一样。）

## 目录

```
app/
├── index.html            页面骨架（开始页 / 答题页 / 完成页两屏：结果屏 + 拿表屏）
├── style.css             样式（单色系 + 大字排版，移动优先）
├── sections.js           八段分段表：段名 / 底色 / 强调色 / 包含哪些 section（视觉层唯一事实源）
├── app.js                问卷 UI：一题一屏、分段、进度、条件题、localStorage 存档、生成两份 PDF
├── js/core.js            共享核心：条件 DSL 解释器 + 答案→PDF 写入（浏览器/Node 同一份）
├── js/instructions.js    填写说明页的版面定义（buildLayout）+ 运行时资产清单
├── data/questions.js     题库（由 build/build-questions.js 生成，勿手改）
├── data/build-report.json 生成统计
├── libs/pdf-lib.min.js   pdf-lib 1.17.1（本地，无 CDN）
├── libs/pdf-lib.LICENSE.md
├── assets/fillvisa_i-485-acro.pdf   官方表副本（仅在从 app/ 单目录起服务时使用）
├── build/build-questions.js  重新生成题库（含 PII 规则、文案、Part 2 门题）
├── build/build-font-subset.py 标题字体子集：按全站文案抠字 → fonts/*.woff2（≤300KB，加题后重跑）
├── build/v9-font-accept.js   标题字体验收 D1–D9（体积 / 覆盖率 / 生效 / 正文未换 / 字号实测 / 12 张截图 / file:// / 回归）
├── build/measure-ink.py      字号对照截图的像素测量（ink 包围盒，D5 用）
├── build/check-item-numbers.js 条目编号核对：9a 逐条编号 + 全库裸 item 重复
├── build/verify.js           验收 1–4：生成 PDF + pdftotext + 字段读回
├── build/smoke-dom.js        无浏览器冒烟测试：真跑 app.js 走完全部题
├── build/ux-v2-accept.js     UX v2 双视口验收（逐屏截图 + 非白占比 + 真下载读回）
├── build/ux-v2-reverse.js     UX v2 反向失败实测（故意改坏 5 处 → 验收脚本必须红）
├── build/clean-rebuild-check.js 干净目录重建比对（页数/MediaBox/逐页文字/字段数）
├── build/check-file-protocol.js   file:// 双击打开验证（内联 b64 兜底 + 0 控制台报错）
├── build/handoff.js          完成页两屏导航 helper（验收脚本切拿表屏用）
├── build/migrate-handoff.js  两屏拆分时的一次性迁移脚本（已跑完，留档）
├── build/check-abbrev.js     国名短写表自检：>9 字符 / 截断 / 重名 必须为 0
├── build/check-pdfsafe.js    PDF 标准字体可写字符自检
├── build/final-accept.js     真实浏览器全流程验收（Playwright，mobile|desktop）
├── build/browser-export-anytime.js 「随时导出」真浏览器验收（顶栏坐标 + 两点位真下载 + 取消路径 + 半成品口径）
├── build/check-export-anytime-reverse.js 「随时导出」反向失败实测（故意改坏 9 处 → 验收脚本必须红）
├── build/check-handoff-partial-copy.js 半成品拿表屏文案验收（🔴 4 个串 partial 屏 0 命中 / 完整屏必须仍在）
├── build/check-handoff-partial-copy-desktop.js 同上（1280×900 视口 + 两屏截图）
├── build/check-topbar-narrow.js 窄屏顶栏几何验收（320/430 × 2× 字号：按钮不溢出、不重叠）
├── build/check-nav-overflow.js 段/题导航 + 窄屏横向溢出验收（6 档视口 × 4 视图 scrollWidth===clientWidth + 8 段跳转 + 目录面板 + 条件题联动）
├── build/measure-overflow.js 窄屏逐题溢出测量（改前/改后原始数字留档）
├── build/check-fix2-pdf-downloads.js 真下载 4 份 PDF + poppler/qpdf 独立读回（A 27 页 / B 1 页 / 已答有值 / 未答为空）
├── build/pdf-fields.js     用 qpdf --json 读下载件 AcroForm 字段值（与 pdf-lib 复核互为独立工具）
├── build/out/I-485-test-filled.pdf  验收产物
└── NOTICE.md             第三方来源与许可（fillvisa AGPL / pdf-lib MIT）
```

## 产品口径（老板已确认，改之前先看这一节）

### 一、定位与边界

- 这是**查验工具**：把申请里容易出事的点逐条问清楚，生成一份「选择题已落表」的 PDF。
- 不问姓名、地址、SSN、A-Number、护照/签证号、签名、电话、邮箱。这些格子在 PDF 里保持空白，由客户手填。
- **Part 1 整段不问**，输出从 Part 2 开始。
- 不收集信息：无后端、无联网请求，答案只在本机 `localStorage`。

### 二、选择题覆盖

- 硬指标：Part 1 之外的 radio / checkbox / select 共 **345 个**，覆盖 **333 个**。
- 剩下 12 个是地址子字段（`employer_*`、`outside_employer_*`、`currentspouse_*` 的 apt / ste / flr / state），按口径**保持不问**。
- 新增题目只允许补选择题；不许为了凑覆盖率加姓名 / 地址 / 证件号题。

### 三、Part 2 Item 3 总闸门

- Item 3 前面有一道门题「你按哪一类申请？」，8 个选项：亲属 / 职业 / 特殊移民 / 庇护难民 / T-U / 公法项目 / DV 与特殊通道 / 以上都不是。
- 选完只显示对应那一张清单，其余 6 张不出现。
- 选「以上都不是」时 7 张清单全展开，并提示：这张表必须勾中一项，都不属于要找律师确认类别，否则 Part 2 空着可能被退回。
- 换门题会清空下游 7 组的旧答案，不留脏状态。门题本身不写任何 PDF 字段。

### 四、完成页分档查验

- 档 2「可能影响资格」：Part 9（9a–9g）里**是/否题**答「是」的题；其中有说明字段的条目后面追加「这一项还要另外写清楚经过」。
- 档 3「例行确认」：其余已答题，只报条数。
- 9d 的收入 / 资产这类多选一题不算「答是」，只进档 3；否则会把选了收入区间的人误报成「可能影响资格」。
- 原「档 1 表上要求你解释」已并入档 2：这些题全是 Part 9 是/否题，单列一档会永远显示「没有」。
- 标了「不确定」的题单列档 1「这 N 题要回去核对」，其余按下面两档；所以完成页是 2 档或 3 档，由规则计算，不许人工贴标签。
- 每条都要给原因，不许只给判定。

### 四之二、完成页拆两屏（2026-11-09）

旧版一屏塞「答完了 + 摘要 + 查验三档 + 两个下载 + 4 步指引 + 手填清单」，
430 宽下实测 3696 CSS px ≈ 4 屏。现在拆两屏：

| 屏 | id | 内容 |
|---|---|---|
| 结果屏 | `#view-done` | `h1 答完了` → `doneSummary` → `donePills` → `h2 查验结果` → `chkIntro` → `chkBox` → 主按钮「下一步：下载和后续」→ 小字链接「有要改的，回去接着答」（回最后一题） |
| 拿表屏 | `#view-handoff` | `h1 下载和后续` → 两个下载按钮 → `pdfStatus` / `instrStatus` / `pdfNotes` → 「拿到 PDF 之后怎么走」4 步 → 手填清单 `hwList` → 底部按钮「回看查验结果」→ 底部免责声明「本工具不构成法律意见」 |

- 切换走 `setView()`，**不重算数据**；数据在 `showDone()` 里算好。
- **PDF 生成按钮仍在拿表屏**；既有 id 全部保留（`btnPdf` / `btnInstr` / `chkBox` /
  `hwList` / `pdfStatus` / `instrStatus` / `doneSummary` / `donePills` / `chkIntro` …）。
- 新增 id：`btnToHandoff` / `btnBackToResult` / `btnEditAnswers` / `handoffDisc`。
- **回到最后一题只有一个入口**：`#btnEditAnswers`（「有要改的，回去接着答」）。
  原来的 `#btnBack`（「返回最后一题检查」）与它同 handler、同目标，是重复按钮，2026-11-09 已删。
- 两屏顶栏都显示「已完成」，`#partTitle` 为空，**不属于任何一段**。
- 两个下载按钮下各一行 14px 灰字 `.dl-hint`：
  27 页「打印这一份，黑笔补空后寄走」 / 1 页「自己留着对照，不用交」。

### 四之三、Part 9 答「是」即时提示

条件：`/^9[a-g]$/.test(q.section) && q.hasDetailsField && answeredYes(q)`。
在题卡内（选项区下方、底部按钮上方）渲染一行 `.live-warn`：

> 这题答「是」要在 Part 9 另写一段解释。不用重填，答完统一给你清单。

样式：左边 4px 竖条（`var(--warn-border)` = `#B45309`）+ `#FFF4E5` 底 + `#B45309` 字，16px / 行高 1.75，圆角 10px。

> 2026-11-09 改文案：原句「这题答「是」**会进** Part 9」有错 ——
> 这题本身就在 Part 9（9a–9g），不存在「进 Part 9」这回事。
> 改成「要在 Part 9 **另写一段解释**」，说的是真正会发生的事。

**答「否」后立即消失**：每次 `render()` 按当前答案重算，不做状态残留。

> 2026-11-09 同时修正了 `answeredYes()` 的老 bug：原来只看「哪个选项被勾了」，
> 是/否题选了「否」也会被当成答是，于是提示在答「否」时也亮着。
> 现在与 `checkedYes()` 同口径 —— `No` / `N/A` 不算答是。

### 四之四、随时导出（2026-11-09）

> 老板原话（14:02）：「能不能加一个可以随时导出的按钮，就是点完以后默认我所有别的没选的都是勾选不确定或者跳过」。

**入口**：顶栏右侧常驻一颗 ghost 小号按钮「导出」（`#btnExport`，`.btn.top-export`，44px 高 / 14px 字）。
只在**答题页**出现（`body.intro` / `body.seg` / `body.done` 三种状态下 `display:none`）——
开始页、切段过渡卡、完成页两屏都不显示。
顶栏布局：`brand`（**可收缩**，挤不下时先截断品牌名）+ `counter`（`margin-left:auto`，溢出截断加省略号）+ 导出按钮（不伸缩）：
430 宽下实测 brand 右缘 127px、counter 右缘 342px、按钮左缘 354px、按钮右缘 412px（视口 430），互不重叠、不溢出。
320 宽 + 2× 字号下实测 brand 18..103、counter 127..220、按钮 244..302（视口 320）——**不溢出、不重叠**。
（2026-11-09 修：`.brand` 原来写死 `flex:0 0 auto`，320 宽 + 2× 字号时把按钮顶出屏幕 24px；
改成 `flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis` 后按钮永远留在屏内。）

**点下去会发生什么**：

1. 先算当前可见题里**未答**的数量 N（口径与 `hasAnswer()` 完全一致：有选项题勾了一个算已答，
   输入题有非空文本算已答；标了「不确定」的题也不写任何格子 → 算未答）。
2. N > 0 → 弹确认：
   > 还有 N 题没答，这些格子在 PDF 里会留空（等同跳过）。现在导出吗？

   **取消 = 什么都不做**：不生成文件、不写 `localStorage`、不切视图、不动题目位置。
3. N = 0 → 直接导出。
4. 确认后走**现有生成链路**（`CORE.fillPdf`），并进**现有拿表屏**（`#view-handoff`）——
   「下载填好的表（27 页）」与「下载填写说明（1 页）」两颗按钮都可用。**不新造第三套下载界面。**
5. 导出时**自动开始下载 A 文件**（官方表 + 填值），不用再点一次。

**中途导出的文案口径**（不许出现矛盾表述）：

| 位置 | 走完全部题 | 中途导出 |
|---|---|---|
| 结果屏标题 `#doneTitle` | 「答完了」 | 「先导出目前的进度」 |
| 顶栏 `#counter` | 「已完成」 | 「已导出」 |
| 摘要 `#doneSummary` | 「共 N 题…已作答 M 题。」 | 「你在第 X 题时导出的（共 Y 题可见），已答的 M 题已经写进 PDF，未答的 N 题在表上留空（等同跳过）。」 |
| 拿表屏 `#exportNote` | 隐藏 | 警告块：「**这是半成品，先别寄！**你在第 X 题时导出的（共 Y 题可见），未答的 N 题在表上留空（等同跳过）。答完再导出一次才是要交的那份。」 |
| 拿表屏导语 `#handoffLead` | 「两份 PDF 各有用处：一份要交，一份自己留着对照。」 | 「这两份 PDF 只是半成品，先别寄。」 |
| 拿表屏主按钮 `#btnPdf` | 「下载填好的表（27 页）」 | 「下载半成品表（27 页）」 |
| 拿表屏 A 文件说明 `#dlHintA` | 「打印这一份，黑笔补空后寄走」 | 「半成品：还有 N 题在表上留空，先别寄 —— 答完再导出一次才是要交的那份。」 |
| 「拿到 PDF 之后怎么走」标题 `#guideTitle` | 「拿到 PDF 之后怎么走」 | 「这份还不能寄：先把题答完」 |
| 第 1 条 `#guideStep1` | 「只打印官方表那 27 页」 | **隐藏**（不教客户去打印半成品） |
| 第 2 条 `#guideStep2` | 「用黑笔补空，别空着交」 | 「先别寄：这份还有 N 题是空的」（第 3/4 条 + 签名提示 + 官网 Filing 提示**整块隐藏**） |
| 手写清单引子 `#hwIntro` | 「其余格子已按你的答案填好，不要覆盖…」 | 「你答过的格子已按答案填好，不要覆盖；未答的题目和下面这些格子生成时留空…」 |
| 进度条 | 全段点亮 | 按当前所在题画（与答题页同口径，不全亮） |

> **为什么改掉「已导出到第 X 题」**（2026-11-09 法正复审 D2）：用户可能已经答了 107 题又退回第 3 题才导出，
> 「已导出到第 3 题」与「已答 107 题」会自相矛盾，客户会以为导出只写进了 3 题。
> 现在位置只说明「当时停在哪」，答案数单独说：「你在第 3 题时导出的…已答的 107 题已经写进 PDF」。

> **🔴 为什么半成品路径必须换掉「寄走 / 一份要交 / 别空着交」**（2026-11-09 法正复审 D1）：
> 中途导出时表上有几十题留空，而拿表屏原本还在教客户「打印这一份…寄走」「空着可能被视为未完成」——
> 客户会把自己明知没答完的 I-485 寄出去（后果：退回 / 补件）。
> 换法全部走 JS 分支（`applyHandoffCopy()`，不许用 CSS 文字替换）：
> 导语、主按钮、A 文件说明、「拿到 PDF 之后怎么走」标题逐条换口径；
> 「拿到 PDF 之后怎么走」里只剩第 2 条（已换成「先别寄 + 还差几题」），
> 第 1 条（只打印 27 页）、第 3 条（手写签名）、第 4 条（I-693 / I-864 / 护照照片）、
> 签名提示、官网 Filing 提示在半成品下**整块隐藏**——
> 客户看到「打印这一份」就会去打印，看到「配齐材料再寄」就会去寄。
> 完整路径（`partial` 为假）**一个字不动** —— 实现上先把 DOM 原文拓一份（`HANDOFF_ORIG`），
> 完整路径直接写回这份原文，保证幂等。

> **🟡 状态行不许留残留**（2026-11-09 法正复审 B2）：
> 复现链 = 中途导出（状态行写「已生成…共 1687 KB」）→ 回去接着答完 → 进拿表屏 →
> 状态行还留着上一次那句，客户以为「完整版已经生成过了」就不去点按钮，最后打印的是旧文件。
> 修法：`showDone()` 在 `!partial` 时清 `#pdfStatus` / `#instrStatus` / `#pdfNotes`（三行）。

**明确不做的事**：

- **不预先把所有题标成「不确定」**。PDF 效果与留空完全相同，但那样结果页会变成「不确定 107 题」、
  说明页会写「另有 107 题要回去核对」，反而误导客户。未答 = 留空 = 跳过。
- **不改存档结构**。存档的键（只有 `i485web.v1`）与字段（`v/answers/pos/currentId/uncertain/seenSegs/at`）
  一个不变、不新增 key；**导出后回来还能接着答**（答案与位置都在）。
  但要写准一句：导出**会**顺手清掉**当前不可见**题的「不确定」标记
  （`reconcileUncertain()` → `save()`，与答完时同一条规则）—— 这不是改结构，只是按可见性对账。
- **不改官方表模板**：留空就是留空，官方 PDF 只有是/否格子，没有「不确定」格。
- **不新造下载界面**：中途导出后落到的就是现有拿表屏，两颗下载按钮照常可用。
- **N 按题计，不按格计**（口径与 `hasAnswer()` 一致）：一道题里只填了一部分也算已答，
  但 PDF 里该题其余格子仍然是空的（确认框里的「这些格子在表里会留空」说的是格子，不是题）。

**「有要改的，回去接着答」**：中途导出后点它回到**导出时的那一题**（不是最后一题），
否则用户从拿表屏点回来会被扔到最后一题，看不到自己导到哪了。

### 五、文案规则（人话 skill 四条）

- 每题一句「为什么问这条 + 答错的代价」，必须具体到这个表项在判断什么，单句 ≤40 字。
- 开头让人做事，不用名词标题；一句一件事，不用分号串三件。
- 段标题用读者嘴里的问法，不带 `Part` 目录编号。
- 官方字段名、条文原文、表格栏位名照原样保留。
- **不许下法律结论**：禁止「会被拒」「一定批准」「保证通过」；用「可能」「通常」「会被要求」。

### 六、免责声明

- 全站统一一句「本工具不构成法律意见」，开始页 / 结果页 / 页脚三处逐字一致。
- 不写「免费使用」「填错后果自负」。

### 七、PDF 写入规则

- `pdf-lib` 载入官方表 → 按 `pdfField` 写值 → 勾选/取消勾选 → 直接下载。
- **单个格子写不进去不能中止整份**：逐字段 try/catch，其余照写，失败项逐条中文说明。
- 模板里的限长字段（如 `priorspouse_country_birth` / `priorspouse_nationality` 上限 9 字符）走高写表：227 个国名全部有 ≤9 字符写法，**禁止截断到有歧义**。
- 缩写、截断、丢弃都要在完成页逐条列出，状态行写「有 N 条提示需要你核对」。
- 纯中文会被 PDF 标准字体丢弃，必须在页面上明说「这一格没有写入」，不能显示成功。
- 所有文本框常驻提示「请用英文或拼音填写」。

### 八、存档与续填

- 答案存在 `localStorage['i485web.v1']`；刷新后回开始页，按钮显示「继续上次（第 N 题）」。
- 「重新开始」清空全部答案。
- 条件题用 `questions.js` 里的 JSON DSL 求值，**不用 eval / new Function**。
- `pos` 读档时按 `Math.floor(Number(pos))` 取整，`NaN` / 负数 / `null` 一律回 0（旧存档手改过也不会把小数下标带进答题页）。
- 新增两个存档字段：
  - `uncertain`：被「不确定，先标记」的题（`q.id -> true`）。这些题不写任何 PDF 字段，完成页单列一档「这 N 题要回去核对」。
  - `seenSegs`：已经看过切段过渡卡的段（段号 -> true），只在第一次进段时出现。
- **旧存档兼容**：读 `v:1` 的旧 JSON 时，缺 `uncertain` / `seenSegs` 一律按空对象处理，不报错；`answers` / `pos` 照旧恢复。
- **标记对账**：进完成页前，`uncertain` 只保留「当前可见、且本来允许标记」的题（父题改答案后下游题可能整段消失，旧标记不能留着复活）；只清标记，不动 `answers` / `seenSegs`。

### 九、不确定出口

- 每道是/否题、单选题、多选题下方有次级按钮「不确定，先标记」。
- 点了之后：清空这题已有答案、`uncertain=true`、直接进下一题；PDF 对应格子保持空白。
- 回到这题时按钮显示「已标记：不确定」，再点一次取消；重新作答也会自动取消标记。
- 完成页单列一档「这 N 题要回去核对」（题号 + 题面）。这些题**不进**「可能影响资格」，也**不进**「例行确认」。
- **两类题不提供这个按钮**（与门题同口径）：
  - 门题（`noPdf`）：只决定显示哪组 Part 2 清单、本身不写 PDF；
  - `gatesChildren`：这题的答案被别的题的 `cond` 引用，清空后下游条件题会整段消失（不写 PDF、界面也不提示）。页面对这类题改显示一行说明「这题决定后面会问到哪些题，先按最接近的情况选；拿不准就在答完后回来改」。
- `gatesChildren` 在**构建期**算好（`build-questions.js` 5d-0b：任一 option id / input id 出现在别的题的 `cond` 里即算），写进 `questions.js`，不靠运行时猜；`build/check-gates.js` 逐题核对，多一个少一个都 exit 1。

## 发版依据（完成页「拿到 PDF 之后怎么走」）

> 2026-11-08 实读，适用版本 **I-485 (09/18/26)**。完成页 4 步指引逐条对来源（见下方表）；
> 手写清单不再引用这些原句，改由 `fieldmap.json` + 题库生成。改文案前先回官网核对，表版本一换整段重写。

来源：

- 表格页：<https://www.uscis.gov/i-485>（Form Details / Filing Your Form I-485 by Mail 两节）
- 官方说明 PDF：<https://www.uscis.gov/sites/default/files/document/forms/i-485instr.pdf>

官方原句（照抄）：

1. **签名**（Instructions, p.3）：
   > "If your application is not signed, or if the signature is not valid, we will reject your application."
   > "USCIS will not accept a stamped or typewritten name in place of any signature on this application."
2. **签名与日期**（Instructions, Part 10）：
   > "You must sign and date your application and, if applicable, provide your daytime telephone number, mobile telephone number, and email address."
3. **没签名直接拒收**（i-485 表格页）：
   > "Don't forget to sign your form. We will reject any unsigned form."
4. **缺页 / 混版本**（i-485 表格页 Form Details）：
   > "If any of the form's pages are missing or are from a different form edition, we may reject your form."
5. **照片**（Instructions, What Evidence Must You Submit, Item 1）：
   > "You must submit two identical color passport-style photographs of yourself taken recently."
6. **I-693**（Instructions, What Evidence Must You Submit, Item 9）：
   > "If you are required to submit a Form I-693, or a partial Form I-693 (such as the Vaccination Record), you must submit it with your Form I-485. Otherwise, your Form I-485 may be rejected."
7. **I-864**（Instructions, Affidavit of Support Under Section 213A of the INA）：
   > "Failure to submit an Affidavit of Support Under Section 213A of the INA (Form I-864 or I-864EZ), when required, will result in a denial of your Form I-485."
8. **费用**（Instructions, Filing Fee；i-485 表格页）：
   > "See Form G-1055, available at www.uscis.gov/forms, for specific information about the fees applicable to this form."
   > "You can find the filing fee for Form I-485 by visiting our Fee Schedule page."
9. **寄到哪里**（Instructions, Where To File?；i-485 表格页）：
   > "Please see our website at https://www.uscis.gov/forms/all-forms/direct-filing-addresses-for-form-i-485-application-to-register-permanent-residence-or-adjust-status for the most current information about where to file your application, including if you are currently in exclusion, deportation, or removal proceedings."
10. **I-693 密封原件**（I-693 Instructions, What to do, Item 5）：
    > "The civil surgeon must give you the completed Form I-693 in a sealed envelope for you to submit to USCIS. Do not accept the form from the civil surgeon unless it is in a sealed envelope. USCIS will return your Form I-693 to you if it is not in a sealed envelope or if the envelope is opened or altered in any way."

**完成页 4 步逐条对来源**（对不上的不写进页面）：

| 步骤文案 | 来源 | 说明 |
|---|---|---|
| 1 只打印官方表那 27 页，不缺页 | 第 4 条 | 原文只说「缺页 / 不同版本可能被拒」，没有「页脚版本号和页码要清楚」这类要求，已删。 |
| 2 用黑笔补空，别空着交 | 本工具行为 + 第 1/2 条 | 前半句「这些格子工具不会填」是产品事实（PII 规则排除）；「空着可能被视为未完成」**没有官方原句**，只作提醒，用「可能」，不当结论。 |
| 3 签名并写当天日期 | 第 1/2/3 条 | 「打印或盖章的名字不算签名」出自第 1 条第二句。 |
| 4 按官网 Filing 页配齐材料再寄 | 第 5/6/7/10 条 | 照片、I-693（如适用，密封原件）、I-864（如适用）。 |

**完成页只写「寄到哪里、交多少费用，一律以 USCIS 官网 i-485 页面的 Filing 一栏为准」，不写具体地址、邮编、费用金额。**
原因：费用随 Form G-1055 调整，寄送地址按申请类别分（Direct Filing Addresses 页），写死就会过期。

## 两份 PDF（老板 2026-11-08 23:44 口径）

> 「不做往官方表前面插说明页了，改成分别下载两份 PDF」

| 文件 | 内容 | 页数 | 文件名 |
|---|---|---|---|
| **A** | 官方表 + 填值（选择题已填、隐私格留空） | 恒 27 | `I-485-填好-YYYYMMDD.pdf` |
| **B** | 填写说明（单独一页） | 恒 1 | `I-485-填写说明.pdf` |

### A 文件：官方表零插页

- **不插页、不删页**：`js/core.js` 的 `fillPdf()` 里已经没有 `addPage` / `removePage` / `insertPage` 路径；
  填值前后页数与 AcroForm 字段数必须不变，不变就报错不生成。
- **内容流不变**：`build/check-instructions.js` 逐页比 A 文件与 `vendor/fillvisa-i485/fillvisa_i-485-acro.pdf`
  的 content-stream sha256，27 页必须逐页相同（唯一允许的差异是字段 widget 的 `/AP` 外观流，内容流必须一致）。
- 字段仍为 748 个；PII（姓名 / SSN / 护照号…）仍为空。

### B 文件：填写说明（1 页 Letter）

- **纸张**：Letter 612×792 pt（与官方表同尺寸，本机打印不混纸）。
- **顶部安全边**：红条距页面上沿 ≥10mm（实测 12.19mm）—— 打印机不可打印区通常在 5–10mm，字压太靠上会被切掉。
- **内容**：
  - 顶部红条两行：`这份是填写说明，不是要提交的表格。` / `INSTRUCTIONS ONLY — NOT FOR SUBMISSION.`
  - 标题：`以下格子工具不会填：可以在电脑里键入，也可以打印后手写`
    （2026-11-09 改：原先写「需要你手写」，与完成页「可以在电脑里直接键入，也可以打印后手写」
    矛盾 —— B 文件可以键入，手写只是备选。单行 27 字 × 15pt ≈ 408pt < 可用宽 522pt，不换行。）
  - 12 行 Part 清单（315 格按 `data/handwrite.json` 归并成 12 个 Part，每行 = Part 名 + 类别 + 格数），不逐格罗列；
  - 底部两句：`其余格子已按你的答案填好，不要覆盖。` / `签名必须手写，盖章或打字的签名 USCIS 不接受。`
  - 本次答题标了「不确定」的题 > 0 时，末尾多一行：`另有 N 题你标了不确定，对应格子已留空，请先核对再提交。`（N=0 不出现）。

### 技术口径：中文在构建期烘好，运行时不再画

- **为什么不用 canvas**：运行时用 canvas 画中文要依赖客户设备装没装中文字体（字体不同排版会变），
  低端机还要背一张 35MB 的 canvas 位图。改成**构建期预渲染**：
  - `build/build-instructions.js` → `build/render-cover.py`（本机 Pillow + Noto CJK）
    → `assets/cover-instructions.png`（2550×3300，300dpi）+ `assets/uncertain-N.png`（13 张）；
  - 运行时只 `fetch` + `embedPng` + `drawImage`，**不再碰 canvas**；
  - `file://` 双击打开时 fetch 被拦 → 另有一份 `data/assets-b64.js` 内联版（构建期 `build/build-inline-assets.js` 生成）。
- **「另有 N 题…」整句**：N 只有 0–12 区间，构建期预渲染 0..12 共 13 张整句小图（每张几 KB），
  运行时按 N 贴对应那张；N=0 不贴；N>12 走 `uncertain-overflow.png`。
- **版面只有一处真相**：`js/instructions.js` 的 `buildLayout()` 产出纯 JSON 坐标，
  构建期渲染器（`build/render-cover.py`）照它出图。两边都按 `maxW` 兜底缩字。
- **失败不静默**：图片读不到 → B 文件生成报错，不出一份空白页。

## 手写格子清单（程序生成）

完成页「这些格子工具不会填，可以在电脑里直接键入，也可以打印后手写」不再手写维护，由 `build/build-questions.js` 生成：

- 口径：`所有 PDF 可填格 − 题库任一题「可能写入」的格 − 表单内部元数据（meta_form_name / meta_formdata）`；
- 产物：`data/handwrite.json`（核对用）+ `data/handwrite.js`（页面用，双击本地打开也能读到）；
- 按 Part 分组（Part 1 / 2 / 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 14），组名取表上印刷的题面，不再人工翻译；
- `build/check-handwrite.js` 双向核对：清单里任何字段不得出现在写入计划里、所有从不写入的用户字段必须在清单里，缺一个就 exit 1。

## 段/题导航（2026-11-09）

老板原话（2026-11-09 15:59）：「我希望有个导航栏，可以让我跳回去选第几段的第几题」。

两个入口，一个数据源：

1. **顶栏进度条第 N 小节可点** —— 点一下跳到第 N 段的第一道当前可见题。
   可点反馈只有 `cursor: pointer` + 按下态 `filter: brightness()` + 键盘 focus 描边，
   **不改配色体系**（小节本身的颜色仍由进度状态决定：已完成 `#1A56DB` /
   当前段 `#93AEE8` / 底槽 `#C7CDD6`）。
2. **顶栏「目录」按钮** —— 与「导出」并排（目录在左、导出在右），打开一页清单：
   - 8 段分组，每段标题 + 该段当前可见题数；
   - 每段下列出该段题目，编号用 **`段号-段内序号`**（如 `4-3`）；
   - 每行显示题面简写（截断到一行）+ 状态标记：**已答 / 未答 / 不确定**；
   - 当前所在题高亮（浅蓝底 + 编号加粗）；
   - **完成页（结果屏 / 拿表屏）也能打开目录**（fix3：`body.done #btnToc { display: inline-block; }`，
     同页的「导出」继续隐藏 —— 完成页已有拿表屏的下载主按钮）。
     完成页没有「当前题」概念，所以打开目录时**不高亮任何题**；点条目仍跳到该题并关面板。

### 编号口径（关键）

> **段内序号按「当前可见题」算**，与顶栏「本段已答 a / b」同一套算法。
> 原因：条件题跟着答案增减（例：第 1 段把 `i485_role` 选成「衍生申请人」会多出条件题），
> 用题库写死序号会跳错题。

这句话同时写进了目录面板里（`#tocPanel .toc-note`，用户看得到）。

**口径修正（2026-11-09 fix3）**：
brief 说顶栏「本段已答 a / b」与目录段内序号「同一套算法」。原先实测并不成立——
顶栏那行的**分母用的是题库静态题数**（21/15/27/23/21/28/21/17），
不是当前可见题数（如第 1 段静态 21 道、当前只可见 5 道）。
两套口径并存，**分母对不上**（顶栏说「本段已答 0 / 21」，目录里只列 5 道）。

fix3 已把 `renderDots()` 改成与目录**同一套算法**：`list().filter(q => seg.sections.indexOf(q.section) >= 0)`
（当前可见题），所以同一屏里顶栏分母 == 目录该段「N 题」。
顶栏分母随之从 21 变 5 这类数值变化**属于预期修正**。
验收：`build/check-nav-overflow.js` 的「C. fix3 硬验收」段（1/3/5/7 段各取一次 +
条件题联动后再取一次）；反向自测 N7 把 `renderDots()` 改回静态口径必须被验收脚本抓到。

### 行为约定

- 点任意一条 → 跳到该题，**关掉面板**，回到答题页，**滚动到顶部**。
- 面板开/关**不影响存档**（不改 `localStorage` 结构、不写新 key）、
  **不改变当前题**（除非点了某一条）。
- `ESC` 或点遮罩或点「×」可关。
- 只读数据源：`window.I485_QUESTIONS` + `window.I485_SECTIONS` + `list()`（可见题）。
  **不新造编号体系、不改 `data/questions.js`。**

## 窄屏横向溢出（2026-11-09 修）

**症状**：视口 320 / 360 / 375 / 390 时 `document.documentElement.scrollWidth` 恒为 **403**，
横向溢出；412 / 430 正常。

**定位**：罪魁是 `h2` 的 `word-break: keep-all`（`style.css` 原 198 行 / 384 行）。
`keep-all` 对中文等于**禁止在汉字间断行**，一道中英混排的超长题面会撑成一块不可断的单词块，
把 `#stage` 顶宽。

**改前实测**（`build/measure-overflow.js 320`，答案全空、107 道当前可见题）：

| 指标 | 改前 |
|---|---|
| 有横向溢出的题 | **64 / 107** |
| `scrollWidth` 范围 | 337 – 557（`clientWidth` = 320） |
| 最差溢出量 | **237px**（第 7 题 / 第 20 题） |
| 首例 | 第 1 题 `scrollWidth=403` vs `clientWidth=320` |

**改法**：两处 `keep-all` 一起改（L13-31 改一处即全盘扫同类）：

```css
h2 { word-break: normal; overflow-wrap: break-word; }        /* 原 keep-all */
.tier-head h3 { word-break: normal; overflow-wrap: break-word; }  /* 原 keep-all */
```

`word-break: normal` = 按语言正常断行（中文可任意断、英文按词断），
`overflow-wrap: break-word` = 超长无空格串兜底可断。

**改后实测**（同一命令、同一答案状态）：107 道题 **0 道溢出**，
`scrollWidth === clientWidth` 全部成立。

验收：`node build/check-nav-overflow.js`（6 档视口 × 4 个视图逐项断言）。

## 视觉（单色系 / 大字排版）

173 题按实际题量分成 8 段，页面底色统一 `#F6F7F9`，卡片恒纯白。
**2026-11-09 配色收敛**：8 段 `accent` 统一 `#1A56DB`、`bg` 统一 `#F6F7F9`
（字段结构保留，便于回滚）。段身份靠三处区分，**不靠颜色**：
① 切段深色横幅（`#12203A`，2 秒）② 顶栏「第 N 段 / 共 8 段 · 段名」文字
③ 进度条第 N 小节（小节位置 = 段号）。

进度条：已完成 `#1A56DB`、当前段未完成部分 `#93AEE8`、底槽 `#C7CDD6`。

**进度信息已合一**（2026-11-09）：原来四套并存（8 段进度条 + 段名 + 题号 + 每题一个圆点）。
现在只剩：8 段进度条 + 「第 N 段 / 共 8 段 · 段名」+ 「第 x 题 / 约 N 题」+ 「本段已答 a / b」。
圆点已删（第 6 段 28 个点会换行、顶栏多占 53px）。删后重算了 `fitStage()` 的 padding-top：

| 视口 | 顶栏高 | 舞台 padding-top | 题卡与顶栏间隙 |
|---|---:|---:|---:|
| 430×932 | 117px | 131px | 14px |
| 1280×900 | 116px | 140px | 24px |

分段表在 `app/sections.js`，规格与实测方法见上一级目录的 `DESIGN.md`。

```bash
# 分段统计自检（应为 21/15/27/23/21/28/21/17，合计 173）
node ../.shots/v2/check_segments.js
```

移动端规格：430×932 基准，正文 18px、题面 22px、按钮最小 56px 高、内容区底部留出底栏 + `safe-area-inset-bottom`。

### 标题字体（思源宋体子集，2026-11-10）

只有 `h1` / `.segmap-title` / `#segTitle` / `#doneTitle` 用宋体，正文、选项、英文行、
13–15px 小字一律保持系统黑体。字体是 **Noto Serif CJK SC SemiBold** 的子集
（SIL OFL 1.1，`fonts/OFL.txt` 随包），单字重 600，不做第二套字体。

```bash
cd app
python3 build/build-font-subset.py   # 改题库 / 文案后必须重跑：按全站实际用字重新抠字
node build/v9-font-accept.js         # D1–D9 验收（含 12 张截图 → .shots/v9-font/）
```

- 子集体积约 167KB（上限 300KB），覆盖全站 985 个唯一字，缺字 0。
- 字号补偿用截图实测：宋体 600 的字面高与黑体相同，但笔画墨量只有 73%；
  按「墨量最接近」选 24px 档（22→24），故 h1 26→28px、段名 20→22px。
- `file://` 下 Chrome 若拦截本地 woff2，`js/font-check.js` 会给 `<html>` 加 `.no-serif`，
  样式回落到系统宋体栈；HTTP(S) 下字体正常加载。

## 重新生成 / 验收

```bash
cd app
node build/build-questions.js     # 改 fieldmap / 文案后重新生成题库
node build/check-item-numbers.js  # 条目编号核对：9a 逐条编号 + 全库裸 item 重复（PASS 才继续）
node build/check-gates.js         # gatesChildren 与 cond 引用集合逐题一致（多/少都 exit 1）
node build/check-handwrite.js     # 手写清单与写入计划互斥且完备（缺/多都 exit 1）
node build/verify.js              # 生成 PDF 并做验收（PASS/FAIL）
node build/smoke-dom.js           # 无浏览器冒烟测试（含用例 G/H/I：两屏拆分 / Part 9 提示 / 进度合一）
node build/ux-v2-accept.js both   # UX v2 双视口逐屏验收（截图 + 非白占比 + 真下载读回）
node build/ux-v2-reverse.js       # UX v2 反向失败实测（故意改坏 5 处 → 验收脚本必须红）
node build/clean-rebuild-check.js # 干净目录重建比对（不比 md5，比页数/MediaBox/逐页文字/字段数）
node build/check-file-protocol.js # file:// 双击打开验证（内联 b64 兜底 + 控制台 0 报错）
node build/check-uncertain.js     # 新增用例：标记 3 题不确定 + 完成页档位 + PDF 读回 + 旧存档兼容
node build/build-instructions.js  # 构建期预渲染说明页 PNG（整页 + 13 张不确定小图）
node build/build-inline-assets.js # 把说明页 PNG 内联成 data/assets-b64.js（file:// 双击用）
node build/check-instructions.js  # 两份 PDF：A 27 页零插页 + 内容流逐页一致 / B 1 页 Letter / 安全边 / 非白占比
node build/check-instructions-reverse.js # 反向自检：把 drawImage 改成贴页顶 → check-instructions 必须 exit 1
node build/check-flatten.js      # flatten:true 路径专项（不抛错 + 反向自检）
node build/check-reverse.js       # 反向失败实测：故意改坏 → 验收脚本必须 exit 1
node build/build-instructions-layout.js  # 只出 layout JSON（--uncertain N 可指定 N）
node build/build-src-zip.js       # 重新打包 deploy/source/i485-web-src.zip（AGPL §7 源码包）
node build/browser-two-files.js mobile   # 真浏览器：两个按钮各真下载 → A 27 页 / B 1 页
node build/browser-uncertain-n.js mobile # 真浏览器：标 3 题不确定 → 说明页里的 N = 完成页条数
node build/shots-v4.js            # 视觉截图（430×932 / 1280×900 → .shots/v4/）
node build/check-abbrev.js        # 国名短写自检（>9 字符 0、截断 0、重名 0）
node build/check-pdfsafe.js       # PDF 标准字体可写字符自检
node build/live-accept.js mobile  # 线上真下载 + 读回（含非 favicon 404 计数）
node build/live-accept.js desktop # 线上真下载 + 读回（含非 favicon 404 计数）
node build/final-accept.js mobile  # 真实浏览器全流程（430×932）
node build/final-accept.js desktop # 真实浏览器全流程（1280×900）
node build/browser-export-anytime.js mobile  # 「随时导出」验收（顶栏坐标 + 第 5/50 题真下载 + 取消路径）
node build/browser-export-anytime.js desktop # 同上（1280×900）
node build/check-export-anytime-reverse.js   # 「随时导出」反向失败实测（改坏 9 处 → 验收脚本必须红）
node build/check-handoff-partial-copy.js     # 半成品拿表屏文案（🔴 4 个串 partial 屏 0 命中 / 完整屏必须仍在）
node build/check-handoff-partial-copy-desktop.js  # 同上（1280×900 + 两屏截图）
node build/check-topbar-narrow.js            # 窄屏顶栏几何（320/430 × 2× 字号）
node build/check-fix2-pdf-downloads.js       # 真下载 4 份 PDF + poppler/qpdf 独立读回
node build/pdf-fields.js <file.pdf>          # qpdf 读下载件 AcroForm 字段值（独立于 pdf-lib 的复核工具）
python3 build/build-font-subset.py           # 重建标题字体子集（改题库后必跑）
node build/v9-font-accept.js                 # 标题字体验收 D1–D9（截图 → .shots/v9-font/）

# 线上复跑（不启本地 server）
CU_BASE=https://i485-check.vercel.app/?debug=1 node build/check-uncertain.js
LA_BASE=https://i485-check.vercel.app/?debug=1 node build/live-accept.js mobile
LA_BASE=https://i485-check.vercel.app/?debug=1 node build/live-accept.js desktop
TF_BASE=https://i485-check.vercel.app/?debug=1 node build/browser-two-files.js mobile
TF_BASE=https://i485-check.vercel.app/?debug=1 node build/browser-uncertain-n.js mobile
```

验收口径（脚本 PASS 不等于能用）：

1. 两个视口都要走完完整流程，不能只跑前几题。
2. 必须**真的点下载并落盘**，再打开下载下来的那份 PDF 读值，不能拿 `build/out` 的产物代替。
3. 交付前必查：有值字段数、姓名/SSN 必须为空、代表性字段读回值、渲染后文字不被框切、控制台 error 数、**非 favicon 的 404 数**、页脚与底栏不相交。
4. **每个验收脚本都要能反向失败**：`build/check-reverse.js` 会故意改坏产物（插页 / 换坏模板 / 空白图 / 缩安全边 / 删小图），
   断言验收脚本必须 exit 1。脚本自己能红，才允许写进交付报告。
5. 表版本每次发版前回 USCIS 官网核一次，版本一换整表作废。
6. **完成页已拆两屏**：下载按钮在拿表屏（`#view-handoff`）。
   验收脚本点 `#btnPdf` / `#btnInstr` 之前必须先 `goHandoff(page)`（`build/handoff.js`），
   否则点不到按钮 —— 11 个既有验收脚本已统一改完（2026-11-09）。

## 已知限制

- iOS Safari / Android 真机触摸未测（目前只验证过桌面 Chrome 与 headless Chrome）。
- 未在 Adobe Acrobat 里打开验证（只用 pdf-lib + poppler 验过）。
- 静态托管尚未落地：双击 `index.html` 或本机 `http.server` 都可用；重启机器服务就没了。

## 许可与署名

- 底图与字段映射来自 `fillvisa-os`（AGPL-3.0），改动与分发按 AGPL 走。
- 依 AGPLv3 第 7 条加保留署名要求：任何衍生版本必须保留原作者与 **Chenbin Yu** 的署名。
- `pdf-lib` 为 MIT，见 `libs/pdf-lib.LICENSE.md`。
