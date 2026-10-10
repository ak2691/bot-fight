import { readFileSync } from "node:fs"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
export default defineConfig({
  define: { 'import.meta.env.VITE_BUILD_VERSION': JSON.stringify(readBuildVersion()) },
  plugins: [react(), tailwindcss()],
  // The gameplay data in ../shared/gameplay is read by the dev server too.
  server: { fs: { allow: ['..'] } },
})

function readBuildVersion() {
  try { return readFileSync(new URL('../shared/build-version.txt', import.meta.url), 'utf8').trim() }
  catch { return 'development' }
}
