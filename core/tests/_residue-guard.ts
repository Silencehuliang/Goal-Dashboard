// g-374 F1/F2 共用**原子写残留检查**（名字无关）——两个套件必须调同一份实现，
// 否则「摘要侧」的判定会退化成自指的局部断言（复核注记：把局部断言改成恒真仍能全绿）。
//
// 为什么不用名字过滤：`core/ops.ts:atomicWrite` 的真实临时名是**同目录**的 `.tmp-<randomUUID()>`
// （`const tmp = join(dir, `.tmp-${randomUUID()}`)`），并**不是** `core/transaction.ts:180` 的
// `<file>.tmp.<pid>`（那条实现服务于另一条写路径）。按名字过滤会随实现改名而空转（恒真）；
// 按「目录清单相等」则任何新出现的半文件（无论叫什么）都会红。
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

/** 目录清单（排序，名字无关）。 */
export function dirEntries(dir: string): string[] {
  return readdirSync(dir).sort();
}

/** 断言目录清单只允许出现 `allowed` 里的新文件、且不删除既有文件。 */
export function assertNoNewEntries(dir: string, before: string[], label: string, allowed: string[] = []): void {
  const after = dirEntries(dir);
  const added = after.filter((n) => !before.includes(n));
  const unexpected = added.filter((n) => !allowed.includes(n));
  assert.deepEqual(
    unexpected, [],
    `${label}：除预期目标（${allowed.join("、") || "无"}）外不得出现任何新文件（半文件/临时残留一律算违规）；实际新增：${added.join("、") || "无"}`,
  );
  const removed = before.filter((n) => !after.includes(n));
  assert.deepEqual(removed, [], `${label}：不得删除既有文件；实际删除：${removed.join("、") || "无"}`);
}
