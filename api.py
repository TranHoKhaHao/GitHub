from flask import Flask, jsonify, request, Response, send_file
from flask_cors import CORS
from pymongo import MongoClient
from werkzeug.utils import secure_filename
import csv
import io
import json as _json
import datetime
import os
import hashlib

app = Flask(__name__)
CORS(app)
app.json.ensure_ascii = False

# ═══════════════════════════════════════════════════════════
# MONGODB
# ═══════════════════════════════════════════════════════════
MONGO_URI = os.getenv(
    "MONGO_URI",
    "mongodb+srv://24126030_db_user:cuong123@cluster0.zyrklbg.mongodb.net/"
)
client = MongoClient(MONGO_URI)
db = client["e-commerce"]
col = db["tiki_books"]

# ═══════════════════════════════════════════════════════════
# BACKUP CONFIG
# ═══════════════════════════════════════════════════════════
BACKUP_DIR = os.getenv("BACKUP_DIR", "backups")
os.makedirs(BACKUP_DIR, exist_ok=True)
backup_col = db["backup_history"]     # Lưu metadata backup + log restore


# ═══════════════════════════════════════════════════════════
# LOAD ML MODELS
# ═══════════════════════════════════════════════════════════
RATING_PATH   = "rating_model.pkl"      # Linear Regression (giữ lại làm phụ lục)
KMEANS_PATH   = "kmeans_model.pkl"
SCALER_PATH   = "scaler.pkl"
ISO_PATH      = "isolation_forest.pkl"
ISO_SCALER_PATH = "iso_scaler.pkl"

rating_model  = None
kmeans_model  = None
scaler_model  = None
iso_model     = None
iso_scaler    = None

# Thứ tự feature BẮT BUỘC khớp với lúc train
ISO_FEATURES = ["price", "discount_rate", "review_count", "rating", "review_per_rating"]

try:
    import joblib

    # 1. Linear Regression (phụ lục — R² âm, chỉ để tham khảo)
    if os.path.exists(RATING_PATH):
        rating_model = joblib.load(RATING_PATH)
        print(f"✅ Loaded rating model: {RATING_PATH}")
    else:
        print(f"⚠️  {RATING_PATH} not found — /api/predict-rating sẽ trả 503")

    # 2. K-Means + Scaler
    if os.path.exists(KMEANS_PATH) and os.path.exists(SCALER_PATH):
        kmeans_model = joblib.load(KMEANS_PATH)
        scaler_model = joblib.load(SCALER_PATH)
        print(f"✅ Loaded K-Means + Scaler")
    else:
        print(f"⚠️  K-Means chưa export — /api/predict-cluster sẽ trả 503")

    # 3. Isolation Forest + Scaler
    if os.path.exists(ISO_PATH) and os.path.exists(ISO_SCALER_PATH):
        iso_model  = joblib.load(ISO_PATH)
        iso_scaler = joblib.load(ISO_SCALER_PATH)
        print(f"✅ Loaded Isolation Forest + ISO Scaler")
    else:
        print(f"⚠️  Isolation Forest chưa export — /api/predict-anomaly & /api/anomalies trả 503")
        print(f"   → Chạy: python train_isolation_forest.py")

except Exception as e:
    print(f"⚠️  Cannot load model: {e}")

# ═══════════════════════════════════════════════════════════
# HELPERS — ANOMALY EXPLANATION
# ═══════════════════════════════════════════════════════════
def _explain_anomaly(price, discount, reviews, rating):
    """Diễn giải vì sao 1 SKU bị coi là bất thường (rule-based, dễ đọc)."""
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

def _build_iso_features(b):
    """Sinh vector 5 features từ document MongoDB (khớp lúc train)."""
    price    = float(b.get("price") or 0)
    discount = float(b.get("discount_rate") or 0)
    reviews  = float(b.get("review_count") or 0)
    rating   = float(b.get("rating") or 0)
    rpr      = reviews / (rating + 0.01)
    return [price, discount, reviews, rating, rpr]

# ═══════════════════════════════════════════════════════════
# HELPERS — DEDUPE  # ═══ NEW ═══
# ═══════════════════════════════════════════════════════════
def _dedupe_key(b):
    """Khoá dedupe: (title viết thường, price). Hai bản ghi cùng key = trùng."""
    title = (b.get("title") or "").strip().lower()
    try:
        price = float(b.get("price") or 0)
    except (ValueError, TypeError):
        price = 0.0
    return (title, price)


def _dedupe_books(books):
    """Loại bỏ bản ghi trùng (title + price). Giữ bản đầu tiên gặp."""
    seen, result = set(), []
    for b in books:
        k = _dedupe_key(b)
        if k in seen:
            continue
        seen.add(k)
        result.append(b)
    return result

# ═══════════════════════════════════════════════════════════
# HELPERS — BACKUP
# ═══════════════════════════════════════════════════════════
def _iso(dt):
    return dt.isoformat(timespec="seconds") if isinstance(dt, datetime.datetime) else dt


def _write_backup_file(books, prefix="BK"):
    """Ghi file backup JSON, trả về (backup_id, filename, file_size, checksum, created_at)."""
    now = datetime.datetime.now()
    backup_id = f"{prefix}_{now.strftime('%Y%m%d_%H%M%S')}_{os.urandom(2).hex()}"
    filename  = f"{backup_id}.json"
    filepath  = os.path.join(BACKUP_DIR, filename)

    payload = {
        "backup_id":    backup_id,
        "created_at":   now.isoformat(timespec="seconds"),
        "collection":   "tiki_books",
        "record_count": len(books),
        "data":         books,
    }
    with open(filepath, "w", encoding="utf-8") as f:
        _json.dump(payload, f, ensure_ascii=False, indent=2)

    file_size = os.path.getsize(filepath)
    with open(filepath, "rb") as f:
        checksum = hashlib.md5(f.read()).hexdigest()
    return backup_id, filename, file_size, checksum, now


def _auto_snapshot(reason="auto-before-restore"):
    """Tự động chụp snapshot trước khi restore để có thể rollback."""
    try:
        books = list(col.find({}, {"_id": 0}))
        if not books:
            return None
        backup_id, filename, file_size, checksum, now = _write_backup_file(books, prefix="SNAP")
        backup_col.insert_one({
            "backup_id":    backup_id,
            "created_at":   now,
            "created_by":   "system",
            "note":         reason,
            "record_count": len(books),
            "file_size":    file_size,
            "filename":     filename,
            "checksum":     checksum,
            "type":         "snapshot",
            "status":       "success",
        })
        return backup_id
    except Exception as e:
        print(f"[auto_snapshot] {e}")
        return None


# ═══════════════════════════════════════════════════════════
# HEALTH
# ═══════════════════════════════════════════════════════════
@app.route("/api/health", methods=["GET"])
def health():
    try:
        count = col.count_documents({})
        return jsonify({
            "ok": True,
            "count": count,
            "db": "e-commerce",
            "col": "tiki_books",
            "model_loaded":    rating_model  is not None,
            "kmeans_loaded":   kmeans_model  is not None and scaler_model is not None,
            "iso_loaded":      iso_model     is not None and iso_scaler    is not None,
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# MODEL INFO
# ═══════════════════════════════════════════════════════════
@app.route("/api/model-info", methods=["GET"])
def model_info():
    return jsonify({
        "ok": True,

        # ── Linear Regression (phụ lục) ──
        "rating_model": {
            "loaded": rating_model is not None,
            "model_type": "LinearRegression",
            "features": [
                "price", "original_price", "discount_rate",
                "review_count", "title_length"
            ],
            "n_train": 1267,
            "metrics": {"mae": 0.1615, "rmse": 0.3018, "r2": -0.0157},
            "note": "R² < 0 — baseline chưa vượt. Chỉ dùng làm phụ lục tham khảo."
        },

        # ── K-Means ──
        "kmeans_model": {
            "loaded": kmeans_model is not None and scaler_model is not None,
            "model_type": "KMeans",
            "n_clusters": 4,
            "silhouette_score": 0.461,
            "features": ["price", "discount_rate", "review_count"],
            "cluster_labels": {
                "0": "Best Seller Giá Rẻ",
                "1": "Phổ Thông / Nguyên Giá",
                "2": "Khuyến Mãi / Deal",
                "3": "Combo / Cao Cấp",
            },
            "cluster_behavior": {
                "0": {
                    "segment": "Người mua nhạy cảm giá",
                    "insight": "Ưu tiên sách rẻ, review nhiều để giảm rủi ro",
                    "tactic":  "Flash Sale, bundle giá thấp"
                },
                "1": {
                    "segment": "Người mua trung thành / Nguyên giá",
                    "insight": "Chấp nhận trả giá gốc, quan tâm thương hiệu/NXB",
                    "tactic":  "Loyalty, pre-order, tác giả best-seller"
                },
                "2": {
                    "segment": "Người mua săn khuyến mãi",
                    "insight": "Chờ deal 25–45%, giá trị đơn trung bình",
                    "tactic":  "Coupon định kỳ, deal giờ vàng"
                },
                "3": {
                    "segment": "Người mua cao cấp / Impulse",
                    "insight": "Mua boxset, sách chuyên ngành giá cao, ít so giá",
                    "tactic":  "Bản giới hạn, combo quà tặng, tư vấn 1-1"
                },
            },
            "note": "Silhouette 0.461 — phân cụm tốt (>0.4)."
        },

        # ── Isolation Forest ──
        "isolation_forest": {
            "loaded": iso_model is not None and iso_scaler is not None,
            "model_type": "IsolationForest",
            "n_estimators": 150,
            "contamination": 0.05,
            "features": ISO_FEATURES,
            "feature_explanation": {
                "price":             "Giá bán hiện tại (VNĐ)",
                "discount_rate":     "Tỷ lệ giảm giá (%)",
                "review_count":      "Số lượt đánh giá",
                "rating":            "Điểm sao trung bình",
                "review_per_rating": "review_count / (rating + 0.01) — mức độ hot thực sự",
            },
            "note": "Phát hiện SKU có tổ hợp chỉ số thương mại bất thường (nghi vấn seeding, giá sai, deal bất thường)."
        },
    })


# ═══════════════════════════════════════════════════════════
# ML: K-MEANS
# ═══════════════════════════════════════════════════════════
@app.route("/api/predict-cluster", methods=["POST"])
def predict_cluster():
    if kmeans_model is None or scaler_model is None:
        return jsonify({
            "ok": False,
            "error": "K-Means chưa export. Chạy notebook export kmeans_model.pkl + scaler.pkl."
        }), 503
    try:
        d = request.get_json(force=True) or {}
        price    = float(d.get("price", 150000))
        discount = float(d.get("discount_rate", 20))
        reviews  = float(d.get("review_count", 120))

        X = [[price, discount, reviews]]
        X_scaled = scaler_model.transform(X)
        cluster = int(kmeans_model.predict(X_scaled)[0])

        return jsonify({
            "ok": True,
            "cluster": cluster,
            "cluster_label": {
                0: "Best Seller Giá Rẻ",
                1: "Phổ Thông / Nguyên Giá",
                2: "Khuyến Mãi / Deal",
                3: "Combo / Cao Cấp",
            }.get(cluster, f"Cụm {cluster}"),
            "source": "kmeans",
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# ML: ISOLATION FOREST — phát hiện bất thường 1 SKU
# ═══════════════════════════════════════════════════════════
@app.route("/api/predict-anomaly", methods=["POST"])
def predict_anomaly():
    if iso_model is None or iso_scaler is None:
        return jsonify({
            "ok": False,
            "error": "Isolation Forest chưa load. Chạy train_isolation_forest.py."
        }), 503
    try:
        d = request.get_json(force=True) or {}
        price    = float(d.get("price", 150000))
        discount = float(d.get("discount_rate", 20))
        reviews  = float(d.get("review_count", 120))
        rating   = float(d.get("rating", 4.5))

        rpr = reviews / (rating + 0.01)
        X   = [[price, discount, reviews, rating, rpr]]
        Xs  = iso_scaler.transform(X)

        score = float(iso_model.decision_function(Xs)[0])   # càng âm → càng bất thường
        pred  = int(iso_model.predict(Xs)[0])               # 1 normal, -1 anomaly
        is_anomaly = (pred == -1)

        return jsonify({
            "ok": True,
            "is_anomaly": is_anomaly,
            "anomaly_score": round(score, 4),
            "verdict": "BẤT THƯỜNG" if is_anomaly else "BÌNH THƯỜNG",
            "reason": _explain_anomaly(price, discount, reviews, rating),
            "input": {
                "price": price,
                "discount_rate": discount,
                "review_count": reviews,
                "rating": rating,
                "review_per_rating": round(rpr, 2),
            }
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# ML: ISOLATION FOREST — liệt kê toàn bộ anomaly (dùng cho dashboard)
# ═══════════════════════════════════════════════════════════
@app.route("/api/anomalies", methods=["GET"])
def list_anomalies():
    if iso_model is None or iso_scaler is None:
        return jsonify({
            "ok": False,
            "error": "Isolation Forest chưa load. Chạy train_isolation_forest.py."
        }), 503
    try:
        limit = int(request.args.get("limit", 50))

        books = list(col.find({}, {"_id": 0}))
        if not books:
            return jsonify({
                "ok": True,
                "total_books": 0,
                "total_anomalies": 0,
                "contamination_rate": 0,
                "anomalies": []
            })

        X, meta = [], []
        for b in books:
            rating = float(b.get("rating") or 0)
            if rating <= 0:
                continue  # bỏ SP chưa có rating
            X.append(_build_iso_features(b))
            meta.append(b)

        if not X:
            return jsonify({
                "ok": True, "total_books": 0, "total_anomalies": 0,
                "contamination_rate": 0, "anomalies": []
            })

        Xs     = iso_scaler.transform(X)
        scores = iso_model.decision_function(Xs)
        preds  = iso_model.predict(Xs)

        anomalies = []
        for b, s, p in zip(meta, scores, preds):
            if p == -1:
                price    = float(b.get("price") or 0)
                discount = float(b.get("discount_rate") or 0)
                reviews  = float(b.get("review_count") or 0)
                rating   = float(b.get("rating") or 0)
                anomalies.append({
                    "sku":          b.get("sku"),
                    "title":        b.get("title"),
                    "category":     b.get("category"),
                    "price":        price,
                    "discount_rate": discount,
                    "review_count": reviews,
                    "rating":       rating,
                    "cluster":      b.get("cluster"),
                    "anomaly_score": round(float(s), 4),
                    "reason":       _explain_anomaly(price, discount, reviews, rating),
                })

        # Score âm nhất = bất thường nhất → xếp đầu
        anomalies.sort(key=lambda x: x["anomaly_score"])

        return jsonify({
            "ok": True,
            "total_books":         len(meta),
            "total_anomalies":     len(anomalies),
            "contamination_rate":  round(len(anomalies) / len(meta) * 100, 2),
            "anomalies":           anomalies[:limit],
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# ML: LINEAR REGRESSION (phụ lục — giữ để đối chứng)
# ═══════════════════════════════════════════════════════════
@app.route("/api/predict-rating", methods=["POST"])
def predict_rating():
    if rating_model is None:
        return jsonify({
            "ok": False,
            "error": "Model chưa load. Chạy cell export model trong notebook."
        }), 503
    try:
        d = request.get_json(force=True) or {}
        price    = float(d.get("price", 150000))
        discount = float(d.get("discount_rate", 20))
        reviews  = float(d.get("review_count", 120))

        original_price = d.get("original_price")
        if original_price is None:
            original_price = price / (1 - discount / 100) if 0 < discount < 100 else price
        else:
            original_price = float(original_price)

        title_length = float(d.get("title_length", 50))
        X = [[price, original_price, discount, reviews, title_length]]
        pred = float(rating_model.predict(X)[0])
        pred = max(1.0, min(5.0, pred))

        return jsonify({
            "ok": True,
            "rating": round(pred, 2),
            "warning": "Kết quả từ Linear Regression (R² = -0.0157) — chỉ tham khảo.",
            "input": {
                "price": price,
                "original_price": round(original_price, 2),
                "discount_rate": discount,
                "review_count": reviews,
                "title_length": title_length,
            }
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# CRUD: BOOKS
# ═══════════════════════════════════════════════════════════
@app.route("/api/books", methods=["GET"])
def get_books():
    try:
        books = list(col.find({}, {"_id": 0}))
        books = _dedupe_books(books)            # ═══ NEW ═══
        return jsonify(books)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# ADMIN: DEDUPE MONGODB  # ═══ NEW ═══
# ═══════════════════════════════════════════════════════════
@app.route("/api/books/dedupe", methods=["POST"])
def dedupe_mongo():
    """Xoá các bản ghi trùng (title + price) trực tiếp trong MongoDB.
       Chạy 1 lần sau khi import lại CSV đã dedupe.
       Trả về: trước / sau / đã xoá.
    """
    try:
        docs = list(col.find({}, {"_id": 1, "title": 1, "price": 1}))
        before = len(docs)

        seen, to_delete = set(), []
        for d in docs:
            k = _dedupe_key(d)
            if k in seen:
                to_delete.append(d["_id"])
            else:
                seen.add(k)

        deleted = 0
        if to_delete:
            deleted = col.delete_many({"_id": {"$in": to_delete}}).deleted_count

        return jsonify({
            "ok": True,
            "before": before,
            "after": before - deleted,
            "deleted": deleted,
            "message": "Không có bản ghi trùng" if deleted == 0 else f"Đã xoá {deleted} bản ghi trùng",
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
# ═══ END NEW ═══


@app.route("/api/books/<sku>", methods=["GET"])
def get_book(sku):
    try:
        book = col.find_one({"sku": sku}, {"_id": 0})
        if not book:
            return jsonify({"ok": False, "error": "Not found"}), 404
        return jsonify(book)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/books", methods=["POST"])
def add_book():
    try:
        new_book = request.get_json(force=True) or {}
        if not new_book.get("sku"):
            return jsonify({"ok": False, "error": "Thiếu sku"}), 400
        if col.find_one({"sku": new_book["sku"]}):
            return jsonify({"ok": False, "error": "SKU đã tồn tại"}), 409
        new_book.pop("_id", None)
        col.insert_one(new_book)
        return jsonify({"ok": True, "sku": new_book["sku"]}), 201
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/books/<sku>", methods=["PUT"])
def update_book(sku):
    try:
        patch = request.get_json(force=True) or {}
        patch.pop("_id", None)
        patch.pop("sku", None)
        result = col.update_one({"sku": sku}, {"$set": patch})
        if result.matched_count == 0:
            return jsonify({"ok": False, "error": "Not found"}), 404
        return jsonify({"ok": True, "modified": result.modified_count})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/books/<sku>", methods=["DELETE"])
def delete_book(sku):
    try:
        result = col.delete_one({"sku": sku})
        if result.deleted_count == 0:
            return jsonify({"ok": False, "error": "Not found"}), 404
        return jsonify({"ok": True, "deleted": result.deleted_count})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# BACKUP — STATS
# ═══════════════════════════════════════════════════════════
@app.route("/api/backup/stats", methods=["GET"])
def backup_stats():
    try:
        backups  = list(backup_col.find({"type": {"$in": ["manual", "snapshot"]}},
                                          {"_id": 0}).sort("created_at", -1))
        restores = list(backup_col.find({"type": "restore"},
                                          {"_id": 0}).sort("created_at", -1))
        total_size = sum(b.get("file_size", 0) for b in backups)
        return jsonify({
            "ok": True,
            "current_books":    col.count_documents({}),
            "total_backups":    len(backups),
            "total_restores":   len(restores),
            "total_size_bytes": total_size,
            "total_size_mb":    round(total_size / 1024 / 1024, 2),
            "last_backup":      _iso(backups[0]["created_at"])  if backups  else None,
            "last_restore":     _iso(restores[0]["created_at"]) if restores else None,
            "recent_backups":   [_iso(b.get("created_at")) for b in backups[:5]],
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# BACKUP — CREATE
# ═══════════════════════════════════════════════════════════
@app.route("/api/backup/create", methods=["POST"])
def backup_create():
    try:
        data       = request.get_json(force=True) or {}
        note       = (data.get("note") or "").strip()
        created_by = (data.get("created_by") or "Admin").strip()

        books = list(col.find({}, {"_id": 0}))
        if not books:
            return jsonify({"ok": False, "error": "Collection rỗng, không có gì để backup"}), 400

        backup_id, filename, file_size, checksum, now = _write_backup_file(books, prefix="BK")

        backup_col.insert_one({
            "backup_id":    backup_id,
            "created_at":   now,
            "created_by":   created_by,
            "note":         note,
            "record_count": len(books),
            "file_size":    file_size,
            "filename":     filename,
            "checksum":     checksum,
            "type":         "manual",
            "status":       "success",
        })

        return jsonify({
            "ok":           True,
            "backup_id":    backup_id,
            "filename":     filename,
            "record_count": len(books),
            "file_size":    file_size,
            "file_size_kb": round(file_size / 1024, 2),
            "checksum":     checksum,
            "created_at":   now.isoformat(timespec="seconds"),
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# BACKUP — LIST
# ═══════════════════════════════════════════════════════════
@app.route("/api/backup/list", methods=["GET"])
def backup_list():
    try:
        limit = int(request.args.get("limit", 100))
        items = list(
            backup_col.find({"type": {"$in": ["manual", "snapshot"]}}, {"_id": 0})
            .sort("created_at", -1)
            .limit(limit)
        )
        for it in items:
            it["created_at"] = _iso(it.get("created_at"))
        return jsonify({"ok": True, "backups": items, "total": len(items)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# BACKUP — HISTORY (backup + restore log)
# ═══════════════════════════════════════════════════════════
@app.route("/api/backup/history", methods=["GET"])
def backup_history():
    try:
        limit = int(request.args.get("limit", 50))
        items = list(backup_col.find({}, {"_id": 0}).sort("created_at", -1).limit(limit))
        for it in items:
            it["created_at"] = _iso(it.get("created_at"))
        return jsonify({"ok": True, "history": items})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# BACKUP — DOWNLOAD FILE
# ═══════════════════════════════════════════════════════════
@app.route("/api/backup/download/<backup_id>", methods=["GET"])
def backup_download(backup_id):
    try:
        meta = backup_col.find_one({"backup_id": backup_id, "filename": {"$exists": True}}, {"_id": 0})
        if not meta:
            return jsonify({"ok": False, "error": "Backup không tồn tại"}), 404
        filepath = os.path.join(BACKUP_DIR, meta["filename"])
        if not os.path.exists(filepath):
            return jsonify({"ok": False, "error": "File backup bị mất"}), 404
        return send_file(
            filepath,
            as_attachment=True,
            download_name=meta["filename"],
            mimetype="application/json",
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# BACKUP — RESTORE TỪ BACKUP_ID
# ═══════════════════════════════════════════════════════════
@app.route("/api/backup/restore/<backup_id>", methods=["POST"])
def backup_restore(backup_id):
    try:
        data        = request.get_json(force=True) or {}
        mode        = (data.get("mode") or "replace").lower()
        restored_by = (data.get("restored_by") or "Admin").strip()

        if mode not in ("replace", "merge"):
            return jsonify({"ok": False, "error": "mode phải là 'replace' hoặc 'merge'"}), 400

        meta = backup_col.find_one({"backup_id": backup_id, "filename": {"$exists": True}}, {"_id": 0})
        if not meta:
            return jsonify({"ok": False, "error": "Backup không tồn tại"}), 404

        filepath = os.path.join(BACKUP_DIR, meta["filename"])
        if not os.path.exists(filepath):
            return jsonify({"ok": False, "error": "File backup bị mất"}), 404

        with open(filepath, "r", encoding="utf-8") as f:
            payload = _json.load(f)
        backup_data = payload.get("data", []) if isinstance(payload, dict) else payload
        if not backup_data:
            return jsonify({"ok": False, "error": "Backup không có dữ liệu"}), 400

        # Snapshot an toàn trước khi restore
        snapshot_id = _auto_snapshot(f"auto trước khi restore {backup_id}")

        if mode == "replace":
            col.delete_many({})
            col.insert_many([{k: v for k, v in d.items() if k != "_id"} for d in backup_data])
            inserted, updated = len(backup_data), 0
        else:
            inserted, updated = 0, 0
            for doc in backup_data:
                doc = {k: v for k, v in doc.items() if k != "_id"}
                sku = doc.get("sku")
                if not sku:
                    continue
                if col.find_one({"sku": sku}):
                    col.update_one({"sku": sku}, {"$set": doc})
                    updated += 1
                else:
                    col.insert_one(doc)
                    inserted += 1

        now = datetime.datetime.now()
        backup_col.insert_one({
            "backup_id":        f"RESTORE_{now.strftime('%Y%m%d_%H%M%S')}_{os.urandom(2).hex()}",
            "created_at":       now,
            "created_by":       restored_by,
            "note":             f"Khôi phục từ {backup_id} (mode={mode})",
            "record_count":     len(backup_data),
            "type":             "restore",
            "status":           "success",
            "source_backup_id": backup_id,
            "mode":             mode,
            "inserted":         inserted,
            "updated":          updated,
            "snapshot_id":      snapshot_id,
        })

        return jsonify({
            "ok":            True,
            "mode":          mode,
            "inserted":      inserted,
            "updated":       updated,
            "total":         len(backup_data),
            "snapshot_id":   snapshot_id,
            "current_books": col.count_documents({}),
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# BACKUP — RESTORE TỪ FILE UPLOAD
# ═══════════════════════════════════════════════════════════
@app.route("/api/backup/upload-restore", methods=["POST"])
def backup_upload_restore():
    try:
        if "file" not in request.files:
            return jsonify({"ok": False, "error": "Không có file upload"}), 400

        file        = request.files["file"]
        mode        = (request.form.get("mode") or "merge").lower()
        restored_by = (request.form.get("restored_by") or "Admin").strip()

        if mode not in ("replace", "merge"):
            return jsonify({"ok": False, "error": "mode phải là 'replace' hoặc 'merge'"}), 400

        content = file.read().decode("utf-8")
        try:
            payload = _json.loads(content)
        except Exception:
            return jsonify({"ok": False, "error": "File không phải JSON hợp lệ"}), 400

        if isinstance(payload, list):
            backup_data = payload
        elif isinstance(payload, dict):
            backup_data = payload.get("data", [])
        else:
            return jsonify({"ok": False, "error": "Format JSON không hợp lệ"}), 400

        if not backup_data:
            return jsonify({"ok": False, "error": "File không có dữ liệu"}), 400

        # Snapshot an toàn
        snapshot_id = _auto_snapshot(f"auto trước upload-restore {secure_filename(file.filename)}")

        if mode == "replace":
            col.delete_many({})
            col.insert_many([{k: v for k, v in d.items() if k != "_id"} for d in backup_data])
            inserted, updated = len(backup_data), 0
        else:
            inserted, updated = 0, 0
            for doc in backup_data:
                doc = {k: v for k, v in doc.items() if k != "_id"}
                sku = doc.get("sku")
                if not sku:
                    continue
                if col.find_one({"sku": sku}):
                    col.update_one({"sku": sku}, {"$set": doc})
                    updated += 1
                else:
                    col.insert_one(doc)
                    inserted += 1

        now = datetime.datetime.now()
        backup_col.insert_one({
            "backup_id":       f"RESTORE_UP_{now.strftime('%Y%m%d_%H%M%S')}_{os.urandom(2).hex()}",
            "created_at":      now,
            "created_by":      restored_by,
            "note":            f"Upload-restore từ {secure_filename(file.filename)} (mode={mode})",
            "record_count":    len(backup_data),
            "type":            "restore",
            "status":          "success",
            "source_filename": secure_filename(file.filename),
            "mode":            mode,
            "inserted":        inserted,
            "updated":         updated,
            "snapshot_id":     snapshot_id,
        })

        return jsonify({
            "ok":            True,
            "mode":          mode,
            "inserted":      inserted,
            "updated":       updated,
            "total":         len(backup_data),
            "snapshot_id":   snapshot_id,
            "current_books": col.count_documents({}),
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# BACKUP — DELETE
# ═══════════════════════════════════════════════════════════
@app.route("/api/backup/<backup_id>", methods=["DELETE"])
def backup_delete(backup_id):
    try:
        meta = backup_col.find_one({"backup_id": backup_id}, {"_id": 0})
        if not meta:
            return jsonify({"ok": False, "error": "Backup không tồn tại"}), 404

        if meta.get("type") == "restore":
            return jsonify({"ok": False, "error": "Không thể xoá log restore"}), 400

        filepath = os.path.join(BACKUP_DIR, meta.get("filename", ""))
        if meta.get("filename") and os.path.exists(filepath):
            os.remove(filepath)

        backup_col.delete_one({"backup_id": backup_id})
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# BÁO CÁO THỐNG KÊ (+ ANOMALY)
# ═══════════════════════════════════════════════════════════
def _compute_anomaly_stats():
    """Tính nhanh anomaly stats cho báo cáo. Trả {} nếu model chưa load."""
    if iso_model is None or iso_scaler is None:
        return {
            "available": False,
            "total_anomalies": 0,
            "contamination_rate": 0,
            "score_range": None,
        }
    try:
        X = []
        for b in col.find({}, {"_id": 0,
                                "price": 1, "discount_rate": 1,
                                "review_count": 1, "rating": 1}):
            if float(b.get("rating") or 0) <= 0:
                continue
            X.append(_build_iso_features(b))
        if not X:
            return {"available": True, "total_anomalies": 0,
                    "contamination_rate": 0, "score_range": None}
        Xs     = iso_scaler.transform(X)
        scores = iso_model.decision_function(Xs)
        preds  = iso_model.predict(Xs)
        n_ano  = int((preds == -1).sum())
        return {
            "available": True,
            "n_books_scored": len(X),
            "total_anomalies": n_ano,
            "contamination_rate": round(n_ano / len(X) * 100, 2),
            "score_range": {
                "min": round(float(scores.min()), 4),
                "max": round(float(scores.max()), 4),
                "mean": round(float(scores.mean()), 4),
                "median": round(float(sorted(scores)[len(scores)//2]), 4),
            },
        }
    except Exception as e:
        return {"available": False, "error": str(e)}


def _build_summary():
    total = col.count_documents({})
    if total == 0:
        return None

    overall = list(col.aggregate([{
        "$group": {
            "_id": None,
            "total":         {"$sum": 1},
            "avg_price":     {"$avg": "$price"},
            "avg_rating":    {"$avg": "$rating"},
            "avg_discount":  {"$avg": "$discount_rate"},
            "total_reviews": {"$sum": "$review_count"},
            "max_price":     {"$max": "$price"},
            "min_price":     {"$min": "$price"},
            "categories":    {"$addToSet": "$category"},
        }
    }]))
    s = overall[0] if overall else {}

    cluster_dist = list(col.aggregate([
        {"$group": {
            "_id":        "$cluster",
            "count":      {"$sum": 1},
            "avg_price":  {"$avg": "$price"},
            "avg_rating": {"$avg": "$rating"},
        }},
        {"$sort": {"_id": 1}},
    ]))

    rating_dist = list(col.aggregate([{
        "$bucket": {
            "groupBy": "$rating",
            "boundaries": [0, 3.0, 4.0, 4.5, 4.8, 5.01],
            "default": "unknown",
            "output": {"count": {"$sum": 1}},
        }
    }]))

    price_dist = list(col.aggregate([{
        "$bucket": {
            "groupBy": "$price",
            "boundaries": [0, 50000, 100000, 200000, 500000, 10000000],
            "default": "unknown",
            "output": {"count": {"$sum": 1}},
        }
    }]))

    top_categories = list(col.aggregate([
        {"$group": {"_id": "$category", "count": {"$sum": 1}, "avg_price": {"$avg": "$price"}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]))

    top_authors = list(col.aggregate([
        {"$match": {"author": {"$nin": ["", "Đang cập nhật", None]}}},
        {"$group": {"_id": "$author", "count": {"$sum": 1}, "avg_rating": {"$avg": "$rating"}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]))

    top_books = list(col.find(
        {"review_count": {"$gt": 0}},
        {"_id": 0, "sku": 1, "title": 1, "price": 1, "rating": 1,
         "review_count": 1, "category": 1, "discount_rate": 1}
    ).sort("review_count", -1).limit(10))

    top_discounts = list(col.find(
        {"discount_rate": {"$gt": 0}},
        {"_id": 0, "sku": 1, "title": 1, "price": 1,
         "original_price": 1, "discount_rate": 1}
    ).sort("discount_rate", -1).limit(10))

    anomaly_stats = _compute_anomaly_stats()

    return {
        "ok": True,
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "db": "e-commerce",
        "collection": "tiki_books",
        "overall": {
            "total_books":      s.get("total", 0),
            "total_categories": len(s.get("categories", [])),
            "avg_price":        round(s.get("avg_price", 0) or 0, 2),
            "avg_rating":       round(s.get("avg_rating", 0) or 0, 2),
            "avg_discount":     round(s.get("avg_discount", 0) or 0, 2),
            "total_reviews":    s.get("total_reviews", 0),
            "max_price":        s.get("max_price", 0),
            "min_price":        s.get("min_price", 0),
        },
        "cluster_distribution": cluster_dist,
        "rating_distribution":  rating_dist,
        "price_distribution":   price_dist,
        "top_categories":       top_categories,
        "top_authors":          top_authors,
        "top_books":            top_books,
        "top_discounts":        top_discounts,
        "anomaly_stats":        anomaly_stats,
    }


@app.route("/api/reports/summary", methods=["GET"])
def report_summary():
    try:
        summary = _build_summary()
        if summary is None:
            return jsonify({"ok": False, "error": "Collection rỗng"}), 404
        return jsonify(summary)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/reports/export", methods=["GET"])
def report_export():
    fmt = (request.args.get("format") or "json").lower()
    try:
        summary = _build_summary()
        if summary is None:
            return jsonify({"ok": False, "error": "Collection rỗng"}), 404

        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

        if fmt == "csv":
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["Loại", "Chỉ số / Tên", "Số lượng", "Chi tiết"])

            ov = summary["overall"]
            w.writerow(["Tổng quan", "Tổng số sách",          ov["total_books"], ""])
            w.writerow(["Tổng quan", "Số thể loại khác nhau", ov["total_categories"], ""])
            w.writerow(["Tổng quan", "Giá trung bình (VND)",  f"{ov['avg_price']:.0f}", ""])
            w.writerow(["Tổng quan", "Rating trung bình",     ov["avg_rating"], "/5"])
            w.writerow(["Tổng quan", "Giảm giá trung bình",   ov["avg_discount"], "%"])
            w.writerow(["Tổng quan", "Tổng lượt review",      ov["total_reviews"], ""])
            w.writerow(["Tổng quan", "Giá cao nhất (VND)",    f"{ov['max_price']:.0f}", ""])
            w.writerow(["Tổng quan", "Giá thấp nhất (VND)",   f"{ov['min_price']:.0f}", ""])
            w.writerow([])

            cluster_label = {
                0: "Best Seller Giá Rẻ",
                1: "Phổ Thông / Nguyên Giá",
                2: "Khuyến Mãi / Deal",
                3: "Combo / Cao Cấp",
            }
            for c in summary["cluster_distribution"]:
                pct = c["count"] / ov["total_books"] * 100
                w.writerow([
                    "Phân cụm K-Means",
                    f"Cụm {c['_id']} - {cluster_label.get(c['_id'], '')}",
                    c["count"],
                    f"{pct:.1f}% | giá TB {c['avg_price']:.0f} | rating TB {c['avg_rating']:.2f}",
                ])
            w.writerow([])

            for r in summary["rating_distribution"]:
                w.writerow(["Rating bucket", str(r["_id"]), r["count"], ""])
            w.writerow([])

            for p in summary["price_distribution"]:
                w.writerow(["Price bucket", str(p["_id"]), p["count"], "VND"])
            w.writerow([])

            for c in summary["top_categories"]:
                w.writerow(["Top thể loại", c["_id"], c["count"], f"giá TB {c['avg_price']:.0f}"])
            w.writerow([])

            for a in summary["top_authors"]:
                w.writerow(["Top tác giả", a["_id"], a["count"], f"rating TB {a['avg_rating']:.2f}"])
            w.writerow([])

            for b in summary["top_books"]:
                w.writerow(["Top sách nổi bật", b["title"], b["review_count"],
                            f"rating {b['rating']} | giá {b['price']:.0f}"])
            w.writerow([])

            for d in summary["top_discounts"]:
                w.writerow(["Top giảm giá", d["title"], f"{d['discount_rate']}%",
                            f"từ {d['original_price']:.0f} → {d['price']:.0f}"])
            w.writerow([])

            # ═══ ANOMALY SECTION ═══
            w.writerow(["=== ANOMALY DETECTION (Isolation Forest) ===", "", "", ""])
            astats = summary["anomaly_stats"]
            if astats.get("available"):
                w.writerow(["Anomaly", "Tổng SKU bất thường", astats["total_anomalies"], ""])
                w.writerow(["Anomaly", "Tỷ lệ contamination",
                            f"{astats['contamination_rate']}%",
                            f"{astats['n_books_scored']} SKU được chấm điểm"])
                sr = astats.get("score_range") or {}
                if sr:
                    w.writerow(["Anomaly", "Score range",
                                f"{sr.get('min')} → {sr.get('max')}",
                                f"mean {sr.get('mean')} | median {sr.get('median')}"])
            else:
                w.writerow(["Anomaly", "Không khả dụng", "", astats.get("error", "Model chưa load")])

            return Response(
                "\uFEFF" + buf.getvalue(),
                mimetype="text/csv; charset=utf-8",
                headers={"Content-Disposition": f"attachment; filename=tiki_report_{stamp}.csv"},
            )

        return Response(
            _json.dumps(summary, ensure_ascii=False, indent=2),
            mimetype="application/json; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename=tiki_report_{stamp}.json"},
        )

    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# RUN
# ═══════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("🚀 Backend: http://localhost:5000  |  /api/health để kiểm tra")
    print("🤖 K-Means          :", "ĐÃ LOAD" if kmeans_model else "CHƯA LOAD")
    print("🔬 Isolation Forest :", "ĐÃ LOAD" if iso_model    else "CHƯA LOAD (chạy train_isolation_forest.py)")
    print("📊 Báo cáo          : http://localhost:5000/api/reports/summary")
    print("⚠️  Anomalies        : http://localhost:5000/api/anomalies")
    print("ℹ️  Model info       : http://localhost:5000/api/model-info")
    print("💾 Backup stats     : http://localhost:5000/api/backup/stats")
    print("📁 Backup folder    :", os.path.abspath(BACKUP_DIR))
    app.run(port=5000, debug=False)