/*
 * Version, shown on the menu so a deploy can be confirmed at a glance.
 *
 * BUILD is rewritten by .github/workflows/pages.yml as the site is published, with
 * the short commit SHA and the date. Served straight from a checkout it stays
 * 'dev', which is how you can tell a local page from the deployed one. That step
 * fails the deploy if it cannot find this line, so the stamp cannot go missing
 * silently — keep the declaration on one line, exactly as written.
 */
export const VERSION = '0.5.0';
export const BUILD = 'dev';

/** e.g. "v0.4.0 · 1a2b3c4 2026-08-19", or "v0.4.0 · dev" from a checkout. */
export function versionLabel() {
  return 'v' + VERSION + ' · ' + BUILD;
}
