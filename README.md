# Morse Club

A Morse code typing trainer built around something worth reading.

Live at **[morseclub.org](https://morseclub.org/)**.

## What it is

You're shown a short passage of world literature — a line of Shakespeare, a haiku by Basho, a
saying of Confucius — and you send it in Morse code, one letter at a time. When you finish, you
get your accuracy, your speed and a letter-by-letter review of your mistakes. Nothing is
corrected while you're sending: you send the whole passage, then you find out.

There are five tiers, from single lines up to full paragraphs. Clear all eight passages in a
tier with at least 80% accuracy to unlock the next one.

There are no accounts. Your progress is saved in your browser, so it stays on that device.

## How to play

- **Straight key**: one key. A short press is a dot, a long press is a dash. It's the spacebar
  on a computer and the round key on a phone.
- **Dot/dash pad**: separate keys for dot and dash (`.` and `-` on a keyboard, with space to end
  a letter). The easier place to start.
- **Iambic keyer**: optional, in settings. Hold a key and it sends dots or dashes at a steady
  speed.

## Running it locally

You need **Node 22.12 or newer** and npm.

```sh
npm install
npm run dev
```

That's all you need to play. With no database connected, the app uses a small set of built-in
passages.

```sh
npm test        # run the tests
npm run lint    # check the code
npm run build   # production build into dist/
```

## The passage library (optional)

The full library lives in a [Supabase](https://supabase.com) database. To connect one:

1. Create a Supabase project and run `supabase/migrations/0001_passages.sql` in its SQL editor.
2. Add passages in the Supabase dashboard.
3. Copy `.env.local.example` to `.env.local` and set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` to your project's URL and its publishable (anon) key.

If the database can't be reached, the app quietly falls back to the built-in passages.

The anon key ends up in the site's JavaScript, and that's fine: the database only lets the
public read active passages. Never put the service-role key in this repo or in a `VITE_`
variable.

Every passage must be public domain. For a translation, the *translation* has to be out of
copyright, not just the original, so note who translated it and when. The built-in passages
are in `src/data/passages.js`.

## Deploying

The site runs on Cloudflare Workers, and pushing to `main` deploys it. The Cloudflare settings
are in `wrangler.jsonc`, and the two `VITE_SUPABASE_` values are set in the Cloudflare
dashboard.

Free Supabase projects pause after a week without requests, so a GitHub Action
(`.github/workflows/supabase-keepalive.yml`) reads one passage a day. It needs two repository
secrets holding the same two values: `SUPABASE_URL` and `SUPABASE_ANON_KEY`. GitHub switches
off scheduled workflows in public repos after 60 days without activity, and emails you when it
does. If that happens, turn it back on from the Actions tab, or Supabase will pause a week
later.

## Credits

Created by Sehel x Claude.
