const fs = require("node:fs");
const process = require("node:process");

for (const file of process.argv.slice(2)) {
    const source = fs.readFileSync(file, "utf8");
    const normalized = source.replace(/[ \t]+(?=\r?$)/gm, whitespace =>
        [...whitespace].map(character => character === "\t" ? "\\t" : "\\x20").join(""),
    );
    fs.writeFileSync(file, normalized);
}
