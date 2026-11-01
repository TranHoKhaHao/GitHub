"""
train_isolation_forest.py
─────────────────────────
Train Isolation Forest từ dữ liệu sách Tiki đã làm sạch.
Xuất:
  - isolation_forest.pkl   (model)
  - iso_scaler.pkl         (StandardScaler)
  - isolation_forest_report.json  (metadata cho báo cáo)

Chạy: python train_isolation_forest.py
"""
import json
import os
import pandas as pd
import numpy as np
import joblib

from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

# ═══════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════
CSV_PATH   = "tiki_books_clean_perfect.csv"
ISO_PATH   = "isolation_forest.pkl"
SCALER_PATH = "iso_scaler.pkl"
REPORT_PATH = "isolation_forest_report.json"

CONTAMINATION = 0.05   # ~5% coi là bất thường
N_ESTIMATORS  = 150
RANDOM_STATE  = 42

# Features dùng để train (KHÔNG đổi thứ tự khi predict)
FEATURES = [
    "price",
    "discount_rate",
    "review_count",
    "rating",
    "review_per_rating",
]


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Chuẩn hoá + tạo behavioral features."""
    df = df.copy()
    for c in ["price", "discount_rate", "review_count", "rating"]:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)

    # Behavioral feature: review trên mỗi 0.1 sao → mức độ "hot" thực sự
    df["review_per_rating"] = df["review_count"] / (df["rating"] + 0.01)
    return df


def explain_anomaly(price, discount, reviews, rating) -> str:
    """Sinh diễn giải ngắn gọn cho 1 SP bất thường (khớp logic api.py)."""
    reasons = []
    if discount > 45:
        reasons.append(f"giảm giá quá sâu ({discount:.0f}%)")
    if discount < 5 and reviews > 2000:
        reasons.append("review cao dù không khuyến mãi")
    if price > 500000 and reviews > 5000:
        reasons.append("sách đắt nhưng vẫn cực hot")
    if rating < 3.5 and reviews > 1000:
        reasons.append("rating thấp nhưng review cao (nghi vấn seeding)")
    if price < 20000 and reviews > 10000:
        reasons.append("giá siêu rẻ kèm review khủng")
    if not reasons:
        reasons.append("tổ hợp chỉ số lệch khỏi mẫu chung")
    return "; ".join(reasons)


def main():
    if not os.path.exists(CSV_PATH):
        print(f"❌ Không tìm thấy {CSV_PATH}")
        return

    df = pd.read_csv(CSV_PATH, encoding="utf-8-sig")
    print(f"📂 Loaded {len(df)} dòng từ {CSV_PATH}")

    df = build_features(df)

    # Bỏ các dòng chưa có rating (SP mới, tránh nhiễu)
    before = len(df)
    df = df[df["rating"] > 0].reset_index(drop=True)
    print(f"🧹 Bỏ {before - len(df)} dòng rating = 0 → còn {len(df)} dòng để train")

    if len(df) < 30:
        print("❌ Quá ít dữ liệu để train Isolation Forest.")
        return

    X = df[FEATURES].values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    print(f"🎯 Training Isolation Forest (n_estimators={N_ESTIMATORS}, "
          f"contamination={CONTAMINATION}) …")
    iso = IsolationForest(
        n_estimators=N_ESTIMATORS,
        contamination=CONTAMINATION,
        max_samples="auto",
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )
    iso.fit(X_scaled)

    # ── Đánh giá nhanh ──
    scores = iso.decision_function(X_scaled)   # càng âm càng bất thường
    preds  = iso.predict(X_scaled)             # -1 = anomaly, 1 = normal
    n_ano  = int((preds == -1).sum())

    df["anomaly_score"] = scores
    df["is_anomaly"]    = (preds == -1)

    print("\n══════════════ KẾT QUẢ TRAIN ══════════════")
    print(f"📊 Tổng SKU hợp lệ       : {len(df)}")
    print(f"🚨 SKU bất thường        : {n_ano} ({n_ano/len(df)*100:.2f}%)")
    print(f"📉 Score min / max       : {scores.min():.4f} / {scores.max():.4f}")
    print(f"📊 Score mean / median   : {scores.mean():.4f} / {np.median(scores):.4f}")

    # Phân bố score theo decile — hữu ích đưa vào báo cáo
    deciles = np.percentile(scores, np.arange(0, 101, 10)).round(4).tolist()
    print(f"📈 Deciles score (0→100) : {deciles}")

    # Top 10 anomaly (score âm nhất)
    top = df.nsmallest(10, "anomaly_score")[
        ["title", "price", "discount_rate", "review_count", "rating", "anomaly_score"]
    ]
    print("\n🔝 Top 10 SKU bất thường (score âm nhất):")
    for _, r in top.iterrows():
        reason = explain_anomaly(
            r["price"], r["discount_rate"], r["review_count"], r["rating"]
        )
        title = (r["title"] or "")[:55]
        print(f"  [{r['anomaly_score']:+.3f}] {title}")
        print(f"          price={r['price']:.0f}, sale={r['discount_rate']:.0f}%, "
              f"rv={r['review_count']:.0f}, ★{r['rating']:.1f}")
        print(f"          → {reason}")

    # ── Lưu model ──
    joblib.dump(iso, ISO_PATH)
    joblib.dump(scaler, SCALER_PATH)
    print(f"\n✅ Đã lưu {ISO_PATH}")
    print(f"✅ Đã lưu {SCALER_PATH}")

    # ── Lưu report (dùng cho /api/model-info & báo cáo) ──
    cluster_counts = df.get("cluster", pd.Series(dtype=int)).value_counts().to_dict()
    report = {
        "model_type": "IsolationForest",
        "sklearn_version": __import__("sklearn").__version__,
        "n_estimators": N_ESTIMATORS,
        "contamination": CONTAMINATION,
        "random_state": RANDOM_STATE,
        "features": FEATURES,
        "n_train": int(len(df)),
        "n_anomalies": n_ano,
        "contamination_actual_pct": round(n_ano / len(df) * 100, 2),
        "score_min": float(scores.min()),
        "score_max": float(scores.max()),
        "score_mean": float(scores.mean()),
        "score_median": float(np.median(scores)),
        "score_deciles": deciles,
        "cluster_distribution": {int(k): int(v) for k, v in cluster_counts.items()},
        "top_anomalies": [
            {
                "sku": str(r.get("sku", "")),
                "title": r["title"],
                "price": float(r["price"]),
                "discount_rate": float(r["discount_rate"]),
                "review_count": float(r["review_count"]),
                "rating": float(r["rating"]),
                "anomaly_score": float(r["anomaly_score"]),
                "reason": explain_anomaly(
                    r["price"], r["discount_rate"], r["review_count"], r["rating"]
                ),
            }
            for _, r in top.iterrows()
        ],
    }
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"✅ Đã lưu {REPORT_PATH}")

    print("\n🎉 HOÀN TẤT! Copy 2 file .pkl vào thư mục chứa api.py rồi chạy `python api.py`.")


if __name__ == "__main__":
    main()