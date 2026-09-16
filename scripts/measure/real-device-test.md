# Real-device check: one Android phone, one iPhone

**Setup**
1. Use the deployed **https** site. Over plain http the screen wake lock (item 13) and Copy don't work.
2. Open it with `?dump` at the end of the address. Press **Clear** under the main card, and leave **Touch controls** on Auto.
3. Mark each item **P** (pass) or **F** (fail). Anything odd goes in *Observed*, even on a pass.

Android: ____________ (model / OS / browser)   iPhone: ____________ (model / iOS)   Date: ________

| # | Check | Pass when | Android | iPhone | Observed |
|---|---|---|---|---|---|
| 1 | 10 runs at a comfortable speed, **straight key** | The score matches your own count of your mistakes in at least 9 of 10 runs | | | |
| 2 | 10 runs, **Dot / dash pad (Manual)** | Same as item 1 | | | |
| 3 | **Iambic at 15 WPM** (Setup → Dot / dash pad → Iambic). Send three passages, tapping once per element | The sidetone sounds on every element with no lag you notice, and the pad's glyph pops once per element, readable without looking straight at it. The results never say "the keyer stopped" | | | |
| 4 | **Iambic at 20 WPM**, the same way | Same as item 3 | | | |
| 5 | Iambic at 20 WPM: **hold the dot key for about 1 second**, then let the run end | The pops you saw match the dots on the strip, and the results say "… holds sent more than one element" | | | |
| 6 | iPhone only: **silent switch on**, then key a few elements | The sidetone is still audible. If it isn't, write down whether the pop alone was enough | — | | |
| 7 | **Scroll the passage** part way, then key without scrolling back | Every press registers, and the page doesn't jump or scroll | | | |
| 8 | Hold a dash while a **notification arrives** (message yourself from another device) | The key lets go, with no stuck key and no phantom marks afterwards | | | |
| 9 | Mid-run, **switch to another app for about 5 s** and come back, once while holding the key | The run carries on, and the key isn't stuck down | | | |
| 10 | **Long-press** a key for 2 s | No menu, callout or magnifier appears | | | |
| 11 | Mid-run, **drag down from the top** of the page | No pull-to-refresh, and the run is intact | | | |
| 12 | **Double-tap or long-press** the keys, the passage and the strip | Nothing on the keys gets selected or highlighted (the passage may select) | | | |
| 13 | Send a long passage slowly, with pauses under 30 s, for longer than the phone's auto-lock time | The screen stays on until the run ends | | | |

**Afterwards**
- On each phone, press **Download** and get the file to the laptop: AirDrop or Files on the iPhone; USB or cloud storage on Android.
- Run `node scripts/measure/analyze-dump.mjs <android>.json <iphone>.json`.
- Note any row showing **stamps** below 100%, **lag p99** over 50 ms, **replay DIFFERS**, or a **cancel** or **blur** you didn't cause.

Notes: ______________________________________________________________________________
