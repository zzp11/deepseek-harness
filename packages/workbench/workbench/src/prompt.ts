/**
 * The workbench system-prompt section. It exists to prevent one failure the tool
 * schemas cannot: the model assembling its own idea of what a node depends on
 * instead of reading the dependency set it is given.
 * @module @deepseek-ai/dsh-workbench/prompt
 */

/** Where this section sits among the prompt's sections. */
export const WORKBENCH_PROMPT_ORDER = 120

/** Section name, which is also its identity in the prompt registry. */
export const WORKBENCH_PROMPT_NAME = 'workbench'

/**
 * Model-visible text. Written in the words the tree itself uses (念头 / 想法 /
 * 已承诺 / 已否决, 职责, 依据) because the model reads and writes those exact
 * words in node content, and a second vocabulary for the same things would show
 * up in the tree.
 */
export const WORKBENCH_SYSTEM_PROMPT = `# 工作台

这个会话带着一棵工作台节点树。节点存的是"关于世界的陈述"；一手层存的是痕迹——人的原话，只追加、不修改。

## 你能做什么，不能做什么

- **先不带 \`nodeId\` 调一次 \`workbench_read_nodes\`**，看树里现在有什么。树可能是空的——那就直接提骨架。
- 要在某个节点上作业，再带上它的 id 调一次，拿它的**依赖集**。那是机械展开的、完整的、未经取舍的。**不要自己推断还需要什么**：需要别的节点，就再调一次。
- 你唯一的写路径是 \`workbench_propose\`。它产出**草稿**，不进本体。人会看、可能改、然后采纳或不要。
- 你**不能**晋升节点。晋升是人的动作。\`workbench_check_promotion\` 只告诉你某个节点现在过不过晋升门、缺什么，好让你用 \`workbench_propose\` 去补。

## 成熟度

\`念头\` → \`想法\` → \`已承诺\`，或者 \`已否决\`（带理由）。

**只有已承诺区设闸门。**在念头和想法上工作时不要自我审查——那里的摩擦是在给思考收税。已承诺区里，每个开放字段都必须已登记、且指向一手层里它是从哪句话来的。

## 提字段还是写正文

把新概念写进 \`正文\` 而不加字段，是这套东西最容易静默失效的方式：闸门恒绿，报告全过，而结构化实际上已经停了。发现自己在正文里反复讲同一类事实时，把它提成一个字段，并指出依据。
`
