import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "fonts");

const files = {
  "noto-serif-sc-29-400-normal.woff2": { sha256: "2b99bfe3ebbbee489e29e6e7261bd43911b4fef73f567c40fb046726d6e1fba5", url: "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.0/files/noto-serif-sc-29-400-normal.woff2" },
  "noto-serif-sc-29-700-normal.woff2": { sha256: "8ba2e61b2e2916527b3e0ca3517e56be27cd750e8e091ccb78c18f288974ae73", url: "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.0/files/noto-serif-sc-29-700-normal.woff2" },
  "noto-serif-sc-latin-400-normal.woff2": { sha256: "af0c95a3e897cfab6a319a789f203dc64b8f81574f8113c7d46240db68c8ff8f", url: "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.0/files/noto-serif-sc-latin-400-normal.woff2" },
  "noto-serif-sc-latin-700-normal.woff2": { sha256: "9a95913aa3f827281ad89ec6253bb71be94bb23dc3184ec3462a15acd7ff05e4", url: "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.0/files/noto-serif-sc-latin-700-normal.woff2" },
  "noto-serif-sc-latin-900-normal.woff2": { sha256: "0fbb1a53da43bc99ddd32e9b50f70955433d9f235b81f2c94a9f50206471e2c2", url: "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.0/files/noto-serif-sc-latin-900-normal.woff2" },
  "noto-serif-sc-chinese-simplified-400-normal.woff2": { sha256: "7dd5aea2df4644e916c2eb558bc8ed6ad6d8925c2c8e251fe68f7206da211696", url: "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.0/files/noto-serif-sc-chinese-simplified-400-normal.woff2" },
  "noto-serif-sc-chinese-simplified-700-normal.woff2": { sha256: "7535a804cc83aa0e8f40fdb1170556ad54ea3260e087a368f3ad6ab4bc86ca4f", url: "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.0/files/noto-serif-sc-chinese-simplified-700-normal.woff2" },
  "noto-serif-sc-chinese-simplified-900-normal.woff2": { sha256: "17baa8873d0264c4eaa42fbfc2eee1669dc84e397d36ac1df1fc896924a627d2", url: "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.0/files/noto-serif-sc-chinese-simplified-900-normal.woff2" },
  "unifrakturmaguntia-latin-400-normal.woff2": { sha256: "a467466874b50cd9ffbe10e5caccd9b261f2bc2252bcfa7d160c744ed9da6f15", url: "https://cdn.jsdelivr.net/npm/@fontsource/unifrakturmaguntia@5.3.0/files/unifrakturmaguntia-latin-400-normal.woff2" },
};

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

for (const [name, spec] of Object.entries(files)) {
  const dest = join(root, name);
  try {
    if (sha256(await readFile(dest)) === spec.sha256) continue;
  } catch {
    // The checkout does not have this file yet.
  }
  const response = await fetch(spec.url);
  if (!response.ok) {
    throw new Error(`Failed to download ${name}: ${response.status}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  const got = sha256(buf);
  if (got !== spec.sha256) {
    throw new Error(`Hash mismatch for ${name}: ${got}`);
  }
  await writeFile(dest, buf);
  console.log(`fetched ${name}`);
}
