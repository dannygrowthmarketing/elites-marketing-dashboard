import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export default function Login({ denied }: { denied?: string | null }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { emailRedirectTo: location.origin, shouldCreateUser: true } });
    setBusy(false);
    if (error) setMsg(error.message); else { setStage("code"); setMsg("Check your inbox. Click the link, or type the 6-digit code if the email shows one."); }
  }
  async function verify(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setMsg(error.message);
  }
  return (
    <div className="login">
      <div className="login-card">
        <div className="eyebrow">Elites Dental Care</div>
        <h1>Marketing intelligence</h1>
        {denied && <div className="errorbox">{denied} isn't on the access list. Ask the owner to add you in Settings.</div>}
        {stage === "email" ? (
          <form onSubmit={send} className="form">
            <label>Work email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
            <button className="btn" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
          </form>
        ) : (
          <form onSubmit={verify} className="form">
            <label>6-digit code<input inputMode="numeric" pattern="[0-9]{6,8}" value={code} onChange={(e) => setCode(e.target.value)} /></label>
            <button className="btn" disabled={busy || code.length < 6}>Verify</button>
            <button type="button" className="btn ghost" onClick={() => setStage("email")}>Use a different email</button>
          </form>
        )}
        {msg && <p className="muted small">{msg}</p>}
        <p className="muted small">Passwordless sign-in. Only allow-listed emails see any data.</p>
      </div>
    </div>
  );
}
