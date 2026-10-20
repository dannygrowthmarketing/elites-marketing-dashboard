import { useState } from "react";
import { DataTable, Page, Section, Tag } from "../components/ui";
import { useFilters, useTable } from "../state";
import { supabase } from "../lib/supabase";
import { DEFINITIONS } from "../lib/metrics";

export default function Settings() {
  const f = useFilters();
  const isOwner = f.role === "owner";
  const [v, setV] = useState(0);
  const users = useTable<any>("app_users", (q) => q.select("*").order("added_at"), [v]);
  const brand = useTable<any>("settings", (q) => q.select("*").eq("key", "branded_terms"), [v]);
  const [err, setErr] = useState<string | null>(null);
  const terms: string[] = brand.data?.[0]?.value ?? [];

  return (
    <Page eyebrow="System" title="Settings">
      <Section n="01" title="Who can sign in" note="Only these emails can see data. Owners manage access and connections; editors can update leads; viewers read only.">
        <DataTable rows={users.data} cols={[
          { key: "email", label: "Email" },
          { key: "role", label: "Role", render: (u) => <Tag tone={u.role === "owner" ? "good" : "neutral"}>{u.role}</Tag> },
          { key: "x", label: "", render: (u) => isOwner && u.email !== f.email ? <button className="btn ghost" onClick={async (e) => { e.stopPropagation(); if (confirm(`Remove ${u.email}?`)) { await supabase.from("app_users").delete().eq("email", u.email); setV((x) => x + 1); } }}>Remove</button> : null },
        ]} />
        {isOwner && <form className="inline-form" onSubmit={async (e) => {
          e.preventDefault(); setErr(null);
          const form = e.currentTarget; // React clears currentTarget after the await below
          const d = Object.fromEntries(new FormData(form)) as Record<string, string>;
          const { error } = await supabase.from("app_users").upsert({ email: d.email.trim().toLowerCase(), role: d.role });
          if (error) setErr(error.message); else { form.reset(); setV((x) => x + 1); }
        }}>
          <input name="email" type="email" required placeholder="name@example.com" />
          <select name="role" defaultValue="viewer"><option value="viewer">viewer</option><option value="editor">editor</option><option value="owner">owner</option></select>
          <button className="btn ghost">Add</button>
        </form>}
        {err && <div className="errorbox">{err}</div>}
      </Section>

      <Section n="02" title="Branded search terms" note="Queries containing any of these count as branded on the SEO page. Applies to data synced after a change.">
        <div className="chips">{terms.map((t) => <Tag key={t}>{t}</Tag>)}</div>
        {(f.role === "owner" || f.role === "editor") && <form className="inline-form" onSubmit={async (e) => {
          e.preventDefault();
          const d = String(new FormData(e.currentTarget).get("terms") ?? "");
          const list = d.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
          await supabase.from("settings").upsert({ key: "branded_terms", value: list });
          setV((x) => x + 1);
        }}>
          <input name="terms" defaultValue={terms.join(", ")} key={terms.join(",")} style={{ minWidth: 280 }} />
          <button className="btn ghost">Save</button>
        </form>}
      </Section>

      <Section n="03" title="Metric definitions" note="How every number on this dashboard is calculated.">
        <DataTable rows={DEFINITIONS as any[]} limit={100} csvName="metric-definitions" cols={[
          { key: "name", label: "Metric" }, { key: "source", label: "Source" }, { key: "formula", label: "Calculation" },
          { key: "notes", label: "Caveats", render: (d) => <span className="small">{d.notes ?? ""}</span> },
        ]} />
      </Section>
    </Page>
  );
}
