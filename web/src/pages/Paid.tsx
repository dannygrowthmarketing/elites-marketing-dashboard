import { useMemo, useState } from "react";
import { DataTable, Drawer, Kpi, KpiRow, Page, Pending, Section, Tag, TrendChart, useRangeArgs } from "../components/ui";
import { useFilters, useRpc, useTable } from "../state";
import { costPer, cpc, cpm, ctr, convRate, ratio } from "../lib/metrics";
import { shortPath } from "../lib/insights";
import { C, totals, useSeries } from "./Overview";

export default function Paid() {
  const f = useFilters();
  const { range } = useRangeArgs();
  const { cur, prev } = useSeries();
  const camps = useRpc<any[]>("rpc_ads_campaigns", range);
  const devs = useRpc<any[]>("rpc_ads_devices", range);
  const terms = useRpc<any[]>("rpc_ads_search_terms", { ...range, p_limit: 2000 });
  const kws = useRpc<any[]>("rpc_ads_keywords", range);
  const lps = useRpc<any[]>("rpc_ads_landing", range);
  const integ = useTable<any>("integrations", (q) => q.select("source,status,last_error").in("source", ["google_ads", "meta_ads"]));
  const metaRows = useTable<any>("meta_daily_ad", (q) => q.select("*").gte("date", f.range.start).lte("date", f.range.end).limit(5000), [f.range.start, f.range.end]);
  const [camp, setCamp] = useState<any | null>(null);
  const t = totals(cur.data), p = f.prev ? totals(prev.data) : null;
  const ads = integ.data?.find((i) => i.source === "google_ads");
  const meta = integ.data?.find((i) => i.source === "meta_ads");
  const metaAgg = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of metaRows.data ?? []) {
      const a = m.get(r.campaign_id) ?? { campaign: r.campaign_name, spend: 0, impressions: 0, clicks: 0, reach: 0, leads: 0 };
      a.spend += +r.spend; a.impressions += r.impressions; a.clicks += r.clicks; a.reach += r.reach; a.leads += +r.leads; m.set(r.campaign_id, a);
    }
    return [...m.values()];
  }, [metaRows.data]);

  return (
    <Page eyebrow="Paid media" title="Paid advertising"
      intro="Google Ads account 520-119-6364 (INR, Asia/Kolkata). Conversions here are Google's attribution and include phone, WhatsApp and directions taps — compare with CRM bookings on the Attribution page.">
      {t.ads_cost == null && <Pending source="Google Ads">{ads?.status === "pending_approval"
        ? "The Google Ads API needs a developer token with Basic access. Apply from the Ads account's API Center; until approved, nothing is imported here."
        : undefined}</Pending>}
      <Section n="01" title="Google Ads">
        <KpiRow>
          <Kpi label="Spend" value={t.ads_cost} prev={p?.ads_cost} format="inr" defKey="ads_cost" invert />
          <Kpi label="Impressions" value={t.ads_impressions} prev={p?.ads_impressions} format="compact" />
          <Kpi label="Clicks" value={t.ads_clicks} prev={p?.ads_clicks} />
          <Kpi label="CTR" value={ctr(t.ads_clicks, t.ads_impressions)} prev={p ? ctr(p.ads_clicks, p.ads_impressions) : undefined} format="pct" />
          <Kpi label="Avg CPC" value={cpc(t.ads_cost, t.ads_clicks)} prev={p ? cpc(p.ads_cost, p.ads_clicks) : undefined} format="inr" defKey="ads_cpc" invert />
          <Kpi label="CPM" value={cpm(t.ads_cost, t.ads_impressions)} format="inr" defKey="ads_cpm" invert />
          <Kpi label="Conversions" value={t.ads_conversions} prev={p?.ads_conversions} format="dec" defKey="ads_conversions" />
          <Kpi label="Conv. rate" value={convRate(t.ads_conversions, t.ads_clicks)} format="pct" />
          <Kpi label="Cost / conversion" value={costPer(t.ads_cost, t.ads_conversions)} prev={p ? costPer(p.ads_cost, p.ads_conversions) : undefined} format="inr" defKey="ads_cpa" invert />
        </KpiRow>
        <p className="muted small">Conversion value and ROAS are omitted: every conversion action in this account is valued at a placeholder ₹1, so Google's value figures carry no meaning.</p>
        <TrendChart rows={cur.data} prevRows={f.prev ? prev.data : null} series={[
          { key: "ads_cost", label: "Spend", color: C.gold, kind: "bar", format: "inr" },
          { key: "ads_clicks", label: "Clicks", color: C.navy, axis: "right" },
          { key: "ads_conversions", label: "Conversions", color: C.rust, axis: "right", format: "dec" },
        ]} />
      </Section>

      <Section n="02" title="Campaigns">
        <DataTable rows={camps.data?.map((r) => ({ ...r, cost: +r.cost, clicks: +r.clicks, impressions: +r.impressions, conversions: +r.conversions })) ?? null}
          csvName="ads-campaigns" onRow={setCamp} cols={[
          { key: "campaign_name", label: "Campaign" },
          { key: "campaign_status", label: "Status", render: (r) => <Tag tone={r.campaign_status === "ENABLED" ? "good" : "neutral"}>{r.campaign_status?.toLowerCase() ?? "—"}</Tag> },
          { key: "cost", label: "Spend", align: "right", format: "inr" },
          { key: "clicks", label: "Clicks", align: "right", format: "int" },
          { key: "ctr", label: "CTR", align: "right", format: "pct", value: (r) => ctr(r.clicks, r.impressions) },
          { key: "cpc", label: "CPC", align: "right", format: "inr", value: (r) => cpc(r.cost, r.clicks) },
          { key: "conversions", label: "Conv.", align: "right", format: "dec" },
          { key: "cpa", label: "Cost/conv.", align: "right", format: "inr", value: (r) => costPer(r.cost, r.conversions) },
        ]} />
      </Section>

      <Section n="03" title="Search terms" note="What people actually typed. Terms with spend and no conversions are candidates for negatives.">
        <DataTable rows={terms.data?.map((r) => ({ ...r, cost: +r.cost, clicks: +r.clicks, impressions: +r.impressions, conversions: +r.conversions })) ?? null}
          csvName="ads-search-terms" initialSort={{ key: "cost", dir: -1 }} cols={[
          { key: "search_term", label: "Search term" },
          { key: "impressions", label: "Impr.", align: "right", format: "int" },
          { key: "clicks", label: "Clicks", align: "right", format: "int" },
          { key: "cost", label: "Spend", align: "right", format: "inr" },
          { key: "conversions", label: "Conv.", align: "right", format: "dec" },
          { key: "cpa", label: "Cost/conv.", align: "right", format: "inr", value: (r) => costPer(r.cost, r.conversions) },
        ]} />
      </Section>

      <Section n="04" title="Keywords and landing pages">
        <div className="two">
          <DataTable rows={kws.data?.map((r) => ({ ...r, cost: +r.cost, clicks: +r.clicks, conversions: +r.conversions })) ?? null} csvName="ads-keywords" cols={[
            { key: "keyword", label: "Keyword" }, { key: "match_type", label: "Match", render: (r) => (r.match_type ?? "").toLowerCase() },
            { key: "clicks", label: "Clicks", align: "right", format: "int" }, { key: "cost", label: "Spend", align: "right", format: "inr" },
            { key: "conversions", label: "Conv.", align: "right", format: "dec" },
          ]} />
          <DataTable rows={lps.data?.map((r) => ({ ...r, cost: +r.cost, clicks: +r.clicks, conversions: +r.conversions })) ?? null} csvName="ads-landing-pages" cols={[
            { key: "landing_page", label: "Landing page", render: (r) => shortPath(r.landing_page) },
            { key: "clicks", label: "Clicks", align: "right", format: "int" }, { key: "cost", label: "Spend", align: "right", format: "inr" },
            { key: "conversions", label: "Conv.", align: "right", format: "dec" },
            { key: "cr", label: "Conv. rate", align: "right", format: "pct", value: (r) => convRate(r.conversions, r.clicks) },
          ]} />
        </div>
      </Section>

      <Section n="05" title="Devices">
        <DataTable rows={devs.data?.map((r) => ({ ...r, cost: +r.cost, clicks: +r.clicks, conversions: +r.conversions })) ?? null} csvName="ads-devices" cols={[
          { key: "device", label: "Device", render: (r) => r.device.toLowerCase() },
          { key: "cost", label: "Spend", align: "right", format: "inr" },
          { key: "share", label: "Share of spend", align: "right", format: "pct", value: (r) => ratio(r.cost, t.ads_cost) },
          { key: "clicks", label: "Clicks", align: "right", format: "int" },
          { key: "conversions", label: "Conv.", align: "right", format: "dec" },
        ]} />
      </Section>

      <Section n="06" title="Meta Ads">
        {meta?.status !== "connected" || !metaRows.data?.length
          ? <Pending source="Meta Ads">Meta access hasn't been provided yet. The tables and sync are built; once a system-user token and ad account ID are saved in Integrations, data appears here.</Pending>
          : <DataTable rows={metaAgg} csvName="meta-campaigns" cols={[
              { key: "campaign", label: "Campaign" }, { key: "spend", label: "Spend", align: "right", format: "inr" },
              { key: "impressions", label: "Impr.", align: "right", format: "int" }, { key: "reach", label: "Reach", align: "right", format: "int" },
              { key: "clicks", label: "Clicks", align: "right", format: "int" },
              { key: "cpc", label: "CPC", align: "right", format: "inr", value: (r) => cpc(r.spend, r.clicks) },
              { key: "leads", label: "Leads (Meta)", align: "right", format: "dec" },
            ]} />}
      </Section>

      <Drawer open={!!camp} onClose={() => setCamp(null)} title={camp?.campaign_name ?? ""}>
        {camp && <CampaignDrill id={camp.campaign_id} />}
      </Drawer>
    </Page>
  );
}

function CampaignDrill({ id }: { id: string }) {
  const f = useFilters();
  const days = useTable<any>("ads_daily_campaign", (q) => q.select("date,impressions,clicks,cost_micros,conversions").eq("campaign_id", id).eq("device", "ALL").gte("date", f.range.start).lte("date", f.range.end).order("date"), [id, f.range.start, f.range.end]);
  const groups = useTable<any>("ads_daily_ad_group", (q) => q.select("ad_group_id,ad_group_name,clicks,cost_micros,conversions").eq("campaign_id", id).gte("date", f.range.start).lte("date", f.range.end).limit(5000), [id, f.range.start, f.range.end]);
  const rows = (days.data ?? []).map((d) => ({ ...d, cost: d.cost_micros / 1e6 }));
  const ag = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of groups.data ?? []) { const a = m.get(r.ad_group_id) ?? { name: r.ad_group_name, clicks: 0, cost: 0, conversions: 0 }; a.clicks += r.clicks; a.cost += r.cost_micros / 1e6; a.conversions += +r.conversions; m.set(r.ad_group_id, a); }
    return [...m.values()];
  }, [groups.data]);
  return (
    <>
      <TrendChart rows={days.data ? rows : null} height={200} series={[{ key: "cost", label: "Spend", color: C.gold, kind: "bar", format: "inr" }, { key: "conversions", label: "Conversions", color: C.rust, axis: "right", format: "dec" }]} />
      <DataTable rows={groups.data ? ag : null} csvName={`ads-campaign-${id}-adgroups`} cols={[
        { key: "name", label: "Ad group" }, { key: "cost", label: "Spend", align: "right", format: "inr" },
        { key: "clicks", label: "Clicks", align: "right", format: "int" }, { key: "conversions", label: "Conv.", align: "right", format: "dec" },
        { key: "cpa", label: "Cost/conv.", align: "right", format: "inr", value: (r) => costPer(r.cost, r.conversions) },
      ]} />
    </>
  );
}
