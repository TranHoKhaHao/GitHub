import csv
from pymongo import MongoClient

MONGO_URI = (
    "mongodb+srv://24126030_db_user:cuong123@cluster0.zyrklbg.mongodb.net/"
)
DB_NAME = "e-commerce"
COLLECTION_NAME = "products"

# Đặt danh sách các file CSV ở đây (dùng biến tên là CSV_FILES có chữ 'S' ở cuối)
CSV_FILES = ["tiki_sach_chi_tiet.csv", "book_data.csv"]


def upload_multiple_csv_to_mongo():
  print("Đang kết nối tới MongoDB Atlas...")
  client = MongoClient(MONGO_URI)
  db = client[DB_NAME]
  collection = db[COLLECTION_NAME]

  for csv_file in CSV_FILES:
    print(f"Đang xử lý file: {csv_file}...")
    records = []
    try:
      with open(csv_file, "r", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        for row in reader:
          records.append(row)

      if records:
        result = collection.insert_many(records)
        print(
            f" -> Đã đẩy thành công {len(result.inserted_ids)} bản ghi"
            f" từ {csv_file} lên collection '{COLLECTION_NAME}'!"
        )
      else:
        print(f"File {csv_file} trống, không có dữ liệu.")
    except Exception as e:
      print(f"Lỗi khi đọc file {csv_file}: {e}")

  print("Hoàn tất toàn bộ quá trình nạp dữ liệu!")


if __name__ == "__main__":
  upload_multiple_csv_to_mongo()