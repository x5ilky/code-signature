import { skap, Logger } from "./SkOutput.ts"
import Parser, { Language, SyntaxNode } from "tree-sitter";
import CppParser from "tree-sitter-cpp";

const cyrb53 = (str: string, seed = 0) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};
function bound(
    node: SDFObject,
    l: number,
    t: number,
    w: number,
    h: number,
    r: number,
): SDFObject {
    const x = (n: number) => n * w + l;
    const y = (n: number) => n * h + t;
    const v = (n: number) => n * r;
    // const v = (n: number) => n;
    switch (node.type) {
        case "circle":
            return {
                type: "circle",
                cx: x(node.cx),
                cy: y(node.cy),
                r: v(node.r),
            };
        case "rect":
            return {
                type: "rect",
                cx: x(node.cx),
                cy: y(node.cy),
                hh: y(node.hh),
                hw: x(node.hw),
            };
        case "union":
            return {
                type: "union",
                a: bound(node.a, l, t, w, h, r),
                b: bound(node.b, l, t, w, h, r),
            };
        case "intersection":
            return {
                type: "intersection",
                a: bound(node.a, l, t, w, h, r),
                b: bound(node.b, l, t, w, h, r),
            };
        case "subtract":
            return {
                type: "subtract",
                a: bound(node.a, l, t, w, h, r),
                b: bound(node.b, l, t, w, h, r),
            };
        case "smoothUnion":
            return {
                type: "smoothUnion",
                k: node.k,
                a: bound(node.a, l, t, w, h, r),
                b: bound(node.b, l, t, w, h, r),
            };
        case "inversion":
            return {
                type: "inversion",
                a: bound(node.a, l, t, w, h, r),
                cx: x(node.cx),
                cy: y(node.cy),
                r: v(node.r),
            };
        case "none":
            return node;
    }
}
function traverseMetaStatement(node: SyntaxNode): SDFObject {
    let op: SDFObject["type"] = "union";
    if (cyrb53(node.type) & 1) {
        op = "union";
    } else {
        op = "subtract";
    }
    if (node.type == "binary_expression") {
        if (cyrb53(node.children[1].type) & 1) {
            op = "smoothUnion";
        } else {
            op = "intersection";
        }
    }
    let object: SDFObject = { type: "none" };

    let dir = "hor";
    if (cyrb53(node.type) & 1) dir = "vert";
    let i = 0, n = node.descendantCount, c = 0;
    for (const child of node.children) {
        if (child.type === "comment") continue;
        let l = 0, t = 0, w = 2, h = 2, r = 1;
        if (dir === "hor") {
            t = 0;
            l = c / n;
            w = child.descendantCount / n;
            h = 1;
        }
        if (dir === "vert") {
            l = 0;
            t = c / n;
            h = child.descendantCount / n;
            w = 1;
        }
        object = {
            type: op,
            a: object,
            b: bound(traverse(child), l, t, w, h, r),
            k: 0.3,
        } as SDFObject;
        i++;
        c += child.descendantCount;
    }
    if (node.type == "if_statement") {
        object = { type: "inversion", a: object, cx: 0, cy: 0, r: 1 };
    }

    return object;
}

const MASK = 0x7fffffff;
function traverse(node: SyntaxNode): SDFObject {
    if (node.type !== "string_literal" && node.children.length > 0) {
        return traverseMetaStatement(node);
    }
    switch (node.type) {
        default: {
            const hash = cyrb53(node.text) & MASK;
            const pos = (hash / MASK - 0.5) * 2;
            const r = (cyrb53(node.text + "radius") & MASK) / MASK;
            return { type: "circle", cx: pos, cy: -pos, r };
        }
        case "number_literal": {
            const hash = cyrb53(parseInt(node.text).toString(24)) & MASK;
            const pos = (hash / MASK - 0.5) * 2;
            const w = (cyrb53(node.text + "width") & MASK) / MASK;
            const h = (cyrb53(node.text + "height") & MASK) / MASK;
            return { type: "rect", cx: pos, cy: -pos, hw: w, hh: h };
        }
        // default:
        //     if (node.children.length > 0) {
        //         return traverseMetaStatement(node);
        //     }
        //     console.log(`unknown node type: ${node.type}`);
        //     /* falls through */
        case ";":
            return { type: "none" };
    }
}

function sdCircle(
    px: number,
    py: number,
    cx: number,
    cy: number,
    r: number,
): number {
    const dx = px - cx;
    const dy = py - cy;
    return Math.hypot(dx, dy) - r;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}
function sdBox(px: number, py: number, bx: number, by: number): number {
    const dx = Math.abs(px) - bx;
    const dy = Math.abs(py) - by;
    const ax = Math.max(dx, 0);
    const ay = Math.max(dy, 0);
    return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0);
}

function opUnion(a: number, b: number): number {
    if (a >= Infinity) return b;
    if (b >= Infinity) return a;
    return Math.min(a, b);
}

function opSubtract(a: number, b: number): number {
    if (a >= Infinity) return Infinity;
    if (b >= Infinity) return a;
    return Math.max(a, -b);
}

function opIntersect(a: number, b: number): number {
    if (a >= Infinity) return b;
    if (b >= Infinity) return a;
    return Math.max(a, b);
}

function clamp(x: number, a: number, b: number): number {
    return Math.max(a, Math.min(b, x));
}

function lerp(a: number, b: number, t: number): number {
    return a * (1 - t) + b * t;
}

function invert(
    x: number,
    y: number,
    v: number,
    cx: number,
    cy: number,
    r: number,
): number {
    const EDGE = 0.1;
    const d = sdCircle(x, y, cx, cy, r);
    if (d < -EDGE) return -v;
    else if (d > EDGE) return v;
    else return lerp(-v, 0, (d + EDGE) / (2 * EDGE));
    // const t = smoothstep(-EDGE, EDGE, d);
    // return lerp(-v, v, t);
}

function smoothUnion(a: number, b: number, k: number): number {
    if (a >= Infinity) return b;
    if (b >= Infinity) return a;

    const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
    return lerp(b, a, h) - k * h * (1 - h);
}

type SDFObject =
    | {
        type: "circle";
        cx: number;
        cy: number;
        r: number;
    }
    | {
        type: "rect";
        cx: number;
        cy: number;
        hw: number;
        hh: number;
    }
    | {
        type: "union" | "intersection" | "subtract";
        a: SDFObject;
        b: SDFObject;
    }
    | {
        type: "smoothUnion";
        a: SDFObject;
        b: SDFObject;
        k: number;
    }
    | {
        type: "inversion";
        a: SDFObject;
        cx: number;
        cy: number;
        r: number;
    }
    | {
        type: "none";
    };

function evaluateSDF(uvx: number, uvy: number, sdf: SDFObject): number {
    switch (sdf.type) {
        case "circle":
            return sdCircle(uvx, uvy, sdf.cx, sdf.cy, sdf.r);
        case "rect":
            return sdBox(uvx - sdf.cx, uvy - sdf.cy, sdf.hw, sdf.hh);
        case "union":
            return opUnion(
                evaluateSDF(uvx, uvy, sdf.a),
                evaluateSDF(uvx, uvy, sdf.b),
            );
        case "intersection":
            return opIntersect(
                evaluateSDF(uvx, uvy, sdf.a),
                evaluateSDF(uvx, uvy, sdf.b),
            );
        case "subtract":
            return opSubtract(
                evaluateSDF(uvx, uvy, sdf.a),
                evaluateSDF(uvx, uvy, sdf.b),
            );
        case "smoothUnion":
            return smoothUnion(
                evaluateSDF(uvx, uvy, sdf.a),
                evaluateSDF(uvx, uvy, sdf.b),
                sdf.k,
            );
        case "inversion":
            return invert(
                uvx,
                uvy,
                evaluateSDF(uvx, uvy, sdf.a),
                sdf.cx,
                sdf.cy,
                sdf.r,
            );
        case "none":
            return Infinity;
    }
}
function centroid(width: number, height: number, sdf: SDFObject) {
    let sx = 0, sy = 0, c = 0, md = 0, maxdist = 0;
    let out = "";
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let uvx = (x + 0.5) / height * 2 - width / height;
            let uvy = (y + 0.5) / height * 2 - 1;
            const d = evaluateSDF(uvx, uvy, sdf);
            if (d < 0) {
                sx += uvx;
                sy += uvy;
                md = Math.max(md, uvx * uvx + uvy * uvy);
                maxdist = Math.max(maxdist, -d);
                c++;
            }
        }
        out += "\n";
    }
    return [sx / c, sy / c, Math.sqrt(md), maxdist];
}

function render(width: number, height: number, sdf: SDFObject, asciiMap: string) {
    let out = "";

    const [dx, dy, scale, md] = centroid(width * 2, height * 2, sdf);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let uvx = (x + 0.5) / height * 2 - width / height;
            let uvy = (y + 0.5) / height * 2 - 1;
            uvx *= 1 / 2;

            uvx = uvx * (scale / 1.3) + dx;
            uvy = uvy * (scale / 1.3) + dy;

            const d = evaluateSDF(uvx, uvy, sdf);

            if (d < 0) {
                const t0 = clamp((-d) / md, 0, 1);
                const t = Math.pow(t0, 0.8); // optional
                const idx = Math.round(
                    t * (asciiMap.length - 1),
                );
                out += asciiMap[idx];
            } else {
                out += " ";
            }
        }
        out += "\n";
    }
    return out;
}

function getOrdinal(n: number) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;

  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
function formatDate(date = new Date()) {
  const year = date.getFullYear();
  const month = date.toLocaleString("en-AU", { month: "long" });
  const day = date.getDate();
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");

  return `${year} (${month} ${getOrdinal(day)}) ${h}:${m}:${s}`;
}

const logger = new Logger({});
const schema = skap.command({
    "file name": skap.positional(0).description("Target file").required(),
    asciiString: skap.string("--ascii-map").description("characters to be used for ascii"),
    grayscaleUnicode: skap.boolean("--grayscale-unicode").description("use grayscale unicode charset <▁▂▃▄▅▆▇█>"),
    smallAscii: skap.boolean("--small-ascii").description("use small ascii charset <..,:-=+*#%@>"),
    footer: skap.string("--footer").description("message below image").default(""),
    includeEditTime: skap.boolean("-e").description("include edit time below signature"),
    height: skap.number("-h").description("height of image").default(20),
    width: skap.number("-w").description("width of image").default(40),
    outputOnly: skap.boolean("-O").description("output signature to stdout")
});
const cmd = schema.parse(Deno.args, {
    customError: (e) => {
        logger.error(e);
        Deno.exit(1);
    }
})

const parser = new Parser();
parser.setLanguage(CppParser as Language);

let STRING = cmd.asciiString ?? " .'`^,:;Il!i~+_-?1)(|\\/tfjrxbkhao*#MW&8%B@$";

if (cmd.grayscaleUnicode)
    STRING = "▁▂▃▄▅▆▇█";
if (cmd.smallAscii)
    STRING = "..,:-=+*#%@";

const sourceCode = Deno.readTextFileSync(cmd["file name"]);
const tree = parser.parse(sourceCode);
const scene = traverse(tree.rootNode);

let output = "";
output += "// begin signature\n"

const HEIGHT = cmd.height, WIDTH = cmd.width;
const r = render(WIDTH, HEIGHT, scene, STRING);

output += "// +";
for (let i = 1; i <= WIDTH; i++)
    output += "-";
output += "+\n";

for (const l of r.split("\n")) {
    if (l.length)
        output += `// |${l}|\n`;
}

output += "// +";
for (let i = 1; i <= WIDTH; i++)
    output += "-";
output += "+\n";

if (cmd.footer) output += `// ${cmd.footer}\n`;
if (cmd.includeEditTime) {
    output += `// ${formatDate()}\n`
}
output += "// end signature\n"

if (cmd.outputOnly) {
    console.log(output);
    Deno.exit(0);
}
const FIND_SIGNATURE_REGEX = /\/\/ begin signature.*?\/\/ end signature/gs
const m = sourceCode.match(FIND_SIGNATURE_REGEX)
let newSourceCode = "";
if (m !== null && m.length > 0) {
    newSourceCode = sourceCode.replace(FIND_SIGNATURE_REGEX, output);
} else {
    newSourceCode = sourceCode + "\n" + output;
}

Deno.writeTextFileSync(cmd["file name"], newSourceCode)
