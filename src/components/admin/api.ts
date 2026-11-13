export function adminUpload<T>(
  url: string,
  data: FormData,
  onProgress: (percent: number | null) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      onProgress(
        event.lengthComputable && event.total > 0
          ? Math.min(99, Math.floor((event.loaded / event.total) * 100))
          : null,
      );
    };
    // Sending the file and generating its display images are separate stages.
    request.upload.onload = () => onProgress(100);
    request.onload = () => {
      const result = request.response;
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(result?.error || result?.message || "上传失败，请重试"));
      } else if (!result) {
        reject(new Error("服务器响应异常，请刷新照片列表后重试"));
      } else {
        resolve(result as T);
      }
    };
    request.onerror = () => reject(new Error("网络连接失败，请检查网络后重试"));
    request.onabort = () => reject(new Error("上传已中断，请重试"));
    request.ontimeout = () => reject(new Error("上传超时，请重试"));
    request.send(data);
  });
}

export async function adminRequest<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers:
      body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || result.message || "请求失败，请重试");
  return result;
}
