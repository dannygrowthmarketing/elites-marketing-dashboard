export function toCsv(rows: Record<string, unknown>[], columns?: { key: string; label: string }[]): string {
  if (!rows.length) return "";
  const cols = columns ?? Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    // Neutralise spreadsheet formula injection from user-entered text.
    const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.map((c) => esc(c.label)).join(","), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(","))].join("\r\n");
}

export function downloadCsv(name: string, rows: Record<string, unknown>[], columns?: { key: string; label: string }[]) {
  const blob = new Blob(["﻿" + toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name.endsWith(".csv") ? name : `${name}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
