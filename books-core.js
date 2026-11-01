
(function () {
  const API = "http://localhost:5000";
  const fmtVND  = n => new Intl.NumberFormat("vi-VN").format(Math.round(n||0)) + "₫";
  const fmtNum  = n => new Intl.NumberFormat("vi-VN").format(n||0);
  const fmtDate = d => new Date(d).toLocaleString("vi-VN");
  const catShort = c => (c||"Sách").split(" > ").pop().slice(0,45);
  const debounce = (fn, ms=300) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
  const escapeHtml = s => { const d = document.createElement("div"); d.textContent = s||""; return d.innerHTML; };

  const CLUSTER_META = {
    0: {
      label: "Cụm 0: Best Seller Giá Rẻ",
      short: "Best Seller",
      desc:  "Sách bán chạy, giá rẻ (< 150k), khuyến mãi mạnh, review rất nhiều",
      chip:  "bg-secondary-container text-on-secondary-container",
      dot:   "bg-secondary",
      color: "#006c49",
    },
    1: {
      label: "Cụm 1: Phổ Thông / Nguyên Giá",
      short: "Phổ Thông",
      desc:  "Sách đại trà, giá cao (> 200k), ít khuyến mãi, review thấp",
      chip:  "bg-surface-container text-on-surface-variant",
      dot:   "bg-outline",
      color: "#717785",
    },
    2: {
      label: "Cụm 2: Khuyến Mãi / Deal",
      short: "Khuyến Mãi",
      desc:  "Sách có giảm giá mạnh (25-45%), giá trung bình, review vừa phải",
      chip:  "bg-primary-fixed text-on-primary-fixed-variant",
      dot:   "bg-primary-container",
      color: "#005cb9",
    },
    3: {
      label: "Cụm 3: Combo / Cao Cấp",
      short: "Cao Cấp",
      desc:  "Sách combo, boxset siêu đắt (> 1 triệu), ít khuyến mãi",
      chip:  "bg-tertiary-fixed text-on-tertiary-fixed-variant",
      dot:   "bg-tertiary",
      color: "#845300",
    },
  };

  const LS_KEY = "tiki_books_cache_v2";

  async function apiGet(path) {
    const r = await fetch(`${API}${path}`);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return r.json();
  }
  async function apiSend(method, path, body) {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${data.error||""}`);
    return data;
  }

  // ═══════════════════════════════════════════════════════════
  // Predict cluster qua KMeans API — nguồn sự thật DUY NHẤT
  // ═══════════════════════════════════════════════════════════
  async function predictClusterViaAPI(price, discount, reviews) {
    try {
      const res = await fetch(`${API}/api/predict-cluster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price,
          discount_rate: discount,
          review_count: reviews,
        }),
      });
      const data = await res.json();
      if (data && data.ok && typeof data.cluster === "number") {
        return data.cluster;
      }
      console.warn("[BooksCore] predict-cluster trả về không hợp lệ:", data);
      return null;
    } catch (e) {
      console.warn("[BooksCore] Không gọi được predict-cluster:", e.message);
      return null;
    }
  }

  const Store = {
    _books: [],
    _ready: false,

    async init() {
      try {
        const data = await apiGet("/api/books");
        this._books = Array.isArray(data) ? data : [];
        this._ready = true;
        this._saveCache();
        return true;
      } catch (e) {
        console.warn("[BooksCore] API không phản hồi, dùng cache/fallback:", e.message);
        try {
          const saved = localStorage.getItem(LS_KEY);
          if (saved) this._books = JSON.parse(saved);
          else this._books = JSON.parse(JSON.stringify(window.TIKI_BOOKS_DATA || []));
        } catch(_) {}
        this._ready = true;
        return false;
      }
    },

    _saveCache() {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this._books)); } catch(e){}
    },

    all() { return this._books; },
    isReady() { return this._ready; },

    /* ── READS ── */
    filtered(opts = {}) {
      let L = this._books.slice();
      const { keyword="", cluster="ALL", clusters=null, categoryPath="",
              priceMin=0, priceMax=Infinity, discountMin=0, minRating=0 } = opts;
      if (keyword) {
        const k = keyword.toLowerCase().trim();
        L = L.filter(b =>
          (b.title||"").toLowerCase().includes(k) ||
          (b.author||"").toLowerCase().includes(k) ||
          (b.sku||"").toLowerCase().includes(k) ||
          (b.category||"").toLowerCase().includes(k));
      }
      if (clusters && Array.isArray(clusters) && clusters.length) L = L.filter(b => clusters.includes(b.cluster));
      else if (cluster !== "ALL") L = L.filter(b => b.cluster === parseInt(cluster));
      if (categoryPath) L = L.filter(b => (b.category||"").includes(categoryPath));
      if (priceMin) L = L.filter(b => b.price >= priceMin);
      if (priceMax !== Infinity) L = L.filter(b => b.price <= priceMax);
      if (discountMin) L = L.filter(b => b.discount_rate >= discountMin);
      if (minRating) L = L.filter(b => b.rating >= minRating);
      return L;
    },

    sorted(L, field="title", dir="asc") {
      const arr = L.slice();
      arr.sort((a,b) => {
        const va=a[field], vb=b[field];
        if (typeof va==="number" && typeof vb==="number") return dir==="asc" ? va-vb : vb-va;
        return dir==="asc" ? String(va).localeCompare(String(vb),"vi") : String(vb).localeCompare(String(va),"vi");
      });
      return arr;
    },

    page(L, p=1, size=20) {
      const start = (p-1)*size;
      return { rows: L.slice(start, start+size), total:L.length, pages: Math.ceil(L.length/size)||1 };
    },

    find(sku) { return this._books.find(b => b.sku === sku); },

    /* ── WRITES ── */
    async update(sku, patch) {
      try {
        await apiSend("PUT", `/api/books/${encodeURIComponent(sku)}`, patch);
        const i = this._books.findIndex(b => b.sku === sku);
        if (i >= 0) Object.assign(this._books[i], patch);
        this._saveCache();
        return true;
      } catch (e) { console.error("[BooksCore.update]", e); return false; }
    },

    /**
     * Thêm sách mới. Cluster BẮT BUỘC lấy từ /api/predict-cluster.
     * Nếu API không phản hồi → trả null (không lưu rác).
     */
    async add(book) {
      const sku = book.sku || this._nextSku();
      const price    = Number(book.price) || 0;
      const discount = Number(book.discount_rate) || 0;
      const reviews  = Number(book.review_count) || 0;

      // 1) Predict cluster qua KMeans API
      const cluster = await predictClusterViaAPI(price, discount, reviews);
      if (cluster === null) {
        console.error("[BooksCore.add] Không predict được cluster — hủy add. " +
                      "Kiểm tra backend đang chạy và đã load kmeans_model.pkl.");
        return null;
      }

      // 2) Chuẩn bị row (KHÔNG còn heuristic gán cluster)
      const row = {
        sku,
        title:           book.title    || "Chưa đặt tên",
        category:        book.category || "Sách",
        author:          book.author   || "Đang cập nhật",
        price,
        original_price:  Number(book.original_price) || price,
        discount_rate:   discount,
        rating:          Number(book.rating)         || 0,
        review_count:    reviews,
        price_range:     book.price_range || "",
        title_length:    (book.title || "").length,
        is_high_rating:  (Number(book.rating) >= 4.8) ? 1 : 0,
        cover_link:      book.cover_link || "",
        cluster,
      };

      // 3) Ghi lên API
      try {
        await apiSend("POST", "/api/books", row);
        this._books.unshift(row);
        this._saveCache();
        return sku;
      } catch (e) {
        console.error("[BooksCore.add]", e);
        return null;
      }
    },

    async duplicate(sku) {
      const src = this.find(sku);
      if (!src) return null;
      const newSku = this._nextSku();
      const copy = { ...src, sku: newSku, title: src.title + " (bản sao)" };
      delete copy._id;
      delete copy.cluster; // sẽ predict lại — an toàn khi data đã đổi
      return (await this.add(copy)) ? newSku : null;
    },

    async remove(sku) {
      try {
        await apiSend("DELETE", `/api/books/${encodeURIComponent(sku)}`);
        const i = this._books.findIndex(b => b.sku === sku);
        if (i >= 0) this._books.splice(i, 1);
        this._saveCache();
        return true;
      } catch (e) { console.error("[BooksCore.remove]", e); return false; }
    },

    async removeMany(skus) {
      let ok = 0;
      for (const s of skus) if (await this.remove(s)) ok++;
      return ok;
    },

    _nextSku() {
      const nums = this._books.map(b => parseInt((b.sku||"0").replace(/\D/g,""), 10)).filter(n=>!isNaN(n));
      return `TK_${(nums.length ? Math.max(...nums) : 1000) + 1}`;
    },

    async resetAll() {
      localStorage.removeItem(LS_KEY);
      return await this.init();
    },

    stats(L = null) {
      const arr = L || this._books, n = arr.length || 1;
      const sum = k => arr.reduce((s,b)=>s+(b[k]||0),0);
      return {
        total: arr.length,
        avgPrice: sum("price")/n,
        avgDiscount: sum("discount_rate")/n,
        avgRating: sum("rating")/n,
        avgReviews: sum("review_count")/n,
        clusterCounts: [0,1,2,3].map(c => arr.filter(b=>b.cluster===c).length),
      };
    },

    clusterStats() {
      const result = {};
      [0,1,2,3].forEach(c => {
        const arr = this._books.filter(b => b.cluster === c);
        const n = arr.length || 1;
        result[c] = {
          count:       arr.length,
          avgPrice:    arr.reduce((s,b)=>s+(b.price||0),0) / n,
          avgDiscount: arr.reduce((s,b)=>s+(b.discount_rate||0),0) / n,
          avgReviews:  arr.reduce((s,b)=>s+(b.review_count||0),0) / n,
          avgRating:   arr.reduce((s,b)=>s+(b.rating||0),0) / n,
        };
      });
      return result;
    },

    correlation(field) {
      const arr = this._books.filter(b => b.rating>0 && b[field]!==undefined);
      if (arr.length<5) return 0;
      const n = arr.length;
      const mx = arr.reduce((s,b)=>s+b[field],0)/n;
      const my = arr.reduce((s,b)=>s+b.rating,0)/n;
      let num=0, dx=0, dy=0;
      arr.forEach(b => { const x=b[field]-mx, y=b.rating-my; num+=x*y; dx+=x*x; dy+=y*y; });
      return (dx===0||dy===0) ? 0 : num/Math.sqrt(dx*dy);
    },

    // predict() đã xoá — dùng /api/predict-cluster trực tiếp nếu cần.
  };

  const Export = {
    _dl(filename, content, mime) {
      const blob = new Blob([content], { type: mime||"text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    },
    csv(L, filename="tiki_books_export.csv") {
      if (!L || !L.length) return false;
      const cols = ["sku","title","category","author","price","original_price","discount_rate","rating","review_count","cluster"];
      const esc = v => `"${String(v ?? "").replace(/"/g,'""')}"`;
      const csv = "\uFEFF" + cols.join(",") + "\n" + L.map(b => cols.map(c=>esc(b[c])).join(",")).join("\n");
      this._dl(filename, csv, "text/csv;charset=utf-8"); return true;
    },
    json(L, filename="tiki_books_export.json") {
      if (!L || !L.length) return false;
      this._dl(filename, JSON.stringify(L, null, 2), "application/json;charset=utf-8"); return true;
    },
    txt(content, filename="report.txt") { this._dl(filename, content, "text/plain;charset=utf-8"); },
    log(content, filename="audit.log") { this._dl(filename, content, "text/plain;charset=utf-8"); },
  };

  const UI = {
    _modal: null,
    _ensureModal() {
      if (this._modal) return this._modal;
      const el = document.createElement("div");
      el.id = "books-global-modal";
      el.className = "fixed inset-0 z-[999] hidden items-center justify-center bg-inverse-surface/50 backdrop-blur-sm";
      el.innerHTML = `
        <div class="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-2xl m-4 p-space-xl flex flex-col gap-space-md max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between pb-space-sm border-b border-surface-container">
            <h3 class="font-headline-md text-headline-md text-on-surface" id="bgm-title">Chi tiết sách</h3>
            <button class="p-1 rounded-full hover:bg-surface-container" onclick="BooksUI.closeModal()"><span class="material-symbols-outlined">close</span></button>
          </div>
          <div id="bgm-body" class="flex flex-col gap-space-sm"></div>
        </div>`;
      el.addEventListener("click", e => { if (e.target === el) this.closeModal(); });
      document.body.appendChild(el);
      this._modal = el;
      return el;
    },
    openModal(book) {
      if (!book) return;
      const el = this._ensureModal();
      const cm = CLUSTER_META[book.cluster] || { label: "Chưa phân cụm", desc: "—", short: "N/A" };
      document.getElementById("bgm-title").textContent = book.title;
      const imgHtml = book.cover_link
        ? `<img src="${book.cover_link}" class="w-24 h-32 object-cover rounded shadow-sm shrink-0" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"/><div class="w-24 h-32 hidden items-center justify-center bg-surface-container rounded shadow-sm shrink-0"><span class="material-symbols-outlined text-outline text-[40px]">menu_book</span></div>`
        : `<div class="w-24 h-32 flex items-center justify-center bg-surface-container rounded shadow-sm shrink-0"><span class="material-symbols-outlined text-outline text-[40px]">menu_book</span></div>`;
      document.getElementById("bgm-body").innerHTML = `
        <div class="flex gap-space-md">
          ${imgHtml}
          <div class="grid grid-cols-2 gap-space-sm text-body-sm flex-1">
            <div><span class="text-on-surface-variant">SKU:</span> <b>${book.sku}</b></div>
            <div><span class="text-on-surface-variant">Cụm:</span> <b>${cm.label}</b></div>
            <div><span class="text-on-surface-variant">Tác giả:</span> <b>${escapeHtml(book.author||"—")}</b></div>
            <div><span class="text-on-surface-variant">Giá bán:</span> <b class="text-primary">${fmtVND(book.price)}</b></div>
            <div><span class="text-on-surface-variant">Giá gốc:</span> <b>${fmtVND(book.original_price)}</b></div>
            <div><span class="text-on-surface-variant">Giảm giá:</span> <b class="text-error">${book.discount_rate}%</b></div>
            <div><span class="text-on-surface-variant">Rating:</span> <b class="text-tertiary">★ ${(book.rating||0).toFixed(1)}</b></div>
            <div><span class="text-on-surface-variant">Reviews:</span> <b>${fmtNum(book.review_count)}</b></div>
          </div>
        </div>
        <div class="mt-space-sm">
          <div class="text-on-surface-variant text-label-sm uppercase mb-1">Danh mục</div>
          <div class="bg-surface-container-low p-space-sm rounded text-body-sm">${escapeHtml(book.category||"—")}</div>
        </div>
        <div class="mt-space-sm">
          <div class="text-on-surface-variant text-label-sm uppercase mb-1">Diễn giải cụm</div>
          <div class="bg-surface-container-low p-space-sm rounded text-body-sm">${cm.desc}</div>
        </div>
        <div class="flex gap-space-sm mt-space-sm">
          <button class="flex-1 py-2 bg-primary-container text-on-primary rounded font-headline-sm" onclick="BooksExport.json([BooksStore.find('${book.sku}')], '${book.sku}.json'); BooksUI.closeModal();">Xuất JSON sách này</button>
          <button class="flex-1 py-2 bg-surface-container rounded font-headline-sm" onclick="BooksUI.closeModal()">Đóng</button>
        </div>`;
      el.classList.remove("hidden"); el.classList.add("flex");
    },
    closeModal() { if (!this._modal) return; this._modal.classList.add("hidden"); this._modal.classList.remove("flex"); },
    toast(message, type="success") {
      let t = document.getElementById("books-global-toast");
      if (!t) { t = document.createElement("div"); t.id="books-global-toast"; document.body.appendChild(t); }
      const icons = { success:"check_circle", error:"error", info:"info" };
      const bgs = { success:"bg-secondary", error:"bg-error", info:"bg-primary-container" };
      t.className = `fixed bottom-6 right-6 z-[1000] flex items-center gap-2 px-4 py-3 rounded-lg shadow-xl text-on-primary font-body-md transition-all transform ${bgs[type]||bgs.success}`;
      t.style.opacity = "1"; t.style.transform = "translateY(0)";
      t.innerHTML = `<span class="material-symbols-outlined">${icons[type]||icons.success}</span><span>${message}</span>`;
      setTimeout(() => { t.style.opacity="0"; t.style.transform="translateY(20px)"; }, 2600);
    },
    resetCache() {
      if (!confirm("Xoá cache local và load lại từ MongoDB?")) return;
      localStorage.removeItem(LS_KEY);
      location.reload();
    },
  };

  window.BooksStore = Store;
  window.BooksExport = Export;
  window.BooksUI = UI;
  window.BooksUtils = { fmtVND, fmtNum, fmtDate, catShort, debounce, escapeHtml, CLUSTER_META };

  window.booksReadyPromise = Store.init().then(ok => {
    console.log(`[BooksCore] ${ok ? "✅" : "⚠️"} Loaded ${Store.all().length} books ${ok ? "from API" : "(fallback)"}`);
    return ok;
  });
})();