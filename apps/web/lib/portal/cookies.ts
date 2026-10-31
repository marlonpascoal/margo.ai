// The account a person opened (P15 chooser). Only a hint: requireMember() checks the membership on every read.
import { ACCOUNT_COOKIE } from "./session";

export const accountCookie = (accountId: string) => ({
  name: ACCOUNT_COOKIE,
  value: accountId,
  httpOnly: true,
  secure: process.env.MARGO_ENV !== "local",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 400 * 24 * 60 * 60,
});
