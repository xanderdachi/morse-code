// framer-motion's layout animations (and, bundled in with them, drag and
// gestures) as a separate chunk. Only the desktop transmission strip's regroup
// needs them, so the initial bundle carries just domMin and phones, whose strip
// animates with CSS, never download this at all.
export { domMax as default } from 'framer-motion'
