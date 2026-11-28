import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: [
    { find: /^@\/api\/product$/, replacement: fileURLToPath(new URL("./src/pgw-api-mock.js", import.meta.url)) },
    { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }
  ] },
  optimizeDeps: { entries: ["pgw-preview.html"] },
  server: { host: "127.0.0.1", port: 5199, fs: { allow: [".."] } }
});
