import { describe, expect, it } from "vitest";
import { corpoParaFetch } from "./erp-api-bridge-corpo";

describe("corpoParaFetch", () => {
  it("204/205/304 saem sem corpo (Fetch rejeita body nesses status)", () => {
    const bytes = new Uint8Array([1]);
    expect(corpoParaFetch(204, bytes)).toBeNull();
    expect(corpoParaFetch(205, bytes)).toBeNull();
    expect(corpoParaFetch(304, bytes)).toBeNull();
    expect(corpoParaFetch(204, new Uint8Array(0))).toBeNull();
  });

  it("200/404 mantêm o payload", () => {
    const bytes = new Uint8Array([9, 8]);
    expect(corpoParaFetch(200, bytes)).toEqual(bytes);
    expect(corpoParaFetch(404, Buffer.from([1]))).toEqual(new Uint8Array([1]));
  });

  it("Response aceita 204 só com body null", () => {
    expect(() => new Response(null, { status: 204 })).not.toThrow();
    expect(() => new Response(new Uint8Array(0), { status: 204 })).toThrow(/204/);
  });
});
