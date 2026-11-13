"use client";

import { ErrorRecovery } from "@/components/error-recovery";

export default function PageError(props: { error: unknown; retry: () => void }) {
  return <><meta name="robots" content="noindex" /><ErrorRecovery {...props} /></>;
}
