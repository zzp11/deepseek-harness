/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-workbench`.
 * @module @deepseek-ai/dsh-client-workbench/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-workbench'

/** Cordis companion plugin name. */
export const name = 'client-workbench-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a browser-side consumer that folds the host's
 * workbench events into view state and owns no cross-plugin mutable data. The
 * fold's replay determinism belongs to this package's definition specs, and
 * the event-stream relationships belong to the host package's companion.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
