// Launch flags. One constant each, with the reason it is set the way it is.

/**
 * The iambic keyer: written, tested, and not offered to players.
 *
 * Under CPU load the keyer runs away. At 35 WPM with 4x throttling it sent 3,682
 * extra elements, with lag reaching 42 seconds — a burst it never recovers from,
 * which in a run means a cascade of wrong letters the operator cannot key their
 * way out of. A mid-range phone under load reaches this, so the keyer ships off
 * rather than late.
 *
 * Before flipping this to true:
 *   1. npm run build
 *   2. node scripts/measure/browser-pipeline.mjs run --iambic-load
 * That sweep drives a real build in headless Chrome at 15 / 25 / 35 WPM against 1x,
 * 4x and 6x CPU throttling, and fails if any run sends 5 or more extra elements or
 * fails to complete. It must pass at every speed and throttle, not just at 1x.
 *
 * Nothing is deleted behind this flag: src/morse/iambic.js, its tests, the pad's
 * element pulse and the settings controls are all intact. The flag decides only
 * whether a player is offered the mode. Turning it on restores the settings
 * controls; no other code needs changing.
 *
 * While it is false, progress loaded from storage with keyerMode 'iambic' is
 * migrated to 'manual' (see sanitize() in progress.js), because there is no
 * longer any UI with which to leave the mode. The stored keyerWpm is kept, so
 * turning the keyer back on restores the player's chosen speed.
 */
export const IAMBIC_ENABLED = false
