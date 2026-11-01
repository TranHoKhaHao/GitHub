/* locdulieu-app.js — Logic trang Lọc & Tìm kiếm (FIXED) */
(function () {
  const { fmtVND, fmtNum, escapeHtml, CLUSTER_META, debounce } = BooksUtils;
  const Store = BooksStore;

  const els = {};
  function cacheEls() {
    els.search   = document.getElementById("bookSearchInput");
    els.priceMin = document.getElementById("rangeMin");
    els.priceMax = document.getElementById("rangeMax");
    els.discount = document.getElementById("discountRange");
    els.category = document.getElementById("categorySelect");
    els.tbody    = document.getElementById("loc-books-body");

    // KPI
    els.statTotal     = document.getElementById("stat-total");
    els.statAvgPrice  = document.getElementById("stat-avg-price");
    els.statAvgDisc   = document.getElementById("stat-avg-discount");
    els.statAvgRating = document.getElementById("stat-avg-rating");

    // Labels
    els.priceRangeLabel = document.getElementById("priceRangeLabel");
    els.priceMinLabel   = document.getElementById("priceMinLabel");
    els.priceMaxLabel   = document.getElementById("priceMaxLabel");
    els.discountLabel   = document.getElementById("discountLabel");
  }

  // Map value <select> → cluster id (theo books-core.js: 0 Phổ Thông, 1 Best Seller, 2 Cao Cấp, 3 Tiềm Năng)
  function mapCategory(val) {
    switch (val) {
      case "bestseller": return 1;
      case "standard":   return 0;
      case "premium":    return 2;
      case "potential":  return 3;
      default:           return "ALL";
    }
  }

  function currentFilters() {
    const pmin = Number(els.priceMin?.value || 0);
    const pmax = Number(els.priceMax?.value || 0);
    const pmaxLimit = Number(els.priceMax?.max || 500000);
    return {
      keyword:     els.search?.value || "",
      priceMin:    pmin,
      priceMax:    pmax >= pmaxLimit ? Infinity : pmax,
      discountMin: Number(els.discount?.value || 0),
      cluster:     mapCategory(els.category?.value || "all"),
    };
  }

  function updateLabels() {
    const pmin = Number(els.priceMin?.value || 0);
    const pmax = Number(els.priceMax?.value || 0);
    const disc = Number(els.discount?.value || 0);

    if (els.priceRangeLabel) els.priceRangeLabel.textContent = `${fmtVND(pmin)} - ${fmtVND(pmax)}`;
    if (els.priceMinLabel)   els.priceMinLabel.textContent   = fmtVND(pmin);
    if (els.priceMaxLabel)   els.priceMaxLabel.textContent   = fmtVND(pmax);
    if (els.discountLabel)   els.discountLabel.textContent   = `≥ ${disc}%`;
  }

  function updateStats(list) {
    if (!list.length) {
      if (els.statTotal)     els.statTotal.textContent     = "0";
      if (els.statAvgPrice)  els.statAvgPrice.textContent  = "0₫";
      if (els.statAvgDisc)   els.statAvgDisc.textContent   = "0%";
      if (els.statAvgRating) els.statAvgRating.textContent = "0.0";
      return;
    }
    const n = list.length;
    const avgPrice  = list.reduce((s, b) => s + (b.price         || 0), 0) / n;
    const avgDisc   = list.reduce((s, b) => s + (b.discount_rate || 0), 0) / n;
    const avgRating = list.reduce((s, b) => s + (b.rating        || 0), 0) / n;

    if (els.statTotal)     els.statTotal.textContent     = fmtNum(n);
    if (els.statAvgPrice)  els.statAvgPrice.textContent  = fmtVND(avgPrice);
    if (els.statAvgDisc)   els.statAvgDisc.textContent   = avgDisc.toFixed(1) + "%";
    if (els.statAvgRating) els.statAvgRating.textContent = avgRating.toFixed(1);
  }

  function render() {
    if (!els.tbody) return;

    updateLabels();

    const list = Store.filtered(currentFilters());
    updateStats(list);

    if (!list.length) {
      els.tbody.innerHTML = `<tr><td colspan="7" class="py-space-lg px-space-md text-center font-body-md text-body-md text-on-surface-variant">Không tìm thấy sách phù hợp.</td></tr>`;
      return;
    }

    els.tbody.innerHTML = list.slice(0, 40).map(b => {
      const cm = CLUSTER_META[b.cluster];
      return `
        <tr class="hover:bg-surface-container-low transition-colors">
          <td class="py-space-md px-space-md">
            <div class="flex items-center gap-space-md">
              ${b.cover_link
                ? `<img src="${b.cover_link}" class="w-12 h-16 rounded object-cover shadow-sm shrink-0" onerror="this.style.display='none'">`
                : `<div class="w-12 h-16 rounded bg-surface-container flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-outline">menu_book</span></div>`}
              <div class="flex flex-col min-w-0">
                <span class="font-headline-sm text-on-surface line-clamp-1">${escapeHtml(b.title)}</span>
                <span class="font-body-sm text-on-surface-variant">${escapeHtml(b.author||"—")}</span>
                <span class="font-label-sm text-[10px] mt-1 text-on-surface-variant">SKU: ${b.sku}</span>
              </div>
            </div>
          </td>
          <td class="py-space-md px-space-md">
            <span class="px-2 py-1 rounded-full text-[11px] font-semibold ${cm.chip}">${cm.short}</span>
          </td>
          <td class="py-space-md px-space-md text-right font-data-metric text-[14px] text-on-surface-variant line-through">${fmtVND(b.original_price)}</td>
          <td class="py-space-md px-space-md text-right font-data-metric text-[16px] text-error font-bold whitespace-nowrap">${fmtVND(b.price)}</td>
          <td class="py-space-md px-space-md text-center">
            <span class="font-label-sm text-[12px] text-error font-bold bg-error-container px-2 py-0.5 rounded">-${b.discount_rate}%</span>
          </td>
          <td class="py-space-md px-space-md text-center whitespace-nowrap">
            <div class="flex flex-col">
              <div class="flex items-center justify-center gap-1 text-[#f59e0b]">
                <span class="material-symbols-outlined text-[16px]" style="font-variation-settings:'FILL' 1;">star</span>
                <span class="font-label-md text-label-md font-bold text-on-surface">${(b.rating||0).toFixed(1)}</span>
              </div>
              <span class="font-body-sm text-body-sm text-on-surface-variant">${fmtNum(b.review_count)} đánh giá</span>
            </div>
          </td>
          <td class="py-space-md px-space-md text-center whitespace-nowrap">
            <button class="p-1 rounded hover:bg-surface-container text-primary" onclick="BooksUI.openModal(BooksStore.find('${b.sku}'))" title="Xem Chi Tiết">
              <span class="material-symbols-outlined text-[20px]">visibility</span>
            </button>
          </td>
        </tr>`;
    }).join("");
  }

  document.addEventListener("DOMContentLoaded", () => {
    window.booksReadyPromise.then((ok) => {
      if (!ok) BooksUI.toast("API không phản hồi – đang dùng cache", "info");

      // Sync active nav (an toàn với cả 2 kiểu: data-path hoặc href)
      document.querySelectorAll('header nav a').forEach(link => {
        const isActive = link.getAttribute('data-path') === 'loc-va-tim-kiem'
                      || (link.href && link.href.includes('locdulieu.html'));
        if (isActive) {
          link.classList.remove('text-on-surface-variant');
          link.classList.add('text-primary', 'border-b-2', 'border-primary');
        }
      });

      cacheEls();
      const handler = debounce(render, 200);
      [els.search, els.priceMin, els.priceMax, els.discount, els.category].forEach(el => {
        if (!el) return;
        el.addEventListener("input", handler);
        el.addEventListener("change", handler);
      });
      render();
      console.log(`[Locdulieu] ✅ Ready with ${Store.all().length} books`);
    });
  });
})();