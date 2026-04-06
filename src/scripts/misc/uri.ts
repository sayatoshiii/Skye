export const serialiseURIObject = (data: any) =>
  Object.entries(data)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value as never)}`,
    )
    .join("&");
