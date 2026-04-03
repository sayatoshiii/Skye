export const baseURL = {
  MATRIX: (homeserver = "https://matrix.org") =>
    `${homeserver}/_matrix/client/v3/`,
};

export const API = async ({
  base,
  endpoint,
  method = "POST",
  headers,
  body,
}: {
  base: string;
  endpoint: string;
  method?: string;
  headers?: any;
  body?: any;
}) =>
  await fetch(base + endpoint, {
    method,
    headers: headers ?? {
      "Content-Type": "application/json",
    },
    body: typeof body === "object" ? JSON.stringify(body) : body,
  });
