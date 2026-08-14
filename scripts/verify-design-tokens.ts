/**
 * Every `--dsw-*` custom property a client stylesheet reads must be defined by the
 * theme package.
 *
 * An undefined custom property does not warn and does not fall back: the whole
 * declaration becomes invalid at computed-value time, so its longhands take their
 * initial values. `border: 1px solid var(--typo)` therefore renders NO border at
 * all, and `background: var(--typo)` renders transparent. The result is a page that
 * has quietly lost its edges, its fills, its hover feedback, and its selected state
 * — which is exactly how this gate came to exist.
 * @module scripts/verify-design-tokens
 */

import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * Where tokens are declared. The theme package owns the shared vocabulary, and a
 * stylesheet may also declare a property of its own — a locally declared one
 * resolves perfectly well, so treating it as missing would be a false report.
 */
const DEFINITION_GLOBS = ['packages/client/ui-theme/src/styles/*.css', 'packages/client/*/src/**/*.css']

/** Client stylesheets that consume it. */
const CONSUMER_GLOB = 'packages/client/*/src/**/*.css'

/**
 * Reads that already fail this rule, recorded so the gate can block everything else.
 *
 * Each is the same defect the gate was written for: the declaration around it is
 * dropped, so that border is not drawn and that fill is transparent today. They are
 * listed rather than fixed because choosing the replacement token for another
 * package's surface is that package's design decision, not a mechanical rename.
 * TODO(design-tokens): retire entries as their owners pick the intended token.
 */
const KNOWN_UNRESOLVED: readonly string[] = [
  'packages/client/ui-agent-preset/src/client/AgentPresetLabel.module.css: --dsw-alias-fill-tsp-secondary',
  'packages/client/ui-agent-preset/src/client/AgentPresetSeat.module.css: --dsw-alias-label-quaternary',
  'packages/client/ui-conversation/src/client/chat/ContextBody.module.css: --dsw-alias-line-secondary',
  'packages/client/ui-conversation/src/client/chat/StatsLine.module.css: --dsw-alias-separator-primary',
  'packages/client/ui-jobs/src/client/JobListAction.module.css: --dsw-alias-fill-l2',
  'packages/client/ui-jobs/src/client/JobListAction.module.css: --dsw-font-mono',
  'packages/client/ui-message-feedback/src/client/MessageFeedbackActions.module.css: --dsw-alias-bg-primary',
  'packages/client/ui-message-feedback/src/client/MessageFeedbackActions.module.css: --dsw-alias-border-secondary',
  'packages/client/ui-message-feedback/src/client/MessageFeedbackActions.module.css: --dsw-alias-interactive-bg-primary',
  'packages/client/ui-message-feedback/src/client/MessageFeedbackActions.module.css: --dsw-alias-label-inverse',
  'packages/client/ui-settings-plugins/src/client/PluginCard.module.css: --dsw-alias-label-error',
  'packages/client/ui-settings-plugins/src/client/fields.module.css: --dsw-alias-label-error',
  'packages/client/ui-tool/src/client/tool/components/ToolRow.module.css: --dsw-alias-label-quaternary',
]

/** A custom-property definition: the name at the head of a declaration. */
const DEFINITION = /(--dsw-[a-z0-9-]+)\s*:/g

/** A custom-property read, with or without a fallback. */
const REFERENCE = /var\(\s*(--dsw-[a-z0-9-]+)\s*(,|\))/g

/**
 * Collect every token the theme defines.
 * @returns the defined token names.
 */
function definedTokens(): Set<string> {
  const defined = new Set<string>()
  for (const glob of DEFINITION_GLOBS) {
    for (const file of globSync(glob, { cwd: root })) {
      for (const match of readFileSync(`${root}${file}`, 'utf8').matchAll(DEFINITION)) {
        defined.add(match[1] as string)
      }
    }
  }
  return defined
}

/** One unresolved reference. */
interface Unresolved {
  readonly file: string
  readonly token: string
}

/**
 * Find every read with no definition and no fallback.
 * @param defined - the token names the theme declares.
 * @returns the unresolved references.
 */
function unresolvedReferences(defined: ReadonlySet<string>): Unresolved[] {
  const missing: Unresolved[] = []
  for (const file of globSync(CONSUMER_GLOB, { cwd: root })) {
    const css = readFileSync(`${root}${file}`, 'utf8')
    for (const match of css.matchAll(REFERENCE)) {
      const token = match[1] as string
      // A read carrying a fallback degrades to that value rather than dropping the
      // declaration, so it is legal even when the token is not part of the theme.
      if (match[2] === ',') continue
      if (!defined.has(token)) missing.push({ file, token })
    }
  }
  return missing
}

const defined = definedTokens()
if (defined.size === 0) {
  throw new Error(`verify-design-tokens: no tokens found under ${DEFINITION_GLOBS.join(', ')}; the globs are wrong`)
}
const allowed = new Set(KNOWN_UNRESOLVED)
const seen = new Set<string>()
const missing = unresolvedReferences(defined).filter((entry) => {
  const key = `${entry.file}: ${entry.token}`
  seen.add(key)
  return !allowed.has(key)
})
const retired = [...allowed].filter(entry => !seen.has(entry))
if (retired.length > 0) {
  console.error('verify-design-tokens: these allowlist entries no longer occur; delete them.')
  for (const entry of retired) console.error(`  ${entry}`)
  process.exit(1)
}
if (missing.length > 0) {
  console.error('verify-design-tokens: stylesheets read design tokens the theme does not define.')
  console.error('An undefined var() makes the whole declaration invalid at computed-value time —')
  console.error('borders stop being drawn and fills go transparent, silently.')
  for (const { file, token } of missing) console.error(`  ${file}: ${token}`)
  process.exit(1)
}
console.log(
  `verify-design-tokens: ${String(defined.size)} tokens defined, every client reference resolves`
  + ` (${String(allowed.size)} recorded exceptions).`,
)
