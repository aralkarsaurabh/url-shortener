import test from "node:test";
import assert from "node:assert/strict";
import { createZip, crc32 } from "./zip.ts";

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("the zip has the right records for each file", () => {
  const zip = createZip([
    { name: "a/one.txt", data: new TextEncoder().encode("hello") },
    { name: "two.txt", data: new Uint8Array([1, 2, 3]) },
  ]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50); // first local header
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50); // end of central directory
  assert.equal(view.getUint16(end + 10, true), 2); // two files listed
  const centralStart = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(centralStart, true), 0x02014b50);
});
