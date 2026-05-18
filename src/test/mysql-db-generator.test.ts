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
});
