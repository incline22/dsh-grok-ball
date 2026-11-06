/**
 * dsh-grok-ball —— host half.
 *
 * The whole widget lives in the browser half (lib/client.js). The host half only
 * has to exist so the bundle patch has something to mount: the client bundle is
 * picked up from `exports["./client"]` + `dsh.client` by @deepseek-ai/dsh-client-modules.
 *
 * Deliberately does NOT `inject` any host service. A static dependency the host
 * cannot satisfy leaves this fiber pending forever, and the web boot treats a
 * pending entry as fatal.
 */
export const name = 'dsh-grok-ball'

export function apply() {
  /* no host-side work: no routes, no files, no network */
}

export default { name, apply }
