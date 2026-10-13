import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs/promises";
import path from "path";

chromium.use(StealthPlugin());

const TARGET_URL =
  "https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI";
const OUTPUT_FILE = path.join("output", "product.json");

async function scrapeProductPage() {
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  try {
    await page.goto(TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page
      .getByRole("button", { name: /accept|agree|allow/i })
      .click({ timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(3000);

    const productData = await page.evaluate((url) => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.innerText.trim() : null;
      };

      const getNumber = (selector) => {
        const text = getText(selector);
        if (!text) return null;
        const match = text.replace(/,/g, "").match(/[\d.]+/);
        return match ? parseFloat(match[0]) : null;
      };

      const metaTitle = document.querySelector(
        'meta[property="og:title"]',
      )?.content;
      const title = metaTitle
        ? metaTitle.replace("- MSI USA", "").trim()
        : getText(".page-title") || getText("h1");
      const brand = "MSI";

      const metaPrice = document.querySelector(
        'meta[property="product:price:amount"]',
      )?.content;
      const parsedMetaPrice = metaPrice ? parseFloat(metaPrice) : null;

      const sale_price =
        parsedMetaPrice ||
        getNumber(
          '.special-price .price, [data-price-type="finalPrice"] .price',
        ) ||
        null;
      const price =
        parsedMetaPrice ||
        getNumber(
          '.old-price .price, [data-price-type="oldPrice"] .price, .product-info-price .price',
        ) ||
        sale_price;

      const categoryTree = [];
      const breadcrumbs = document.querySelectorAll(
        ".breadcrumbs li, .breadcrumb li",
      );
      breadcrumbs.forEach((li) => {
        const a = li.querySelector("a");
        const name = li.innerText.trim();
        if (name && name !== "Home") {
          categoryTree.push({ name: name, url: a ? a.href : null });
        }
      });
      const product_category =
        categoryTree.map((c) => c.name).join(" > ") || null;

      let availability = null;
      const stockText = getText(".stock, .availability")?.toLowerCase() || "";
      const addToCartBtn = document.querySelector(
        "button.tocart, #button-cart",
      );

      if (
        stockText.includes("in stock") ||
        (!stockText && addToCartBtn && !addToCartBtn.disabled)
      ) {
        availability = "in_stock";
      } else if (stockText.includes("out of stock")) {
        availability = "out_of_stock";
      } else if (stockText.includes("pre-order")) {
        availability = "pre_order";
      }

      const image_url =
        document.querySelector('meta[property="og:image"]')?.content ||
        document.querySelector(
          ".product-image-main img, .gallery-placeholder img, .fotorama__img",
        )?.src ||
        null;

      const additionalImagesSet = new Set();
      document
        .querySelectorAll(
          ".product-image-thumbnail img, .gallery img, .fotorama__nav__frame img",
        )
        .forEach((img) => {
          if (img.src && img.src !== image_url && !img.src.includes("loader")) {
            additionalImagesSet.add(img.src);
          }
        });
      const additional_image_urls = Array.from(additionalImagesSet);

      const specs = [];
      const specRows = document.querySelectorAll(
        "#product-attribute-specs-table tr, table.table tr",
      );
      specRows.forEach((row) => {
        const name = row.querySelector("th, .label")?.innerText.trim();
        const value = row.querySelector("td, .data")?.innerText.trim();
        if (name && value) {
          specs.push({ name, value });
        }
      });

      const description =
        getText(".product.attribute.description, #description") || null;
      const item_id =
        document.querySelector('input[name="product"]')?.value || null;
      const mpn =
        document.querySelector('div[itemprop="sku"]')?.innerText.trim() ||
        getText(".sku .value") ||
        null;

      const star_rating = getNumber(".rating-result") || null;
      const review_count = getNumber(".reviews-actions .action.view") || null;

      return {
        url,
        item_id,
        title,
        brand,
        product_category,
        category_tree: categoryTree,
        description,
        price,
        sale_price,
        availability,
        image_url,
        additional_image_urls,
        specs,
        star_rating,
        review_count,
        gtin: null,
        mpn,
      };
    }, TARGET_URL);

    productData.scraped_at = new Date().toISOString();

    await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    await fs.writeFile(
      OUTPUT_FILE,
      JSON.stringify(productData, null, 2),
      "utf-8",
    );
  } catch (error) {
    console.error(error);
  } finally {
    await browser.close();
  }
}

scrapeProductPage();
