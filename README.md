# React + Vite

## Supabase keep-alive: don't delete it

`.github/workflows/supabase-keepalive.yml` runs once a day and reads one active passage from Supabase.

- **Why it exists:** free Supabase projects pause after seven days with no API requests. A paused project doesn't look broken. The app quietly falls back to its bundled passages, so a quiet week would go unnoticed and unreported.
- **What it checks:** the workflow fails, and GitHub emails you, when Supabase answers anything but HTTP 200, or answers 200 with no active passages.
- **Setup:** add two repository secrets under Settings → Secrets and variables → Actions:
  - `SUPABASE_URL`, the same value as `VITE_SUPABASE_URL`
  - `SUPABASE_ANON_KEY`, the same value as `VITE_SUPABASE_ANON_KEY`

  With the GitHub CLI, run `gh secret set SUPABASE_URL` and `gh secret set SUPABASE_ANON_KEY`; each prompts for its value. The key never goes in the workflow file.
- **Check it:** start it by hand from the Actions tab with *Run workflow*.
- **Watch for:** GitHub turns scheduled workflows off after 60 days with no repository activity in a public repository, and it emails you when it does. If that email arrives, re-enable the workflow from the Actions tab.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
