import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The gameplay data in ../shared/gameplay is read by the dev server too.
  server: { fs: { allow: ['..'] } },
})
