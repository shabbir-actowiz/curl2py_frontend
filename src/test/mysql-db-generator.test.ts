import { describe, expect, it } from "vitest";
import { generateMysqlDbCode } from "@/pages/Index";

const productJson = {
  pincode: "380015",
  locality: "Memnagar , 380015",
  city: "Ahmedabad",
  sku: 1,
  url: "https://www.milkbasket.com/product/1",
  product_name: "Amul Full Cream Milk Pouch",
  brand: "N/A",
  stock_avaliblity_status: "yes",
  EAN_code: "N/A",
  type: 1,
  kind: 1,
  badge: 0,
  category: {
    id: 49,
    name: "Milk",
    sub_category: "Fresh Milk",
    sub_category_type: "",
    type_id: "",
  },
  delivery_slots: ["5:00-7:00"],
  plus_one_eligible: false,
  availability: {
    in_stock: true,
    max_quantity: 10,
    schedule_available: true,
    cut_off_time: "12:00 AM",
  },
  image_url: "https://file.milkbasket.com/products/1_0_1705487117.jpeg",
  has_video: false,
  weight_text: "500 ML",
  pricing: {
    currency: "Rs",
    mrp: 35,
    selling_price: 35,
    mbeyond_price: 35,
    discount_amount: 0,
    discount_percent: 0,
    deal_discount_percent: 0,
    savings: 0,
  },
  offers_count: 0,
  offers_label: "",
};

describe("MySQL DB generator", () => {
  it("preserves pasted JSON arrays as JSON columns without index-map objects", () => {
    const source = `{
      "b_id": [9379993],
      "b_bid_number": ["GEM/2026/R/672917"],
      "nested": [{"x": [1, 2, 3]}]
    }`;
    const result = generateMysqlDbCode(source, "data");

    expect(result.error).toBeNull();
    expect(result.sourceJson).toBe(source.trim());
    expect(JSON.parse(result.sourceJson).b_id).toEqual([9379993]);
    expect(result.code).toContain("b_id JSON,");
    expect(result.code).toContain("b_bid_number JSON,");
    expect(result.code).toContain("nested JSON,");
    expect(result.code).toContain("json.dumps(json_dict.get('b_id')) if json_dict.get('b_id') else None");
    expect(result.sourceJson).not.toMatch(/"b_id"\s*:\s*\{\s*"0"\s*:/);
    expect(result.code).not.toContain('"0": 9379993');
  });

  it("generates generic insert functions and JSON columns from product output", () => {
    const result = generateMysqlDbCode(JSON.stringify(productJson), "products");

    expect(result.error).toBeNull();
    expect(result.code).toContain("import mysql.connector");
    expect(result.code).toContain("from mysql.connector import Error");
    expect(result.code).toContain("TABLE_NAME = f\"products_{datetime.now().strftime('%Y_%m_%d')}\"");
    expect(result.code).toContain("def insert_data(json_dict):");
    expect(result.code).toContain("def insert_multiple_data(json_list):");
    expect(result.code).toContain("for json_dict in json_list:");
    expect(result.code).not.toContain("product_json");
    expect(result.code).not.toContain("products_json");
    expect(result.code).not.toContain("products_json_list");
    expect(result.code).toContain("category JSON,");
    expect(result.code).toContain("delivery_slots JSON,");
    expect(result.code).toContain("availability JSON,");
    expect(result.code).toContain("pricing JSON,");
    expect(result.code).toContain("json_dict.get('product_name')");
    expect(result.code).toContain("json.dumps(json_dict.get('category')) if json_dict.get('category') else None");
    expect(result.code).toContain("json.dumps(json_dict.get('delivery_slots')) if json_dict.get('delivery_slots') else None");
    expect(result.code).toContain("product_url VARCHAR(255),");
  });

  it("infers schema from every object in an array", () => {
    const result = generateMysqlDbCode(JSON.stringify([{ a: 1 }, { b: true, nested: { ok: true } }]), "data");

    expect(result.error).toBeNull();
    expect(result.code).toContain("a INT,");
    expect(result.code).toContain("b BOOLEAN,");
    expect(result.code).toContain("nested JSON");
    expect(result.code).toContain("json_dict.get('a')");
    expect(result.code).toContain("json_dict.get('b')");
  });

  it("reports invalid JSON inline instead of generating code", () => {
    const result = generateMysqlDbCode("{bad", "data");

    expect(result.code).toBe("");
    expect(result.error).toContain("Invalid JSON for DB code generation");
  });

  it("uses root object keys when nested list contains objects", () => {
    const result = generateMysqlDbCode(JSON.stringify({
      product_id: "ARDEUATWFCHDWHZR",
      product_title: "Soft Drink PET Bottle (2.25 L PET Bottle)",
      brand: "MiRiNDA",
      images: ["url1", "url2"],
      variants: [
        {
          name: "300 ml Tin",
          unit_price: null,
          product_id: "ARDHFBC4FGZWGPQW",
          content_title: "300 ml Tin",
          is_in_stock: false,
        },
      ],
    }), "products");

    expect(result.error).toBeNull();
    expect(result.code).toContain("product_id VARCHAR(255),");
    expect(result.code).toContain("product_title VARCHAR(255),");
    expect(result.code).toContain("brand VARCHAR(255),");
    expect(result.code).toContain("images JSON,");
    expect(result.code).toContain("variants JSON,");
    expect(result.code).not.toContain("name VARCHAR");
    expect(result.code).not.toContain("unit_price");
    expect(result.code).not.toContain("content_title");
    expect(result.code).not.toContain("is_in_stock");
    expect(result.code).toContain("json.dumps(json_dict.get('variants')) if json_dict.get('variants') else None");
  });

  it("uses root object keys when nested dict is present", () => {
    const result = generateMysqlDbCode(JSON.stringify({
      product_id: "1",
      brand: "MiRiNDA",
      specifications: { Brand: "MiRiNDA", Quantity: "2.25 L" },
    }), "products");

    expect(result.error).toBeNull();
    expect(result.code).toContain("product_id VARCHAR(255),");
    expect(result.code).toContain("brand VARCHAR(255),");
    expect(result.code).toContain("specifications JSON,");
    expect(result.code).toContain("json.dumps(json_dict.get('specifications')) if json_dict.get('specifications') else None");
  });

  it("keeps root object schema with both nested dict and nested list", () => {
    const result = generateMysqlDbCode(JSON.stringify({
      product_id: "1",
      variants: [{ name: "small" }],
      specifications: { Brand: "MiRiNDA" },
    }), "products");

    expect(result.error).toBeNull();
    expect(result.code).toContain("product_id VARCHAR(255),");
    expect(result.code).toContain("variants JSON,");
    expect(result.code).toContain("specifications JSON,");
    expect(result.code).not.toContain("name VARCHAR");
  });

  it("uses array item top-level keys when root is an array", () => {
    const result = generateMysqlDbCode(JSON.stringify([
      { product_id: "1", variants: [{ name: "small" }] },
      { product_title: "Drink", specifications: { Brand: "MiRiNDA" } },
    ]), "products");

    expect(result.error).toBeNull();
    expect(result.code).toContain("product_id VARCHAR(255),");
    expect(result.code).toContain("product_title VARCHAR(255),");
    expect(result.code).toContain("variants JSON,");
    expect(result.code).toContain("specifications JSON,");
    expect(result.code).not.toContain("name VARCHAR");
  });

  it("does not auto-select a root object items list", () => {
    const result = generateMysqlDbCode(JSON.stringify({
      page: 1,
      items: [{ name: "Variant", unit_price: 10 }],
    }), "data");

    expect(result.error).toBeNull();
    expect(result.code).toContain("page INT,");
    expect(result.code).toContain("items JSON,");
    expect(result.code).not.toContain("name VARCHAR");
    expect(result.code).not.toContain("unit_price");
  });

  it("does not auto-select a root object variants list", () => {
    const result = generateMysqlDbCode(JSON.stringify({
      product_title: "Drink",
      variants: [{ name: "300 ml Tin", is_in_stock: false }],
    }), "products");

    expect(result.error).toBeNull();
    expect(result.code).toContain("product_title VARCHAR(255),");
    expect(result.code).toContain("variants JSON,");
    expect(result.code).not.toContain("is_in_stock");
  });

  it("stores images list of strings as JSON", () => {
    const result = generateMysqlDbCode(JSON.stringify({
      product_id: "1",
      images: ["url1", "url2"],
    }), "products");

    expect(result.error).toBeNull();
    expect(result.code).toContain("images JSON,");
  });

  it("stores specifications dict as JSON", () => {
    const result = generateMysqlDbCode(JSON.stringify({
      product_id: "1",
      specifications: { Brand: "MiRiNDA" },
    }), "products");

    expect(result.error).toBeNull();
    expect(result.code).toContain("specifications JSON,");
  });

  it("returns a clear error for empty root arrays", () => {
    const result = generateMysqlDbCode("[]", "data");

    expect(result.code).toBe("");
    expect(result.error).toBe("Cannot infer schema from empty array.");
  });

  it("unions mixed array object keys and uses get for missing values", () => {
    const result = generateMysqlDbCode(JSON.stringify([
      { product_id: "1", mrp: 10 },
      { product_title: "Drink", rating: 4.5 },
    ]), "products");

    expect(result.error).toBeNull();
    expect(result.code).toContain("product_id VARCHAR(255),");
    expect(result.code).toContain("mrp INT,");
    expect(result.code).toContain("product_title VARCHAR(255),");
    expect(result.code).toContain("rating DECIMAL(10,2),");
    expect(result.code).toContain("json_dict.get('product_id')");
    expect(result.code).toContain("json_dict.get('product_title')");
  });

  it("keeps null-only fields as TEXT NULL but infers from other records", () => {
    const result = generateMysqlDbCode(JSON.stringify([
      { unit_price: null, note: null },
      { unit_price: 25 },
    ]), "data");

    expect(result.error).toBeNull();
    expect(result.code).toContain("unit_price INT,");
    expect(result.code).toContain("note TEXT NULL,");
  });

  it("generates the expected Flipkart product root schema", () => {
    const result = generateMysqlDbCode(JSON.stringify({
      product_id: "ARDEUATWFCHDWHZR",
      product_title: "Soft Drink PET Bottle (2.25 L PET Bottle)",
      brand: "MiRiNDA",
      category: "Soft Drinks",
      sub_category: "Cola & Soft Drinks",
      super_category: "Beverages",
      vertical: "soft_drink",
      mrp: 120,
      selling_price: 99,
      discount_percentage: "17%",
      xtrasaver_price: 95,
      xtrasaver_savings: "4",
      offer_text: "Special price",
      rating: 4.5,
      review_count: 1234,
      expiry_date: "2026-08-01",
      prescription_required: "No",
      share_text: "A".repeat(300),
      share_url: "https://www.flipkart.com/" + "x".repeat(260),
      images: ["url1", "url2"],
      variants: [{ name: "300 ml Tin", unit_price: null, product_id: "ARDHFBC4FGZWGPQW", content_title: "300 ml Tin", is_in_stock: false }],
      specifications: { Brand: "MiRiNDA", Quantity: "2.25 L" },
    }), "products");

    expect(result.error).toBeNull();
    [
      "product_id VARCHAR(255),",
      "product_title VARCHAR(255),",
      "brand VARCHAR(255),",
      "category VARCHAR(255),",
      "sub_category VARCHAR(255),",
      "super_category VARCHAR(255),",
      "vertical VARCHAR(255),",
      "mrp INT,",
      "selling_price INT,",
      "discount_percentage VARCHAR(255),",
      "xtrasaver_price INT,",
      "xtrasaver_savings VARCHAR(255),",
      "offer_text VARCHAR(255),",
      "rating DECIMAL(10,2),",
      "review_count INT,",
      "expiry_date VARCHAR(255),",
      "prescription_required VARCHAR(255),",
      "share_text TEXT,",
      "share_url TEXT,",
      "images JSON,",
      "variants JSON,",
      "specifications JSON,",
      "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    ].forEach((line) => expect(result.code).toContain(line));

    [
      "json_dict.get('product_id'),",
      "json_dict.get('product_title'),",
      "json_dict.get('brand'),",
      "json_dict.get('category'),",
      "json_dict.get('sub_category'),",
      "json_dict.get('super_category'),",
      "json_dict.get('vertical'),",
      "json_dict.get('mrp'),",
      "json_dict.get('selling_price'),",
      "json_dict.get('discount_percentage'),",
      "json_dict.get('xtrasaver_price'),",
      "json_dict.get('xtrasaver_savings'),",
      "json_dict.get('offer_text'),",
      "json_dict.get('rating'),",
      "json_dict.get('review_count'),",
      "json_dict.get('expiry_date'),",
      "json_dict.get('prescription_required'),",
      "json_dict.get('share_text'),",
      "json_dict.get('share_url'),",
      "json.dumps(json_dict.get('images')) if json_dict.get('images') else None,",
      "json.dumps(json_dict.get('variants')) if json_dict.get('variants') else None,",
      "json.dumps(json_dict.get('specifications')) if json_dict.get('specifications') else None",
    ].forEach((line) => expect(result.code).toContain(line));

    expect(result.code).not.toContain("content_title VARCHAR");
    expect(result.code).not.toContain("is_in_stock BOOLEAN");
  });
});
