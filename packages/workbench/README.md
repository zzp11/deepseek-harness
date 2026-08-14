# workbench/ — idea-to-commitment workbench

English | [中文](README.zh.md)

The workbench turns a thought into something committed to, in one place: a tree of statements about the world, a first-hand layer that only ever appends, and gates that charge their friction at one moment — promotion — rather than on every edit.

It is a **product** family rather than a capability seam. There is no replaceable provider contract to split: the node model, the gates, and the write paths are one decision, and the session log is the only persistence.

| Package | Role | ctx key |
|---|---|---|
| [`workbench/`](workbench/README.md) | The node tree, its derived quantities, the `workbench/*` event family, and the model-facing tools. | (registers on `ctx.tools`) |

The browser half lives in [`client/workbench/`](../client/workbench/README.md); it consumes this family's events and calls its write path, and owns no tree of its own.

The event payloads are catalogued in [docs/persistence-catalog.md](../../docs/persistence-catalog.md).
