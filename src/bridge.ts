// stdio → Streamable HTTP 的透明转发：每条消息单独 POST 到端点，只按规范补 HTTP 请求头，
// 不理解、不改写消息内容，也不在新旧两代协议之间转换。
// 请求头规则见 https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http

export const DEFAULT_ENDPOINT = "https://jiajia.fun/mcp";

const MODERN_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
// 新一代协议里这几个方法要带 Mcp-Name，取 params.name 或 params.uri。
const NAMED_METHODS = new Set(["tools/call", "resources/read", "prompts/get"]);
// 实现自定义的服务端错误码（JSON-RPC 保留 -32000 到 -32099 给实现使用）。
const BRIDGE_ERROR = -32000;

type Id = string | number;
type Message = Record<string, unknown>;

export interface BridgeOptions {
  endpoint: string;
  key?: string;
  userAgent: string;
  write: (line: string) => void;
  log: (message: string) => void;
  fetch?: typeof fetch;
}

export interface Bridge {
  handleLine(line: string): void;
  drain(): Promise<void>;
}

export function createBridge(options: BridgeOptions): Bridge {
  const fetchImpl = options.fetch ?? fetch;
  const inflight = new Map<Id, AbortController>();
  const pending = new Set<Promise<void>>();
  // 旧一代协议在 initialize 里协商版本，之后的请求都要带上它。
  let legacyVersion: string | undefined;

  function send(message: unknown): void {
    options.write(JSON.stringify(message));
  }

  function handleLine(line: string): void {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      send(errorResponse(null, -32700, "Parse error"));
      return;
    }
    if (!isObject(message)) {
      // 服务端不接受批量请求，一个请求体只放一条消息。
      send(errorResponse(null, -32600, "Invalid Request：每行只能是一条 JSON-RPC 消息"));
      return;
    }
    const id = requestId(message);
    if (typeof message.method !== "string") {
      if (!("result" in message) && !("error" in message)) {
        send(errorResponse(id ?? null, -32600, "Invalid Request"));
      } else {
        options.log("忽略客户端发来的响应：服务端不会向客户端发请求");
      }
      return;
    }
    if (message.method === "notifications/cancelled") {
      // HTTP 上取消请求就是断开它的响应流，不再单独发通知。
      const target = isObject(message.params) ? message.params.requestId : undefined;
      if (typeof target === "string" || typeof target === "number") inflight.get(target)?.abort();
      return;
    }
    const task = forward(message, id);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }

  async function forward(message: Message, id: Id | undefined): Promise<void> {
    const controller = new AbortController();
    if (id !== undefined) inflight.set(id, controller);
    try {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: requestHeaders(message),
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      await relay(message, id, response);
    } catch (error) {
      if (controller.signal.aborted) return;
      fail(id, `无法连接 ${options.endpoint}：${describe(error)}`);
    } finally {
      if (id !== undefined) inflight.delete(id);
    }
  }

  function requestHeaders(message: Message): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "user-agent": options.userAgent,
    };
    if (options.key) headers.authorization = `Bearer ${options.key}`;
    const method = message.method as string;
    const params = isObject(message.params) ? message.params : undefined;
    const meta = params && isObject(params._meta) ? params._meta : undefined;
    const modernVersion = meta?.[MODERN_VERSION_KEY];
    if (typeof modernVersion === "string") {
      headers["mcp-protocol-version"] = modernVersion;
      headers["mcp-method"] = method;
      const name = params?.name ?? params?.uri;
      if (NAMED_METHODS.has(method) && typeof name === "string") {
        headers["mcp-name"] = encodeHeaderValue(name);
      }
      // 夹夹的工具不声明 x-mcp-header，所以不转写 Mcp-Param-* 请求头。
    } else if (legacyVersion && method !== "initialize") {
      headers["mcp-protocol-version"] = legacyVersion;
    }
    return headers;
  }

  async function relay(request: Message, id: Id | undefined, response: Response): Promise<void> {
    const type = response.headers.get("content-type") ?? "";
    if (response.ok && type.includes("text/event-stream") && response.body) {
      let answered = false;
      for await (const data of readSse(response.body)) {
        const body = parseJson(data);
        if (body === undefined) {
          options.log("忽略响应流里无法解析的事件");
          continue;
        }
        if (id !== undefined && isObject(body) && body.id === id) answered = true;
        emit(request, body);
      }
      if (!answered) fail(id, "响应流在返回结果之前结束了");
      return;
    }

    const text = await response.text();
    const body = text.trim() ? parseJson(text) : undefined;
    if (response.ok) {
      if (body !== undefined) emit(request, body);
      else if (id !== undefined) fail(id, `服务端返回了无法解析的响应（HTTP ${response.status}）`);
      return;
    }
    if (isObject(body) && isObject(body.error)) {
      // 服务端给出的 JSON-RPC 错误原样交给客户端；不带 id 的补上请求的 id，客户端才能对上。
      if (id === undefined) {
        options.log(`通知被拒绝（HTTP ${response.status}）：${String(body.error.message ?? "")}`);
        return;
      }
      emit(request, body.id == null ? { ...body, id } : body);
      return;
    }
    fail(id, httpErrorMessage(response.status), response.status);
  }

  function emit(request: Message, body: unknown): void {
    if (
      request.method === "initialize" &&
      isObject(body) &&
      isObject(body.result) &&
      typeof body.result.protocolVersion === "string"
    ) {
      legacyVersion = body.result.protocolVersion;
    }
    send(body);
  }

  function fail(id: Id | undefined, message: string, httpStatus?: number): void {
    options.log(message);
    // 通知没有 id，不能给它回响应。
    if (id === undefined) return;
    send(errorResponse(id, BRIDGE_ERROR, message, httpStatus === undefined ? undefined : { httpStatus }));
  }

  return {
    handleLine,
    async drain() {
      while (pending.size > 0) await Promise.all(pending);
    },
  };
}

function httpErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "key 无效、已吊销，或账号已停用（HTTP 401）。请更换 JIAJIA_MCP_KEY，或删掉它改用匿名访问";
    case 403:
      return "请求被服务端拒绝（HTTP 403）";
    case 404:
      return "端点不存在（HTTP 404），请检查 JIAJIA_MCP_URL";
    case 503:
      return "服务暂时不可用（HTTP 503），请稍后再试";
    default:
      return `服务端返回 HTTP ${status}`;
  }
}

// 不能原样放进请求头的值，按规范用 =?base64?…?= 编码。
export function encodeHeaderValue(value: string): string {
  const plain = /^[\x21-\x7E]([\x20-\x7E\t]*[\x21-\x7E])?$/.test(value) || value === "";
  const looksEncoded = value.startsWith("=?base64?") && value.endsWith("?=");
  if (plain && !looksEncoded) return value;
  return `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

// 逐个产出 SSE 事件的 data。注释行和 data 以外的字段都忽略。
export async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  const takeEvent = (): string | undefined => {
    const event = data.length > 0 ? data.join("\n") : undefined;
    data = [];
    return event;
  };
  const readLine = (line: string): string | undefined => {
    if (line === "") return takeEvent();
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") return undefined;
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    data.push(value);
    return undefined;
  };

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let match = /\r\n|\r|\n/.exec(buffer);
    // 末尾单独的 \r 可能是被切开的 \r\n，等下一块再处理。
    while (match && !(match[0] === "\r" && match.index === buffer.length - 1)) {
      const event = readLine(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
      if (event !== undefined) yield event;
      match = /\r\n|\r|\n/.exec(buffer);
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r\n|\r|\n/)) {
    const event = readLine(line);
    if (event !== undefined) yield event;
  }
  const last = takeEvent();
  if (last !== undefined) yield last;
}

function requestId(message: Message): Id | undefined {
  const id = message.id;
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}

function errorResponse(id: Id | null, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Message {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `（${error.cause.message}）` : "";
    return `${error.message}${cause}`;
  }
  return String(error);
}
