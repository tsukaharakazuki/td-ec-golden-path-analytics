import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Builds one self-contained index.html. The same file is:
//  - the GitHub Pages viewer (drop a bundle JSON or open the sample)
//  - the template the CLI fills with data (skills/.../assets/dashboard-template.html)
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: { target: 'es2020', assetsInlineLimit: 100000000, cssCodeSplit: false },
})
