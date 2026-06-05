import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src")
        }
    },
    // 防止 CORS 问题
    server: {
        port: 5173,
        strictPort: true,
    },
    // 确保输出到 dist 目录
    build: {
        outDir: 'dist',
        // 避免类型检查导致构建失败
        sourcemap: true,
        emptyOutDir: true,
    },
    // 为 Tauri 开发优化
    clearScreen: false,
    // 使用相对路径
    base: './',
    // 解决类型问题
    esbuild: {
        logOverride: { 'this-is-undefined-in-esm': 'silent' }
    },
});
