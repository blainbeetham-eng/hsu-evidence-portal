"use client";
import { useState, useTransition } from "react";
import { discardInboxItem, fileInboxItem, findProperty, type Found } from "./actions";
import type { ActionResult } from "../properties/[id]/actions";

export function FileInbox({ itemId, initialAddress, initial }: { itemId: string; initialAddress: string; initial: Found }) {
  const [pending, start] = useTransition();
  const [address, setAddress] = useState(initialAddress);
  const [found, setFound] = useState<Found>(initial);
  const [wo, setWo] = useState(initial?.workOrders[0]?.id ?? "");
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <div className="stack">
      <div className="row">
        <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Property address" style={{ flex: 1, minWidth: 220 }} />
        <button
          className="secondary"
          disabled={pending}
          onClick={() => start(async () => {
            const f = await findProperty(address);
            setFound(f);
            setWo(f?.workOrders[0]?.id ?? "");
            setResult(f ? null : { ok: false, message: "No single property matches that address." });
          })}
        >
          Find
        </button>
      </div>
      {found && (
        <div className="row">
          <span className="small">{found.address}</span>
          <select value={wo} onChange={(e) => setWo(e.target.value)}>
            {found.workOrders.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
          <button disabled={pending || !wo} onClick={() => start(async () => setResult(await fileInboxItem(itemId, wo)))}>File here</button>
        </div>
      )}
      <div>
        <button
          className="link small"
          disabled={pending}
          onClick={() => {
            const reason = window.prompt("Why discard this email's files? (Kept in the history.)");
            if (reason) start(async () => setResult(await discardInboxItem(itemId, reason)));
          }}
        >
          Discard
        </button>
      </div>
      {result && <p className={`small ${result.ok ? "muted" : "error"}`}>{result.message}</p>}
    </div>
  );
}
