# Real-device check: one Android phone, one iPhone

Covers what ships. The iambic keyer is off for launch (`IAMBIC_ENABLED` in `src/lib/features.js`),
so there is nothing here for it; if that flag is ever flipped back on, the keyer needs its own
rows before it goes out.

**Attribution — fill this in first, or the result cannot be read back later.**

| | Device model | OS version | Browser + version | Tester | Date |
|---|---|---|---|---|---|
| **Android** | | | | | |
| **iPhone** | | | | | |

**Setup**
1. Use the deployed **https** site. Over plain http the screen wake lock (row 9) and Copy don't work.
2. Open it with `?dump` at the end of the address. Press **Clear** under the main card, and leave
   **Touch controls** on Auto.
3. Row 11 needs a first visit: use a private window, or clear site data for the origin, *after*
   finishing the other rows so you don't throw away the run dump.
4. Mark each row **P** or **F**. Anything odd goes in *Observed*, even on a pass — a pass with a
   note is more useful than a bare P.

| # | Check | Pass when | Android | iPhone | Observed |
|---|---|---|---|---|---|
| 1 | **10 straight-key runs** at a comfortable speed. Write the accuracy of each run in *Observed* | Every run's score matches your own count of your mistakes, and the passage never shows a letter you didn't send. Note any single moment the display disagreed with what you keyed, even if the final score was right | | | |
| 2 | **10 dot/dash pad runs**, same passages if you can | As row 1 | | | |
| 3 | **Long-press** each touch key, the passage and the transmission strip for 2 s | No callout menu, no magnifier, no selection highlight on the keys or the strip. The passage text may select | | | |
| 4 | Key a full passage without deliberately scrolling | Keying never scrolls the page and never moves the passage under you | | | |
| 5 | **Scroll the passage** part way through a run, then carry on keying | Scrolling emits no dot or dash, nothing is dropped, and the page doesn't jump back | | | |
| 6 | Mid-run, **drag down from the top** of the page | No pull-to-refresh. The run is intact | | | |
| 7 | **Hold a dash while a notification arrives** (message yourself from another device) | The key releases cleanly: no stuck key, no phantom marks after it, and the mark that was forming is either complete or absent, not doubled | | | |
| 8 | Mid-run, **switch to another app for ~5 s and come back** — once while idle, once while holding the key | The run survives, the key isn't stuck down, and the timer is sane: no jump, no negative or frozen clock, and the backgrounded time isn't counted as keying | | | |
| 9 | Send a **long tier-4 passage** slowly, with pauses under 30 s, for longer than the phone's auto-lock time | The screen never sleeps until the run ends | | | |
| 10 | **Sidetone**: key a few elements with the volume up. iPhone: then set the **silent switch / focus mode** and key again | The tone is audible on every mark on both devices. On iPhone, record in *Observed* whether silent mode kills it, and if so whether the key's own movement was enough to key by | | | |
| 11 | Hold the phone **one-handed as you'd actually play** and key a passage in both input modes | Both keys are reachable with the thumb without shifting grip, and the home indicator / gesture bar never sits over a key or swallows a press | | | |
| 12 | With the keys on screen, **read the passage** during a run | The passage stays legible and the cursor stays visible above the keys: never hidden behind them, never clipped to an unreadable sliver | | | |
| 13 | **First visit** (private window or cleared site data): work through the intro to the try-it step and **send a real E from the touch keys** | The try-it step accepts one short press on the round key (straight key) or one tap on the dot key (pad), and moves on. It must accept a genuine key press, not only the on-screen demo | | | |

**Afterwards**
- On each phone press **Download** and get the file to the laptop: AirDrop or Files on iPhone, USB or
  cloud storage on Android.
- Run `node scripts/measure/analyze-dump.mjs <android>.json <iphone>.json`.
- Flag any row showing **stamps** below 100%, **lag p99** over 50 ms, **replay DIFFERS**, or a
  **cancel** or **blur** you didn't cause.

Notes: ______________________________________________________________________________
