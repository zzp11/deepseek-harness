/** Host loader entry for the browser-only workbench plugin. */

/**
 * T1 scaffold: the node half proves the roster row resolved and mounted before
 * the browser ever fetches the bundle. See the host plugin's apply for why the
 * line is a `console.log`. It goes when T6 gives this half real work.
 */
export function apply(): void {
  console.log('workbench-client: node half loaded')
}
