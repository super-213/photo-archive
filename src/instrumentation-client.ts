import { reportClientError } from "./lib/monitoring-client";

window.addEventListener("error", (event) => reportClientError(event.error, "client-error"));
window.addEventListener("unhandledrejection", (event) => reportClientError(event.reason, "unhandled-rejection"));
