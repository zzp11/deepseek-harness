/**
 * The browser-safe face of this package: the content model, the branded ids, the
 * event payload types, the gates, and every derived quantity — pure functions and
 * types, no cordis, no session store, no I/O.
 *
 * It exists so the browser half folds the event family with THIS code rather than
 * its own copy. A dependency set or a maturity mark derived twice is how one fact
 * ends up with two values, and that is the failure this whole design is built
 * against. The package root is not importable from a browser bundle — it reaches
 * cordis, the command registry, and the tool registry — so the shared layer needs
 * its own entry.
 * @module @deepseek-ai/dsh-workbench/projection
 */

export * from './brand.ts'
export * from './core.ts'
export * from './gates.ts'
export * from './model.ts'
export * from './store.ts'
export type * from './events.ts'
