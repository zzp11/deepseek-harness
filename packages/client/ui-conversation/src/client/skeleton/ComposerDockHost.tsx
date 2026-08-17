// The docked composer's seat: an empty element whose only job is to exist and
// report itself. `ConversationRoot` renders the one composer subtree into it
// through a portal, so the composer moves without being rebuilt.

import type { ComposerDockHostProps } from '../contract/slots.ts'
import css from './ConversationRoot.module.css'

/**
 * Render the seat a conversation view offers the composer.
 * @param props - the injected face carrying the one call that offers the seat.
 * @returns the seat element.
 */
export function ComposerDockHost({ offerSeat }: ComposerDockHostProps) {
  // A callback ref, not an effect: mounting offers the element and unmounting
  // releases it, in the same commit as the DOM change, so the composer is never
  // portalled into a node that has already left the document.
  return <div className={css.composerDockHost} ref={offerSeat} />
}
