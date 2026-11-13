import { z } from "zod";
import { monitoringPath, vitalNames } from "../monitoring";

const common = {
  id: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.:-]+$/),
  path: z.string().max(512).startsWith("/").transform(monitoringPath),
};
export const telemetryInput = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("vital"), name: z.enum(vitalNames), value: z.number().finite().min(0).max(3_600_000) }),
  z.object({ ...common, kind: z.literal("error"),
    source: z.enum(["client-error", "unhandled-rejection", "render-error"]),
    name: z.enum(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "OtherError"]),
    digest: z.string().max(128).regex(/^[a-zA-Z0-9_-]*$/).default(""),
  }),
]);
