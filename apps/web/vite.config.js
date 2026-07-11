import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/health": "http://127.0.0.1:8787",
      "/auth": "http://127.0.0.1:8787",
      "/users": "http://127.0.0.1:8787",
      "/conversations": "http://127.0.0.1:8787",
      "/messages": "http://127.0.0.1:8787",
      "/config": "http://127.0.0.1:8787",
    },
  },
});
