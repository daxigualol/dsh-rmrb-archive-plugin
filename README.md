# 人民日报 PDF 存档

在 DeepSeek Harness 的左侧栏加一个「人民日报」入口：选好日期，它会从
[人民网电子版](https://paper.people.com.cn/rmrb/) 抓取《人民日报》各版 PDF，
合并成每天一份，按月份归档，并把缺版的日子整理成清单。

> 适用于 DeepSeek Harness **0.2.1-rc.5 或更新版本**。抓取与合并都在本机完成，文件保存到你指定的目录。

## 它能给你什么

- **每天一份完整的报纸**：`20251202.pdf`，当天全部版面按顺序合并，带标题与作者信息。
- **按月份整理好的目录**：`202512/20251201.pdf`，按年翻查不用逐个日期点开。
- **缺版说得清楚**：某天少了几版，会保留分版 PDF 并写下缺哪几版，最后汇总成一段说明。
- **随时能停**：下载在后台进行，停止后已完成的日期不受影响。

## 安装

**在应用里装（推荐）**：打开侧栏的**插件**面板（或「设置 → 插件」），点**添加插件**，把下面这行粘进去：

```
github:daxigualol/dsh-rmrb-archive-plugin
```

也可以直接对智能体说「装上 github:daxigualol/dsh-rmrb-archive-plugin」，它走的 `install_bundle` 是同一套流程。

**命令行安装**（需要先把 DeepSeek Harness Desktop 完全退出）：

```bash
dsh plugin add github:daxigualol/dsh-rmrb-archive-plugin

# 固定到已验证的提交：
dsh plugin add git+https://github.com/daxigualol/dsh-rmrb-archive-plugin.git#10bd45b
```

装好后左侧栏会多出一个报纸图标 **人民日报**，点开就是面板。

**卸载**：在**设置 → 插件**里打开「人民日报」→ 卸载；命令行同样需要先退出应用：
`dsh plugin remove @daxigualol/rmrb-archive`。

## 开始使用

1. 点侧栏的「人民日报」。
2. 选**开始日期**和**结束日期**（默认都是今天，点「今天」可一键回到当天）。
3. 确认**保存目录**（默认是 `文档\人民日报存档`，可以直接改成别的路径）。
4. 按需要勾选选项（见下表）。
5. 点「开始下载」。日志会逐版刷新，随时可以点「停止」。

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| 合并为每日单份 PDF | 开 | 把当天各版合成一个 `merged.pdf`；关掉则只留分版 PDF |
| 按月份整理 | 开 | 完成后移动为 `YYYYMM/YYYYMMDD.pdf` |
| 校验版次并记录缺失 | 开 | 对比版面清单与实际下载，缺版时写 `missing.txt` |
| 版次完整时删除分版 PDF | 开 | 只在「合并」和「校验」都开启、且当天没有缺版时，删掉分版只留合并件 |

下载过程中，进度条显示当前是第几天、第几版；下方的结果表按日期列出成功/失败、
已下载版数和缺失版次。

## 用一句话让智能体去做

不用打开面板也能下：

> 下载 2025 年 12 月 1 日到 12 月 7 日的人民日报 PDF

智能体会调用 `rmrb_archive` 工具，和面板共用同一个任务，所以两边看到的是同一份进度。
也可以问「人民日报下载到哪了」，或者让它停止。工具参数：

| 参数 | 说明 |
| --- | --- |
| `action` | `start` 开始、`status` 查进度、`cancel` 停止 |
| `startDate` / `endDate` | 日期范围，`YYYY-MM-DD` |
| `outputDir` | 保存目录，省略则用面板里的默认目录 |
| `merge` / `groupByMonth` / `cleanup` | 对应面板上的同名选项（版次校验始终开启） |

## 文件放在哪

```
人民日报存档/
├─ 202512/                  # 版次完整的日期，按月整理
│  └─ 20251202.pdf
├─ 20251201/                # 有缺版的日期：保留分版 PDF 与 missing.txt
│  ├─ 01版_要闻.pdf
│  ├─ 02版_要闻.pdf
│  └─ missing.txt           # 缺失的版次，一行一个，如 "16"
├─ missing/                 # 各日缺失清单的汇总
│  └─ 20251201.txt
└─ 缺失说明.txt             # 可读的缺版说明，可直接用于发布说明
```

- 文件名沿用「版面号 + 版面名」，例如 `01版_要闻.pdf`；
- `merged.pdf` 与 `missing.txt` 的命名和常见的整理脚本兼容；
- 默认目录在各系统的「文档」下：Windows 为 `%USERPROFILE%\Documents\人民日报存档`。

## 常见问题

**一次最多能下多少天？**
一个任务最多 62 天（含首尾）。超过会在开始前直接提示，不会悄悄截断。更长的区间请分几次下，
并且**等上一次跑完再开始下一次**。

**能同时跑两个任务吗？**
不能。同一时间只允许一个任务，第二个会提示「已有任务在运行，请先停止或等待完成」。

**重复下载同一天会怎样？**
会覆盖当天已有的同名文件（分版 PDF 与合并后的 PDF），适合重新抓一遍。

**某天缺了几版怎么办？**
那天会保留分版 PDF，并在 `missing.txt` 里写明缺的版次，任务最后汇总到 `缺失说明.txt`。
补抓时直接重跑那一天即可。注意：`缺失说明.txt` 的固定文案写的是「均为广告版」，
若缺失的并非广告版，请以 `missing/` 里的清单为准。

**面板报 401 / 403？**
面板接口只接受本机、同源的页面请求。通过远程地址或反向代理访问时会被拒绝，这是有意的限制。

**下载失败或很慢？**
站点偶发限流时会自动重试一次；仍失败只影响那一天，其余日期照常完成。隔一会儿重跑失败的那天即可。

**很久以前的日期能下吗？**
2024-12-01 起使用新版页面入口；更早的日期走旧版入口，页面结构可能不同，解析成功率不保证。

## 权限与隐私

- 只访问 `paper.people.com.cn`，不经过任何第三方服务；
- 下载的内容只写到本机你指定的目录，不上传、不统计、不采集；
- 面板接口仅对本机同源页面开放，远程访问会得到 401/403。

## 版权与免责声明

- 《人民日报》电子版内容（文字、图片、PDF 等）版权归人民网及权利人所有。本插件仅用于
  个人学习与研究，请遵守目标站点的服务条款、robots.txt 及适用法律。
- 本插件不提供、不分发任何报纸内容，只做本机抓取与整理。
- 流程移植自以 CC0 1.0（公共领域）发布的 `renminribao-1.4`，在此致谢原作者。
- PDF 合并使用随包内置的 [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1（MIT）。

## 开发者附录

<details>
<summary>实现结构、参考实现对照、发布注意事项</summary>

**结构**

| 路径 | 作用 |
| --- | --- |
| `index.js` | Host 半部：注册 `/rmrb/api` 接口与智能体工具 |
| `lib/engine.js` | 抓版面 → 下载 → 合并 → 版次校验 → 按月归档 → 缺版清单 |
| `lib/jobs.js` | 单任务仓库，面板与工具共享 |
| `lib/routes.js` | 同源 HTTP 接口，授权交给 Connection 的 `requestRejection()` |
| `lib/tool.js` | `rmrb_archive` 工具 |
| `client.js` | 浏览器半部：`sidebar.panellist` 图标 + `main` 面板页 |

**参考实现对照**：`generateLinks.js`→`eachDate/pageUrlFor`、`fetchPageData.js`→`fetchDay`
（正则替代 cheerio）、`downloadPDF.js`→`downloadToFile`、`mergePDFs.js`→`mergePdfFiles`、
`check-folders.js`→缺版校验与清理、`rename-and-group-by-month.js`→`groupByMonth`、
`collect-missing.js`→`collectMissing`、`missing_notice.js`→`buildMissingNotice`、
`run.js`→逐日循环与 1.2 s 间隔。

**改包名时要同步三处**：`package.json` 的 `name`、`cordis.patch.yml` 的 `insert[].name`、
`client.js` 里 `__ModuleLoader__.load({ id })`。三者不一致会导致安装后不激活。

**发布检查**：`engines.dsh` 为 `>=0.2.1-rc.5`；`pnpm pack` 后确认
`vendor/pdf-lib.min.cjs`、`locale/`、`icon.svg` 都在包里；仓库根目录必须同时有
`package.json` 与 `cordis.patch.yml`。

</details>
