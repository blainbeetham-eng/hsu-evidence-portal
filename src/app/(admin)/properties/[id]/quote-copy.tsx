"use client";
import { useState } from "react";

export function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p>
      <button className="secondary" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
        {copied ? "Copied" : "Copy measurements"}
      </button>
    </p>
  );
}
