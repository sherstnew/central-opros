import { DuplicateGroupsError } from "./duplicate-groups";
// Persist categories only: provider errors may contain prompts or credentials.
export function duplicateError(error: unknown) {
  const status = typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status : undefined;
  const name = error instanceof Error ? error.name : "";
  if (error instanceof DuplicateGroupsError) {
    const details = {
      unknown_id: "ИИ указал ID вне переданного списка",
      repeated_id: "ИИ повторил ID внутри одной группы",
      overlapping_groups: "ИИ включил одну карточку в несколько групп",
    };
    return { category: "groups", violation: error.violation,
      detail: `${details[error.violation]}; объединение отменено.`, status };
  }
  if (status === 429) return { category: "rate_limit", detail: "ИИ ограничил число запросов (429).", status };
  if (status === 401 || status === 403)
    return { category: "access", detail: `ИИ отклонил доступ (${status}). Проверь ключ и доступ к модели.`, status };
  if (status && status >= 500)
    return { category: "provider", detail: `Сервис ИИ временно недоступен (${status}).`, status };
  if (/timeout/i.test(name))
    return { category: "timeout", detail: "Сервис ИИ не ответил вовремя.", status };
  if (name === "ZodError" || error instanceof SyntaxError)
    return { category: "response", detail: "ИИ вернул ответ в неверном формате.", status };
  if (error instanceof Error && error.message === "Некорректные группы повторов")
    return { category: "groups", detail: "ИИ вернул некорректные группы повторов; объединение отменено.", status };
  if (status)
    return { category: "request", detail: `Запрос к ИИ отклонён (${status}).`, status };
  if (/connection/i.test(name))
    return { category: "connection", detail: "Не удалось подключиться к сервису ИИ.", status };
  return { category: "unknown", detail: "Ошибка проверки или сохранения повторов.", status };
}
