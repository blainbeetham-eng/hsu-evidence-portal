"use client";
import { useState, useTransition } from "react";
import { addFieldUser, setFieldUserAccess } from "./actions";
import type { ActionResult } from "../properties/[id]/actions";

export function AddFieldUser() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  return (
    <details>
      <summary>Add a person</summary>
      <div className="card stack">
        <label htmlFor="fn">Name</label>
        <input id="fn" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="fe">Email</label>
        <input id="fe" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button
          disabled={pending}
          onClick={() => start(async () => {
            const r = await addFieldUser(email, name);
            setResult(r);
            if (r.ok) { setEmail(""); setName(""); }
          })}
        >
          Add to field team
        </button>
        {result && <p className={`small ${result.ok ? "muted" : "error"}`}>{result.message}</p>}
      </div>
    </details>
  );
}

export function AccessToggle({ userId, on }: { userId: string; on: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <>
      <button className="link" disabled={pending} onClick={() => start(async () => setResult(await setFieldUserAccess(userId, !on)))}>
        {on ? "Switch off" : "Switch on"}
      </button>
      {result && !result.ok && <span className="small error"> {result.message}</span>}
    </>
  );
}
