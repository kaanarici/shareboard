import { describe, expect, test } from "bun:test";
import { sharedRowsToFiles } from "./share-intake-files";

describe("sharedRowsToFiles", () => {
  test("turns stored image blobs into files", async () => {
    const rows = [
      {
        files: [
          {
            blob: new Blob(["image"], { type: "image/png" }),
            name: "capture.png",
            type: "image/png",
            lastModified: 123,
          },
        ],
      },
    ];

    const files = sharedRowsToFiles(rows);

    expect(files).toHaveLength(1);
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0]?.name).toBe("capture.png");
    expect(files[0]?.type).toBe("image/png");
    expect(files[0]?.lastModified).toBe(123);
    expect(await files[0]?.text()).toBe("image");
  });

  test("filters non-image blobs and fills a missing image name", () => {
    const files = sharedRowsToFiles([
      {
        files: [
          { blob: new Blob(["x"], { type: "text/plain" }), name: "note.txt", type: "text/plain" },
          { blob: new Blob(["y"], { type: "image/jpeg" }), name: "", type: "" },
        ],
      },
    ]);

    expect(files.map((file) => ({ name: file.name, type: file.type }))).toEqual([
      { name: "shared-image-1", type: "image/jpeg" },
    ]);
  });
});
