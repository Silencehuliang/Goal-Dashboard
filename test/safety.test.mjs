/**
 * Guards that exist because an earlier version of this plugin took the DSH
 * desktop GUI down. Read README "为什么没有浏览器半边" before changing any of
 * these — each assertion encodes a real, observed failure.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = join(import.meta.dirname, "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const pkg = () => JSON.parse(read("package.json"));

const SOURCE_FILES = ["index.js", "lib/model.js", "lib/store.js", "lib/skills.js", "lib/board.js"];

test("package.json declares no dsh.client", () => {
  const manifest = pkg();
  assert.equal(
    manifest.dsh?.client,
    undefined,
    "declaring dsh.client makes the host load a browser bundle from this package; " +
      "if that entry fails to activate the whole DSH web boot aborts",
  );
});

test("package.json declares the bundle patch", () => {
  const manifest = pkg();
  assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
});

test("package.json has no prepare/prepack/publish-time build script", () => {
  const scripts = pkg().scripts ?? {};
  for (const key of ["prepare", "prepack", "prepublish", "prepublishOnly"]) {
    assert.equal(
      scripts[key],
      undefined,
      `a "${key}" script makes git installs fail with ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED ` +
        "until every user adds the package to pnpm's allowBuilds",
    );
  }
});

test("package.json has zero runtime dependencies", () => {
  assert.deepEqual(
    pkg().dependencies ?? {},
    {},
    "any dependency is code executed at install time; this plugin needs none",
  );
});

test("no source file imports a @deepseek-ai runtime package", () => {
  for (const file of SOURCE_FILES) {
    const src = read(file);
    assert.doesNotMatch(
      src,
      /^\s*(import|export)[^;\n]*from\s+["']@deepseek-ai\//m,
      `${file} must not import @deepseek-ai/*: a moved host package would stop the plugin loading`,
    );
    assert.doesNotMatch(
      src,
      /require\(\s*["']@deepseek-ai\//,
      `${file} must not require @deepseek-ai/*`,
    );
  }
});

test("cordis.patch.yml inserts exactly one row, named after the package", () => {
  const yml = read("cordis.patch.yml");
  const names = [...yml.matchAll(/^\s+name:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  const ids = [...yml.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  assert.equal(names.length, 1, "exactly one plugin row");
  assert.equal(names[0], pkg().name, "the row references the package by its npm name");
  assert.equal(ids.length, 1);
  assert.equal(ids[0], "goal-dashboard");
  assert.doesNotMatch(yml, /^\s+client:/m, "the bundle layer must not configure a client half");
});

test("entry exports the documented plugin surface", async () => {
  const mod = await import(pathToFileURL(join(repoRoot, "index.js")).href);
  assert.equal(typeof mod.name, "string");
  assert.deepEqual(mod.inject, ["tools"]);
  assert.equal(typeof mod.apply, "function");
  assert.equal(
    mod.default,
    undefined,
    "a default export makes the loader collapse the module and lose `inject`",
  );
});

test("declared tool names are unique, prefixed, and strictly typed", async () => {
  const { apply } = await import(pathToFileURL(join(repoRoot, "index.js")).href);
  const registered = [];
  const ctx = {
    get: () => undefined,
    effect: (fn) => fn(),
    tools: { register: (def) => { registered.push(def); return () => {}; }, get: () => ({}) },
  };
  apply(ctx, {});
  assert.ok(registered.length >= 10, `expected a full tool set, got ${registered.length}`);
  const names = registered.map((d) => d.name);
  assert.equal(new Set(names).size, names.length, "tool names must be unique");
  for (const def of registered) {
    assert.match(def.name, /^board_[a-z_]+$/, `${def.name} must be namespaced board_*`);
    assert.equal(typeof def.description, "string");
    assert.ok(def.description.length > 0, `${def.name} needs a description`);
    assert.equal(def.parameters?.type, "object");
    assert.equal(def.parameters?.additionalProperties, false, `${def.name} must reject unknown params`);
    assert.ok(Array.isArray(def.parameters?.required), `${def.name} must declare required[]`);
    for (const key of def.parameters.required) {
      assert.ok(def.parameters.properties?.[key], `${def.name} requires undeclared param ${key}`);
    }
    assert.equal(typeof def.execute, "function");
    assert.equal(def.output?.schema?.type, "object");
    assert.equal(typeof def.output?.render, "function");
  }
});
