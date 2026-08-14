# @deepseek-ai/dsh-client-workbench

English | [中文](README.zh.md)

Browser half of the workbench: the 工作台 tab beside the conversation. It folds the host's `workbench/*` events into a node tree on the left and a focus pane on the right, renders proposal cards the person edits in place before accepting, and carries the bottom meter row. [dsh-workbench](../../workbench/workbench/README.md) owns the tree, the gates, and every write.

Editing a proposal card costs nothing: the card holds a draft copy, so changing it neither writes to the log nor calls a model. The edited content is what the gates re-run against when the person accepts, which is what stops a hand-corrected proposal from landing with a dangling reference or an unregistered field.

**This package currently carries the T1 scaffold only** — a node half and a browser half that each announce themselves. The conversation-node definition, the tab, the shape renderers, and the verdict buttons land in T6–T7.

## Model Experience

None, as this package renders browser-side views and nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Scaffold only** — both halves print one line and register nothing.
- **Graph rendering deferred** — v1 renders two shapes (paragraph card, child list); table, relation graph, argument graph, and flow are typed placeholders with no renderer.
- **Working set and selection are browser-local** — neither survives a reload, because the host owns no event for them yet.
