import test from "node:test";
import assert from "node:assert/strict";
import { parseDelimited, runOffline, type OfflineDataset } from "../src/offline.ts";

function table(ds: OfflineDataset, module: string, params: any) {
  return runOffline(ds, module, params).blocks.find((b: any) => b.type === "table");
}
const simple: OfflineDataset = {
  id: -1, name: "test", n_rows: 6, n_cols: 3, source_format: "csv",
  columns: ["value", "group", "paired"],
  rows: [[1,"A",4],[2,"A",5],[3,"A",6],[4,"B",3],[5,"B",2],[6,"B",1]],
};

test("Student t test uses t-distribution tail probabilities", () => {
  const t = table(simple, "ttest_one", { variable: "value", testvalue: 3.5 });
  assert.ok(Math.abs(t.rows[0][4] - 1) < 1e-10);
  const tDs: OfflineDataset = { ...simple, columns: ["x"], rows: [[1],[2],[3]], n_rows: 3, n_cols: 1 };
  const nonzero = table(tDs, "ttest_one", { variable: "x", testvalue: 0 });
  assert.ok(Math.abs(nonzero.rows[0][4] - 0.0741799) < 1e-6);
  const paired = table(simple, "ttest_paired", { v1: "value", v2: "paired" });
  assert.ok(paired.rows[0][5] >= 0 && paired.rows[0][5] <= 1);
});

test("Mann-Whitney and Wilcoxon calculate rank statistics", () => {
  const mw = table(simple, "mannwhitney", { variable: "value", group: "group" });
  assert.equal(mw.rows[0][2], 0);
  assert.ok(mw.rows[0][5] > 0 && mw.rows[0][5] < 1);
  const paired: OfflineDataset = { ...simple, columns: ["before", "after"], rows: [[1,0],[2,0],[3,0]], n_cols: 2, n_rows: 3 };
  const w = table(paired, "wilcoxon", { v1: "before", v2: "after" });
  assert.equal(w.rows[0][1], 6);
});

test("ANOVA and Kruskal-Wallis use their own statistics", () => {
  const anovaDs: OfflineDataset = { ...simple, rows: [[1,"A",0],[2,"A",0],[3,"B",0],[4,"B",0]], n_rows: 4 };
  const a = table(anovaDs, "anova", { variable: "value", group: "group" });
  assert.equal(a.rows[0][2], 8);
  assert.ok(Math.abs(a.rows[0][5] - 0.105572809) < 1e-6);
  const kw = table(anovaDs, "kruskal", { variable: "value", group: "group" });
  assert.equal(kw.rows[0][2], 2.4);
});

test("ROC gives tied scores half credit and compares every chosen score", () => {
  const ds: OfflineDataset = { ...simple, columns: ["outcome","score1","score2"], rows: [[0,1,0],[1,1,1]], n_cols: 3, n_rows: 2 };
  const t = table(ds, "roc", { y: "outcome", score_vars: ["score1","score2"] });
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0][2], 0.5);
  assert.equal(t.rows[1][2], 1);
});

test("CSV import keeps quoted commas/newlines and pads short rows", () => {
  const ds = parseDelimited('name,note,value\nA,"first, line\nsecond line",1\nB,only-name', "quoted");
  assert.equal(ds.rows[0][1], "first, line\nsecond line");
  assert.equal(ds.rows[1][2], null);
});

