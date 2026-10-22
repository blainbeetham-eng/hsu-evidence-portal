"use client";
import { useFormStatus } from "react-dom";

export function SyncButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Syncing… (up to a minute)" : "Sync now"}
    </button>
  );
}
