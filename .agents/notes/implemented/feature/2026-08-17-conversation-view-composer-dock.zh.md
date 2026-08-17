# Agent Note：对话视图可以把 composer 收进自己里面

Status: implemented

[English](2026-08-17-conversation-view-composer-dock.md) | 中文

## Problem

常驻 composer 吸在滚动区底部的那个座位，对**转录**是对的，对不是转录的视图就不对。工作台视图是三栏——目录、卡片、某个模块上说过的话。一个浮在三栏之下的输入框**不属于这三栏中的任何一栏**，而且它会压住最高那一栏的最后一行。原来的答案是让每个视图都为它留底部避让，这等于让每个视图为一个它没要、也用不上的座位付钱。

最直觉的修法——让视图自己渲染一个输入框——比问题本身更糟。常驻 composer 身上挂着：会话草稿、浏览器侧的图片预览、`conversation.composer` 的 chain election（审批与提问接管）、提交模式解析、斜杠命令菜单。**再写一个，这些一样都不会有**，并且会把「人怎么发一条消息」变成一个有两个答案的问题，两个答案迟早互相漂移。

## Decision

`ui-conversation` 声明一个子座 `conversation.view.composer`（`kind: 'single'`、`scope: 'session'`）。声明了它的视图，会把常驻 composer 收进自己内部；没声明的视图不受影响，照旧保留吸底座位。

**只有一个** composer。本包把 `ComposerDockHost` 注册进视图声明的那个座，`ConversationRoot` 用 `createPortal` 把**它已有的**那棵 composer 子树渲染进这个宿主，而不是再渲染一个。

### 座位从回调 ref 让出，不用 effect

`ComposerDockHost` 通过回调 ref 把自己的元素交给登记处，于是「挂载即让座、卸载即收回」与 DOM 变化发生在**同一次 commit** 里。用 effect 会晚一帧，而这一帧足够把 composer portal 进一个已经离开文档的节点。

### 登记处是可订阅对象，且只持有一个座位

`ComposerDockRegistry`（`src/client/input/dock.ts`）暴露 `subscribe`/`version`/`host`，由 `useSyncExternalStore` 读——与本包给 view ring 用的是同一种 ledger 形状。它只持有**一个**座位，不是每会话一个：壳子一次只显示一个对话，座位由挂载的视图让出、卸载时收回，而常驻 composer 本身是**故意**活在会话边界之上的（切会话它不重建）。

### 这次搬动保住什么、保不住什么

换掉 portal 的容器会**重建** DOM 子树——前后的 textarea **不是同一个节点**。草稿、已附的图片、提交模式偏好之所以仍然活着，是因为它们住在这棵树**之上**的会话输入机里，不在 DOM 里、也不在组件 state 里；chain election 活着是因为它每次都从同一份 pending 列表重算。

**只存在 DOM 里的东西保不住**——光标位置、正在进行中的输入法组词——所以不许有任何东西依赖跨座位的元素同一性。

发布 `--dsh-composer-height` 的 `ResizeObserver` **只在默认位置挂**。那个属性是为了给滚动区底部的座位留避让，composer 一旦进了某一栏，就没有东西要避让了。

## Alternatives considered

**用 `SnapshotStore` 存座位。** 试过两次——一次按会话、一次单个——都因同样两个原因失败：`createSnapshotStore` 在开发模式下**深冻结** state，冻一个 DOM 元素等于把从它可达的一切都冻上；而 `update()` 会**忽略 mutator 的返回值**，赋值被静默丢掉。可订阅 ledger 是本包处理不可序列化响应式状态时本来就在用的那一套。

**让工作台自己渲染一个 composer。** 否掉：Problem 里列的那些机制它一样都复制不了，并且会给「怎么发消息」造出第二个答案。

**保留浮动 composer，让工作台留避让。** 这就是阶段 0 的做法。它把输入框留在三栏之外，于是读起来像是属于**页面**、而不属于它要续下去的那段对话，并且以后每个视图都要继续交这笔避让税。

**在 `ui-conversation` 上加一个配置项决定 composer 去哪。** 按当前设计**做不到**：浏览器半边的插件拿不到 `cordis.yml` 的配置。**声明那个座就是开关。**

## Testing

`packages/client/ui-conversation/tests/skeleton.client.spec.tsx` 覆盖**两个方向**——让出座位后 composer 进去、且屏幕上只有一个座位；收回座位后它回到默认位置——并钉住保全契约：**草稿活过这次搬动，元素同一性不活**。

`apps/web/tests/workbench-salon.e2e.ts` 在真装配的浏览器上断言 `[data-composer-seat]` **只有一个**、它在工作台的对话栏之内、并且在那里能打字。

本包的 `src/client/**` 处在一条既有的 GUI 债覆盖率豁免下（`vitest.config.ts`），所以这些测试**不由** per-file 覆盖率闸门强制。

## Consequences

视图现在有了一个受支持的方式来安置 composer，工作台也因此**不留底部避让**——没有东西浮在它最后一行之上。

「这个视图要不要接管 composer」由**它是否声明那个座**决定，**无法从 `cordis.yml` 组合**——浏览器半边的插件没有配置通道（客户端 boot graph 条目只带 `id`/`url`/`rev`/`inject`）。同一个根因也让「对话」这个 tab 本身组合不掉，记在 `my_docs/04` 的 D-47。

接管与释放都会丢掉只存在 DOM 里的状态，所以视图**不该在有人可能正在组词时**让出或收回座位。实际上座位只在切换视图时变，而那本来就是一次明确的点击。
