import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Mirrors the "@/*" path alias from tsconfig.json so tests import code the same way the app does.
// Component tests opt in to a simulated browser with a "// @vitest-environment jsdom" comment at the top of the
// file; everything else (pricing, validation, guards) stays in plain Node, which is faster and stricter.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { include: ['lib/**/*.test.ts', 'components/**/*.test.tsx', 'app/**/*.test.tsx'] },
});
