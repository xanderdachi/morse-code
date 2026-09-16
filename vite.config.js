import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // `npm run analyze`: a gzipped-size treemap of what the build ships, in stats.html.
    mode === 'analyze' && visualizer({ filename: 'stats.html', template: 'treemap', gzipSize: true }),
  ],
  build: {
    // Off explicitly (Vite's default): production ships no source maps.
    sourcemap: false,
  },
  test: {
    include: ['src/**/*.test.{js,jsx}'],
    environment: 'node',
  },
}))
