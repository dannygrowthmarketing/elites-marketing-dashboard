/* WPCode: "Dashboard: attribution capture + booking relay" — JavaScript, Site Wide Footer.
 * 1) Stores first-touch and latest-touch attribution in a first-party cookie (90 days).
 * 2) Adds that attribution to every Elementor form as hidden fields (read server-side by the PHP snippet).
 * 3) When a Click4Appointment booking succeeds, sends it to WordPress (admin-ajax), which signs and
 *    forwards it to the dashboard. The browser never sees the dashboard secret.
 * Does not touch the existing Google Ads / GA4 conversion snippets (18950, 18612) — it only listens.
 */
(function () {
  var COOKIE = "edc_attr";
  var DAYS = 90;

  function read() {
    try {
      var m = document.cookie.match(new RegExp("(?:^|; )" + COOKIE + "=([^;]*)"));
      return m ? JSON.parse(decodeURIComponent(m[1])) : null;
    } catch (e) { return null; }
  }
  function write(v) {
    var exp = new Date(Date.now() + DAYS * 864e5).toUTCString();
    document.cookie = COOKIE + "=" + encodeURIComponent(JSON.stringify(v)) + "; expires=" + exp + "; path=/; SameSite=Lax; Secure";
  }
  function touchFromUrl() {
    var q = new URLSearchParams(location.search);
    var ref = document.referrer && document.referrer.indexOf(location.hostname) === -1 ? document.referrer : "";
    var t = {
      source: q.get("utm_source") || "", medium: q.get("utm_medium") || "", campaign: q.get("utm_campaign") || "",
      term: q.get("utm_term") || "", content: q.get("utm_content") || "",
      gclid: q.get("gclid") || "", fbclid: q.get("fbclid") || "",
      landing: location.origin + location.pathname, referrer: ref, ts: new Date().toISOString()
    };
    var meaningful = t.source || t.gclid || t.fbclid || t.referrer;
    return { touch: t, meaningful: !!meaningful };
  }

  var cur = read() || {};
  var now = touchFromUrl();
  if (!cur.first) cur.first = now.touch;                 // first visit ever (even direct)
  if (now.meaningful || !cur.last) cur.last = now.touch;  // a new campaign/referral visit replaces "latest"
  write(cur);

  // Hidden fields on Elementor forms
  function stamp(form) {
    if (form.querySelector('input[name="edc_attr"]')) return;
    var i = document.createElement("input");
    i.type = "hidden"; i.name = "edc_attr"; i.value = JSON.stringify(read() || {});
    form.appendChild(i);
  }
  document.querySelectorAll("form.elementor-form").forEach(stamp);
  new MutationObserver(function () { document.querySelectorAll("form.elementor-form").forEach(stamp); })
    .observe(document.body, { childList: true, subtree: true });

  // Click4Appointment success relay
  if (!window.EDC_DASH || !window.fetch) return;
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var p = origFetch.apply(this, arguments);
    if (url.indexOf("click4appointment.com/api/bookAppointment/post") === -1) return p;
    var reqBody = null;
    try { reqBody = init && typeof init.body === "string" ? JSON.parse(init.body) : null; } catch (e) {}
    p.then(function (res) { return res.clone().json(); }).then(function (data) {
      if (!data || data.success !== true) return;
      var b = reqBody || {};
      var pick = function () { for (var i = 0; i < arguments.length; i++) { var k = arguments[i]; if (b[k]) return String(b[k]); } return ""; };
      var fd = new FormData();
      fd.append("action", "edc_c4a_booking");
      fd.append("nonce", window.EDC_DASH.nonce);
      fd.append("name", pick("patientName", "name", "patient_name", "fullName"));
      fd.append("phone", pick("mobile", "phone", "mobileNumber", "patientMobile", "contactNumber"));
      fd.append("email", pick("email", "patientEmail"));
      fd.append("appointment_at", pick("appointmentDateTime", "appointmentDate", "date", "slot"));
      fd.append("service", pick("serviceName", "treatment", "reason"));
      fd.append("ref", String((data.data && (data.data.id || data.data.appointmentId || data.data.bookingId)) || ""));
      fd.append("attr", JSON.stringify(read() || {}));
      fd.append("page", location.href.split("?")[0]);
      navigator.sendBeacon ? navigator.sendBeacon(window.EDC_DASH.ajax, fd) : origFetch(window.EDC_DASH.ajax, { method: "POST", body: fd, keepalive: true });
    }).catch(function () {});
    return p;
  };
})();
