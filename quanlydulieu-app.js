/* quanlydulieu-app.js — FIXED: await + error handling cho mọi write ops */
(function () {
  const { fmtVND, fmtNum, escapeHtml, CLUSTER_META, debounce } = BooksUtils;
  const Store = BooksStore;

  const state = {
    keyword: "",
    cluster: "ALL",
    sort: "newest",
    page: 1,
    pageSize: 10,
    selectedSku: null,
    busy: false,          // chống double-click
  };

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setBusy = (btn, busy, loadingText = "Đang xử lý...") => {
    if (!btn) return;
    if (busy) {
      btn.dataset.oldHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span><span>${loadingText}</span>`;
    } else {
      btn.disabled = false;
      if (btn.dataset.oldHtml) btn.innerHTML = btn.dataset.oldHtml;
    }
  };

  // ═══════════════════════════════════════════
  // List + KPI
  // ═══════════════════════════════════════════
  function getCurrentList() {
    let list = Store.filtered({ keyword: state.keyword, cluster: state.cluster });
    if (state.sort === "price-desc")        list = Store.sorted(list, "price", "desc");
    else if (state.sort === "price-asc")    list = Store.sorted(list, "price", "asc");
    else if (state.sort === "rating-desc")  list = Store.sorted(list, "rating", "desc");
    else if (state.sort === "reviews-desc") list = Store.sorted(list, "review_count", "desc");
    else                                    list = Store.sorted(list, "sku", "desc");
    return list;
  }

  function updateKPIs() {
    const s = Store.stats();
    setText("header-total-sku", fmtNum(s.total));
    setText("kpi-total-sku", fmtNum(s.total));
    [0,1,2,3].forEach(c => {
      const pct = s.total ? (s.clusterCounts[c] / s.total * 100) : 0;
      setText(`kpi-c${c}-count`, fmtNum(s.clusterCounts[c]));
      setText(`kpi-c${c}-pct`, pct.toFixed(1) + "%");
    });
  }

  // ═══════════════════════════════════════════
  // Table
  // ═══════════════════════════════════════════
  function renderTable() {
    const tbody = document.getElementById("crud-table-body");
    if (!tbody) return;

    const list = getCurrentList();
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));

    if (state.page > pages) state.page = pages;
    if (state.page < 1)     state.page = 1;

    const start = (state.page - 1) * state.pageSize;
    const rows = list.slice(start, start + state.pageSize);

    if (state.selectedSku && !list.some(b => b.sku === state.selectedSku)) {
      state.selectedSku = null;
      hideInspector();
    }

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-on-surface-variant">Không có sách nào phù hợp với bộ lọc.</td></tr>`;
      if (!state.selectedSku) hideInspector();
    } else {
      tbody.innerHTML = rows.map(b => {
        const cm = CLUSTER_META[b.cluster];
        const isSelected = state.selectedSku === b.sku;
        const imgHtml = b.cover_link
          ? `<img src="${b.cover_link}" alt="${escapeHtml(b.title)}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"/>
             <div class="absolute inset-0 hidden items-center justify-center bg-surface-container-high">
               <span class="material-symbols-outlined text-outline text-[24px]">menu_book</span>
             </div>`
          : `<div class="w-full h-full flex items-center justify-center bg-surface-container-high">
               <span class="material-symbols-outlined text-outline text-[24px]">menu_book</span>
             </div>`;

        return `
          <tr class="hover:bg-surface-container-low transition-colors cursor-pointer group ${isSelected ? 'bg-surface-container-low ring-1 ring-primary-container' : ''}" data-sku="${b.sku}" onclick="CRUDApp.selectRow('${b.sku}')">
            <td class="py-3 px-2 text-center" onclick="event.stopPropagation()">
              <input class="row-checkbox w-4 h-4 rounded cursor-pointer accent-primary" type="checkbox" value="${b.sku}"/>
            </td>
            <td class="py-3 px-2 font-label-md text-[12px] text-primary font-bold whitespace-nowrap">${b.sku}</td>
            <td class="py-3 px-3">
              <div class="flex items-center gap-3">
                <div class="w-10 h-14 bg-surface-container rounded shadow-sm shrink-0 overflow-hidden relative">${imgHtml}</div>
                <div class="flex flex-col min-w-0">
                  <span class="font-headline-sm text-[14px] text-on-surface font-semibold truncate group-hover:text-primary transition-colors" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</span>
                  <span class="font-body-sm text-[12px] text-on-surface-variant truncate">${escapeHtml(b.author || "—")}</span>
                </div>
              </div>
            </td>
            <td class="py-3 px-3 text-right">
              <div class="font-label-md text-[13px] font-bold whitespace-nowrap">${fmtVND(b.price)}</div>
              <span class="font-label-sm text-[10px] px-1.5 py-0.5 rounded bg-error-container text-on-error-container font-semibold">-${b.discount_rate}%</span>
            </td>
            <td class="py-3 px-2 text-center">
              <div class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container">
                <span class="material-symbols-outlined text-[14px] text-tertiary-container" style="font-variation-settings:'FILL' 1;">star</span>
                <span class="font-label-md text-[12px] font-bold">${(b.rating || 0).toFixed(1)}</span>
              </div>
            </td>
            <td class="py-3 px-2 text-right font-label-md text-[12px]">${fmtNum(b.review_count)}</td>
            <td class="py-3 px-3 whitespace-nowrap">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-label-sm text-[10px] ${cm.chip} font-bold">
                <span class="w-1.5 h-1.5 rounded-full ${cm.dot}"></span> ${cm.short}
              </span>
            </td>
            <td class="py-3 px-2 text-center" onclick="event.stopPropagation()">
              <div class="flex items-center justify-center gap-1">
                <button class="p-1 rounded hover:bg-surface-container text-on-surface-variant hover:text-primary transition-colors" onclick="CRUDApp.edit('${b.sku}')" title="Sửa">
                  <span class="material-symbols-outlined text-[18px]">edit_note</span>
                </button>
                <button class="p-1 rounded hover:bg-surface-container text-on-surface-variant hover:text-secondary transition-colors" onclick="CRUDApp.duplicate('${b.sku}')" title="Nhân bản">
                  <span class="material-symbols-outlined text-[18px]">content_copy</span>
                </button>
                <button class="p-1 rounded hover:bg-error-container text-on-surface-variant hover:text-error transition-colors" onclick="CRUDApp.remove('${b.sku}')" title="Xóa">
                  <span class="material-symbols-outlined text-[18px]">delete</span>
                </button>
              </div>
            </td>
          </tr>`;
      }).join("");
    }

    updateSelectedCount();
    updatePagination(total, pages);

    if (rows.length > 0 && !state.selectedSku && !state.keyword) {
      selectRow(rows[0].sku, true);
    }
  }

  function updatePagination(total, pages) {
    const footer = document.getElementById("crud-pagination");
    if (!footer) return;
    const start = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.page * state.pageSize, total);

    let buttonsHtml = "";
    for (let i = 1; i <= Math.min(pages, 5); i++) {
      buttonsHtml += `<button class="w-8 h-8 rounded ${state.page === i ? 'bg-primary-container text-on-primary font-bold' : 'bg-surface-container-low hover:bg-surface-container text-on-surface'} font-label-sm text-label-sm flex items-center justify-center" onclick="CRUDApp.gotoPage(${i})">${i}</button>`;
    }
    if (pages > 5) {
      buttonsHtml += `<span class="px-1 text-outline">...</span><button class="px-2 h-8 rounded bg-surface-container-low text-on-surface font-label-sm text-label-sm" onclick="CRUDApp.gotoPage(${pages})">${pages}</button>`;
    }

    footer.innerHTML = `
      <div class="font-body-sm text-body-sm text-on-surface-variant">
        Hiển thị <b>${start} - ${end}</b> trong tổng số <b>${fmtNum(total)}</b> SKU
      </div>
      <div class="flex items-center gap-1">
        <button class="px-2.5 py-1.5 rounded bg-surface-container text-on-surface-variant hover:text-on-surface ${state.page === 1 ? 'opacity-40 cursor-not-allowed' : ''}" ${state.page === 1 ? 'disabled' : ''} onclick="CRUDApp.gotoPage(${state.page - 1})">
          <span class="material-symbols-outlined text-[18px] align-middle">chevron_left</span>
        </button>
        ${buttonsHtml}
        <button class="px-2.5 py-1.5 rounded bg-surface-container-low hover:bg-surface-container text-on-surface ${state.page === pages || pages === 0 ? 'opacity-40 cursor-not-allowed' : ''}" ${state.page === pages || pages === 0 ? 'disabled' : ''} onclick="CRUDApp.gotoPage(${state.page + 1})">
          <span class="material-symbols-outlined text-[18px] align-middle">chevron_right</span>
        </button>
      </div>`;
  }

  function updateSelectedCount() {
    const checked = document.querySelectorAll(".row-checkbox:checked");
    const el = document.getElementById("selected-count");
    if (el) el.textContent = checked.length;
    const allCb = document.getElementById("select-all-checkbox");
    const all = document.querySelectorAll(".row-checkbox");
    if (allCb && all.length > 0) allCb.checked = checked.length === all.length && all.length > 0;
  }

  // ═══════════════════════════════════════════
  // Inspector
  // ═══════════════════════════════════════════
  function showInspector() {
    const panel = document.getElementById("inspector-panel");
    const table = document.getElementById("table-container");
    const txt = document.getElementById("inspector-toggle-text");
    if (!panel || !table) return;
    panel.classList.remove("hidden");
    panel.classList.add("flex");
    table.className = "col-span-12 xl:col-span-8 flex flex-col bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden transition-all duration-300";
    if (txt) txt.textContent = "Ẩn Inspector";
  }

  function hideInspector() {
    const panel = document.getElementById("inspector-panel");
    const table = document.getElementById("table-container");
    const txt = document.getElementById("inspector-toggle-text");
    if (!panel || !table) return;
    panel.classList.add("hidden");
    panel.classList.remove("flex");
    table.className = "col-span-12 flex flex-col bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden transition-all duration-300";
    if (txt) txt.textContent = "Hiện Inspector";
    const skuBadge = document.getElementById("active-sku-badge");
    if (skuBadge) skuBadge.textContent = "—";
    const aiTag = document.getElementById("inspector-ai-tag");
    if (aiTag) aiTag.textContent = "—";
  }

  function selectRow(sku, silent = false) {
    state.selectedSku = sku;
    const b = Store.find(sku);
    if (!b) return;
    showInspector();

    document.querySelectorAll("#crud-table-body tr").forEach(tr => tr.classList.remove("bg-surface-container-low", "ring-1", "ring-primary-container"));
    const row = document.querySelector(`#crud-table-body tr[data-sku="${sku}"]`);
    if (row) {
      row.classList.add("bg-surface-container-low", "ring-1", "ring-primary-container");
      if (!silent) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    document.getElementById("active-sku-badge").textContent = b.sku;
    document.getElementById("inspector-sku").value = b.sku;
    document.getElementById("inspector-title").value = b.title;
    document.getElementById("inspector-author").value = b.author || "";
    document.getElementById("inspector-price").value = b.price;
    document.getElementById("inspector-reviews").value = b.review_count;
    document.getElementById("inspector-discount").value = b.discount_rate;
    document.getElementById("discount-val-label").textContent = `${b.discount_rate}%`;
    document.getElementById("inspector-rating").value = b.rating;
    document.getElementById("inspector-cluster-select").value = b.cluster;
    document.getElementById("inspector-ai-tag").textContent = CLUSTER_META[b.cluster].label;
  }

  // ═══════════════════════════════════════════
  // WRITE ACTIONS (async + await — QUAN TRỌNG)
  // ═══════════════════════════════════════════
  async function duplicate(sku) {
    if (state.busy) return;
    state.busy = true;
    try {
      const newSku = await Store.duplicate(sku);
      if (newSku) {
        BooksUI.toast(`Đã nhân bản thành ${newSku}`, "success");
        state.keyword = "";
        state.cluster = "ALL";
        state.sort = "newest";
        state.page = 1;
        document.getElementById("search-input").value = "";
        document.getElementById("filter-cluster").value = "ALL";
        document.getElementById("sort-select").value = "newest";
        renderTable();
        updateKPIs();
        selectRow(newSku);
      } else {
        BooksUI.toast("Nhân bản thất bại — kiểm tra API/MongoDB", "error");
      }
    } catch (e) {
      BooksUI.toast("Lỗi nhân bản: " + e.message, "error");
    } finally {
      state.busy = false;
    }
  }

  async function remove(sku) {
    if (state.busy) return;
    if (!confirm(`Xác nhận xóa bản ghi SKU ${sku}?`)) return;
    state.busy = true;
    try {
      const ok = await Store.remove(sku);
      if (ok) {
        BooksUI.toast(`Đã xóa SKU ${sku} khỏi MongoDB`, "error");
        if (state.selectedSku === sku) state.selectedSku = null;
        renderTable();
        updateKPIs();
      } else {
        BooksUI.toast("Xóa thất bại — API không phản hồi đúng", "error");
      }
    } catch (e) {
      BooksUI.toast("Lỗi xóa: " + e.message, "error");
    } finally {
      state.busy = false;
    }
  }

  function edit(sku) { selectRow(sku); }

  async function saveInspector() {
    if (!state.selectedSku) {
      BooksUI.toast("Chưa chọn sản phẩm nào", "error");
      return;
    }
    const patch = {
      title:         document.getElementById("inspector-title").value.trim(),
      author:        document.getElementById("inspector-author").value.trim() || "Đang cập nhật",
      price:         Number(document.getElementById("inspector-price").value) || 0,
      review_count:  Number(document.getElementById("inspector-reviews").value) || 0,
      discount_rate: Number(document.getElementById("inspector-discount").value) || 0,
      rating:        Number(document.getElementById("inspector-rating").value) || 0,
      cluster:       Number(document.getElementById("inspector-cluster-select").value)
    };
    if (!patch.title) {
      BooksUI.toast("Tên sách không được để trống!", "error");
      return;
    }

    const btn = document.getElementById("btn-save-inspector");
    setBusy(btn, true, "Đang lưu vào MongoDB...");
    try {
      const ok = await Store.update(state.selectedSku, patch);
      if (ok) {
        BooksUI.toast(`Đã lưu thay đổi cho ${state.selectedSku}`, "success");
        renderTable();
        updateKPIs();
        selectRow(state.selectedSku, true);
      } else {
        BooksUI.toast("Lưu thất bại — kiểm tra API/MongoDB", "error");
      }
    } catch (e) {
      BooksUI.toast("Lỗi lưu: " + e.message, "error");
    } finally {
      setBusy(btn, false);
    }
  }

  // ═══════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════
  window.CRUDApp = {
    handleSearch(val) { state.keyword = val; state.page = 1; renderTable(); },
    handleFilter(val) { state.cluster = val; state.page = 1; renderTable(); },
    handleSort(val)   { state.sort = val; renderTable(); },
    gotoPage(p)       { state.page = p; renderTable(); },
    selectRow, edit, duplicate, remove
  };

  // ═══════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════
  document.addEventListener("DOMContentLoaded", () => {
    hideInspector();
    updateKPIs();
    renderTable();

    // Search debounce
    const searchInput = document.getElementById("search-input");
    if (searchInput) {
      searchInput.addEventListener("input", debounce(e => {
        state.keyword = e.target.value;
        state.page = 1;
        renderTable();
      }, 250));
    }

    // Select all
    document.getElementById("select-all-checkbox").addEventListener("change", (e) => {
      document.querySelectorAll(".row-checkbox").forEach(cb => cb.checked = e.target.checked);
      updateSelectedCount();
    });
    document.getElementById("crud-table-body").addEventListener("change", (e) => {
      if (e.target.classList.contains("row-checkbox")) updateSelectedCount();
    });

    // Inspector buttons
    document.getElementById("btn-save-inspector").addEventListener("click", saveInspector);
    document.getElementById("btn-duplicate-inspector").addEventListener("click", () => { if (state.selectedSku) duplicate(state.selectedSku); });
    document.getElementById("btn-delete-inspector").addEventListener("click", () => { if (state.selectedSku) remove(state.selectedSku); });

    // Toggle inspector
    document.getElementById("btn-toggle-inspector").addEventListener("click", () => {
      const panel = document.getElementById("inspector-panel");
      if (panel.classList.contains("hidden")) {
        if (!state.selectedSku) {
          const list = getCurrentList();
          if (list.length > 0) selectRow(list[0].sku);
        } else showInspector();
      } else {
        state.selectedSku = null;
        hideInspector();
        document.querySelectorAll("#crud-table-body tr").forEach(tr => tr.classList.remove("bg-surface-container-low", "ring-1", "ring-primary-container"));
      }
    });

    // Sync K-Means
    document.getElementById("btn-sync-kmeans").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true, "Đang đồng bộ...");
      try {
        const count = await Store.reclusterAll();
        BooksUI.toast(`Đã đồng bộ phân cụm K-Means (${count} bản ghi cập nhật)`, "success");
        renderTable();
        updateKPIs();
      } catch (err) {
        BooksUI.toast("Lỗi đồng bộ K-Means: " + err.message, "error");
      } finally {
        setBusy(btn, false);
      }
    });

    // Export CSV
    document.getElementById("btn-export-csv").addEventListener("click", () => {
      const list = getCurrentList();
      if (BooksExport.csv(list, "tiki_books_crud_export.csv")) {
        BooksUI.toast(`Đã xuất ${list.length} sách ra file CSV`, "success");
      }
    });

    // Batch delete
    document.getElementById("batch-action-trigger").addEventListener("click", async (e) => {
      const checked = Array.from(document.querySelectorAll(".row-checkbox:checked")).map(cb => cb.value);
      if (checked.length === 0) {
        BooksUI.toast("Vui lòng chọn ít nhất 1 dòng!", "error");
        return;
      }
      if (!confirm(`Xác nhận xóa ${checked.length} sách đã chọn khỏi MongoDB?`)) return;

      const btn = e.currentTarget;
      setBusy(btn, true, `Đang xóa ${checked.length}...`);
      try {
        const ok = await Store.removeMany(checked);
        if (checked.includes(state.selectedSku)) state.selectedSku = null;
        BooksUI.toast(`Đã xóa ${ok}/${checked.length} sách khỏi MongoDB`, ok === checked.length ? "success" : "error");
        renderTable();
        updateKPIs();
      } catch (err) {
        BooksUI.toast("Lỗi xóa loạt: " + err.message, "error");
      } finally {
        setBusy(btn, false);
      }
    });

    // ── Add book modal ──
    const modal = document.getElementById("add-book-modal");
    const openModal = () => {
      document.getElementById("modal-new-sku").value = Store._nextSku();
      modal.classList.remove("hidden");
    };
    const closeModal = () => modal.classList.add("hidden");

    document.getElementById("btn-open-add-modal").addEventListener("click", openModal);
    document.getElementById("btn-close-modal").addEventListener("click", closeModal);
    document.getElementById("btn-cancel-modal").addEventListener("click", closeModal);

    // ── SUBMIT NEW BOOK (FIXED: await + error) ──
    document.getElementById("btn-submit-modal").addEventListener("click", async (e) => {
      const title = document.getElementById("modal-new-title").value.trim();
      const price = Number(document.getElementById("modal-new-price").value);

      if (!title || price <= 0) {
        BooksUI.toast("Vui lòng nhập Tên sách và Giá bán hợp lệ!", "error");
        return;
      }

      const clusterChoice = document.getElementById("modal-new-cluster").value;
      const newBook = {
        title,
        author: document.getElementById("modal-new-author").value.trim() || "Đang cập nhật",
        category: document.getElementById("modal-new-publisher").value.trim() || "Sách",
        price,
        original_price: price,
        discount_rate: Number(document.getElementById("modal-new-discount").value) || 0,
        rating: Number(document.getElementById("modal-new-rating").value) || 5.0,
        review_count: Number(document.getElementById("modal-new-reviews").value) || 0
      };

      const btn = e.currentTarget;
      setBusy(btn, true, "Đang lưu vào MongoDB...");

      try {
        // ⚠️ BẮT BUỘC: await — Store.add là async
        const newSku = await Store.add(newBook);

        if (!newSku) {
          throw new Error(
            "Không lưu được vào MongoDB. Kiểm tra:\n" +
            "  1. Server api.py đã chạy chưa (python api.py)\n" +
            "  2. MongoDB Atlas có whitelist IP không\n" +
            "  3. Mở DevTools → Console xem chi tiết"
          );
        }

        // Nếu user chọn cụm thủ công thì cập nhật lại
        if (clusterChoice !== "AUTO") {
          const ok2 = await Store.update(newSku, { cluster: Number(clusterChoice) });
          if (!ok2) console.warn("[CRUD] Cập nhật cluster thủ công thất bại");
        }

        BooksUI.toast(`✅ Đã thêm thành công ${newSku} vào MongoDB`, "success");
        closeModal();

        // Reset form
        document.getElementById("modal-new-title").value = "";
        document.getElementById("modal-new-price").value = "";
        document.getElementById("modal-new-author").value = "";
        document.getElementById("modal-new-publisher").value = "";
        document.getElementById("modal-new-discount").value = 20;
        document.getElementById("modal-new-rating").value = 5.0;
        document.getElementById("modal-new-reviews").value = 12;

        // Reset filter để thấy sách mới
        state.keyword = "";
        state.cluster = "ALL";
        state.sort = "newest";
        state.page = 1;
        document.getElementById("search-input").value = "";
        document.getElementById("filter-cluster").value = "ALL";
        document.getElementById("sort-select").value = "newest";

        renderTable();
        updateKPIs();
        selectRow(newSku);
      } catch (err) {
        console.error("[CRUD] Thêm sách thất bại:", err);
        // Hiện lỗi cho user biết
        alert(err.message);
        BooksUI.toast(err.message.split("\n")[0], "error");
      } finally {
        setBusy(btn, false);
      }
    });

    // Cập nhật trạng thái sync ở header dựa trên API thật
    const dbStatusDot = document.getElementById("db-status-dot");
    const kpiSyncStatus = document.getElementById("kpi-sync-status");
    const dbSourceLabel = document.getElementById("db-source-label");

    window.booksReadyPromise.then((ok) => {
      if (ok) {
        if (dbStatusDot) { dbStatusDot.classList.remove("bg-error"); dbStatusDot.classList.add("bg-secondary"); }
        if (kpiSyncStatus) { kpiSyncStatus.textContent = "MongoDB 100% OK"; kpiSyncStatus.className = "text-secondary"; }
        if (dbSourceLabel) dbSourceLabel.textContent = "DATABASE: MONGODB ATLAS";
        BooksUI.toast("Đã kết nối MongoDB Atlas", "success");
      } else {
        if (dbStatusDot) { dbStatusDot.classList.remove("bg-secondary"); dbStatusDot.classList.add("bg-error"); }
        if (kpiSyncStatus) { kpiSyncStatus.textContent = "API offline — dùng cache"; kpiSyncStatus.className = "text-error"; }
        if (dbSourceLabel) dbSourceLabel.textContent = "DATABASE: CACHE (offline)";
        BooksUI.toast("Không kết nối API — dữ liệu chỉ ở cache", "error");
      }
      updateKPIs();
      renderTable();
    });

    console.log("[CRUD] ✅ Ready. Books loaded:", Store.all().length);
  });
})();