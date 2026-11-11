import react from '@vitejs/plugin-react'
import { cpSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

const repo = resolve(import.meta.dirname, '..')

// Publish rules/ and the simulator next to the page, so the page, the
// simulator worker and the rules-helper function all read the same versions.
function publishRulesAndSim(): Plugin {
  return {
    name: 'publish-rules-and-sim',
    apply: 'build',
    closeBundle() {
      const out = resolve(import.meta.dirname, 'dist')
      cpSync(resolve(repo, 'rules'), resolve(out, 'rules'), { recursive: true })
      mkdirSync(resolve(out, 'sim'), { recursive: true })
      cpSync(resolve(repo, 'sim/street_level_sim.py'), resolve(out, 'sim/street_level_sim.py'))
    },
  }
}

export default defineConfig({
  // Relative base + hash routing: works at https://<user>.github.io/<repo>/
  base: './',
  plugins: [react(), publishRulesAndSim()],
  server: { fs: { allow: [repo] } },
  test: { include: ['src/**/*.test.ts'] },
})
