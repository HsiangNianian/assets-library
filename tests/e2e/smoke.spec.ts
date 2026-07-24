import { expect, test } from "@playwright/test";

test("overview and upload pages expose the MVP scope", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "素材概览" })).toBeVisible();
  await expect(
    page.getByText("上传成功的素材会立即出现在这里，可查看处理状态并完成入库。"),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "按标签搜索素材" })).toBeVisible();
  await expect(page.getByText("仅匹配标签内容，不搜索素材名称或描述。")).toBeVisible();
  await page.getByRole("link", { name: /上传素材/ }).click();
  await expect(page.getByRole("heading", { name: "上传素材" })).toBeVisible();
  await expect(page.getByText(/自动提取 1–5 张关键帧/)).toBeVisible();
  await expect(page.getByText(/不支持音频、URL、批量上传和转码/)).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveAttribute(
    "accept",
    /video\/mp4/,
  );
});
