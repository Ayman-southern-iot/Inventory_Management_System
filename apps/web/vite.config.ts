import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// Vite config runs in Node before the app exists, so reading env here is the sanctioned
// exception to the "no process.env" rule — it is configuration, and it is one file.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devPort = Number(env.WEB_PORT ?? 5173);
  const apiTarget = env.VITE_DEV_API_PROXY_TARGET ?? 'http://127.0.0.1:3000';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: devPort,
      strictPort: true,
      // Lets the SPA call same-origin `/api/v1/...` in dev exactly as it does behind Caddy
      // in production, so there is no environment-specific URL logic in the app code.
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/socket.io': { target: apiTarget, ws: true, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
