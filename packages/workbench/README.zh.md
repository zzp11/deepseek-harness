# workbench/ —— 念头到落地工作台

[English](README.md) | 中文

工作台把一个念头带到"已承诺"，全程在一个地方：一棵存"关于世界的陈述"的节点树、一个只追加的一手层，以及只在**晋升**这一刻集中收费的闸门——而不是每次编辑都收。

它是一个**product** 族，不是能力缝。没有可替换的 provider 契约可拆：内容模型、闸门、写路径是同一个决定，而会话日志是唯一的持久化载体。

| 包 | 角色 | ctx key |
|---|---|---|
| [`workbench/`](workbench/README.md) | 节点树、它的派生量、`workbench/*` 事件族，以及模型可见的工具。 | （注册到 `ctx.tools`） |

浏览器半边在 [`client/workbench/`](../client/workbench/README.md)：它消费本族的事件、调本族的写路径，自己不持有任何树。

事件载荷编目在 [docs/persistence-catalog.md](../../docs/persistence-catalog.md)。
