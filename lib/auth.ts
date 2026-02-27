import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { getEnv } from "./env";

export const AUTH_COOKIE_NAME = "connect_token";

export type JwtPayload = {
  userId: string;
  email: string;
};

export function signToken(payload: JwtPayload) {
  const { jwtSecret } = getEnv();

  return jwt.sign(payload, jwtSecret, {
    expiresIn: "7d",
  });
}

export function verifyToken(token: string): JwtPayload {
  const { jwtSecret } = getEnv();

  return jwt.verify(token, jwtSecret) as JwtPayload;
}

export async function getAuthUserFromCookies() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}
