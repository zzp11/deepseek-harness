/**
 * The workbench's owned branded ids. They cross the session log, the model-facing
 * tool surface, and the browser wire, where a node id and a first-hand entry id
 * are both plain strings and would otherwise be interchangeable.
 * @module @deepseek-ai/dsh-workbench/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies a node of the workbench tree. */
export type NodeId = Branded<'WorkbenchNodeId'>

/**
 * Brand a string as a {@link NodeId}.
 * @param id - the raw node-id string.
 * @returns the same string, branded; no validation is performed.
 */
export function NodeId(id: string): NodeId {
  return id as NodeId
}

/**
 * Identifies one entry of the first-hand layer — a verbatim utterance now,
 * source material later. A node field cites the entry its value was distilled
 * from through this id.
 */
export type SourceId = Branded<'WorkbenchSourceId'>

/**
 * Brand a string as a {@link SourceId}.
 * @param id - the raw first-hand entry id.
 * @returns the same string, branded; no validation is performed.
 */
export function SourceId(id: string): SourceId {
  return id as SourceId
}

/** Identifies one authored content body on a card. */
export type BodyId = Branded<'WorkbenchBodyId'>

/**
 * Brand a string as a {@link BodyId}.
 * @param id - the raw body id.
 * @returns the same string, branded; no validation is performed.
 */
export function BodyId(id: string): BodyId {
  return id as BodyId
}

/**
 * Identifies one addressable object inside an authored body — a flow step, a
 * table row, an argument ground.
 *
 * These ids are authored and stored rather than assigned at render time, because
 * the conversation anchor cites one of them: a render-time index would move when
 * a step is inserted above it, and the anchor would then silently point at a
 * different object.
 */
export type BodyObjectId = Branded<'WorkbenchBodyObjectId'>

/**
 * Brand a string as a {@link BodyObjectId}.
 * @param id - the raw body-object id.
 * @returns the same string, branded; no validation is performed.
 */
export function BodyObjectId(id: string): BodyObjectId {
  return id as BodyObjectId
}

/** Identifies one model proposal awaiting a human verdict. */
export type ProposalId = Branded<'WorkbenchProposalId'>

/**
 * Brand a string as a {@link ProposalId}.
 * @param id - the raw proposal id.
 * @returns the same string, branded; no validation is performed.
 */
export function ProposalId(id: string): ProposalId {
  return id as ProposalId
}
