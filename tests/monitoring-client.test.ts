import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sendTelemetry, reportClientError } from "../src/lib/monitoring-client";

const originalMode = process.env.NODE_ENV;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
const originalFetch = globalThis.fetch;
Object.assign(process.env, { NODE_ENV: "production" });
Object.defineProperty(globalThis, "location", { configurable: true, value: { pathname: "/works/private-name" } });
after(() => {
  if (originalMode === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Object.assign(process.env, { NODE_ENV: originalMode });
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
  if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
  else Reflect.deleteProperty(globalThis, "location");
  globalThis.fetch = originalFetch;
});

test("beacon transport sends a small JSON body and has a keepalive fallback when not queued", async () => {
  let beaconBody: Blob | undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    sendBeacon: (url: string, body: Blob) => { assert.equal(url, "/api/telemetry"); beaconBody = body; return true; },
  } });
  const event = { kind: "vital" as const, id: "sample", path: "/archive", name: "LCP" as const, value: 1200 };
  sendTelemetry(event);
  assert.equal(beaconBody?.type, "application/json");
  assert.deepEqual(JSON.parse(await beaconBody!.text()), event);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: () => false } });
  let options: RequestInit | undefined;
  globalThis.fetch = (async (url, init) => { assert.equal(url, "/api/telemetry"); options = init; return new Response(null, { status: 204 }); }) as typeof fetch;
  sendTelemetry(event);
  assert.equal(options?.keepalive, true);
  assert.equal(options?.credentials, "omit");
  assert.deepEqual(JSON.parse(options?.body as string), event);
  globalThis.fetch = async () => { throw new Error("offline"); };
  assert.doesNotThrow(() => sendTelemetry(event));
  await Promise.resolve();
});

test("client error reporting deduplicates objects, removes private details and caps repeated failures", async () => {
  const reports: Blob[] = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    sendBeacon: (_url: string, body: Blob) => { reports.push(body); return true; },
  } });
  const error = Object.assign(new TypeError("secret user input"), { digest: "12345" });
  reportClientError(error, "client-error");
  reportClientError(error, "render-error");
  assert.equal(reports.length, 1);
  const report = JSON.parse(await reports[0].text());
  assert.equal(report.name, "TypeError");
  assert.equal(report.path, "/works/[slug]");
  assert.equal(report.digest, "12345");
  assert.ok(!JSON.stringify(report).includes("secret"));
  for (let index = 0; index < 20; index++) reportClientError(new Error(`private-${index}`), "unhandled-rejection");
  assert.equal(reports.length, 10);
});

test("development does not send production telemetry", () => {
  Object.assign(process.env, { NODE_ENV: "development" });
  let calls = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: () => { calls++; return true; } } });
  sendTelemetry({ kind: "vital", id: "dev", path: "/", name: "CLS", value: 0 });
  assert.equal(calls, 0);
});
