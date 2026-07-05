/**
 * SLICE 02 placeholder: a small, hand-picked schema fed wholesale to the model.
 *
 * This is intentionally thin. Slice 03 (two-stage LLM table selection + the
 * AI-bootstrapped table catalog) replaces this with schema retrieval over the
 * real, large existing database. Until then, edit this constant to match a
 * few tables of your actual DB so you can exercise the end-to-end engine.
 */
export const SAMPLE_SCHEMA_DDL = `
CREATE TABLE orders (
  id            INT PRIMARY KEY,
  customer_id   INT,                -- FK -> customers.id
  order_date    DATE,               -- when the order was placed
  status        VARCHAR(20),        -- 'paid' | 'refunded' | 'pending'
  total_amount  DECIMAL(12,2)       -- order total in TWD
);

CREATE TABLE order_items (
  id          INT PRIMARY KEY,
  order_id    INT,                  -- FK -> orders.id
  product_id  INT,                  -- FK -> products.id
  quantity    INT,
  unit_price  DECIMAL(12,2)         -- price per unit in TWD
);

CREATE TABLE products (
  id            INT PRIMARY KEY,
  name          VARCHAR(120),
  category      VARCHAR(60),        -- product line / category
  active        TINYINT(1)
);

CREATE TABLE customers (
  id            INT PRIMARY KEY,
  name          VARCHAR(120),
  region        VARCHAR(60),        -- e.g. 'North' | 'South' | 'East' | 'West'
  signup_date   DATE
);
`.trim();
