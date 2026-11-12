# NOTICE — 第三方来源与许可

本目录（`i485-web/app/`）包含从下列项目派生的内容。**上游文件未被修改**。

## 1. fillvisa-os（AGPL-3.0）

- 项目：fillvisa-os
- 仓库：https://github.com/athos2113/fillvisa-os
- 分支：main
- 下载时提交：`e7328ca4deb07b9d7932ee7df6a85b51be7907c9`（2026-11-02T05:23:32Z）
- 许可：**AGPL-3.0**

原始文件原样保留在 `../vendor/fillvisa-i485/`（本项目的 `app/` 不复制、不改写它们）。

本 `app/` 中由上游派生的内容：

- `data/questions.js`：由 `../fieldmap.json`（解析自上游 18 个问卷页、19 个 map JS、
  `download.html` 与 AcroForm PDF）+ 上游 HTML 里的 `id`/`name`/`label` +
  本项目 `../../i485-tutorial/文案-期3-Part9-14-v3.md` 的中文文案**自动生成**。
- `assets/fillvisa_i-485-acro.pdf`：上游 `vendor/fillvisa-i485/fillvisa_i-485-acro.pdf`
  的**逐字节副本**，仅作为「从 app/ 单目录启动」时的兜底；运行时不改动它。
  sha256 与原件一致：`330a28d41e8b6ff1f6ab6b90363836dd74ddcfbc25c86d9a8c7cb57c2490f7e2`。

因为上游是 AGPL-3.0，**本目录的派生部分同样按 AGPL-3.0 分发**。若要对外提供服务（SaaS），
需按 AGPL 提供对应源码。仅供个人填表使用时不必发布。

## 2. pdf-lib 1.17.1（MIT）

- 项目：pdf-lib — https://github.com/Hopding/pdf-lib
- 文件：`libs/pdf-lib.min.js`（npm 包 `pdf-lib@1.17.1` 的 `dist/pdf-lib.min.js`，未改动）
- 许可：MIT，全文见 `libs/pdf-lib.LICENSE.md`

## 3. 表格本身

- USCIS Form I-485（Edition 09/18/26），美国政府表格，属公共领域。
  本地可填版（AcroForm 化）来自上面第 1 项。
