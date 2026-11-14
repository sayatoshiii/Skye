import { serialiseURIObject } from "../misc/uri";

export const baseURL = {
  MATRIX: (homeserver = "https://matrix.org") =>
    `${homeserver}/_matrix/client/v3/`,
  MATRIX_V1: (homeserver = "https://matrix.org") =>
    `${homeserver}/_matrix/client/v1/`,
  MATRIX_VERSIONS: (homeserver = "https://matrix.org") =>
    `${homeserver}/_matrix/client/`,
  CUSTOM: (url: string, trailing: boolean = false) =>
    url + (trailing ? "/" : ""),
};

export type APIOptions = {
  base: string;
  endpoint: string;
  method?: string;
  headers?: any;
  body?: any;
  accessToken?: string | null;
  query?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type MatrixErrorBody = {
  errcode?: string;
  error?: string;
  retry_after_ms?: number;
  [key: string]: unknown;
};

export type MatrixError = Error & {
  name: "MatrixError";
  status: number;
  errcode: string;
  body: MatrixErrorBody;
  retryAfterMs?: number;
};

export const createMatrixError = (
  status: number,
  body: MatrixErrorBody,
  retryAfterHeader?: string | null,
): MatrixError => {
  const error = new Error(
    body.error ?? `Matrix request failed with status ${status}`,
  ) as MatrixError;
  const headerSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;

  error.name = "MatrixError";
  error.status = status;
  error.errcode = body.errcode ?? "M_UNKNOWN";
  error.body = body;
  error.retryAfterMs =
    body.retry_after_ms ??
    (Number.isFinite(headerSeconds) ? headerSeconds * 1000 : undefined);

  return error;
};

export const isMatrixError = (
  error: unknown,
  errcode?: string,
): error is MatrixError =>
  (error as MatrixError)?.name === "MatrixError" &&
  (!errcode || (error as MatrixError).errcode === errcode);

const cleanQuery = (query: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [
        key,
        typeof value === "object" ? JSON.stringify(value) : value,
      ]),
  );

export const API = async ({
  base,
  endpoint,
  method = "POST",
  headers,
  body,
  accessToken,
  query,
  signal,
}: APIOptions) => {
  const search = query ? serialiseURIObject(cleanQuery(query)) : "";
  const joiner = endpoint.includes("?") ? "&" : "?";

  return await fetch(base + endpoint + (search ? joiner + search : ""), {
    method,
    headers: {
      ...(headers ?? { "Content-Type": "application/json" }),
      ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
    },
    body:
      body === undefined
        ? undefined
        : typeof body === "object" && !(body instanceof Blob)
          ? JSON.stringify(body)
          : body,
    signal,
  });
};

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export const sleep = wait;

export const matrixRequest = async <T>(
  options: APIOptions & { maxRetries?: number },
): Promise<T> => {
  const { maxRetries = 3, ...request } = options;

  for (let attempt = 0; ; attempt++) {
    const response = await API(request);

    if (response.ok) {
      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    }

    const body = (await response.json().catch(() => ({}))) as MatrixErrorBody;
    const error = createMatrixError(
      response.status,
      body,
      response.headers.get("Retry-After"),
    );

    if (error.errcode !== "M_LIMIT_EXCEEDED" || attempt >= maxRetries)
      throw error;

    await wait(error.retryAfterMs ?? 1000 * 2 ** attempt, request.signal);
  }
};
