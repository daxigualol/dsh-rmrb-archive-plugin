# 人民日报 PDF 存档（DSH 插件）

给 DeepSeek Harness 的 Web GUI 增加一个左侧栏入口「人民日报」：按日期区间从
[paper.people.com.cn](https://paper.people.com.cn/rmrb/) 抓取《人民日报》各版 PDF，
合并为每日一份、按月份归档，并把缺版情况整理成清单。

逻辑移植自上游参考实现 `renminribao-1.4`（CC0 1.0，作者已停止维护）。

## 功能

- **左侧栏入口**：`sidebar.panellist` 中注册 `rmrb-archive`，点击后打开 `main` 插槽里的面板页。
- **面板页**：日期区间、保存目录、四个开关（合并 / 按月整理 / 版次校验 / 清理分版），
  开始与停止按钮，实时进度条与日志，以及逐日结果表。
- **智能体工具 `rmrb_archive`**：`action=start|status|cancel`。面板与工具共用同一个
  Host 端任务仓库，所以模型看到的就是面板上的同一份进度。
- **Host 半部**：真正的抓取、下载、合并、归档；浏览器只做展示。
- **停机保护**：同一时间只允许一个任务；单日失败不影响其余日期；随时可停止。

## 参考实现对照

| 参考文件 | 本插件 |
| --- | --- |
| `generateLinks.js` | `lib/engine.js` 的 `pageUrlFor()` / `eachDate()`（2024-11-30 及以前走旧版入口） |
| `fetchPageData.js` | `fetchDay()`、`extractPageLinks()`、`extractPdfUrl()`、`extractPublishDate()`（正则替代 cheerio） |
| `downloadPDF.js` | `downloadToFile()`（先写 `.tmp` 再改名，校验 `%PDF` 魔数） |
| `mergePDFs.js` | `mergePdfFiles()`（内置 pdf-lib，替代 `pdf-merger-js`，同样写入元数据） |
| `check-folders.js` | `archiveDay()` 的缺失序号校验 + `missing.txt` + 无缺失时清理分版 |
| `rename-and-group-by-month.js` | `groupByMonth()`（`merged.pdf` → `YYYYMM/YYYYMMDD.pdf`） |
| `collect-missing.js` | `collectMissing()`（`YYYYMMDD/missing.txt` → `missing/YYYYMMDD.txt`） |
| `missing_notice.js` | `buildMissingNotice()` / `readMissingEntries()`（生成 `缺失说明.txt`） |
| `run.js` | 面板与工具的参数、逐日循环与 1200 ms 间隔 |

## 输出结构

```
人民日报存档/
├─ 20251201/               # 版次不完整时保留分版 PDF 与 missing.txt
│  ├─ 01版_要闻.pdf
│  └─ missing.txt          # 内容为缺失版次，如 "19"
├─ 202512/                 # 版次完整且按月整理
│  └─ 20251202.pdf
├─ missing/                # 收集到的缺失清单（按日期）
│  └─ 20251201.txt
└─ 缺失说明.txt            # 缺失汇总文案
```

默认目录是**用户文档目录下的 `人民日报存档`**（Windows 为 `%USERPROFILE%\Documents\人民日报存档`）；
面板里可以改成任意路径，相对路径按默认目录解析。
`missing.txt`、`merged.pdf` 等文件名与参考实现保持一致，原有整理脚本仍可继续使用。

## 安装

三种来源效果相同，都会写进 profile 的 bundle 列表。

**1. 本地目录（开发 / 自用）**

```bash
plugin_manager install_bundle  target: D:\path\to\rmrb-archive-plugin
# 命令行等价写法：dsh plugin add D:\path\to\rmrb-archive-plugin
```

**2. GitHub（推荐用于分享）**

```bash
dsh plugin add github:daxigualol/dsh-rmrb-archive-plugin
# 固定到某个 commit，避免分支头漂移：
dsh plugin add git+https://github.com/daxigualol/dsh-rmrb-archive-plugin.git#<commit-sha>
```

让智能体安装时用 `plugin_manager install_bundle target: "github:daxigualol/dsh-rmrb-archive-plugin"`。
安装后左侧栏出现「人民日报」图标，插件管理器里显示标题、描述与图标；
卸载用 `plugin_manager remove_bundle` 或 `dsh plugin remove`。

**3. npm（发布后）**

```bash
dsh plugin add dsh-rmrb-archive@1.0.0
```

> 当前包名是 `@daxigualol/rmrb-archive`。发 npm 时若要在该 scope 下发布，需先在 npm 创建
> `@daxigualol` 组织；否则改用无 scope 的 `dsh-rmrb-archive`。

## 分发（GitHub / npm）

仓库根目录就是包根目录：`package.json`、`cordis.patch.yml`、`index.js`、`client.js` 都必须在根上。
**包名出现在三个地方，改名时必须同步**：

| 位置 | 字段 |
| --- | --- |
| `package.json` | `name` |
| `cordis.patch.yml` | `insert[].name` |
| `client.js` | `__ModuleLoader__.load({ id })` |

`repository` 指向 <https://github.com/daxigualol/dsh-rmrb-archive-plugin>，`LICENSE` 署名为
`daxigualol`。`engines.dsh` 声明为 `>=0.2.1-rc.5`，低于该版本的 DSH 会拒绝安装。
检查打包内容（确认 `vendor/pdf-lib.min.cjs`、`locale/`、`icon.svg` 都在）用：

```bash
pnpm pack
```

## 接口与安全

面板通过同源 HTTP 接口工作：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/rmrb/api/defaults` | 默认日期、默认输出目录、最大天数 |
| GET | `/rmrb/api/state?since=N` | 任务快照 + 增量日志 |
| POST | `/rmrb/api/start` | 启动任务（`content-type: application/json`） |
| POST | `/rmrb/api/cancel` | 停止任务 |

授权交给 Host 的 Connection 服务 `requestRejection()`：它执行 Host/Origin 检查与浏览器
凭据校验，远程或未认证的请求得到 401/403。没有 Web 载体的组合里，接口按本地同源处理。
面板只对本机同源页面开放，不依赖任何第三方 CDN 或外部脚本。

## 依赖与许可

- 仅使用 Node 内置模块；PDF 合并使用随包内置的 `vendor/pdf-lib.min.cjs`
  （pdf-lib 1.17.1，MIT，许可证见 `vendor/pdf-lib.LICENSE.md`），不依赖 pnpm 安装。
- 抓取内容版权归人民网及权利人所有。本插件仅用于个人学习与研究，请遵守目标站点
  的服务条款、robots.txt 与适用法律。
