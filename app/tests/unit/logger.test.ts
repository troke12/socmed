import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "@/lib/observability/logger";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("emits JSON to console.log for info", () => {
    log.info("hello", { foo: 1 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const out = logSpy.mock.calls[0]![0] as string;
    const j = JSON.parse(out);
    expect(j.level).toBe("info");
    expect(j.msg).toBe("hello");
    expect(j.foo).toBe(1);
  });

  it("emits to console.error for error", () => {
    log.error("boom");
    expect(errSpy).toHaveBeenCalledTimes(1);
    const j = JSON.parse(errSpy.mock.calls[0]![0] as string);
    expect(j.level).toBe("error");
  });

  it("child adds context", () => {
    log.child({ requestId: "r1" }).info("nested");
    const j = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(j.requestId).toBe("r1");
  });
});
