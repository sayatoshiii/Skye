import { API, baseURL } from "../api/client";

export const login = async (user?: string, password?: string) => {
  const response = await API({
    base: baseURL.MATRIX("https://matrix.org"),
    endpoint: "login",
    body: {
      type: "m.login.password",
      identifier: {
        type: "m.id.user",
        user,
      },
      password,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to sign-in!");
  }

  const { access_token, device_id, user_id } = await response.json();

  localStorage.setItem("access_token", access_token);
  localStorage.setItem("device_id", device_id);
  localStorage.setItem("user_id", user_id);
};
