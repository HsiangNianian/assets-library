import { expect, test } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZGroAAAAASUVORK5CYII=",
  "base64",
);

test("overview and upload pages expose the MVP scope", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "素材库" })).toBeVisible();
  await expect(
    page.getByText("已审核并可供使用的素材"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "待入库", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "已入库", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "按标签搜索已入库素材" }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("搜索标签、场景或风格"),
  ).toBeVisible();
  await page.getByRole("link", { name: "列表视图" }).click();
  await expect(page).toHaveURL(/layout=list/);
  await page.getByRole("link", { name: "画廊视图" }).click();
  await expect(page).not.toHaveURL(/layout=list/);
  await page.getByRole("link", { name: "待入库", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "按标签搜索已入库素材" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: /上传素材/ }).click();
  await expect(page.getByRole("heading", { name: "上传素材" })).toBeVisible();
  await expect(page.getByText(/自动提取 1–5 张关键帧/)).toBeVisible();
  await expect(page.getByText(/支持一次选择多个本地素材并逐个上传/)).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveAttribute(
    "accept",
    /video\/mp4/,
  );
  await expect(page.locator('input[type="file"]')).toHaveAttribute("multiple");

  await page.locator('input[type="file"]').setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: png },
    { name: "second.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByText("first.png", { exact: true })).toBeVisible();
  await expect(page.getByText("second.png", { exact: true })).toBeVisible();
  await expect(page.getByLabel("first.png 预览")).toBeHidden();
  await page.getByText("first.png", { exact: true }).hover();
  await expect(page.getByLabel("first.png 预览")).toBeVisible();
  await expect(page.getByAltText("first.png 预览")).toBeVisible();
  await expect(page.getByLabel("second.png 预览")).toBeHidden();
  await expect(page.getByTestId("upload-dropzone")).toHaveCSS(
    "height",
    "256px",
  );
  const listCanScroll = await page
    .getByRole("list", { name: "上传素材列表" })
    .evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(listCanScroll).toBe(true);
});

test("submits every selected asset as an independent upload", async ({
  page,
}) => {
  let uploadCount = 0;
  await page.route("**/api/uploads**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && pathname === "/api/uploads") {
      uploadCount += 1;
      const suffix = String(uploadCount).padStart(12, "0");
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          uploadId: `00000000-0000-4000-8000-${suffix}`,
          assetId: `10000000-0000-4000-8000-${suffix}`,
          mediaType: "image",
          processingStatus: "queued",
          reviewStatus: "pending_review",
          progressPercent: 10,
          failureCode: null,
          failureMessage: null,
        }),
      });
      return;
    }
    if (request.method() === "GET" && pathname.startsWith("/api/uploads/")) {
      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "temporarily unavailable",
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: png },
    { name: "two.png", mimeType: "image/png", buffer: png },
  ]);
  await page.getByRole("button", { name: "开始上传" }).click();

  await expect.poll(() => uploadCount).toBe(2);
  await expect(
    page.getByText("所选素材均已提交，可在素材概览继续查看状态。"),
  ).toBeVisible();
  const firstItem = page
    .getByRole("listitem")
    .filter({ hasText: "one.png" });
  await firstItem.hover();
  await expect(
    firstItem.getByText(
      "无法获取处理状态（HTTP 503），请前往素材概览查看。",
    ),
  ).toBeVisible();
});
