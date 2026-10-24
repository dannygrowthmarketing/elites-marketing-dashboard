// Public webhook receiver for payment gateways. POST /functions/v1/payments-webhook?provider=razorpay|phonepe|cashfree
// Every request is verified against the secret the owner saved on the Integrations page before anything is stored.
//   Razorpay: X-Razorpay-Signature = hex HMAC-SHA256(raw body, webhook secret)
//   PhonePe PG: Authorization = hex SHA-256("username:password") configured on the PhonePe webhook
//   Cashfree: x-webhook-signature = base64 HMAC-SHA256(x-webhook-timestamp + raw body, secret key)
// Stored: amount, method, UPI app family, time, gateway reference. Not stored: UPI IDs, card details, phone numbers.
import { admin, json, sha256Hex, timingSafeEqual } from "../_shared/util.ts";

type Ev = { gateway: string; event_key: string; type: "payment" | "refund" | "failed"; payment_id?: string; amount?: number;
  paid_at?: string; method?: string; vpa?: string; upi_app?: string; phone?: string; status?: string; note?: string };

async function hmac(secret: string, msg: string, enc: "hex" | "base64") {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  return enc === "hex" ? [...sig].map((b) => b.toString(16).padStart(2, "0")).join("") : btoa(String.fromCharCode(...sig));
}

async function secretFor(provider: string): Promise<string | null> {
  const { data } = await admin().rpc("svc_get_credential", { p_provider: provider });
  return data?.[0]?.api_token ?? null;
}

const iso = (sec?: number | null) => (sec ? new Date(sec * 1000).toISOString() : undefined);

function razorpay(body: any, eventId: string | null): Ev[] {
  const t = body.event as string;
  if (t === "payment.captured" || t === "payment.failed") {
    const p = body.payload?.payment?.entity ?? {};
    return [{ gateway: "razorpay", event_key: eventId ?? `${t}:${p.id}`, type: t === "payment.captured" ? "payment" : "failed",
      payment_id: p.id, amount: (p.amount ?? 0) / 100, paid_at: iso(p.created_at), method: p.method,
      vpa: p.vpa ?? p.upi?.vpa, phone: p.contact, status: p.status, note: p.description ?? undefined }];
  }
  if (t === "refund.processed") {
    const r = body.payload?.refund?.entity ?? {};
    return [{ gateway: "razorpay", event_key: eventId ?? `${t}:${r.id}`, type: "refund", payment_id: r.payment_id, amount: (r.amount ?? 0) / 100,
      paid_at: iso(r.created_at), status: r.status }];
  }
  return [];
}

function phonepe(body: any): Ev[] {
  const t = (body.event ?? body.type ?? "") as string;
  const p = body.payload ?? {};
  const det = (p.paymentDetails ?? [])[0] ?? {};
  const mode = String(det.paymentMode ?? "");
  const method = mode.startsWith("UPI") ? "upi" : /CARD/.test(mode) ? "card" : mode === "NET_BANKING" ? "netbanking" : mode ? "other" : undefined;
  const ref = p.orderId ?? p.merchantOrderId;
  if (/order\.completed/i.test(t) && p.state === "COMPLETED") {
    return [{ gateway: "phonepe", event_key: `${t}:${ref}`, type: "payment", payment_id: ref, amount: (p.amount ?? 0) / 100,
      paid_at: det.timestamp ? new Date(det.timestamp).toISOString() : undefined, method, upi_app: method === "upi" ? "PhonePe PG (UPI)" : undefined,
      phone: p.metaInfo?.udf1, status: p.state }];
  }
  if (/order\.failed/i.test(t)) return [{ gateway: "phonepe", event_key: `${t}:${ref}`, type: "failed", payment_id: ref, amount: (p.amount ?? 0) / 100, status: p.state }];
  if (/refund\.completed/i.test(t)) {
    return [{ gateway: "phonepe", event_key: `${t}:${p.refundId ?? p.merchantRefundId}`, type: "refund", payment_id: p.originalMerchantOrderId ?? ref,
      amount: (p.amount ?? 0) / 100, status: p.state }];
  }
  return [];
}

function cashfree(body: any): Ev[] {
  const t = body.type as string;
  const d = body.data ?? {};
  const pay = d.payment ?? {};
  if (t === "PAYMENT_SUCCESS_WEBHOOK" || t === "PAYMENT_FAILED_WEBHOOK") {
    const group = String(pay.payment_group ?? "");
    return [{ gateway: "cashfree", event_key: `${t}:${pay.cf_payment_id}`, type: t === "PAYMENT_SUCCESS_WEBHOOK" ? "payment" : "failed",
      payment_id: String(d.order?.order_id ?? pay.cf_payment_id), amount: Number(pay.payment_amount ?? 0), paid_at: pay.payment_time,
      method: group.includes("upi") ? "upi" : group.includes("card") ? "card" : group.includes("net") ? "netbanking" : group.includes("wallet") ? "wallet" : group,
      vpa: pay.payment_method?.upi?.upi_id, phone: d.customer_details?.customer_phone, status: pay.payment_status }];
  }
  if (t === "REFUND_STATUS_WEBHOOK" && d.refund?.refund_status === "SUCCESS") {
    return [{ gateway: "cashfree", event_key: `${t}:${d.refund.cf_refund_id}`, type: "refund", payment_id: String(d.refund.order_id), amount: Number(d.refund.refund_amount ?? 0) }];
  }
  return [];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const provider = new URL(req.url).searchParams.get("provider") ?? "";
  if (!["razorpay", "phonepe", "cashfree"].includes(provider)) return json({ error: "unknown provider" }, 400);
  const raw = await req.text();
  if (raw.length > 200_000) return json({ error: "too large" }, 413);
  const secret = await secretFor(provider);
  if (!secret) return json({ error: "not configured" }, 503);

  let ok = false;
  if (provider === "razorpay") {
    ok = timingSafeEqual(req.headers.get("x-razorpay-signature") ?? "", await hmac(secret, raw, "hex"));
  } else if (provider === "phonepe") {
    const got = (req.headers.get("authorization") ?? "").replace(/^SHA256\s+/i, "").trim().toLowerCase();
    ok = timingSafeEqual(got, await sha256Hex(secret));
  } else {
    const ts = req.headers.get("x-webhook-timestamp") ?? "";
    const fresh = Math.abs(Date.now() - Number(ts) * (ts.length > 11 ? 1 : 1000)) < 10 * 60_000;
    ok = fresh && timingSafeEqual(req.headers.get("x-webhook-signature") ?? "", await hmac(secret, ts + raw, "base64"));
  }
  if (!ok) return json({ error: "bad signature" }, 401);

  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }
  const events = provider === "razorpay" ? razorpay(body, req.headers.get("x-razorpay-event-id"))
    : provider === "phonepe" ? phonepe(body) : cashfree(body);
  const db = admin();
  const results = [];
  for (const e of events) {
    const { data, error } = await db.rpc("svc_payment_ingest", { p: e });
    if (error) {
      await db.from("integrations").update({ status: "error", last_error: `Webhook: ${error.message}`.slice(0, 500) }).eq("source", provider);
      return json({ error: "store failed" }, 500);
    }
    results.push(data);
  }
  // Always 200 for verified events we don't track, so the gateway doesn't retry forever.
  return json({ ok: true, handled: results.length });
});
