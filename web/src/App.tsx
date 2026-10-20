import { useEffect, useState, lazy, Suspense } from "react";
import { HashRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { FiltersProvider, useFilters } from "./state";
import { DateBar, Loading } from "./components/ui";
import Login from "./pages/Login";
import Overview from "./pages/Overview";

const Seo = lazy(() => import("./pages/Seo"));
const Gbp = lazy(() => import("./pages/Gbp"));
const Website = lazy(() => import("./pages/Website"));
const Paid = lazy(() => import("./pages/Paid"));
const Crm = lazy(() => import("./pages/Crm"));
const Attribution = lazy(() => import("./pages/Attribution"));
const Insights = lazy(() => import("./pages/Insights"));
const Integrations = lazy(() => import("./pages/Integrations"));
const Settings = lazy(() => import("./pages/Settings"));

const NAV = [
  ["/", "Overview"], ["/insights", "Insights"], ["/seo", "SEO"], ["/gbp", "Business Profile"], ["/website", "Website"],
  ["/paid", "Paid ads"], ["/crm", "Leads & CRM"], ["/attribution", "Attribution"], ["/integrations", "Integrations"], ["/settings", "Settings"],
] as const;

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [member, setMember] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) { setMember(null); return; }
    supabase.rpc("is_member").then(({ data }) => setMember(Boolean(data)));
  }, [session]);

  if (session === undefined || (session && member === null)) return <div className="boot"><Loading h={60} /></div>;
  if (!session) return <Login />;
  if (!member) return (
    <>
      <Login denied={session.user.email} />
      <p className="center"><button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button></p>
    </>
  );

  return (
    <HashRouter>
      <FiltersProvider email={session.user.email ?? null}>
        <Shell email={session.user.email ?? ""} />
      </FiltersProvider>
    </HashRouter>
  );
}

function Shell({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const f = useFilters();
  return (
    <div className="shell">
      <aside className={`side ${open ? "open" : ""}`}>
        <div className="brand"><span className="mark">E</span><div><strong>Elites Dental Care</strong><small>Marketing intelligence</small></div></div>
        <nav onClick={() => setOpen(false)}>
          {NAV.map(([to, label], i) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "on" : "")}>
              <span className="nav-n">{String(i + 1).padStart(2, "0")}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="small muted">{email}{f.role && ` · ${f.role}`}</div>
          <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="btn ghost menu" onClick={() => setOpen((o) => !o)} aria-label="Menu">☰</button>
          <DateBar />
          <button className="btn ghost" onClick={f.refresh} title="Reload data">↻</button>
        </div>
        <Suspense fallback={<div className="page"><Loading h={300} /></div>}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/seo" element={<Seo />} />
            <Route path="/gbp" element={<Gbp />} />
            <Route path="/website" element={<Website />} />
            <Route path="/paid" element={<Paid />} />
            <Route path="/crm" element={<Crm />} />
            <Route path="/attribution" element={<Attribution />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}
