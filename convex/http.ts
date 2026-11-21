import { httpRouter } from "convex/server";
import { auth } from "./auth";
import {
  checkin,
  passwordReset,
  passwordResetInfo,
  publicInfo,
} from "./gateway";
const http = httpRouter();
auth.addHttpRoutes(http);
http.route({ path: "/gateway/checkin", method: "POST", handler: checkin });
http.route({
  path: "/gateway/public-info",
  method: "POST",
  handler: publicInfo,
});
http.route({
  path: "/gateway/password-reset-info",
  method: "POST",
  handler: passwordResetInfo,
});
http.route({
  path: "/gateway/password-reset",
  method: "POST",
  handler: passwordReset,
});
export default http;
