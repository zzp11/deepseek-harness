/**
 * The composer dock: the one way a conversation view takes the composer out of
 * the bottom of the column and places it inside itself.
 *
 * The default position — a sticky seat at the foot of the scroll body — is right
 * for a transcript. A view that is not a transcript can want it elsewhere: the
 * workbench puts the exchange in a right-hand column and the composer under it,
 * and a second composer floating below that column is both wrong and confusing.
 *
 * The composer MOVES rather than being rebuilt. A view declares
 * `conversation.view.composer`, this package registers a host into it, and
 * `ConversationRoot` renders its existing composer subtree into that host through
 * a portal. One instance keeps its draft, its images, its chain election, and its
 * height observer; a second implementation would keep none of them and would be a
 * second answer to "how does a person send a message".
 *
 * A subscribable, not a `SnapshotStore`: the value is a DOM node, and the store
 * engine deep-freezes its state in development — freezing an element would take
 * every object reachable from it along with it. This is the shape the view ledger
 * already uses (`subscribe`/`version`), read through `useSyncExternalStore`.
 */

/** What `ConversationRoot` reads to decide where the composer goes. */
export interface ComposerDock {
  /**
   * Subscribe to seat changes.
   * @param listener - called after the seat is offered or released.
   * @returns the unsubscribe function.
   */
  subscribe: (listener: () => void) => () => void
  /**
   * The current version, for `useSyncExternalStore`.
   * @returns a number that changes whenever the seat does.
   */
  version: () => number
  /**
   * The seat a view is offering.
   * @returns the element to place the composer in, or null for its default seat.
   */
  host: () => HTMLElement | null
}

/**
 * The composer-dock registry: ONE seat, not one per session.
 *
 * The shell shows a single conversation at a time, and the seat is offered by a
 * mounted view and released when that view unmounts — so at most one seat exists at
 * any moment. The resident composer lives above the session boundary by design (it
 * survives session switches), so a per-session seat would be the wrong shape for it.
 */
export class ComposerDockRegistry implements ComposerDock {
  private current: HTMLElement | null = null
  private seq = 0
  private readonly listeners = new Set<() => void>()

  /** @inheritdoc */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** @inheritdoc */
  readonly version = (): number => this.seq

  /** @inheritdoc */
  readonly host = (): HTMLElement | null => this.current

  /**
   * Offer, or withdraw, the docked seat.
   * @param host - the element to place the composer in, or null to release it.
   */
  set(host: HTMLElement | null): void {
    if (this.current === host) return
    this.current = host
    this.seq += 1
    for (const listener of [...this.listeners]) listener()
  }
}
