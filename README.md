# dsh-model-drag — DSH 模型拖拽排序插件

在 DeepSeek Harness (DSH) 的模型选择菜单（输入框右下角模型选择器）里：

- **按住模型行拖动** → 组内排序：跟手 1:1 移动、其余行弹性让位、松手平滑落位
- **按住分组标题拖动** → 整组移动：例如把 OpenAI-Flex 组拖到 DeepSeek 组正下方，
  标题与组内所有行一起走，其他组变暗让位
- 顺序自动保存（行序与组序分开记忆），重开菜单 / 重启应用 / 菜单重渲染后依然保持
- **打开菜单自动定位**：滚动到当前选中的模型所在位置（v1.5.0 重构：拦截
  `scrollIntoView`——DSH 夹书签的动作触发时，先同步应用保存的顺序，再让
  原生滚动落在选中行的新位置上。重排被精确插入"摆书"与"夹书签"之间，
  同步执行、零竞态、零闪烁；v1.5.1 起定位完全复用 DSH 原生的 nearest
  书签——重排后原生落点天然正确，插件不做任何额外定位。注意：选中行为
  组首行且原生落点贴视口顶时，DSH 原生行为会让 sticky 标题盖住该行——
  这是 DSH 原生定位的固有表现，插件不再修正（v1.7.1 决策））

## 架构（v2.0.0 事件驱动重构）

引擎（`engine.js`）按职责分层，行为规则全部数据化：

| 模块 | 职责 |
|---|---|
| `CONFIG` | 全部可调参数（阈值、时长、缓动、z 层级、存储键），改手感只动这里 |
| `CONTRACT` | 稳定 DOM 契约作为数据——引擎所有选择器的唯一出处 |
| `Dom` | 契约上的查询原语（行/组判定、键、兄弟集合、滚动视口） |
| `Storage` | 持久化 + 数据消毒（损坏 JSON / 越权类型一律回退默认） |
| `Layout` | 纯几何：不等高单元的最终布局位移模拟、槽位中点、拖拽边界（无副作用，可独立测试） |
| `flipToRest` / `AutoScroller` | FLIP 落位动画（令牌防竞态）/ 定时器驱动自动滚动 |
| `ClickGuard` | 点击拦截，跟随拖拽生命周期（代际令牌防快速连拖竞态） |
| `RowPolicy` / `GroupPolicy` | 每种拖拽模式的统一规则接口（命中、建单元、采集、跟随、中心、持久化）；新增模式只需实现接口 |
| `Session` | 指针状态机 PRESSED → READY → DRAGGING；唯一结构事件 `onStructureChanged`——宿主中途重排/摘除节点由此送达（重锚定继续拖 / 干净终止），绝不轮询 |
| `Host` | 每次安装的控制器：一条指针路由、一个结构观察器（活动会话→结构事件，否则→重放）、`gate` 统一异常规则（任何抛错走同一终止路径，不可能留僵尸会话）；终端路径（settle/release/abort）自注销 |
| `Replay` | 保存顺序回放（MutationObserver 驱动，最小写入，`UNRANKED` 具名哨兵） |

事件纪律：指针事件驱动几何，MutationObserver 驱动结构——高频指针路径从不
重读 DOM"核对"宿主变化；每条终端路径自行注销 `Host.active`。

稳定性措施：存储消毒、样式标签去重、`gate` 单一异常规则覆盖指针/观察器/自动滚动、
dispose 任意时刻可安全调用（含拖拽中途）、会话抛错自动清理不污染页面。

## 已验证场景（v1.7.1，含致命修复）

- DSH 0.2.1-rc.5（Windows x64，Web 界面与桌面端共用同一前端构建），
  临时 profile `temp-drag` 启动的真实 DSH 界面 + 临时复刻页各跑一轮
- 行拖拽：换位 / 跨三位跳拖 / 跟手 0px 误差 / pointercancel 回弹
- 组拖拽：OpenAI-Flex 整组从末位移到 DeepSeek 下方（跨两位）/ 行随组完整迁移
- 真实鼠标链路（v1.1.1 修复）：按住标题拖动曾会被"文本选择/原生拖放"手势劫持
  （合成事件测试测不到这条管线），现已在 pointerdown 掐断手势并禁选标题文本；
  真实输入下按下→捕获→跟踪→释放全链路实测正常
- 不等高组让位（v1.2.0 修复）：让位空间按最终布局模拟（各组真实高度+原始间隙），
  短组跨越高组 / 高组让位短组均全程 0 重叠；等高行自动退化为原行为
- 光标与误选防护（v1.3.0/v1.3.1）：
  - 悬停恢复应用原生光标（行 pointer / 标题箭头），不再常驻抓手
  - 按下的瞬间整个菜单切换为手掌并保持到松手——拖动中指针扫过其他行、
    间隙、其他分组甚至移出菜单都不会闪回箭头（v1.3.1：修复光标规则只挂在
    被拖元素上导致的箭头↔手掌闪烁，及重写时遗失的拖拽中全页 grabbing/禁选）
  - 按住 220ms 长按仍会确认拖拽意图（此时松手不触发选择），快速按住直接
    移动则立即拖拽
  - 点击拦截跟随拖拽生命周期（原为固定 400ms 窗口，长拖拽松手后拦截器已失效
    导致误选择模型）；长按后松手不触发选择
  - 普通快速点击行为完全不变（正常选择模型）
- 两者共用：重开菜单恢复 / 重渲染恢复 / 高频重渲染压力 / 边缘自动滚动 /
  搜索过滤下拖拽 / 零残留样式

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | bundle 清单（`dsh.bundle.patch` + `dsh.client` 声明） |
| `cordis.patch.yml` | 插入插件行 `dsh-model-drag` |
| `index.js` | Host 半壳（空实现，行为全在 Client） |
| `client.js` | Client 模块（由 `engine.js` 经 `build-client.mjs` 生成，勿手改） |
| `engine.js` | 拖拽引擎源码（临时验证页与 client.js 的单一来源） |
| `locale/en.json` `locale/zh.json` | 插件管理页的标题/描述 |
| `icon.svg` | 插件图标（原创） |
| `dsh-model-drag-1.7.1.tgz` | 打包产物（安装用这个） |

## 安装（desktop 主 profile）

```powershell
dsh plugin --profile desktop add <路径>\dsh-model-drag-1.7.1.tgz
```

已在本机执行过一次。运行中的 DSH 会通过 HMR 即时加载；若未生效，重启 DSH 即可。
安装后可在 侧边栏 → 插件 页看到「模型拖拽排序」。

卸载：

```powershell
dsh plugin --profile desktop remove dsh-model-drag
```

## 工作原理

- 只依赖稳定 DOM 契约（构建哈希变化不影响）：
  `section[data-menu-group]` 分组 + `button[role="menuitemradio"]` 行 +
  行内 `span[data-provider-id][data-model-id]` + 滚动容器 `class="scrollable"`。
- 行拖拽与组拖拽共用同一套机制（ siblings = 组内行 / 视口内分组，
  FLIP 全量落位）；拖拽行 transform 1:1 跟手（无过渡），
  兄弟项 170ms 弹性过渡让位，松手 FLIP 落定（零跳变）后动画样式全部移除。
- 行序按 `provider\0model` 键存 `localStorage`（键 `dsh-plugin.model-drag-sort.order.v1`），
  组序按 provider id 存 `dsh-plugin.model-drag-sort.groups.v1`；
  打开菜单 / React 重渲染后由 MutationObserver 瞬时（无动画）重放已保存顺序。
- 行只在 provider 组内排序；组间排序改组序不改组成员；
  拖拽启动有 5px 阈值，不影响点击选择；列表贴边时自动滚动（不依赖 rAF）。

## 重新构建

改完 `engine.js` 后：

```powershell
node build-client.mjs   # 重新生成 client.js
pnpm pack               # 重新打包 tgz
dsh plugin --profile desktop remove dsh-model-drag
dsh plugin --profile desktop add .\dsh-model-drag-<版本>.tgz
```

## 临时验证环境（temp-drag profile）

```powershell
dsh --profile temp-drag --port 8937 --no-open
# 打开输出的 http://127.0.0.1:<port>/?token=...
```

临时复刻页（无需 DSH，直接浏览器打开 `temp-dsh/index.html`，配合任意静态服务器）
可用于脱离真实应用的快速调试。
