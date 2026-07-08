import { readFileSync } from 'fs';
import { join } from 'path';

// 手動載入 .env
const envPath = join(process.cwd(), '.env');
const envFile = readFileSync(envPath, 'utf-8');
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=:#]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
});

import { createProvider } from '../lib/llm/factory';
import { resolveSchemaForQuestion } from '../lib/schema/retrieval';

async function testQuery() {
  const question = '給我2026/06的訂單營收TOP10的使用者排行榜';
  
  console.log('=== 測試查詢 ===');
  console.log('問題:', question);
  console.log('\n=== 第一階段：表選擇 ===');
  
  const provider = createProvider();
  const schema = await resolveSchemaForQuestion(question, provider);
  
  console.log('選擇的表:', schema.tables);
  console.log('使用後備 schema?', schema.usedFallback);
  console.log('\n=== 語義規則 ===');
  schema.rules.forEach(r => {
    console.log(`- [${r.scope}] ${r.content.substring(0, 100)}${r.content.length > 100 ? '...' : ''}`);
  });
  console.log('\n=== 表關係 ===');
  schema.relationships.forEach(r => {
    console.log(`- ${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn} (${r.cardinality})`);
  });
  
  console.log('\n=== DDL 片段 ===');
  console.log(schema.ddl.substring(0, 500) + '...');
  
  console.log('\n=== 第二階段：SQL 生成 ===');
  const result = await provider.generateSqlAndChart({
    question,
    schemaDDL: schema.ddl,
    rules: schema.rules,
    relationships: schema.relationships,
  });

  console.log('生成的 SQL:');
  console.log(result.sql);
  console.log('\n圖表類型:', result.chart_spec.chart_type);
  console.log('說明:', result.explanation);
}

testQuery().catch(console.error);
