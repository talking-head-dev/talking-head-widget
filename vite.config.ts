import { configDefaults, defineConfig } from "vitest/config";

/*
  Two library builds into dist/:
  - `vite build`: ESM for npm, `three` left as an import (a dependency): widget.js (the mount code; three.js and the
    viewport are a separate chunk it imports when the widget first shows) and head.js (the head modules).
  - `vite build --mode iife`: one file for a <script> tag, three.js bundled: talking-head-widget.iife.js.
*/
export default defineConfig(({ mode }) => {
  const iife = mode === "iife";
  return {
    build: {
      target: "es2022",
      emptyOutDir: !iife,
      sourcemap: true,
      lib: iife
        ? { entry: "src/iife.ts", name: "TalkingHeadWidget", formats: ["iife"], fileName: () => "talking-head-widget.iife.js" }
        : { entry: { widget: "src/index.ts", head: "src/head.ts" }, formats: ["es"] },
      rolldownOptions: iife
        ? { output: { codeSplitting: false } }
        : { external: [/^three($|\/)/], output: { chunkFileNames: "chunks/[name]-[hash].js" } },
    },
    test: {
      environment: "jsdom",
      globals: true,
      include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
      exclude: [...configDefaults.exclude],
    },
  };
});
