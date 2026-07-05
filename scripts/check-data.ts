import mysql from 'mysql2/promise';

async function checkData() {
  const conn = await mysql.createConnection({
    host: process.env.ANALYTICS_DB_HOST,
    port: Number(process.env.ANALYTICS_DB_PORT || 3306),
    user: process.env.ANALYTICS_DB_USER,
    password: process.env.ANALYTICS_DB_PASSWORD,
    database: process.env.ANALYTICS_DB_DATABASE,
  });

  try {
    console.log('=== 檢查 2026/06 的訂單資料 ===\n');
    
    const [count] = await conn.query(`
      SELECT COUNT(*) as total
      FROM orders
      WHERE YEAR(created_at) = 2026 AND MONTH(created_at) = 6
    `);
    console.log('2026/06 訂單數量:', count);

    console.log('\n=== 訂單日期範圍 ===');
    const [dateRange] = await conn.query(`
      SELECT 
        MIN(created_at) as earliest,
        MAX(created_at) as latest,
        COUNT(*) as total
      FROM orders
    `);
    console.log(dateRange);

    console.log('\n=== 最近的訂單 (前5筆) ===');
    const [recent] = await conn.query(`
      SELECT id, user_id, total, created_at
      FROM orders
      ORDER BY created_at DESC
      LIMIT 5
    `);
    console.log(recent);

    console.log('\n=== 測試完整 JOIN 查詢 (2026/06) ===');
    const [result] = await conn.query(`
      SELECT 
        up.nickname AS user_name,
        SUM(o.total) AS total_revenue,
        COUNT(*) as order_count
      FROM orders o
        JOIN users u ON o.user_id = u.id
        JOIN user_profiles up ON u.id = up.user_id
      WHERE YEAR(o.created_at) = 2026 AND MONTH(o.created_at) = 6
      GROUP BY up.nickname
      ORDER BY total_revenue DESC
      LIMIT 10
    `);
    console.log('結果筆數:', (result as any[]).length);
    console.log(result);

  } finally {
    await conn.end();
  }
}

checkData().catch(console.error);
