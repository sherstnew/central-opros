export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "X-Opros-Client": "web",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response
    .json()
    .catch(() => ({ error: "Сервер вернул неожиданный ответ" }));
  if (!response.ok)
    throw new ApiError(
      result.error || "Не удалось выполнить запрос",
      response.status,
    );
  return result;
}
