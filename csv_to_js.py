"""Chuyển dữ liệu và ghép ảnh bìa -> tiki_books_data.js"""
import csv, json, os, re

SRC_CLEAN = "tiki_books_clean_perfect.csv"
SRC_ORIGINAL = "book_data.csv"
OUT = "tiki_books_data.js"

def to_float(v, d=0.0):
    try: return float(str(v).strip() or d)
    except: return d

def to_int(v, d=0):
    try: return int(float(str(v).strip() or d))
    except: return d

def normalize_title(t):
    if not t: return ""
    t = t.lower()
    t = re.sub(r'\(tái bản[^)]*\)', '', t)
    t = re.sub(r'- tái bản[^,]*', '', t)
    t = re.sub(r'sách ', '', t)
    t = re.sub(r'\(bìa mềm\)', '', t)
    t = re.sub(r'\(bìa cứng\)', '', t)
    t = re.sub(r'[^a-z0-9 ]', '', t)
    return " ".join(t.split()).strip()

def cluster_of(price, disc, rating, review):
    if price >= 250000: return 2
    if disc >= 25 and review >= 100: return 1
    if rating >= 4.7 and review >= 50: return 3
    return 0

def main():
    if not os.path.exists(SRC_CLEAN):
        print(f"❌ Không tìm thấy {SRC_CLEAN}!")
        return

    cover_map = {}
    if os.path.exists(SRC_ORIGINAL):
        with open(SRC_ORIGINAL, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                title = r.get("title") or r.get("product_name")
                cover = r.get("cover_link")
                if title and cover and cover.startswith("http"):
                    cover_map[normalize_title(title)] = cover

    rows, idx = [], 0
    matched_count = 0
    
    with open(SRC_CLEAN, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            title = (r.get("title") or "").strip()
            price = to_float(r.get("price"))
            if not title or price <= 0: continue
            
            idx += 1
            norm_title = normalize_title(title)
            cover_url = cover_map.get(norm_title, "")
            
            if cover_url:
                matched_count += 1

            book = {
                "sku": f"TK_{1000 + idx}",
                "title": title,
                "category": (r.get("category") or "").strip(),
                "author": (r.get("author") or "").strip() or "Đang cập nhật",
                "price": price,
                "original_price": to_float(r.get("original_price"), price),
                "discount_rate": to_float(r.get("discount_rate")),
                "rating": to_float(r.get("rating")),
                "review_count": to_int(r.get("review_count")),
                "price_range": (r.get("price_range") or "").strip(),
                "title_length": to_int(r.get("title_length")),
                "is_high_rating": to_int(r.get("is_high_rating")),
                "cover_link": cover_url
            }
            book["cluster"] = cluster_of(book["price"], book["discount_rate"], book["rating"], book["review_count"])
            rows.append(book)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// AUTO-GENERATED from tiki_books_clean_perfect.csv + book_data.csv\n")
        f.write("window.TIKI_BOOKS_DATA = ")
        json.dump(rows, f, ensure_ascii=False)
        f.write(";\n")

    print(f"✅ Đã xuất {len(rows)} sách vào {OUT}")
    print(f"   -> Tìm thấy ảnh bìa thật cho {matched_count}/{len(rows)} cuốn sách.")

if __name__ == "__main__":
    main()