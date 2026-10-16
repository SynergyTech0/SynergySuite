import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // The API (apps/books/api) on its suite port; sign in locally with DEV_USER_EMAIL.
        target: 'http://localhost:3055',
        changeOrigin: true,
      },
    },
  },
});
