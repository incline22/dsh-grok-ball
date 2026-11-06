# dsh-grok-ball

DSH 界面上的 Grok Ball 表情球挂件：圆球 + 一双会跟着鼠标看的眼睛，按 DSH 的运行状态换表情，可拖动，点一下有反馈。

表情引擎来自 [tycoding/grok-ball](https://github.com/tycoding/grok-ball)（MIT，纯 SVG、零运行依赖），本仓库把它接进 DSH 的客户端插件体系。

## 它现在会做什么

| DSH 状态 | 表情 |
| --- | --- |
| 空闲 / 没有进行中的会话 | `02` 待机放空 |
| 一轮回复刚开始 | `31` 接收任务（0.65 秒） |
| 正在跑（`running`） | `30` 思考中 |
| 需要你回答 / 授权（`pendingInteraction`） | `35` 等待输入 |
| 一轮刚跑完 | `33` 任务完成 + 撒花（2.6 秒） |
| 点一下球 | `10` 开心 + 自旋甩彩带 + 弹跳（0.8 秒） |

- 眼睛实时跟随鼠标（`setGaze`）。
- 拖动摆位，位置记在 `localStorage` 的 `dsh-grok-ball:pos`，窗口缩放时自动夹回可视区。
- 没有面板、不发指令：就是一只会看人、会庆祝的小球。
- 挂载在 `shell.overlay` 槽位（`order: 950`），只有球本身接收指针事件，不挡聊天。

## 安装

```powershell
dsh plugin --profile web add dsh-grok-ball
```

本地开发也可以先 link 自己的目录（profile 名按你实际用的填）：

```powershell
dsh plugin --profile desktop add "link:E:\Grok Ball"
```

装完需要重启 DSH（插件市场里的「重启」或关掉重开），新插件才会进宿主组合。

## 卸载

```powershell
dsh plugin --profile web remove dsh-grok-ball
```

## 结构

```
package.json           # dsh.bundle.patch + dsh.client 声明
cordis.patch.yml       # 把插件 insert 进 profile 层栈
lib/index.js           # 宿主半边：空 apply（只为让 bundle 能挂载）
lib/client.js          # 浏览器半边：__ModuleLoader__ 包装 + 内联引擎 + 挂件逻辑（构建产物）
src/client-src.js      # 浏览器半边的可读源文件
vendor/grok-ball.js    # 上游引擎，未修改
scripts/build.mjs      # 把 vendor 引擎塞进 src 里的占位符，产出 lib/client.js
scripts/smoke-test.mjs # 无浏览器烟测：DOM/React 桩 + 状态映射断言
preview.html           # 纯前端预览页，不依赖 DSH
```

## 开发

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node scripts/build.mjs      # 改完 src/client-src.js 或换引擎后重新生成 lib/client.js
& $node scripts/smoke-test.mjs # 无浏览器烟测
```

改完 `lib/client.js` 后刷新页面即可（client-modules 按 mtime 热读 bundle）；新增/移除插件才需要重启宿主。

## 状态从哪来

浏览器半边通过 `ctx.inject(['slots', 'uiSession'], …)` 拿到 `uiSession`，订阅：

- `uiSession.adapter.current`：当前会话绑定（`key` / `props.sessionId`）；
- `uiSession.sessionStatus`：`Map<sessionId, { running, pendingInteraction, completionUnread }>`。

「任务完成」由插件自己观察当前会话的 `running: true → false` 得出（主会话的 `completionUnread` 会被宿主清掉，所以不依赖它）。

## 许可

MIT。引擎版权归 tycoding（见 `vendor/LICENSE` 与根目录 `LICENSE`）。
