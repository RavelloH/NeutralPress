import "server-only";

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("请求内容过大");
    this.name = "RequestBodyTooLargeError";
  }
}

/** 在读取流的过程中执行上限，避免无 Content-Length 时先缓冲整个请求。 */
export async function readRequestBodyWithLimit(
  request: Pick<Request, "headers" | "body">,
  maxBytes: number,
): Promise<ArrayBuffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("请求体大小上限必须为正整数");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (
      !/^\d+$/.test(contentLength) ||
      !Number.isSafeInteger(declared) ||
      declared > maxBytes
    ) {
      if (request.body && !request.body.locked) {
        void request.body.cancel().catch(() => undefined);
      }
      throw new RequestBodyTooLargeError();
    }
  }

  if (!request.body) {
    return new ArrayBuffer(0);
  }

  const reader = request.body.getReader();
  let buffer = new ArrayBuffer(Math.min(maxBytes, 64 * 1024));
  let bytes = new Uint8Array(buffer);
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const nextTotal = totalBytes + value.byteLength;
      if (nextTotal > maxBytes) {
        // 不等待底层取消完成，以免恶意流阻塞超限响应。
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      if (nextTotal > bytes.byteLength) {
        const expanded = new ArrayBuffer(
          Math.min(maxBytes, Math.max(bytes.byteLength * 2, nextTotal)),
        );
        const expandedBytes = new Uint8Array(expanded);
        expandedBytes.set(bytes.subarray(0, totalBytes));
        buffer = expanded;
        bytes = expandedBytes;
      }
      bytes.set(value, totalBytes);
      totalBytes = nextTotal;
    }
  } finally {
    reader.releaseLock();
  }

  return totalBytes === buffer.byteLength
    ? buffer
    : buffer.slice(0, totalBytes);
}
