// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

import tailwindcss from '@tailwindcss/vite';

const site = process.env.ASTRO_SITE;
const base = process.env.ASTRO_BASE;

// https://astro.build/config
export default defineConfig({
  integrations: [react()],

  vite: {
    plugins: [tailwindcss()]
  },
  ...(site ? { site } : {}),
  ...(base ? { base } : {}),
});