import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRateLimiter } from "../src/rateLimit.js";

describe("límite por ventana", () => {
  it("bloquea al llegar al máximo y libera al vencer la ventana", () => {
    let time = 0;
    const limiter = createRateLimiter(2, 1_000, () => time);
    limiter.record("a");
    assert.equal(limiter.retryAfter("a"), 0);
    limiter.record("a");
    assert.equal(limiter.retryAfter("a"), 1);
    assert.equal(limiter.retryAfter("b"), 0);
    time = 1_000;
    assert.equal(limiter.retryAfter("a"), 0);
  });

  it("reinicia una clave", () => {
    const limiter = createRateLimiter(1, 1_000);
    limiter.record("a");
    assert.ok(limiter.retryAfter("a") > 0);
    limiter.reset("a");
    assert.equal(limiter.retryAfter("a"), 0);
  });
});
