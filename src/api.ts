export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
let accountId: string | undefined;
const requests = new Set<AbortController>();
export function setApiAccount(id?: string) {
  if (id !== accountId) {
    for (const request of requests) request.abort();
    requests.clear();
    accountId = id;
  }
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  expectedAccountId = accountId,
): Promise<T> {
  if (expectedAccountId !== accountId)
    throw new ApiError("Аккаунт изменился. Обнови страницу.", 409);
  const request = new AbortController();
  const abort = () => request.abort();
  requests.add(request);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      signal: request.signal,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        "X-Opros-Client": "web",
        ...(accountId ? { "X-Opros-Account": accountId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response
      .json()
      .catch(() => ({ error: "Сервер вернул неожиданный ответ" }));
    if (request.signal.aborted)
      throw new DOMException("Запрос отменён", "AbortError");
    if (!response.ok)
      throw new ApiError(
        result.error || "Не удалось выполнить запрос",
        response.status,
      );
    return result;
  } finally {
    requests.delete(request);
    signal?.removeEventListener("abort", abort);
  }
}
