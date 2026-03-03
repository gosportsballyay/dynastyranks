import { Resend } from "resend";

let _resend: Resend | null = null;

/**
 * Lazy-initialized Resend client singleton.
 */
export function getResend(): Resend {
  if (_resend) return _resend;

  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }

  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
