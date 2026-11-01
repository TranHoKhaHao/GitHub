import asyncio
import csv
import os
from playwright.async_api import async_playwright

INPUT_LIST_CSV = "tiki_1500_sach.csv"       
OUTPUT_DETAIL_CSV = "tiki_sach_chi_tiet.csv" 
MAX_TO_SCRAPE = 1420                       

async def scrape_product_detail(page, url):
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(3000)  

        detail_data = await page.evaluate("""() => {
            const getCleanText = (selector) => {
                const el = document.querySelector(selector);
                return el ? el.innerText.trim() : "";
            };

            // 1. Tên sách
            const title = getCleanText('h1') || getCleanText('.title');

            // 2. Danh mục / Thể loại (Giữ chuỗi phân cấp nhưng loại bỏ hoàn toàn các mục lặp trùng nhau)
            let category = "";
            const breadcrumbEls = document.querySelectorAll('div.breadcrumb a, ul.breadcrumb li a, div[class*="Breadcrumb"] a, div[class*="breadcrumb"] span, nav[aria-label="breadcrumb"] a');
            
            if (breadcrumbEls.length > 0) {
                let crumbs = Array.from(breadcrumbEls)
                    .map(el => el.innerText.trim())
                    .filter(text => text && text !== "Trang chủ" && !text.includes(document.querySelector('h1')?.innerText || ""));
                
                // Lọc bỏ các mục bị lặp liền kề nhau
                crumbs = crumbs.filter((item, index) => item !== crumbs[index - 1]);
                
                // Giữ lại toàn bộ chuỗi phân cấp sạch sẽ
                category = crumbs.join(" > ");
            }

            // Fallback dự phòng nếu breadcrumb không khớp
            if (!category) {
                const allLinks = document.querySelectorAll('a');
                const catList = [];
                for (const a of allLinks) {
                    const text = a.innerText.trim();
                    if ((text.includes("Sách") || text.includes("Nhà Sách")) && a.href.includes("/c")) {
                        catList.push(text);
                    }
                }
                // Lọc trùng cho phần fallback
                const uniqueCats = catList.filter((item, index) => item !== catList[index - 1]);
                if (uniqueCats.length > 0) {
                    category = uniqueCats.join(" > ");
                }
            }

            // 3. Tác giả
            let author = "";
            const authorEl = document.querySelector('h3 ~ div, div[class*="Author"], a[class*="author"], span.author');
            if (authorEl) {
                author = authorEl.innerText.trim();
            } else {
                const bodyText = document.body.innerText;
                const authorMatch = bodyText.match(/Tác giả:\\s*([^\\n]+)/i);
                if (authorMatch) author = authorMatch[1].trim();
            }

            // 4. Giá hiện tại
            const price = getCleanText('.product-price__current-price, div[class*="ProductPrice"]');

            // 5. Giá gốc
            const originalPrice = getCleanText('.product-price__original-price, span[class*="OriginalPrice"]');

            // 6. Tỷ lệ giảm giá
            const discount = getCleanText('.product-price__discount-rate, span[class*="DiscountRate"]');

            // 7. Điểm đánh giá (Rating)
            let rating = "";
            const ratingEls = document.querySelectorAll('span[class*="rating"], div[class*="rating"], .number, span[style*="color"]');
            for (const el of ratingEls) {
                const text = el.innerText.trim();
                if (/^[1-5][.,]\\d$/.test(text)) {
                    rating = text;
                    break;
                }
            }
            if (!rating) {
                const bodyText = document.body.innerText;
                const match = bodyText.match(/\\b([1-5][.,]\\d)\\s*(?:\\/\\s*5)?\\b/);
                if (match) rating = match[1];
            }

            // 8. Số lượng đánh giá
            let reviewCount = "";
            const bodyTextAll = document.body.innerText;
            const reviewMatch = bodyTextAll.match(/\\((\\d+)\\s*(?:đánh giá|nhận xét)?\\)/i);
            if (reviewMatch) {
                reviewCount = reviewMatch[1];
            }

            return {
                title: title,
                category: category,
                author: author,
                price: price,
                original_price: originalPrice,
                discount_rate: discount,
                rating: rating,
                review_count: reviewCount
            };
        }""")
        
        return detail_data

    except Exception as e:
        print(f"Lỗi khi cào URL {url}: {e}")
        return None

async def main():
    urls_to_scrape = []
    if os.path.exists(INPUT_LIST_CSV):
        with open(INPUT_LIST_CSV, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                url = row.get("product_url", "").strip()
                cat = row.get("category", "").strip()
                if url:
                    urls_to_scrape.append({"url": url, "category": cat})
    else:
        print(f"Không tìm thấy file {INPUT_LIST_CSV}. Hãy kiểm tra lại tên file đầu vào!")
        return

    print(f"Đã đọc thành công {len(urls_to_scrape)} đường dẫn từ file {INPUT_LIST_CSV}.")
    target_items = urls_to_scrape[:MAX_TO_SCRAPE]

    detail_columns = [
        "product_url", "title", "category", "author", "price", 
        "original_price", "discount_rate", "rating", "review_count"
    ]
    
    with open(OUTPUT_DETAIL_CSV, mode="w", newline="", encoding="utf-8-sig") as out_file:
        writer = csv.DictWriter(out_file, fieldnames=detail_columns)
        writer.writeheader()

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=False,  # Để False để quan sát trực tiếp trình duyệt chạy
                args=["--disable-blink-features=AutomationControlled"]
            )
            context = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            page = await context.new_page()

            for index, item in enumerate(target_items, 1):
                url = item["url"]
                fallback_category = item["category"]
                
                print(f"Đang cào chi tiết [{index}/{len(target_items)}]: {url}")
                data = await scrape_product_detail(page, url)
                
                if data:
                    if not data.get("category") and fallback_category:
                        data["category"] = fallback_category
                        
                    row_data = {"product_url": url, **data}
                    writer.writerow(row_data)
                    out_file.flush()  # Lưu trực tiếp xuống file CSV ngay lập tức tránh mất dữ liệu
                
                await page.wait_for_timeout(3000)  # Nghỉ 3 giây giữa các request

            await browser.close()

    print(f"\n Hoàn tất cào chi tiết! Dữ liệu đã được lưu tại file: {OUTPUT_DETAIL_CSV}")

if __name__ == "__main__":
    asyncio.run(main())