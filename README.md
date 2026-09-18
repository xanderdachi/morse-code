# Morse Club

A Morse code typing trainer built around something worth reading.

## What it is

You are shown a passage of world literature — a line of Shakespeare, a sentence from
Confucius, a Yoruba proverb, the opening of a Russian folk tale — and you transmit it in
Morse. You key it with the spacebar or with on-screen paddles, and the app watches what you
send. It says nothing while you are sending. When the run ends you get your accuracy, your
speed, and a character-by-character review of where you went wrong.

Errors are shown only after the run, never during it. This is deliberate. Live correction
turns transmitting into a game of reacting to feedback, and the thing you are trying to
build — the reflex that turns a letter into a rhythm without going through your conscious
mind — does not get built that way. You send the whole passage, then you find out.

The reading is half the point. The passages are short enough to key and good enough to be
worth keying, and each one comes with a line of context: who wrote it, when, and why it
matters. A session should leave you having practised Morse *and* having encountered
something you had not read before. If the app were only a typing trainer, the passages
could be random letters, and they are not.

## How it works

### The two input modes

**Straight key.** One key, held down. A short press is a dot, a long press is a dash, and
the boundary between them is your calibrated dot length. On a desktop this is the spacebar;
on a phone it is a single round key at the bottom of the screen. This is how a real straight
key works, and it is the harder of the two modes, because the difference between a dot and a
dash is entirely in your timing.

**Dot/dash pad.** Two keys: one makes a dot, one makes a dash, and a third button ends the
letter. On a desktop these are `.` and `-` with space to end a letter. This removes the
timing question from the elements themselves and leaves you with the letters, which is a
gentler place to start.

**The iambic keyer** sits on top of the pad. Instead of one tap per element, you *hold* a
paddle and the keyer generates elements at a fixed speed — dots while you hold the dot
paddle, dashes while you hold the dash paddle, and alternating dots and dashes while you
hold both. This is how most modern operators actually key. The speed is chosen in settings
rather than earned from your own hand, which is why iambic runs are scored in their own
division and never ranked against hand-timed ones.

**The iambic keyer is written and tested, and is not enabled for launch.** It runs away under
CPU load — see *Testing* for the numbers — so it sits behind `IAMBIC_ENABLED` in
`src/lib/features.js`, currently `false`. While that flag is off there is no keyer control in
settings at all, and anyone who had the mode selected before the flag flipped is moved back to
the manual pad when their progress loads, with their chosen speed kept for when it returns.
Nothing is deleted: the keyer, its tests and the pad's element pulse are all still in the tree,
and turning the flag on restores the controls.

### Anchored decoding

This is the part that makes the app work, and it is worth understanding.

A conventional Morse decoder has to work out where each letter ends purely from the silence
between marks: roughly one dot-length of silence inside a letter, three between letters.
That works for a fluent operator and is miserable for a beginner, because a beginner pauses
to think — and a pause in the middle of a letter gets read as a letter boundary, which
splits the letter in two and cascades into garbage for the rest of the word.

Morse Club knows the passage. At any moment it knows which letter you *should* be sending
and what that letter's code is. So instead of asking "has enough time passed?", it asks
"does what you have sent so far match the code I am expecting?" Marks accumulate in a
buffer, and:

- if the buffer equals the expected code, the letter commits immediately, and timing plays
  no part at all;
- if the buffer is a *prefix* of the expected code, it waits, however long you pause;
- if the buffer diverges from the expected code, the boundary is genuinely unknown, and it
  falls back to timing.

The consequence is that pausing mid-letter costs you nothing. You can stop halfway through a
`Q`, think about it, and finish it, and the app will still read a `Q`. For a learner this is
the difference between a tool that is usable and one that is not.

When you *do* send something wrong, the decoder drops onto an error path: it segments by
timing, and runs a beam of competing hypotheses about what actually happened (you sent the
wrong letter, you skipped a letter, you added one) in parallel until one of them resyncs
with three exact matches in a row. Real text repeats letter pairs, so two matches can be
coincidence. If nothing has matched for a long stretch, it gives up on the beam and
re-anchors wherever your recent letters best line up with the passage.

Anchoring decides *boundaries only*. A letter is always decoded from the marks you actually
sent, so sending a wrong symbol always produces a wrong letter. Anchoring can never flatter
you into a letter you did not key.

**The honest tradeoff:** because letter breaks follow the passage rather than your spacing,
an anchored run grades the dots and dashes inside each letter and does not grade your
spacing at all. You could run every letter together with no gaps and still score 100%. This
is why an anchored run is reported as **symbol accuracy**, not accuracy — the results screen
uses that label and says so on the review. It is a real limitation, not a rounding detail.

### Unanchored decoding

At tier five you can switch anchoring off, and then spacing counts.

Unanchored decoding gets no help from the passage. Every gap between marks is either inside
a letter or between letters, and rather than thresholding each gap on its own, the decoder
picks the segmentation of the *whole run* that best fits the observed gaps — a Viterbi pass
over the entire mark sequence, with costs in log space because timing error is
multiplicative rather than additive. Marks that form no valid code collapse into a single
garbled character rather than exploding into a run of them.

Deciding globally rather than gap-by-gap means late evidence can revise an early reading:
if the second half of your run establishes that your dot length drifted, the first half gets
re-segmented in that light. This is strictly harder than anchored mode, and it is the mode
that corresponds to real on-air operating, where nobody knows what you meant to send.

### Grading

A finished run is compared to the passage by Levenshtein edit-distance alignment,
case-insensitively. Spaces are never keyed, so they are never scored: the target is
stripped of spaces before comparison, and a forty-character passage with eight spaces is
scored out of thirty-two. Word breaks come back only for displaying the review.

Accuracy is `matches ÷ (target length + insertions)`. Insertions — letters you sent that
the passage does not contain — count in the denominator, so extra letters can never pad a
score. Sending a letter that is not there costs exactly as much as missing one that is. Without
this, the optimal strategy for a struggling operator would be to spray marks and hope, and
the number at the end would stop meaning anything.

### Tiers

There are five tiers, graded by passage length: tier one is a line, tier five is a
paragraph. Each tier presents a board of eight passages, and you must clear *all eight* —
80% accuracy or better on each — before the next tier opens. Clearing the tier-five board
finishes the game.

Higher tiers are also less forgiving in ways beyond length. Tiers one to three give you an
undo control and let you take a letter back with the error prosign for free. From tier four
the undo control is gone and a taken-back letter is graded as a letter you missed. Tier five
is where anchoring becomes optional. All of this lives in one table, `LENIENCY` in
`src/lib/progress.js`; nothing else in the app hardcodes a tier or a threshold, and if you
want to retune the difficulty curve, that table is the only place to do it.

Once a board is chosen it is remembered, so a later fetch can never swap in a passage you
have not seen. If a remembered passage goes inactive, only that slot is refilled.

### Progress

Everything the app remembers lives in a single `localStorage` key, `morse-club-v1`: your
tier, which passages you have cleared, your best score on each, your calibrated dot length,
and your settings. There are no accounts and no login, and nothing you do is sent anywhere.
The flip side is that clearing your site data clears your progress, and progress does not
follow you to another browser or another device.

`localStorage` can throw — Safari private browsing, blocked site data — so every read and
write is guarded, and the last saved state is also held in memory. If storage is
unavailable the app keeps working for the rest of the session and simply forgets when you
leave.

## The corpus

Every passage is public domain. That constraint is harder than it looks, and most of the
care in the corpus is about one thing: **a translation carries its own copyright term,
separate from the original work.**

Confucius died around 479 BCE and the *Analects* are unambiguously public domain. A 1998
English translation of the *Analects* is not — it is a 1998 literary work with a living
author and a publisher. The age of the original tells you nothing about the rights in the
translation. This catches people constantly, and it is the single most likely way for a
project like this to end up shipping something it has no right to ship.

So the rule is that the *translation* must be out of copyright, not merely the original.
This is why the `passages` table has a `license_note` column that is `not null`, and why
every translated row is expected to name its translator and the publication date rather than
just saying "public domain" — the note is the evidence, and a row that cannot produce one
does not belong in the table. It is also why the Indian texts use Victorian translations:
Max Müller's *Sacred Books of the East* and its contemporaries are the newest English
renderings of those works that are safely clear of copyright everywhere. They read stiffly
and they are not the best translations available. They are the best translations available
that can actually be used.

### `text_original` versus `text_morse_safe`

Each row stores the passage twice.

`text_original` is what you see: real punctuation, accents, typographic quotation marks —
*Petit à petit, l'oiseau fait son nid*, with the à and the curly apostrophe intact. Showing
the passage in a mangled form would be a small act of vandalism against the text, and the
whole premise of the app is that these passages are worth reading properly.

`text_morse_safe` is what you are graded against: the same passage normalised into
characters that exist in the Morse alphabet. Accents fold to their base letters, typographic
quotes become plain ones, and anything with no Morse representation is removed. Grading uses
this version, always, because grading you on a character you cannot possibly key would be
nonsense.

Keeping both means display honesty and grading fairness do not have to fight. The app
re-normalises `text_morse_safe` on read, so a badly seeded row stays playable, and in
development it warns to the console when the two columns disagree after normalisation —
because if they disagree, the on-screen cursor and the grader will disagree about where you
are, which is confusing in a way that is very hard to diagnose from the symptom.

### Where the passages come from

The table is defined in `supabase/migrations/0001_passages.sql`, which you run once in the
Supabase SQL editor. Rows are seeded through the Supabase dashboard.

There is no seed CSV and no corpus generator script in this repository. If you add one,
this is the section to update.

A small set of tier-one passages is bundled in the app at `src/data/passages.js` as a
fallback. These are used whenever Supabase cannot answer — not configured, offline, request
timed out, project paused, permissions wrong. The app is fully playable with no backend at
all; you just get the bundled passages instead of the full corpus, and a quiet line at the
bottom of the screen telling you so.

## Architecture

The app is Vite and React, styled with Tailwind, deployed on Cloudflare Pages. Framer Motion
does the animation. That is the whole stack.

### `src/morse/` is plain JavaScript

The decoding engine — the keyer, the anchored and unanchored segmenters, the grader, the
timing model, the iambic keyer — is plain JavaScript. No React, no DOM, no network, no
imports from anywhere else in the app except itself.

**This is deliberate and it should stay that way.** The engine is where all the difficulty
lives, and keeping it free of the browser means the entire thing can be tested headlessly:
you can synthesise a keystroke log, run it through the real engine, and assert on the real
output, thousands of times, in a plain Node process with no rendering and no clock to wait
for. The speed sweep runs the decoder at every speed from 5 to 50 WPM with timing jitter;
the stress suite plays whole runs live, waking at every deadline. None of that is possible
if the engine reaches for `window`.

The pressure to break this rule will come in the form of something small and reasonable —
just read a setting, just check a media query. Don't. Pass it in as an argument.

### `@supabase/postgrest-js`, not `supabase-js`

The app only ever does one thing against the backend: select rows from one table. It has no
accounts, no storage, no realtime and no edge functions. `supabase-js` is a bundle of clients
for all of those, constructed whether you use them or not, and shipping it would mean
sending users the code for five features to use one.

So the app talks to PostgREST directly, with the anon key sent as `apikey` and as the bearer
token exactly as `supabase-js` would send it. The wire format is identical; only the client
is smaller.

**If you ever add authentication, go back to `supabase-js`.** Auth is the one thing you
should not hand-roll on top of PostgREST: session handling, token refresh and the
storage of credentials are exactly the kind of thing that is easy to get subtly and
dangerously wrong. The moment there is a login screen, this optimisation has stopped paying
for itself.

The client is also loaded on demand, so the app and its bundled passages never wait on it,
and the fetch fails fast — six seconds, with PostgREST's own retrying turned off — because
the bundled passages are a better answer than a long skeleton screen.

## Running it

You need Node 22.12 or newer and npm. (Vite itself is happy from 20.19, but the test runner
is not, so 22.12 is the real floor.)

```
npm install
npm run dev       # dev server with hot reload
npm test          # the full suite, once
npm run test:watch
npm run lint      # oxlint
npm run build     # production build into dist/
npm run analyze   # build, plus a gzipped-size treemap in stats.html
```

The app runs with no configuration at all — without a backend it serves the bundled
passages. To connect it to Supabase, copy `.env.local.example` to `.env.local` and fill in
two variables:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Vite only exposes variables prefixed with `VITE_` to the client, and both of these are
exposed. **The anon key is public by design.** It is compiled into the JavaScript bundle
that every visitor downloads, and there is no way to ship a browser app that talks to
Supabase without it. Treating it as a secret is a category error.

What actually protects the data is row-level security. The `passages` table has RLS enabled
with exactly one policy: anyone may `select` rows where `active` is true. There is no
insert, update or delete policy, so those operations are impossible for the anon role no
matter what anyone does with the key. Writes happen through the dashboard or the service
role, and **the service role key never goes in this repository or in any `VITE_` variable.**

If you add tables, the same discipline applies: enable RLS and write the policy first, on
the assumption that the key is in the hands of everyone who has ever loaded the page —
because it is.

## Deployment

Cloudflare Pages builds directly from the connected GitHub repository. **Pushing to `main`
deploys.** That is the entire deployment process.

The Pages project is configured with build command `npm run build` and output directory
`dist`. The two environment variables are set in the Pages dashboard under Settings →
Environment variables, not committed to the repository.

There is no manual deploy command and no `wrangler` dependency, and **one should not be
added.** A second, imperative deploy path means it becomes possible to ship a build from
someone's laptop that does not correspond to any commit — and then the deployed site and
the repository have silently diverged, with no way to tell from either one. Building from
Git means what is live is always a commit you can name, check out and roll back to.

### Supabase keep-alive: don't delete it

`.github/workflows/supabase-keepalive.yml` runs once a day and reads a single active passage
from Supabase.

It exists because free Supabase projects pause after seven days with no API requests, and a
paused project does not look broken. The app falls back to its bundled passages, quietly and
by design, so a paused backend produces a site that still works and simply stops serving
most of the corpus. Nobody reports that, because nobody can see it. A daily read prevents
the pause, and a failed read fails the workflow, which makes GitHub email you.

The workflow fails when Supabase answers anything other than HTTP 200, and also when it
answers 200 with no active passages — which would mean an empty table or a broken RLS
policy, both of which leave the app on bundled passages just as surely as a pause does.

It needs two repository secrets under Settings → Secrets and variables → Actions, with the
same values as the app's environment variables: `SUPABASE_URL` and `SUPABASE_ANON_KEY`. With
the GitHub CLI, `gh secret set SUPABASE_URL` and `gh secret set SUPABASE_ANON_KEY` will each
prompt for the value. The key never goes in the workflow file. You can run the workflow by
hand from the Actions tab with *Run workflow* to check the secrets are right.

One thing to watch: **GitHub disables scheduled workflows on public repositories after 60
days with no repository activity**, and emails you when it does. If that email arrives,
re-enable the workflow from the Actions tab — otherwise the keep-alive stops, and seven days
later the thing it was preventing happens anyway.

## Testing

`npm test` runs the whole suite: 466 tests across 30 files, in a plain Node environment, in
about a minute and a half.

The suite exists because the engine's failure modes are not the kind you catch by using the
app. A decoder that is 98% correct feels fine in casual use and is infuriating over a long
session, and the difference between those two only shows up across thousands of runs.

**The synthetic keyer** (`src/morse/testing/syntheticKeyer.js`) generates the exact keystroke
log a real operator would produce for a given passage — presses of one or three units, gaps
of one, three and seven — with a seeded PRNG so noisy runs are reproducible from a seed, and
with realistic imperfection: timing jitter, speed drift over the course of a passage, and
beginner scenarios that stall, fumble and send the wrong thing. This lets the tests assert on
what the engine does with *human-shaped* input rather than with clean input.

**The speed sweep** (`scripts/measure/speed-sweep.mjs`) runs the decoder from 5 to 50 WPM in
2.5 WPM steps with ±20% timing jitter, anchored and unanchored, from both an uncalibrated
start and a correctly calibrated one, over real passages. It exists to catch the failure
where a change improves accuracy at comfortable speeds and quietly destroys it at the edges.

**The stress and recovery suites** (`src/morse/stress.test.js`, `misinput.test.js`,
`resync.test.js`) play whole runs live, waking the engine at every deadline as the browser
would, and check invariants rather than exact output: that the run always finalises on
silence alone, that it never finalises while the operator is still keying, that the buffer
never exceeds its bound, that the error-path beam always terminates. These are the tests
that catch hangs and runaway states, which are the failures that actually ruin a session.

### Current state, honestly

Straight key and manual pad are verified: **7,800 presses at 0.17 ms p99 timing error, with
zero drops.** That measurement comes from `scripts/measure/browser-pipeline.mjs`, which
drives a real production build in headless Chrome over CDP and compares every event it
dispatched against what the engine actually recorded. Those two modes can be trusted.

**The iambic keyer has a known runaway under CPU throttling, and is not enabled for launch.**
At 35 WPM with 4x throttling it sent **3,682 extra elements, with lag reaching 42 seconds** — a
burst it never recovers from, which in a run means a cascade of wrong letters the operator
cannot key their way out of. A mid-range phone under load reaches this, so the keyer ships off
rather than late: `IAMBIC_ENABLED` in `src/lib/features.js` is `false`, and that flag is the
only thing standing between the code and the player.

`npm run build` plus `node scripts/measure/browser-pipeline.mjs run --iambic-load` reproduces
it, sweeping 15 / 25 / 35 WPM against 1x, 4x and 6x throttling and failing any run that sends
five or more extra elements. That sweep must pass at every speed and throttle — not just at 1x
— before the flag goes back to `true`. This is a real open bug, not a caveat.

The straight key and the manual pad do not share the code path, which is why they are
unaffected and why the flag is enough. The keyer's own unit tests still run on every `npm test`;
the tests that drive its settings controls skip themselves while the flag is false and come
back the moment it is true, so the feature cannot rot while it is parked.

`scripts/measure/real-device-test.md` is a manual checklist for one Android phone and one
iPhone, covering the things no headless browser can tell you: whether the sidetone survives
the iPhone silent switch, whether a notification arriving mid-dash leaves a stuck key,
whether the screen wake lock holds through a long slow passage. Run it before shipping
anything that touches input.

## Credits

Created by Sehel x Claude.
