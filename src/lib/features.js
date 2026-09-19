// Launch flags. One constant each, with the reason it is set the way it is.

/**
 * The iambic keyer: on, with the runaway fixed and the ceiling lowered.
 *
 * It was off for launch because under CPU load it ran away: at 35 WPM with 4x
 * throttling it sent 3,682 extra elements, with lag reaching 42 seconds. The keyer
 * kept emitting for a paddle the operator had already let go of, and each extra
 * element slowed the next decode, so the burst accelerated instead of settling.
 *
 * Two changes closed it, both in the emission loop in src/hooks/useMorseInput.js:
 *   - A stall guard. An element due more than one element period before the keyer
 *     reaches it is never sent: the page is behind, a release stamped before it may
 *     still be queued, so the keyer lets go of both paddles and drops any queued dot
 *     memory rather than guessing. It records a 'keyer-stall' anomaly, which the
 *     results modal reports, so a short letter reads as the keyer giving up rather
 *     than as the app misreading the operator.
 *   - A hard cap of MAX_HOLD_ELEMENTS (8) elements on any single hold. No Morse
 *     character is longer than 6 elements, so a longer hold is never intentional.
 * The speed ceiling came down from 40 to 30 WPM at the same time (KEYER_WPM in
 * progress.js): the runs that ran away were the fastest ones, where an element period
 * is shortest relative to the lag a loaded phone adds.
 *
 * This flag stays as the kill switch. To check the fix, or after any change to the
 * emission loop:
 *   1. npm run build
 *   2. node scripts/measure/browser-pipeline.mjs run --iambic-load
 * That sweep drives a real build in headless Chrome at 15 / 25 / 30 WPM against 1x,
 * 4x and 6x CPU throttling, and fails if any run sends 5 or more extra elements or
 * fails to complete. It must pass at every speed and throttle, not just at 1x.
 *
 * Turning it back to false removes the settings controls (there would be no way to
 * leave the mode otherwise) and migrates progress loaded with keyerMode 'iambic' to
 * 'manual' (see sanitize() in progress.js). The stored keyerWpm is kept either way,
 * so the player's chosen speed survives the flag.
 */
export const IAMBIC_ENABLED = true
