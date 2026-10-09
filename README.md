# 早间新闻

静态中文电子报。每一期是一份 Hacker News 中文晨报：头版加各版面，可以在浏览器里翻页。

拖页面左缘或右缘，纸会跟着指尖卷起来；松手时过了中线就翻过去，否则弹回。点「上一版 / 下一版」、按左右方向键，或从左侧「目录」打开版面目录再选一版，也会播放同一段卷页。目录默认收起，报纸占满版心；点遮罩、再点「目录」、按 Esc，或选中某一版，都会关上。系统开了「减少动态效果」时，翻页立刻切换，目录也不滑动。

构建结果是纯静态文件（`dist/`），不请求任何外部脚本、字体或统计服务。

## 环境

- Node.js 22.12 或更高
- npm

```bash
npm install
```

## 本地预览

```bash
npm run dev
```

开发服务器监听 `4329` 端口。默认子路径是 `/hn-preview/`，所以首页在：

`http://127.0.0.1:4329/hn-preview/`

## 新增一期

每一期是 `src/content/issues/` 里的一个 JSON 文件，文件名就是日期：

```text
src/content/issues/YYYY-MM-DD.json
```

`date` 字段必须和文件名一致。字段、可选的评论金句和今日数字都写在 [docs/issue-schema.md](docs/issue-schema.md)，由 `src/content.config.ts` 校验。缺了的可选字段不会渲染。页面上的数字写成「120 点赞 / 45 评论」「3 条回复」，不用「分」或「评」单独作单位。

期号按日期从早到晚，从现存第一期数起（第 1 期、第 2 期……）。删掉中间某一期后，后面的期号会重排。仓库里的 `2026-10-06.json` 和 `2026-10-07.json` 是 `dummy: true` 的占位，只为了试往期目录和翻页，不需要时直接删除。

改完 JSON 并推到 `main` 之后，不用在服务器上手动构建。GitHub Actions 会编译并发布。

## 每天怎么上线

1. 每日任务把当天的晨报写成 `src/content/issues/YYYY-MM-DD.json`，提交并推到 [yiningle/morning-news](https://github.com/yiningle/morning-news) 的 `main`。
2. 推送触发 `.github/workflows/deploy.yml`（也可以在 Actions 里手动跑一次）。
3. CI 用 Node 24 执行 `npm ci`，再以 `BASE_PATH=/hn/` 执行 `npm run build`。
4. 工作流把 `dist/` 里的文件打成 tar，经 SSH 解到服务器的 `/var/www/html/.hn-new`，再把现有的 `/var/www/html/hn` 挪到 `/var/www/html/.hn-old`，最后把新目录换成 `/var/www/html/hn`。nginx 配置不动。

线上地址是 `http://43.156.61.11/hn/`。首页是最新一期，往期在 `/hn/archive/`，单期在 `/hn/YYYY-MM-DD/`。

仓库需要这三个 Actions secrets，工作流只读它们，不会写进日志以外的文件，也不会改 nginx：

| Secret | 内容 |
| --- | --- |
| `VPS_HOST` | `43.156.61.11` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | 能登录该用户的私钥 |

## 按子路径构建

所有页面和资源链接都带 `BASE_PATH`。不设置时默认是 `/hn-preview/`，方便本地试看。生产构建固定用 `/hn/`。

```bash
# 本地默认，产物准备挂到 /hn-preview/
npm run build

# 和生产一致
BASE_PATH=/hn/ npm run build

# 挂在域名根上
BASE_PATH=/ npm run build
```

末尾的 `/` 可有可无。`astro build` 把文件写到 `dist/`。`BASE_PATH` 必须和浏览器里的 URL 前缀一致；只改目录名、不重新构建，CSS、字体和页面链接仍会指向旧前缀。

## 字体

版面使用自行托管的 Noto Serif SC（思源宋体 / Source Han Serif 的 Google 发布名）和 UnifrakturMaguntia（报头 “The Morning News”，取自 Fontsource 5.3.0）。两者都是 SIL Open Font License 1.1。授权文本在 `src/fonts/OFL.txt`，构建后也会复制到 `dist/fonts-license.txt`。

仓库里通常已经带好 `src/fonts/*.woff2`。如果检出里没有这些文件，`node scripts/ensure-fonts.mjs` 会按 SHA-256 从 Fontsource 5.3.0 下载同一批字体。生产构建前会先跑这个脚本。
