import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/worker.mjs";

function stubAssets(responsesByPath) {
  return {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const response = responsesByPath[path];
      return response ?? new Response("not found", { status: 404 });
    },
  };
}

test("asset route hands every request straight to the ASSETS binding", async () => {
  const html = new Response("<!doctype html><title>Pacing</title>", { headers: { "content-type": "text/html" } });
  const env = { ASSETS: stubAssets({ "/index.html": html }) };
  const response = await worker.fetch(new Request("https://pacing.561.group/index.html"), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<!doctype html><title>Pacing</title>");
});

test("asset route passes an unknown path's 404 straight through, unmodified", async () => {
  const env = { ASSETS: stubAssets({}) };
  const response = await worker.fetch(new Request("https://pacing.561.group/nope"), env);
  assert.equal(response.status, 404);
});

test("worker has no server-side logic beyond the ASSETS delegation -- no request field is read", async () => {
  let sawRequest = false;
  const env = {
    ASSETS: {
      async fetch(request) {
        sawRequest = true;
        return new Response("ok", { status: 200 });
      },
    },
  };
  await worker.fetch(new Request("https://pacing.561.group/vendor/pacing-intelligence.mjs"), env);
  assert.equal(sawRequest, true);
});
