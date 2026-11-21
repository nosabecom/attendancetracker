export const AUTH_GATEWAY_MESSAGES = Object.freeze({
  400: "Invalid sign-in request.",
  401: "Incorrect username or password.",
  403: "Request not allowed.",
  409: "That username is unavailable. Sign in or choose another.",
  429: "Too many attempts. Please try again later.",
  503: "Sign-in is temporarily unavailable.",
});

const SAFE_AUTH_MESSAGES = new Set([
  ...Object.values(AUTH_GATEWAY_MESSAGES),
  "Invalid credentials.",
]);

export function safeAuthErrorMessage(error) {
  if (
    error &&
    typeof error === "object" &&
    typeof error.message === "string" &&
    SAFE_AUTH_MESSAGES.has(error.message)
  ) {
    return error.message;
  }
  return null;
}
