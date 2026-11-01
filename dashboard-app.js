/* dashboard-app.js — Dashboard với K-Means + Isolation Forest */
(function () {
  "use strict";

  const API = "http://localhost:5000";
  const { fmtVND, fmtNum, debounce, escapeHtml, CLUSTER_META } = BooksUtils;
  const Store = BooksStore;

  const state = {
    keyword: "",
    priceMin: 5000,
    priceMax: 3500000,
    discountMin: 0,
    cluster: "ALL",
    page: 1,
    pageSize: 8,
  };

  const $ = (id) => document.getElementById(id);
  const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };

  // ═══════════════════════════════════════════════════════════
  // KPI (giữ nguyên)
  // ═══════════════════════════════════════════════════════════
  const currentList = () => Store.filtered(state);

  function updateKPIs(list) {
    const s = Store.stats(list);
    setText("stat-total-books",   fmtNum(s.total));
    setText("header-total-sku",   fmtNum(s.total));
    setText("stat-avg-price",     fmtVND(s.avgPrice));
    setText("stat-avg-discount",  s.avgDiscount.toFixed(1) + "%");
    setText("stat-avg-rating",    s.avgRating.toFixed(2));
    setText("donut-total",        fmtNum(s.total));

    [0, 1, 2, 3].forEach(c => {
      const pct = s.total ? (s.clusterCounts[c] / s.total * 100) : 0;
      setText(`cluster-count-${c}`, fmtNum(s.clusterCounts[c]));
      setText(`cluster-pct-${c}`,   pct.toFixed(1) + "%");
    });

    const C = 2 * Math.PI * 75;
    let offset = 0;
    [2, 1, 3, 0].forEach(c => {
      const arc = (s.clusterCounts[c] / (s.total || 1)) * C;
      const circle = document.querySelector(`circle[data-cluster-arc="${c}"]`);
      if (circle) {
        circle.setAttribute("stroke-dasharray",  `${arc} ${C}`);
        circle.setAttribute("stroke-dashoffset", `${-offset}`);
      }
      offset += arc;
    });
  }

  // ═══════════════════════════════════════════════════════════
  // TABLE (giữ nguyên)
  // ═══════════════════════════════════════════════════════════
  function renderTable(list) {
    const tbody = $("dashboard-books-body");
    if (!tbody) return;
    const { rows, total, pages } = Store.page(list, state.page, state.pageSize);

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-space-lg text-on-surface-variant">Không có sách phù hợp.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(b => {
        const cm = CLUSTER_META[b.cluster];
        return `
          <tr class="hover:bg-surface-container-low/60 transition-colors">
            <td class="py-space-sm px-space-md font-data-metric text-[12px] font-bold text-primary">${b.sku}</td>
            <td class="py-space-sm px-space-md">
              <div class="flex flex-col min-w-0">
                <span class="font-headline-sm text-body-md text-on-surface font-semibold truncate">${escapeHtml(b.title)}</span>
                <span class="font-body-sm text-body-sm text-on-surface-variant truncate">${escapeHtml(b.author || "—")} • ${escapeHtml((b.category || "Sách").split(" > ").pop().slice(0, 40))}</span>
              </div>
            </td>
            <td class="py-space-sm px-space-md text-right font-data-metric font-medium">${fmtVND(b.price)}</td>
            <td class="py-space-sm px-space-md text-center">
              <span class="inline-block px-2 py-0.5 rounded font-label-sm text-label-sm font-bold bg-error-container text-on-error-container">-${b.discount_rate}%</span>
            </td>
            <td class="py-space-sm px-space-md text-right font-data-metric">${fmtNum(b.review_count)}</td>
            <td class="py-space-sm px-space-md text-center">
              <span class="inline-flex items-center gap-1 font-label-md text-label-md font-bold ${b.rating >= 4.8 ? 'text-secondary' : 'text-primary'}">★ ${(b.rating || 0).toFixed(2)}</span>
            </td>
            <td class="py-space-sm px-space-md">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-label-sm text-[11px] ${cm.chip} font-medium">
                <span class="w-1.5 h-1.5 rounded-full ${cm.dot}"></span> ${cm.short}
              </span>
            </td>
            <td class="py-space-sm px-space-md text-center">
              <button class="p-1 hover:bg-surface-container text-outline hover:text-primary rounded transition-colors" onclick="BooksUI.openModal(BooksStore.find('${b.sku}'))" title="Chi tiết">
                <span class="material-symbols-outlined text-[18px]">visibility</span>
              </button>
            </td>
          </tr>`;
      }).join("");
    }

    const footer = $("dashboard-table-footer");
    if (footer) {
      const start = (state.page - 1) * state.pageSize + 1;
      const end   = Math.min(state.page * state.pageSize, total);
      footer.innerHTML = `
        <div class="font-body-sm text-body-sm text-on-surface-variant">
          Hiển thị <b>${start} - ${end}</b> / <b>${fmtNum(total)}</b> SKU | Trang ${state.page} / ${pages}
        </div>
        <div class="flex items-center gap-1">
          <button class="w-8 h-8 rounded bg-surface-container-lowest flex items-center justify-center ${state.page === 1 ? 'opacity-40' : ''}" ${state.page === 1 ? 'disabled' : ''} onclick="DashboardApp.gotoPage(${state.page - 1})">
            <span class="material-symbols-outlined text-[16px]">chevron_left</span>
          </button>
          ${[...Array(Math.min(pages, 3))].map((_, i) => `
            <button class="w-8 h-8 rounded ${state.page === i + 1 ? 'bg-primary text-on-primary font-bold' : 'bg-surface-container-lowest'} font-label-sm text-label-sm" onclick="DashboardApp.gotoPage(${i + 1})">${i + 1}</button>
          `).join("")}
          ${pages > 3 ? `<span class="px-1 text-outline">...</span><button class="px-2 h-8 rounded bg-surface-container-lowest font-label-sm text-label-sm" onclick="DashboardApp.gotoPage(${pages})">${pages}</button>` : ""}
          <button class="w-8 h-8 rounded bg-surface-container-lowest flex items-center justify-center ${state.page === pages ? 'opacity-40' : ''}" ${state.page === pages ? 'disabled' : ''} onclick="DashboardApp.gotoPage(${state.page + 1})">
            <span class="material-symbols-outlined text-[16px]">chevron_right</span>
          </button>
        </div>`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SCATTER (giữ nguyên)
  // ═══════════════════════════════════════════════════════════
  function renderScatter(list) {
    const svg = $("dashboard-scatter-svg");
    if (!svg) return;
    svg.querySelectorAll("circle.scatter-point").forEach(c => c.remove());

    const sample = list.slice(0, 200);
    const colors = { 0: "#006c49", 1: "#717785", 2: "#005cb9", 3: "#845300" };
    const px = d => 50 + (Math.min(d, 60) / 60) * (620 - 50);
    const py = r => 240 - (Math.min(r, 5000) / 5000) * (240 - 20);

    sample.forEach(b => {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("class", "scatter-point");
      c.setAttribute("cx", px(b.discount_rate).toFixed(1));
      c.setAttribute("cy", py(b.review_count).toFixed(1));
      c.setAttribute("r", Math.max(2, Math.min(6, Math.log10(b.review_count + 10) * 1.5)).toFixed(1));
      c.setAttribute("fill", colors[b.cluster] || "#005cb9");
      c.setAttribute("opacity", "0.55");
      c.innerHTML = `<title>${escapeHtml(b.title)} — -${b.discount_rate}% — ${b.review_count} reviews</title>`;
      svg.appendChild(c);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // ★ ANOMALY — ISOLATION FOREST (MỚI)
  // ═══════════════════════════════════════════════════════════
  async function loadAnomalies(limit = 15) {
    const tbody   = $("dashboard-anomaly-body");
    const summary = $("dashboard-anomaly-summary");
    if (!tbody) return;

    // Loading state
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-space-lg text-on-surface-variant">
      <span class="inline-flex items-center gap-2">
        <span class="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
        Đang tải danh sách anomalies…
      </span>
    </td></tr>`;
    if (summary) {
      summary.textContent = "Đang tải…";
      summary.className = "font-label-sm text-label-sm px-3 py-1.5 rounded bg-surface-container text-on-surface-variant font-semibold";
    }

    try {
      const res = await fetch(`${API}/api/anomalies?limit=${limit}`);
      const data = await res.json();

      // API không khả dụng
      if (!res.ok || !data.ok) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-space-lg text-on-surface-variant">
          <span class="inline-flex items-center gap-2">
            <span class="material-symbols-outlined text-[20px] text-tertiary">info</span>
            Isolation Forest chưa sẵn sàng — chạy <code class="bg-surface-container px-1.5 rounded font-label-sm">python train_isolation_forest.py</code> và khởi động lại backend.
          </span>
        </td></tr>`;
        if (summary) {
          summary.textContent = "Model offline";
          summary.className = "font-label-sm text-label-sm px-3 py-1.5 rounded bg-tertiary-fixed text-on-tertiary-fixed-variant font-semibold";
        }
        return;
      }

      renderAnomalyTable(data);
    } catch (err) {
      console.error("[Dashboard] loadAnomalies failed:", err.message);
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-space-lg text-error">
        ⚠️ Không kết nối được API (${escapeHtml(err.message)}). Đảm bảo <code>python api.py</code> đang chạy.
      </td></tr>`;
      if (summary) {
        summary.textContent = "API offline";
        summary.className = "font-label-sm text-label-sm px-3 py-1.5 rounded bg-error-container text-on-error-container font-semibold";
      }
    }
  }

  function renderAnomalyTable(data) {
    const tbody   = $("dashboard-anomaly-body");
    const summary = $("dashboard-anomaly-summary");
    if (!tbody) return;

    const anomalies = data.anomalies || [];

    // Summary badge
    if (summary) {
      summary.textContent = `${fmtNum(data.total_anomalies)} / ${fmtNum(data.total_books)} SKU (${data.contamination_rate}%)`;
      const rate = Number(data.contamination_rate) || 0;
      if (rate <= 0) {
        summary.className = "font-label-sm text-label-sm px-3 py-1.5 rounded bg-secondary-container text-on-secondary-container font-semibold";
      } else if (rate <= 5) {
        summary.className = "font-label-sm text-label-sm px-3 py-1.5 rounded bg-tertiary-fixed text-on-tertiary-fixed-variant font-semibold";
      } else {
        summary.className = "font-label-sm text-label-sm px-3 py-1.5 rounded bg-error-container text-on-error-container font-semibold";
      }
    }

    if (!anomalies.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-space-lg text-on-surface-variant">
        <span class="inline-flex items-center gap-2">
          <span class="material-symbols-outlined text-[20px] text-secondary">check_circle</span>
          Không phát hiện sản phẩm bất thường nào trong tập dữ liệu hiện tại.
        </span>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = anomalies.map(a => {
      const score    = Number(a.anomaly_score) || 0;
      const negative = score < 0;
      const scoreCls = negative ? "text-error font-bold" : "text-secondary font-bold";
      const rowTint  = negative
        ? "hover:bg-error-container/30"
        : "hover:bg-surface-container-low/60";

      return `
        <tr class="${rowTint} transition-colors">
          <td class="py-space-sm px-space-md font-data-metric text-[12px] font-bold text-primary whitespace-nowrap">
            ${escapeHtml(a.sku || "—")}
          </td>
          <td class="py-space-sm px-space-md">
            <div class="flex flex-col min-w-0">
              <span class="font-headline-sm text-body-md text-on-surface font-semibold truncate" title="${escapeHtml(a.title || '')}">
                ${escapeHtml(a.title || "—")}
              </span>
              <span class="font-body-sm text-body-sm text-on-surface-variant truncate">
                ${escapeHtml((a.category || "Sách").split(" > ").pop().slice(0, 50))}
              </span>
            </div>
          </td>
          <td class="py-space-sm px-space-md text-right font-data-metric whitespace-nowrap">${fmtVND(a.price)}</td>
          <td class="py-space-sm px-space-md text-center">
            <span class="inline-block px-2 py-0.5 rounded font-label-sm text-label-sm font-bold bg-error-container text-on-error-container">
              -${Number(a.discount_rate || 0).toFixed(0)}%
            </span>
          </td>
          <td class="py-space-sm px-space-md text-right font-data-metric whitespace-nowrap">${fmtNum(a.review_count)}</td>
          <td class="py-space-sm px-space-md text-center">
            <span class="inline-flex items-center gap-1 font-label-md text-label-md font-bold ${a.rating >= 4.8 ? 'text-secondary' : (a.rating >= 4.5 ? 'text-primary' : 'text-tertiary')}">
              ★ ${Number(a.rating || 0).toFixed(2)}
            </span>
          </td>
          <td class="py-space-sm px-space-md text-center font-data-metric text-[12px] ${scoreCls} whitespace-nowrap">
            ${score.toFixed(3)}
          </td>
          <td class="py-space-sm px-space-md">
            <span class="font-body-sm text-body-sm text-on-surface-variant">
              ${escapeHtml(a.reason || "—")}
            </span>
          </td>
        </tr>`;
    }).join("");
  }

  // ═══════════════════════════════════════════════════════════
  // BIND CONTROLS (giữ nguyên + thêm nút anomaly refresh)
  // ═══════════════════════════════════════════════════════════
  function bindControls() {
    const sidebarSearch = $("dash-sidebar-search");
    const topSearch     = $("dash-top-search");
    const tableSearch   = $("dash-table-search");

    const onSearch = debounce(e => {
      state.keyword = e.target.value;
      state.page = 1;
      refresh();
    }, 250);
    [sidebarSearch, topSearch, tableSearch].forEach(inp => inp && inp.addEventListener("input", onSearch));

    const priceSl = $("dash-price-slider");
    if (priceSl) priceSl.addEventListener("input", debounce(e => {
      state.priceMax = Number(e.target.value);
      const lbl = $("dash-price-label");
      if (lbl) lbl.textContent = `5k - ${fmtVND(state.priceMax)}`;
      state.page = 1;
      refresh();
    }, 200));

    const discSl = $("dash-discount-slider");
    if (discSl) discSl.addEventListener("input", debounce(e => {
      state.discountMin = Number(e.target.value);
      const lbl = $("dash-discount-label");
      if (lbl) lbl.textContent = `≥ ${state.discountMin}%`;
      state.page = 1;
      refresh();
    }, 200));

    $("dash-export-csv-btn")?.addEventListener("click", () => {
      const list = currentList();
      if (BooksExport.csv(list, "tiki_books_export.csv"))
        BooksUI.toast(`Đã xuất ${list.length} sách ra CSV!`);
      else BooksUI.toast("Không có dữ liệu", "error");
    });

    $("dash-refresh-btn")?.addEventListener("click", async () => {
      await Store.init();
      refresh();
      loadAnomalies();   // ← refresh cả anomalies
      BooksUI.toast("Đã nạp lại từ MongoDB");
    });

    $("dash-export-table-btn")?.addEventListener("click", () => {
      BooksExport.csv(currentList(), "tiki_books_dashboard.csv");
      BooksUI.toast("Đã xuất bảng");
    });

    // Cluster filter button
    const filterBtn = $("dash-filter-cluster-btn");
    const filterLbl = $("dash-filter-cluster-label");
    const labels = ["Tất Cả Cụm", "Cụm 0: Best Seller", "Cụm 1: Phổ Thông", "Cụm 2: Khuyến Mãi", "Cụm 3: Combo"];
    const opts   = ["ALL", "0", "1", "2", "3"];
    if (filterBtn && filterLbl) {
      filterBtn.addEventListener("click", () => {
        const next = (opts.indexOf(state.cluster) + 1) % opts.length;
        state.cluster = opts[next];
        filterLbl.textContent = labels[next];
        state.page = 1;
        refresh();
      });
    }

    // ★ Nút refresh riêng cho anomalies
    $("dash-refresh-anomaly-btn")?.addEventListener("click", () => {
      loadAnomalies();
      BooksUI.toast("Đang làm mới anomalies…", "info");
    });
  }

  // ═══════════════════════════════════════════════════════════
  // REFRESH
  // ═══════════════════════════════════════════════════════════
  function refresh() {
    const list = currentList();
    updateKPIs(list);
    renderTable(list);
    renderScatter(list);
  }

  // ═══════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════
  window.DashboardApp = {
    gotoPage(p) { state.page = p; refresh(); },
    refresh,
    loadAnomalies,
  };

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  document.addEventListener("DOMContentLoaded", () => {
    const ready = window.booksReadyPromise || Promise.resolve(false);
    ready.then((ok) => {
      if (!ok) BooksUI.toast("API không phản hồi – đang dùng cache", "info");
      bindControls();
      refresh();

      // Load anomalies song song — không block dashboard
      loadAnomalies();

      console.log("[Dashboard] ✅ Ready (K-Means + Isolation Forest)");
    });
  });
})();