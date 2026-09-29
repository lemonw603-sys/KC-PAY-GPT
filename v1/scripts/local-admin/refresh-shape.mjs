#!/usr/bin/env node
// 从生产只读抓一份「形状快照」写回 v1/scripts/local-admin/shape.json（scripts/local-admin.sh refresh-shape 调用）。
// 只经 browser-mvp/scripts/prod-query.sh；每条查询只出聚合（见 shape-queries.mjs 顶部说明）。不写生产。
import { collectSections, prodRunner, SHAPE_PATH, writeShape } from './shape.mjs';
import { summarizeShape } from './summary.mjs';

const started = new Date();
const run = prodRunner();
process.stderr.write('  只读取生产聚合（一条语句、一个一致性读视图）…\n');
const sections = await collectSections((sql, name) => run(sql, name));
const shape = writeShape(sections, { capturedAt: started });
console.log(`已写入 ${SHAPE_PATH}`);
console.log(summarizeShape(shape));
