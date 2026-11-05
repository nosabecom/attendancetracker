import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { checkin, publicInfo } from "./gateway";
const http = httpRouter();
auth.addHttpRoutes(http);
http.route({ path: "/gateway/checkin", method: "POST", handler: checkin });
http.route({
  path: "/gateway/public-info",
  method: "POST",
  handler: publicInfo,
});
export default http;
