"use client";

import { ErrorRecovery } from "@/components/error-recovery";

export default function AdminError(props: { error: unknown; retry: () => void }) {
  return <ErrorRecovery {...props} admin />;
}
