/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as admission from "../admission.js";
import type * as attendance from "../attendance.js";
import type * as auth from "../auth.js";
import type * as authSupport from "../authSupport.js";
import type * as gateway from "../gateway.js";
import type * as http from "../http.js";
import type * as legacy from "../legacy.js";
import type * as localAuthStress from "../localAuthStress.js";
import type * as localBurst from "../localBurst.js";
import type * as localMetrics from "../localMetrics.js";
import type * as localSubscriptions from "../localSubscriptions.js";
import type * as localTest from "../localTest.js";
import type * as migration from "../migration.js";
import type * as operations from "../operations.js";
import type * as password from "../password.js";
import type * as rosters from "../rosters.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  admission: typeof admission;
  attendance: typeof attendance;
  auth: typeof auth;
  authSupport: typeof authSupport;
  gateway: typeof gateway;
  http: typeof http;
  legacy: typeof legacy;
  localAuthStress: typeof localAuthStress;
  localBurst: typeof localBurst;
  localMetrics: typeof localMetrics;
  localSubscriptions: typeof localSubscriptions;
  localTest: typeof localTest;
  migration: typeof migration;
  operations: typeof operations;
  password: typeof password;
  rosters: typeof rosters;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
