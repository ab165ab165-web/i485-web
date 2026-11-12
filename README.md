# I-485 中文填表助手（MVP）

一页一题的中文问卷，答完在**本地**生成填好的官方 I-485 PDF（09/18/26 版）。
无后端、无框架、无 CDN、不联网。

**定位：查验工具，不是代填工具。** 它做的是把「你会不会有麻烦」逐条问清楚、落到表上；
姓名、地址这些格子保持空白，由客户自己手填。

## 怎么打开

**直接双击 `index.html`** 就能用：PDF 模板已经内联，`file://` 下也能正常生成。
也可以起一个本地静态服务：

```bash
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

在线版：https://i485-check.vercel.app

## 目录

```
index.html              页面骨架（开始页 / 答题页 / 完成页两屏：结果屏 + 拿表屏）
style.css               样式（单色系 + 大字排版，移动优先）
theme.css               配色变量（三套皮肤）
sections.js             八段分段表：段名 / 底色 / 强调色 / 包含哪些 section（视觉层唯一事实源）
app.js                  问卷 UI：一题一屏、分段、进度、条件题、localStorage 存档、生成两份 PDF
render.js               排版层（答案核对页渲染）
js/core.js              共享核心：条件 DSL 解释器 + 答案→PDF 写入（浏览器/Node 同一份）
js/instructions.js      填写说明页的版面定义 + 运行时资产清单
js/font-check.js        字体加载自检
data/questions.js       题库（约 107 题 / 8 段）
data/template-b64.js    官方 I-485 PDF 模板（内联 base64）
data/assets-b64.js      说明页所需图片资源（内联 base64）
data/handwrite.js       手写提示文案
libs/pdf-lib.min.js     pdf-lib 1.17.1（本地，无 CDN）
libs/pdf-lib.LICENSE.md
assets/                 界面用图（说明页封面、图标）
fonts/                  标题字体子集（woff2）
NOTICE.md               第三方来源与许可说明（fillvisa-i485，AGPL-3.0）
LICENSE                 AGPL-3.0
```

题库生成脚本、验收脚本等项目工具链不在本仓发布范围内。

## 许可与署名

- 底图与字段映射来自 `fillvisa-os`（AGPL-3.0），改动与分发按 AGPL 走。
- 依 AGPLv3 第 7 条加保留署名要求：任何衍生版本必须保留原作者与 **Chenbin Yu** 的署名。
- `pdf-lib` 为 MIT，见 `libs/pdf-lib.LICENSE.md`。
