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

  /*
   * When this bundle was built, shown on the login page.
   *
   * A literal date in the source would be wrong the day after somebody wrote it, and would
   * still read as today's while the browser served a week-old bundle from cache. Stamped here
   * it cannot disagree with the code around it: the value is created by the build that
   * produced the file, so a stale page shows a stale date, which is the useful answer.
   */
  const builtAt = new Date().toISOString();

  return {
    define: {
      __BUILD_TIME__: JSON.stringify(builtAt),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: devPort,
      strictPort: true,
      // Listen on every interface (IPv4 + IPv6) so the SPA is reachable as both `localhost` and
      // `127.0.0.1`. Without this, Windows resolves `localhost` to `::1` first and a request to
      // `http://127.0.0.1:5173` is refused, which makes the login page look unreachable.
      host: true,
      // Lets the SPA call same-origin `/api/v1/...` in dev exactly as it does behind Caddy
      // in production, so there is no environment-specific URL logic in the app code.
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/socket.io': { target: apiTarget, ws: true, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      // No error-reporting service consumes these yet (Phase 06 adds monitoring), so shipping
      // 1.5 MB of readable source to every browser buys nothing.
      sourcemap: false,
    },
  };
});
