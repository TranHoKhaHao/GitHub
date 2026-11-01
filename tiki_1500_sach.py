import asyncio
import csv
import re
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

CATEGORY_URLS = [
    "https://tiki.vn/nha-sach-tiki/c8322",
    "https://tiki.vn/sach-truyen-tieng-viet/c1883",
    "https://tiki.vn/sach-tieng-anh/c320",
    
]
OUTPUT_CSV = "tiki_1500_sach.csv"
MAX_PRODUCTS = 1500
MAX_LOAD_MORE_CLICKS_PER_CATEGORY = 50
PAUSE_SECONDS = 3.0


def product_id_from_url(url: str) -> str:
    match = re.search(r"-p(\d+)", url)
    if match:
        return match.group(1)
    try:
        query = parse_qs(urlparse(url).query)
        for key in ("spid", "id", "product_id"):
            if query.get(key):
                return query[key][0]
    except Exception:
        pass
    return ""


async def collect_visible_products(page, category_label: str):
    return await page.evaluate(
        """(categoryLabel) => {
          const output = [];
          const seen = new Set();
          
          // Quét tất cả các khối sản phẩm hoặc các thẻ a có chứa -p trên trang
          const elements = Array.from(document.querySelectorAll('a[href*="-p"]'));

          for (const el of elements) {
            const href = el.href || "";
            if (!href.includes("tiki.vn/") || !/-p\\d+/.test(href)) continue;
            
            const cleanUrl = href.split("?")[0].split("#")[0];
            if (seen.has(cleanUrl)) continue;

            // Lấy khối chứa sản phẩm (card) để bóc tách thông tin chuẩn xác theo layout của Tiki
            let card = el.closest('div[class*="product"], .product-item, div[class*="style__Product"]');
            if (!card) {
                card = el.parentElement?.parentElement || el.parentElement;
            }

            const cardText = card ? (card.innerText || "") : (el.innerText || "");
            const cleanText = cardText.replace(/\\s+/g, " ").trim();

            // Lấy tên sách
            let title = el.getAttribute("title") || "";
            if (!title && card) {
              const img = card.querySelector("img");
              if (img) title = img.getAttribute("alt") || "";
            }
            if (!title) {
              const titleEl = card ? card.querySelector('.name, h3, h4, span[class*="Name"]') : null;
              if (titleEl) title = titleEl.innerText.trim();
            }
            if (!title) {
              const lines = cleanText.split("\\n").map(l => l.trim()).filter(l => l.length > 5);
              title = lines.length > 0 ? lines[0] : "";
            }

            // Lấy giá sản phẩm
            const priceMatch = cleanText.match(/\\d[\\d.\\s]*\\s?₫/);
            const priceDisplay = priceMatch ? priceMatch[0].replace(/\\s+/g, "") : "";

            // Đánh giá và số lượng đã bán
            const ratingMatch = cleanText.match(/([0-5](?:[.,]\\d+)?)\\s*\\/\\s*5/);
            const soldMatch = cleanText.match(/Đã bán\\s*([\\d.,]+)/i);

            if (cleanUrl && title && title.length > 2) {
              seen.add(cleanUrl);
              output.push({
                product_name: title.trim(),
                product_url: cleanUrl,
                category: categoryLabel,
                price_display: priceDisplay,
                rating_display: ratingMatch ? ratingMatch[1] : "",
                sold_display: soldMatch ? soldMatch[1] : "",
                card_text: cleanText
              });
            }
          }
          return output;
        }""",
        category_label,
    )


async def main():
    records_by_url = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled", "--start-maximized"]
        )
        context = await browser.new_context(
            viewport={"width": 1440, "height": 950},
            locale="vi-VN",
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        for category_url in CATEGORY_URLS:
            if len(records_by_url) >= MAX_PRODUCTS:
                break

            label = "Sách tiếng Việt" if "sach-truyen-tieng-viet" in category_url else "Nhà sách Tiki"
            print(f"\nĐang mở danh mục: {category_url}")
            try:
                await page.goto(category_url, wait_until="domcontentloaded", timeout=60000)
                await page.wait_for_timeout(6000)
            except Exception as exc:
                print(f"Không thể mở danh mục: {exc}")
                continue

            last_count = 0
            same_count_iterations = 0

            for step in range(MAX_LOAD_MORE_CLICKS_PER_CATEGORY + 1):
                try:
                    found = await collect_visible_products(page, label)
                except Exception:
                    break

                added = 0
                for item in found:
                    url = item.get("product_url", "")
                    if not url or url in records_by_url:
                        continue
                    item["product_id"] = product_id_from_url(url)
                    records_by_url[url] = item
                    added += 1

                print(f"[{label}] Vòng {step + 1}: Quét thấy {len(found)}, thêm mới {added}, tổng tích lũy: {len(records_by_url)}")

                if len(records_by_url) >= MAX_PRODUCTS or step >= MAX_LOAD_MORE_CLICKS_PER_CATEGORY:
                    break

                # Kiểm tra nếu số lượng sản phẩm quét được không đổi qua nhiều vòng thì tiến hành cuộn mạnh hơn
                if len(found) == last_count:
                    same_count_iterations += 1
                else:
                    same_count_iterations = 0
                    last_count = len(found)

                # Kỹ thuật cuộn trang từng đoạn mô phỏng thao tác người thật kết hợp đẩy scrollHeight để ép Tiki load thêm DOM
                try:
                    await page.evaluate("""
                        window.scrollBy({
                            top: 1500,
                            behavior: 'smooth'
                        });
                    """)
                    await page.wait_for_timeout(int(PAUSE_SECONDS * 1000))
                    
                    # Nếu cuộn mà bị kẹt, ép cuộn xuống hẳn đáy trang
                    if same_count_iterations >= 2:
                        await page.evaluate("window.scrollTo(0, document.body.scrollHeight);")
                        await page.wait_for_timeout(4000)
                        same_count_iterations = 0

                except Exception as e:
                    print(f"Lỗi cuộn trang: {e}")
                    break

        await browser.close()

    rows = list(records_by_url.values())[:MAX_PRODUCTS]
    columns = [
        "product_id", "product_name", "category", "price_display",
        "rating_display", "sold_display", "product_url", "card_text",
    ]
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nHoàn tất! Đã lưu {len(rows)} sản phẩm vào file: {OUTPUT_CSV}")


if __name__ == "__main__":
    asyncio.run(main())