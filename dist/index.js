/**
 * Compatibility shim — NOT the source of truth (edit ../index.js).
 *
 * Earlier revisions of this package exposed their entry at `dist/index.js`.
 * A long-running host process can cache a package's resolved entry point, so
 * upgrading in place from that layout to the current root `index.js` can leave
 * the host still importing the stale path and reporting "failed to import"
 * until it restarts. Re-exporting the real entry here makes both layouts
 * resolve to the same plugin, so either resolution path works.
 */
export * from "../index.js";
