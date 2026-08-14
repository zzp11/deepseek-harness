# @deepseek-ai/dsh-client-workbench

[English](README.md) | 中文

工作台的浏览器半边：会话旁边的「工作台」tab。它把宿主的 `workbench/*` 事件折叠成左边的节点树和右边的焦点区，渲染可就地编辑再采纳的 proposal 卡，并承载底部仪表行。树、闸门和所有写入归 [dsh-workbench](../../workbench/workbench/README.md) 所有。

改 proposal 卡是零成本的：卡里拿的是草稿副本，改它既不落日志也不调模型。人点采纳时，闸门重跑的正是改完的内容——这一步挡住的是"人手改完带着悬空引用或未登记字段落盘"。

**本包目前只有 T1 脚手架** —— 节点半边和浏览器半边各报出自己。conversation-node definition、tab、形态渲染器和裁决按钮在 T6–T7 落地。

## Model Experience

无，因为本包只渲染浏览器侧视图，这里没有任何东西进入模型请求。

#### KV Cache effect

无；本包既不组装也不发送模型请求。

## Known Limitations and Deferred Work

- **只有脚手架** —— 两个半边各打一行日志，什么都不注册。
- **图渲染推迟** —— v1 只渲染两种形态（段落卡、子节点列表）；表、关系图、论证图、流程只有类型占位，没有渲染器。
- **工作集与选中态是浏览器本地状态** —— 刷新即失，因为宿主还没有承载它们的事件。
