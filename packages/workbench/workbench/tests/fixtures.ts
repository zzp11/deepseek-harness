/** Builders shared by the workbench specs: a node, a first-hand entry, and a read model over them. */

import { NodeId, SourceId } from '../src/brand.ts'
import type { FirstLayerEntry, NodeGraph, WorkbenchNode } from '../src/model.ts'

/**
 * Build a node with the skeleton values a test does not care about already filled.
 * @param id - the node id.
 * @param overrides - fields this test does care about.
 * @returns the node.
 */
export function node(id: string, overrides: Partial<WorkbenchNode> = {}): WorkbenchNode {
  return {
    id: NodeId(id),
    title: `title-${id}`,
    parent: null,
    maturity: 'thought',
    source: 'human',
    fields: {},
    lastRev: 1,
    createdAt: 0,
    ...overrides,
  }
}

/**
 * Build an utterance entry of the first-hand layer.
 * @param id - the entry id.
 * @param text - the person's words.
 * @param rev - the global rev current when it was appended.
 * @returns the entry.
 */
export function utterance(id: string, text: string, rev = 1): FirstLayerEntry {
  return { kind: 'utterance', entryId: SourceId(id), text, rev, createdAt: 0 }
}

/**
 * Assemble a read model from nodes and first-hand entries, at `rev` 7.
 * @param nodes - the tree.
 * @param entries - the first-hand layer.
 * @param fieldDictionary - the registered open fields.
 * @returns the read model.
 */
export function graphOf(
  nodes: readonly WorkbenchNode[],
  entries: readonly FirstLayerEntry[] = [],
  fieldDictionary: NodeGraph['meta']['fieldDictionary'] = {},
): NodeGraph {
  return {
    nodes: new Map(nodes.map(item => [item.id, item])),
    firstLayer: new Map(entries.map(entry => [entry.entryId, entry])),
    meta: { rev: 7, fieldDictionary },
  }
}
