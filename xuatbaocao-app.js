/* xuatbaocao-app.js — Kết xuất báo cáo thống kê từ Flask + MongoDB */
(function () {
  const API = "http://localhost:5000";

  const fmtVND = n => new Intl.NumberFormat("vi-VN").format(Math.round(n || 0)) + "₫";
  const fmtNum = n => new Intl.NumberFormat("vi-VN").format(n || 0);
  const escapeHtml = s => {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  };

  let currentSummary = null;

  // ── UI helpers ──────────────────────────────────────────
  function setStatus(ok, msg) {
    const el = document.getElementById("sync-status");
    if (!el) return;
    el.className = `px-space-sm py-space-xs rounded font-label-sm uppercase flex items-center gap-1 ${
      ok ? "bg-secondary-container text-on-secondary-container"
         : "bg-error-container text-on-error-container"
    }`;
    el.innerHTML = `<span class="w-2 h-2 rounded-full ${ok ? "bg-secondary" : "bg-error"}"></span> ${escapeHtml(msg)}`;
  }

  function barRow(label, count, total, detail = "") {
    const pct = total ? (count / total * 100) : 0;
    const width = Math.max(2, pct);
    return `
      <div class="flex flex-col gap-1">
        <div class="flex justify-between text-body-sm">
          <span class="text-on-surface">${escapeHtml(label)}</span>
          <span class="font-label-md text-on-surface-variant">
            ${fmtNum(count)} (${pct.toFixed(1)}%)${detail ? " • " + escapeHtml(detail) : ""}
          </span>
        </div>
        <div class="w-full h-3 bg-surface-container rounded-md overflow-hidden">
          <div class="h-full bg-primary rounded-md" style="width:${width}%"></div>
        </div>
      </div>`;
  }

  // ── Render functions ────────────────────────────────────
  function renderKPIs(s) {
    const o = s.overall;
    document.getElementById("kpi-total").textContent         = fmtNum(o.total_books);
    document.getElementById("kpi-categories").textContent    = fmtNum(o.total_categories);
    document.getElementById("kpi-avg-price").textContent     = fmtVND(o.avg_price);
    document.getElementById("kpi-min-price").textContent     = fmtVND(o.min_price);
    document.getElementById("kpi-max-price").textContent     = fmtVND(o.max_price);
    document.getElementById("kpi-avg-rating").textContent    = (o.avg_rating || 0).toFixed(2);
    document.getElementById("kpi-total-reviews").textContent = fmtNum(o.total_reviews);
    document.getElementById("kpi-avg-discount").textContent  = (o.avg_discount || 0).toFixed(1) + "%";
    document.getElementById("generated-at").textContent      = new Date(s.generated_at).toLocaleString("vi-VN");
  }

  function renderClusters(s) {
    const total = s.overall.total_books;
    const labels = { 0: "Cụm 0 - Phổ thông", 1: "Cụm 1 - Best Seller", 2: "Cụm 2 - Cao cấp", 3: "Cụm 3 - Tiềm năng" };
    const colors = { 0: "bg-outline", 1: "bg-secondary", 2: "bg-primary", 3: "bg-tertiary-fixed-dim" };
    const el = document.getElementById("cluster-bars");
    el.innerHTML = s.cluster_distribution.map(c => {
      const pct = total ? (c.count / total * 100) : 0;
      return `
        <div class="flex flex-col gap-1">
          <div class="flex justify-between text-body-sm">
            <span class="flex items-center gap-2 text-on-surface">
              <span class="w-3 h-3 rounded-sm ${colors[c._id] || 'bg-outline'}"></span>
              ${escapeHtml(labels[c._id] || `Cụm ${c._id}`)}
            </span>
            <span class="font-label-md text-on-surface-variant">
              ${fmtNum(c.count)} sách (${pct.toFixed(1)}%) • giá TB ${fmtVND(c.avg_price)} • rating ${c.avg_rating.toFixed(2)}
            </span>
          </div>
          <div class="w-full h-3 bg-surface-container rounded-md overflow-hidden">
            <div class="h-full ${colors[c._id] || 'bg-primary'} rounded-md" style="width:${Math.max(2, pct)}%"></div>
          </div>
        </div>`;
    }).join("");
  }

  function renderRatingBuckets(s) {
    const total = s.overall.total_books;
    const labelMap = {
      "0": "0 – 3.0 ★", "3.0": "3.0 – 4.0 ★", "4.0": "4.0 – 4.5 ★",
      "4.5": "4.5 – 4.8 ★", "4.8": "4.8 – 5.0 ★", "unknown": "Không xác định"
    };
    document.getElementById("rating-bars").innerHTML = s.rating_distribution
      .map(r => barRow(labelMap[String(r._id)] || String(r._id), r.count, total))
      .join("");
  }

  function renderPriceBuckets(s) {
    const total = s.overall.total_books;
    const labelMap = {
      "0": "Dưới 50.000₫",
      "50000": "50.000 – 100.000₫",
      "100000": "100.000 – 200.000₫",
      "200000": "200.000 – 500.000₫",
      "500000": "Trên 500.000₫",
      "unknown": "Không xác định"
    };
    document.getElementById("price-bars").innerHTML = s.price_distribution
      .map(p => barRow(labelMap[String(p._id)] || String(p._id), p.count, total))
      .join("");
  }

  function renderTopCategories(s) {
    const total = s.overall.total_books;
    document.getElementById("top-categories").innerHTML = s.top_categories
      .map((c, i) => `
        <li class="flex items-start gap-2 py-1 border-b border-surface-container last:border-0">
          <span class="font-label-md text-primary font-bold w-6 shrink-0">#${i + 1}</span>
          <div class="flex-1 min-w-0">
            <div class="text-on-surface truncate" title="${escapeHtml(c._id)}">${escapeHtml(c._id || "—")}</div>
            <div class="text-label-sm text-on-surface-variant">
              ${fmtNum(c.count)} sách • giá TB ${fmtVND(c.avg_price)} • ${(c.count / total * 100).toFixed(1)}%
            </div>
          </div>
        </li>`).join("");
  }

  function renderTopAuthors(s) {
    document.getElementById("top-authors").innerHTML = s.top_authors
      .map((a, i) => `
        <li class="flex items-start gap-2 py-1 border-b border-surface-container last:border-0">
          <span class="font-label-md text-secondary font-bold w-6 shrink-0">#${i + 1}</span>
          <div class="flex-1 min-w-0">
            <div class="text-on-surface truncate" title="${escapeHtml(a._id)}">${escapeHtml(a._id)}</div>
            <div class="text-label-sm text-on-surface-variant">
              ${fmtNum(a.count)} đầu sách • rating TB ${a.avg_rating.toFixed(2)}★
            </div>
          </div>
        </li>`).join("");
  }

  function renderTopBooks(s) {
    const tbody = document.getElementById("top-books-body");
    tbody.innerHTML = s.top_books.map((b, i) => `
      <tr class="hover:bg-surface-container-low transition-colors">
        <td class="py-2 px-3 font-label-md text-primary font-bold">${i + 1}</td>
        <td class="py-2 px-3">
          <div class="text-on-surface truncate max-w-md" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</div>
          <div class="text-label-sm text-on-surface-variant truncate">${escapeHtml((b.category || "").split(" > ").pop())}</div>
        </td>
        <td class="py-2 px-3 text-right font-label-md">${fmtVND(b.price)}</td>
        <td class="py-2 px-3 text-center">
          <span class="inline-flex items-center gap-1 font-label-md text-tertiary">
            ★ ${(b.rating || 0).toFixed(1)}
          </span>
        </td>
        <td class="py-2 px-3 text-right font-label-md">${fmtNum(b.review_count)}</td>
      </tr>`).join("");
  }

  function renderAll(summary) {
    currentSummary = summary;
    renderKPIs(summary);
    renderClusters(summary);
    renderRatingBuckets(summary);
    renderPriceBuckets(summary);
    renderTopCategories(summary);
    renderTopAuthors(summary);
    renderTopBooks(summary);
  }

  // ── Load & refresh ──────────────────────────────────────
  async function loadReport() {
    setStatus(false, "Đang tải...");
    try {
      const r = await fetch(`${API}/api/reports/summary`);
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      renderAll(data);
      setStatus(true, "MongoDB Synced");
    } catch (e) {
      console.error("[Report] Lỗi:", e);
      setStatus(false, "Lỗi API");
      if (window.BooksUI?.toast) BooksUI.toast("Không tải được báo cáo: " + e.message, "error");
    }
  }

  // ── Download actions ────────────────────────────────────
  function downloadFromBackend(format) {
    window.location.href = `${API}/api/reports/export?format=${format}`;
    if (window.BooksUI?.toast) {
      BooksUI.toast(`Đang tải báo cáo ${format.toUpperCase()}...`, "info");
    }
  }

  function printPDF() {
    if (window.BooksUI?.toast) BooksUI.toast('Mở hộp thoại in — chọn "Save as PDF"', "info");
    setTimeout(() => window.print(), 350);
  }

  // ── Init ────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-refresh")?.addEventListener("click", loadReport);
    document.getElementById("btn-download-csv")?.addEventListener("click",  () => downloadFromBackend("csv"));
    document.getElementById("btn-download-json")?.addEventListener("click", () => downloadFromBackend("json"));
    document.getElementById("btn-print-pdf")?.addEventListener("click",    printPDF);
    loadReport();
  });
})();