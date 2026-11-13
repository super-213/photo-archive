import assert from "node:assert/strict";
import { after, test } from "node:test";
import { adminUpload } from "../src/components/admin/api";

class UploadRequest {
  static latest: UploadRequest;
  method = "";
  url = "";
  body?: FormData;
  responseType = "";
  status = 0;
  response: unknown = null;
  upload = {
    onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null,
    onload: null as (() => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  constructor() { UploadRequest.latest = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  send(body: FormData) { this.body = body; }
}

const original = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: UploadRequest });
after(() => {
  if (original) Object.defineProperty(globalThis, "XMLHttpRequest", original);
  else Reflect.deleteProperty(globalThis, "XMLHttpRequest");
});

test("photo upload reports byte progress and waits for image processing before resolving", async () => {
  const body = new FormData();
  body.set("file", new Blob(["photo"], { type: "image/jpeg" }), "photo.jpg");
  const progress: (number | null)[] = [];
  let finished = false;
  const result = { photo: { id: "uploaded-photo" }, duplicate: false };
  const pending = adminUpload("/api/admin/photos", body, (percent) => progress.push(percent))
    .then((value) => { finished = true; return value; });
  const request = UploadRequest.latest;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/api/admin/photos");
  assert.equal(request.body, body);
  request.upload.onprogress!({ lengthComputable: true, loaded: 50, total: 100 });
  request.upload.onprogress!({ lengthComputable: true, loaded: 100, total: 100 });
  request.upload.onload!();
  await Promise.resolve();
  assert.deepEqual(progress, [50, 99, 100]);
  assert.equal(finished, false);
  request.status = 201;
  request.response = result;
  request.onload!();
  assert.deepEqual(await pending, result);
});

test("unknown transfer size stays indeterminate instead of inventing a percentage", async () => {
  const progress: (number | null)[] = [];
  const pending = adminUpload("/api/admin/photos", new FormData(), (percent) => progress.push(percent));
  const request = UploadRequest.latest;
  request.upload.onprogress!({ lengthComputable: false, loaded: 50, total: 0 });
  request.upload.onprogress!({ lengthComputable: true, loaded: 50, total: 0 });
  assert.deepEqual(progress, [null, null]);
  request.status = 201;
  request.response = { photo: { id: "existing" }, duplicate: true };
  request.onload!();
  assert.deepEqual(await pending, request.response);
});

test("upload surfaces server errors and handles non-JSON proxy responses", async () => {
  for (const [status, response, message] of [
    [429, { error: "正在处理其他照片，请稍后重试" }, /正在处理其他照片/],
    [413, null, /上传失败，请重试/],
    [200, null, /服务器响应异常/],
  ] as const) {
    const pending = adminUpload("/api/admin/photos", new FormData(), () => {});
    const request = UploadRequest.latest;
    request.status = status;
    request.response = response;
    request.onload!();
    await assert.rejects(pending, message);
  }
});

test("network interruption, abort, and timeout reject so the queue can offer retry", async () => {
  for (const [event, message] of [
    ["onerror", /网络连接失败/],
    ["onabort", /上传已中断/],
    ["ontimeout", /上传超时/],
  ] as const) {
    const pending = adminUpload("/api/admin/photos", new FormData(), () => {});
    UploadRequest.latest[event]!();
    await assert.rejects(pending, message);
  }
});
