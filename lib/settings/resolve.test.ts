import { describe, it, expect } from "vitest";
import { coerceSetting, resolveSetting } from "./resolve";

describe("coerceSetting", () => {
  it("coerces numbers and rejects non-numbers", () => {
    expect(coerceSetting("number", "42")).toEqual({ ok: true, value: 42 });
    expect(coerceSetting("number", "abc")).toEqual({ ok: false });
  });
  it("coerces booleans from common truthy/falsy strings", () => {
    expect(coerceSetting("boolean", "true")).toEqual({ ok: true, value: true });
    expect(coerceSetting("boolean", "off")).toEqual({ ok: true, value: false });
    expect(coerceSetting("boolean", "maybe")).toEqual({ ok: false });
  });
  it("splits and trims a list", () => {
    expect(coerceSetting("list", " a , b ,,c ")).toEqual({ ok: true, value: ["a", "b", "c"] });
  });
});

describe("resolveSetting — precedence DB → env → default", () => {
  it("prefers the DB override", () => {
    expect(resolveSetting("number", "10", "20", "30")).toEqual({ value: 10, source: "db" });
  });
  it("falls back to env when no DB value", () => {
    expect(resolveSetting("number", null, "20", "30")).toEqual({ value: 20, source: "env" });
  });
  it("falls back to the built-in default when neither is set", () => {
    expect(resolveSetting("number", null, undefined, "30")).toEqual({ value: 30, source: "default" });
  });
  it("skips a source whose value is invalid for the type", () => {
    // DB has garbage → skip to env
    expect(resolveSetting("number", "abc", "20", "30")).toEqual({ value: 20, source: "env" });
  });
  it("treats an empty-string list DB value as a real (empty) override", () => {
    expect(resolveSetting("list", "", "a,b", "c")).toEqual({ value: [], source: "db" });
  });
});
