import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyUiApi } from "@/server/api/ui-proxy";

describe("same-origin UI API proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves the v1 path without injecting credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ task_id: "task" }, { status: 202 }),
    );
    const response = await proxyUiApi(
      new Request("http://localhost/api/ui/v1/tasks/abc?full=1", {
        headers: {
          origin: "http://localhost",
          "sec-fetch-site": "same-origin",
          cookie: "local-preference=value",
        },
      }),
      ["tasks", "abc"],
    );
    expect(response.status).toBe(202);
    const [target, init] = fetchMock.mock.calls[0]!;
    expect(String(target)).toBe("http://localhost/api/v1/tasks/abc?full=1");
    const forwardedHeaders = new Headers(init?.headers);
    expect(forwardedHeaders.get("x-api-key")).toBeNull();
    expect(forwardedHeaders.get("cookie")).toBeNull();
  });

  it("accepts the browser public Host when Next.js uses an internal URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ status: "done" }),
    );
    const response = await proxyUiApi(
      new Request("http://localhost:23015/api/ui/v1/tasks/abc", {
        headers: {
          host: "127.0.0.1:23015",
          origin: "http://127.0.0.1:23015",
          "sec-fetch-site": "same-origin",
        },
      }),
      ["tasks", "abc"],
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not forward cookies and rejects cross-origin browser calls", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await proxyUiApi(
      new Request("http://localhost/api/ui/v1/tasks/abc", {
        headers: {
          origin: "https://attacker.example",
          cookie: "session=private",
        },
      }),
      ["tasks", "abc"],
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a same-origin request without a login session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ status: "done" }),
    );
    const response = await proxyUiApi(
      new Request("http://localhost/api/ui/v1/tasks/abc", {
        headers: { origin: "http://localhost" },
      }),
      ["tasks", "abc"],
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
