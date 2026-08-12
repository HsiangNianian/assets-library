import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // 两个 MySQL 集成套件共享受保护的 *_test 数据库；文件级串行可避免
    // 各套件的 TRUNCATE 生命周期互相污染，同时单个套件内部仍可测试并发。
    fileParallelism: false,
    coverage: { reporter: ["text", "html"] },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
