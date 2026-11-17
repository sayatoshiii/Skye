import { isMatrixError } from "../../api/client";
import { sessionRequest } from "../session";
import type { Session } from "../types";

export type PasswordPrompt = () => Promise<string | null>;

type Request = { endpoint: string; method: "POST" | "DELETE"; body: Record<string, unknown> };

const passwordAuth = (session: Session, password: string, flow?: string) => ({
  type: "m.login.password",
  identifier: { type: "m.id.user", user: session.userId },
  password,
  session: flow,
});

export const withAuth = async (session: Session, request: Request, askPassword: PasswordPrompt) => {
  try {
    return await sessionRequest(session, request);
  } catch (error) {
    if (!isMatrixError(error) || error.status !== 401 || !Array.isArray(error.body.flows)) throw error;
    const password = await askPassword();
    return password === null
      ? null
      : sessionRequest(session, { ...request, body: { ...request.body, auth: passwordAuth(session, password, error.body.session as string | undefined) } });
  }
};
