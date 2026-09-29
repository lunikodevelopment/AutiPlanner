const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** RFC 5545 TEXT escaping. Newlines become the two-character sequence `\\n`. */
export function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(/\r\n|\n|\r/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

/** Inverse of {@link escapeText}. `\\n` and `\\N` both become a newline. */
export function unescapeText(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      out += char ?? "";
      continue;
    }
    const next = value[index + 1];
    if (next === undefined) {
      out += "\\";
      break;
    }
    if (next === "n" || next === "N") out += "\n";
    else if (next === "\\") out += "\\";
    else if (next === ";") out += ";";
    else if (next === ",") out += ",";
    else out += next;
    index += 1;
  }
  return out;
}

/**
 * Splits a TEXT list on unescaped commas, then unescapes each value.
 * Escaped commas stay inside a value.
 */
export function splitEscapedList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\" && index + 1 < value.length) {
      current += char;
      current += value[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (char === ",") {
      parts.push(unescapeText(current));
      current = "";
      continue;
    }
    current += char ?? "";
  }
  parts.push(unescapeText(current));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

export function joinEscapedList(values: readonly string[]): string {
  return values.map((value) => escapeText(value)).join(",");
}

/**
 * Folds a content line at 75 octets. Continuation lines start with a space.
 * UTF-8 code points are not split.
 */
export function foldContentLine(line: string): string {
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let offset = 0;
  let budget = 75;
  while (offset < bytes.length) {
    let end = Math.min(offset + budget, bytes.length);
    if (end < bytes.length) {
      while (end > offset && isContinuationByte(bytes[end])) end -= 1;
      if (end === offset) {
        end = Math.min(offset + 1, bytes.length);
        while (end < bytes.length && isContinuationByte(bytes[end])) end += 1;
      }
    }
    chunks.push(decoder.decode(bytes.subarray(offset, end)));
    offset = end;
    budget = 74;
  }
  return chunks.join("\r\n ");
}

/** Removes CRLF/LF folding whitespace. Does not unescape TEXT. */
export function unfoldIcs(input: string): string {
  return input.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll(/\n[ \t]/g, "");
}

function isContinuationByte(value: number | undefined): boolean {
  return value !== undefined && (value & 0xc0) === 0x80;
}
