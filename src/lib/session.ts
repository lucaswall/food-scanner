import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import type { SessionData } from "@/types";

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "food-scanner-session",
  cookieOptions: {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // Must be "lax" for OAuth redirect flows
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: "/",
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
