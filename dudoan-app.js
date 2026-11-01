/* dudoan-app.js — Unsupervised Learning: K-Means + Isolation Forest */
(function () {
  "use strict";

  const API = "http://localhost:5000";

  // ═══════════════════════════════════════════════════════════
  // CLUSTER META — diễn giải hành vi 4 cụm
  // ═══════════════════════════════════════════════════════════
  const CLUSTER_META = {
    0: {
      name:    "Best Seller Giá Rẻ",
      segment: "Người mua nhạy cảm giá",
      insight: "Ưu tiên sách rẻ, đọc nhiều review để giảm rủi ro. Mua khi có Flash Sale hoặc giảm sâu.",
      tactic:  "Flash Sale, bundle giá thấp, sách 49k–99k, miễn phí ship.",
    },
    1: {
      name:    "Phổ Thông / Nguyên Giá",
      segment: "Người mua trung thành / Nguyên giá",
      insight: "Chấp nhận trả giá gốc, quan tâm NXB / tác giả / thương hiệu. Ít so giá, mua theo thói quen.",
      tactic:  "Loyalty program, pre-order, tác giả best-seller, NXB uy tín.",
    },
    2: {
      name:    "Khuyến Mãi / Deal",
      segment: "Người mua săn khuyến mãi",
      insight: "Chờ deal 25–45% rồi mới mua, giá trị đơn trung bình. So sánh giá kỹ giữa các sàn.",
      tactic:  "Coupon định kỳ, deal giờ vàng, gamification (điểm thưởng).",
    },
    3: {
      name:    "Combo / Cao Cấp",
      segment: "Người mua cao cấp / Impulse",
      insight: "Mua boxset, sách chuyên ngành, sách nghệ thuật giá cao. Quan tâm chất lượng hơn giá.",
      tactic:  "Bản giới hạn, combo quà tặng, tư vấn 1-1, ưu đãi VIP.",
    },
  };

  // ═══════════════════════════════════════════════════════════
  // DOM CACHE
  // ═══════════════════════════════════════════════════════════
  const $ = (id) => document.getElementById(id);

  let els = null;
  function cacheEls() {
    els = {
      // Inputs
      price:         $("input-price"),
      discount:      $("input-discount"),
      reviews:       $("input-reviews"),
      rating:        $("input-rating"),
      discountLabel: $("discount-val-label"),
      ratingLabel:   $("rating-val-label"),
      quickPrices:   document.querySelectorAll(".quick-price"),
      btnAnalyze:    $("btn-analyze"),
      btnReset:      $("reset-form-btn"),

      // K-Means panel
      kmeansBadge:        $("kmeans-status-badge"),
      resultClusterId:    $("result-cluster-id"),
      resultSegmentName:  $("result-segment-name"),
      resultSegmentInsight: $("result-segment-insight"),
      resultClusterSource:  $("result-cluster-source"),
      resultTactic:         $("result-tactic"),

      // Isolation Forest panel
      isoBadge:      $("iso-status-badge"),
      isoVerdict:    $("iso-verdict"),
      isoVerdictIcon:$("iso-verdict-icon"),
      isoScore:      $("iso-score"),
      isoReason:     $("iso-reason"),
      isoReasonBox:  $("iso-reason-box"),
      isoRprBadge:   $("iso-rpr-badge"),

      // Performance / feature importance
      perfNTrain:    $("perf-n-train"),
      fiReviewPct:   $("fi-reviews-pct"),
      fiReviewBar:   $("fi-reviews-bar"),
      fiDiscountPct: $("fi-discount-pct"),
      fiDiscountBar: $("fi-discount-bar"),
      fiPricePct:    $("fi-price-pct"),
      fiPriceBar:    $("fi-price-bar"),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // BADGE STYLE HELPERS
  // ═══════════════════════════════════════════════════════════
  const BADGE_BASE = "font-label-sm text-label-sm uppercase tracking-wider px-2.5 py-1 rounded font-bold flex items-center gap-1";
  const BADGE = {
    pending: `${BADGE_BASE} bg-surface-container-high text-on-surface`,
    ok:      `${BADGE_BASE} bg-secondary-container text-on-secondary-container`,
    warn:    `${BADGE_BASE} bg-tertiary-fixed text-on-tertiary-fixed-variant`,
    error:   `${BADGE_BASE} bg-error-container text-on-error-container`,
    idle:    `${BADGE_BASE} bg-surface-container-high text-on-surface`,
  };

  function setBadge(el, kind, label, dotColor = "bg-outline") {
    if (!el) return;
    el.className = BADGE[kind] || BADGE.idle;
    el.innerHTML = `<span class="w-2 h-2 rounded-full ${dotColor}"></span> ${label}`;
  }

  // ═══════════════════════════════════════════════════════════
  // FEATURE IMPORTANCE (Pearson |corr| — từ BooksStore)
  // ═══════════════════════════════════════════════════════════
  function computeFeatureImportance() {
    if (!window.BooksStore) return { reviews: 33.3, discount: 33.3, price: 33.4 };
    const arr = BooksStore.all().filter(b => (b.rating || 0) > 0);
    if (arr.length < 5) return { reviews: 52, discount: 33, price: 15 };

    const cR = Math.abs(BooksStore.correlation("review_count")) || 0;
    const cD = Math.abs(BooksStore.correlation("discount_rate")) || 0;
    const cP = Math.abs(BooksStore.correlation("price"))        || 0;
    const total = cR + cD + cP;
    if (total === 0) return { reviews: 33.3, discount: 33.3, price: 33.4 };

    return {
      reviews:  (cR / total) * 100,
      discount: (cD / total) * 100,
      price:    (cP / total) * 100,
    };
  }

  function updateFeatureBars() {
    const fi = computeFeatureImportance();
    const set = (pctEl, barEl, val) => {
      if (pctEl) pctEl.textContent = val.toFixed(1) + "%";
      if (barEl) barEl.style.width = val.toFixed(1) + "%";
    };
    set(els.fiReviewPct,   els.fiReviewBar,   fi.reviews);
    set(els.fiDiscountPct, els.fiDiscountBar, fi.discount);
    set(els.fiPricePct,    els.fiPriceBar,    fi.price);
  }

  // ═══════════════════════════════════════════════════════════
  // ANALYZE — Gọi 2 API
  // ═══════════════════════════════════════════════════════════
  async function analyze() {
    const p      = parseFloat(els.price.value)    || 150000;
    const d      = parseFloat(els.discount.value) || 0;
    const r      = parseFloat(els.reviews.value)  || 0;
    const rating = parseFloat(els.rating.value)   || 0;

    // ── Disable button ──
    const originalBtnHtml = els.btnAnalyze.innerHTML;
    els.btnAnalyze.disabled = true;
    els.btnAnalyze.innerHTML = `
      <span class="material-symbols-outlined text-[26px] animate-spin">progress_activity</span>
      <span>ĐANG PHÂN TÍCH…</span>`;

    setBadge(els.kmeansBadge, "pending", "Đang chờ", "bg-outline");
    setBadge(els.isoBadge,    "pending", "Đang chờ", "bg-outline");

    // ── 1) K-MEANS ──────────────────────────────────────
    let clusterId     = null;
    let clusterSource = "Heuristic";

    try {
      const res = await fetch(`${API}/api/predict-cluster`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: p, discount_rate: d, review_count: r }),
      });
      const data = await res.json();
      if (data && data.ok) {
        clusterId     = data.cluster;
        clusterSource = "K-Means Model";
      }
    } catch (err) {
      console.warn("[Dudoan] K-Means API failed:", err.message);
    }

    // Fallback heuristic nếu API lỗi
    if (clusterId === null && window.BooksStore) {
      clusterId = BooksStore.clusterOf({ price: p, discount_rate: d, review_count: r });
      clusterSource = "Heuristic (API offline)";
    }
    if (clusterId === null) clusterId = 1;

    const cm = CLUSTER_META[clusterId] || {
      name: `Cụm ${clusterId}`,
      segment: "—",
      insight: "Không có diễn giải cho cụm này.",
      tactic:  "—",
    };

    els.resultClusterId.textContent       = clusterId;
    els.resultSegmentName.textContent     = cm.segment;
    els.resultSegmentInsight.textContent  = cm.insight;
    els.resultTactic.textContent          = cm.tactic;
    els.resultClusterSource.textContent   = `Cụm ${clusterId}: ${cm.name}  •  Nguồn: ${clusterSource}`;
    setBadge(els.kmeansBadge, "ok", "Hoàn tất", "bg-secondary");

    // ── 2) ISOLATION FOREST ──────────────────────────────
    let isoData = null;

    try {
      const res = await fetch(`${API}/api/predict-anomaly`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price: p, discount_rate: d, review_count: r, rating: rating,
        }),
      });
      isoData = await res.json();
    } catch (err) {
      console.warn("[Dudoan] IF API failed:", err.message);
    }

    // rpr luôn cập nhật (hiển thị ngay cả khi IF fail)
    const rpr = (rating > 0) ? (r / (rating + 0.01)) : 0;
    if (els.isoRprBadge) els.isoRprBadge.textContent = `rpr = ${rpr.toFixed(1)}`;

    if (isoData && isoData.ok) {
      const isAnomaly = !!isoData.is_anomaly;
      els.isoVerdict.textContent = isoData.verdict;
      els.isoScore.textContent   = Number(isoData.anomaly_score).toFixed(4);
      els.isoReason.textContent  = isoData.reason || "—";

      if (isAnomaly) {
        els.isoVerdict.className    = "font-headline-md text-headline-md font-bold text-error";
        els.isoVerdictIcon.textContent = "warning";
        els.isoVerdictIcon.className   = "material-symbols-outlined text-[20px] text-error";
        els.isoReasonBox.className = "rounded-lg p-space-sm flex items-start gap-space-sm bg-error-container";
        els.isoReason.className    = "font-body-sm text-body-sm text-on-error-container mt-0.5";
        setBadge(els.isoBadge, "error", "Bất thường", "bg-error");
      } else {
        els.isoVerdict.className    = "font-headline-md text-headline-md font-bold text-secondary";
        els.isoVerdictIcon.textContent = "check_circle";
        els.isoVerdictIcon.className   = "material-symbols-outlined text-[20px] text-secondary";
        els.isoReasonBox.className = "rounded-lg p-space-sm flex items-start gap-space-sm bg-secondary-container";
        els.isoReason.className    = "font-body-sm text-body-sm text-on-secondary-container mt-0.5";
        setBadge(els.isoBadge, "ok", "Bình thường", "bg-secondary");
      }
    } else {
      // IF offline / 503
      els.isoVerdict.textContent = "Không khả dụng";
      els.isoScore.textContent   = "—";
      els.isoReason.textContent  = "Không gọi được Isolation Forest. Đảm bảo backend đã chạy và đã train model (train_isolation_forest.py).";
      els.isoVerdict.className   = "font-headline-md text-headline-md font-bold text-on-surface-variant";
      els.isoVerdictIcon.textContent = "help";
      els.isoVerdictIcon.className   = "material-symbols-outlined text-[20px] text-outline";
      els.isoReasonBox.className = "rounded-lg p-space-sm flex items-start gap-space-sm bg-surface-container-high";
      els.isoReason.className    = "font-body-sm text-body-sm text-on-surface-variant mt-0.5";
      setBadge(els.isoBadge, "warn", "API offline", "bg-tertiary");
    }

    // ── Restore button ───────────────────────────────────
    els.btnAnalyze.disabled = false;
    els.btnAnalyze.innerHTML = originalBtnHtml;
  }

  // ═══════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════
  function bindEvents() {
    // Discount slider
    els.discount.addEventListener("input", (e) => {
      els.discountLabel.textContent = `${e.target.value}%`;
    });

    // Rating slider
    els.rating.addEventListener("input", (e) => {
      els.ratingLabel.textContent = parseFloat(e.target.value).toFixed(1);
    });

    // Quick price buttons
    els.quickPrices.forEach((btn) => {
      btn.addEventListener("click", () => {
        els.quickPrices.forEach((b) => {
          b.className = "quick-price px-2.5 py-1 rounded bg-surface-container-low hover:bg-surface-container text-on-surface font-label-sm text-label-sm transition-colors";
        });
        btn.className = "quick-price px-2.5 py-1 rounded bg-primary-container text-on-primary font-label-sm text-label-sm transition-colors";
        els.price.value = btn.getAttribute("data-val");
      });
    });

    // Analyze
    els.btnAnalyze.addEventListener("click", () => {
      els.btnAnalyze.classList.add("scale-95");
      setTimeout(() => {
        els.btnAnalyze.classList.remove("scale-95");
        analyze();
      }, 120);
    });

    // Reset
    els.btnReset.addEventListener("click", () => {
      els.price.value    = 150000;
      els.discount.value = 20;
      els.discountLabel.textContent = "20%";
      els.reviews.value  = 120;
      els.rating.value   = 4.5;
      els.ratingLabel.textContent = "4.5";
      analyze();
    });
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  document.addEventListener("DOMContentLoaded", () => {
    // Đồng bộ nav
    document.querySelectorAll('header nav a').forEach((link) => {
      const active = link.getAttribute("href") === "dudoan.html"
                  || (link.href && link.href.includes("dudoan.html"));
      if (active) {
        link.classList.remove("text-on-surface-variant");
        link.classList.add("text-error", "border-b-2", "border-error");
      }
    });

    cacheEls();
    if (!els.price) {
      console.error("[Dudoan] Không tìm thấy input — HTML chưa đúng version?");
      return;
    }

    bindEvents();

    const ready = window.booksReadyPromise || Promise.resolve(false);
    ready.then((ok) => {
      if (!ok && window.BooksUI) {
        BooksUI.toast("API không phản hồi — đang dùng cache cho feature importance", "info");
      }

      // Cập nhật N_train (nếu có)
      if (els.perfNTrain && window.BooksStore) {
        els.perfNTrain.textContent = new Intl.NumberFormat("vi-VN").format(BooksStore.all().length);
      }

      updateFeatureBars();

      // Chạy lần đầu để trang không trống
      analyze();

      console.log(`[Dudoan] ✅ Ready. Books: ${window.BooksStore ? BooksStore.all().length : "?"}. API: ${API}`);
    });
  });
})();