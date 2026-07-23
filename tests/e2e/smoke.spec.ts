import { expect, test } from "@playwright/test";

test("overview and upload pages expose the MVP scope", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "素材概览" })).toBeVisible();
  await page.getByRole("link", { name: /上传素材/ }).click();
  await expect(page.getByRole("heading", { name: "上传素材" })).toBeVisible();
  await expect(page.getByText(/不支持音频、URL、批量上传和转码/)).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveAttribute(
    "accept",
    /video\/mp4/,
  );
});
