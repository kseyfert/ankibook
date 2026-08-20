import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** root задан явно: иначе Vite берёт корнем текущую директорию,
 *  и запуск из корня проекта не находит index.html. */
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  server: {
    port: 3000,
    proxy: { '/api': 'http://localhost:3001' },
  },
  plugins: [react()],
});