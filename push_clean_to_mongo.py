import csv
from pymongo import MongoClient
import json

MONGO_URI = "mongodb+srv://24126030_db_user:cuong123@cluster0.zyrklbg.mongodb.net/"
DB_NAME = "e-commerce"
COLLECTION_NAME = "tiki_books"

def upload_clean_data():
    print("Đang kết nối tới MongoDB Atlas...")
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    collection = db[COLLECTION_NAME]
    
    # Xóa dữ liệu cũ (nếu có) để nạp mới
    collection.delete_many({})
    print("Đã dọn dẹp collection cũ.")

    records = []
    # Đọc từ file JS đã được convert (hoặc file CSV perfect của bạn)
    # Cách 1: Đọc thẳng từ file tiki_books_data.js (nhanh nhất)
    with open("tiki_books_data.js", "r", encoding="utf-8") as f:
        content = f.read()
        # Cắt lấy phần mảng JSON
        json_str = content.split("window.TIKI_BOOKS_DATA = ")[1].split(";")[0]
        records = json.loads(json_str)

    if records:
        collection.insert_many(records)
        print(f"✅ Đã đẩy thành công {len(records)} cuốn sách lên MongoDB Atlas!")
    else:
        print("❌ Lỗi: Không đọc được dữ liệu.")

if __name__ == "__main__":
    upload_clean_data()