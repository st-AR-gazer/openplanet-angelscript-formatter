export interface AngelScriptFormatterOptions {
  indentSize: number;
  useTabs: boolean;
  maxBlankLines: number;
  maxLineWidth: number;
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
  spaceAroundOperators: boolean;
  keepPreprocessorColumnZero: boolean;
  blankLineBetweenTopLevelDeclarations: boolean;
  argumentWrap: "never" | "auto" | "always";
  chainWrap: "never" | "auto" | "always";
  chainWrapStyle: "leadingDot" | "trailingDot";
  braceStyle: "kr" | "allman";
}

export interface AngelScriptRangeEdit {
  startLine: number;
  endLine: number;
  replacementText: string;
}

export const DEFAULT_FORMATTER_OPTIONS: AngelScriptFormatterOptions = {
  indentSize: 2,
  useTabs: false,
  maxBlankLines: 1,
  maxLineWidth: 120,
  trimTrailingWhitespace: true,
  insertFinalNewline: true,
  spaceAroundOperators: true,
  keepPreprocessorColumnZero: true,
  blankLineBetweenTopLevelDeclarations: true,
  argumentWrap: "auto",
  chainWrap: "auto",
  chainWrapStyle: "leadingDot",
  braceStyle: "kr",
};

type TokenKind =
  | "identifier"
  | "keyword"
  | "number"
  | "string"
  | "lineComment"
  | "blockComment"
  | "preprocessor"
  | "operator"
  | "punctuation"
  | "unknown";

interface Token {
  kind: TokenKind;
  value: string;
  lineBreaksBefore: number;
}

const KEYWORDS = new Set<string>([
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "default",
  "break",
  "continue",
  "return",
  "try",
  "catch",
  "throw",
  "class",
  "interface",
  "enum",
  "namespace",
  "typedef",
  "funcdef",
  "import",
  "from",
  "const",
  "final",
  "override",
  "private",
  "protected",
  "shared",
  "external",
  "abstract",
  "mixin",
  "auto",
  "in",
  "out",
  "inout",
  "get",
  "set",
  "cast",
  "function",
  "super",
  "this",
  "void",
  "bool",
  "int",
  "uint",
  "int8",
  "int16",
  "int32",
  "int64",
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "float",
  "double",
  "string",
  "array",
  "dictionary",
  "true",
  "false",
  "null",
]);

const OPERATOR_WORDS = new Set<string>(["and", "or", "xor", "not", "is"]);

const CONTROL_KEYWORDS_WITH_SPACE_BEFORE_PAREN = new Set<string>([
  "if",
  "for",
  "while",
  "switch",
  "catch",
]);

const TYPE_KEYWORDS = new Set<string>([
  "auto",
  "bool",
  "int",
  "uint",
  "int8",
  "int16",
  "int32",
  "int64",
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "float",
  "double",
  "string",
  "array",
  "dictionary",
  "void"
]);

const DECLARATION_KEYWORDS = new Set<string>([
  "namespace",
  "class",
  "interface",
  "enum",
  "funcdef",
  "typedef",
  "import",
  ...TYPE_KEYWORDS
]);

const PASS_BY_REFERENCE_MODIFIERS = new Set<string>(["in", "out", "inout"]);

const MULTI_CHAR_OPERATORS = [
  ">>>=",
  "<<=",
  ">>=",
  "++",
  "--",
  "==",
  "!=",
  "<=",
  ">=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "&&",
  "||",
  "<<",
  ">>",
  "::",
  "->",
];

const SINGLE_CHAR_PUNCTUATION = new Set(["{", "}", "(", ")", "[", "]", ",", ";", "?", ":", "."]);
const SINGLE_CHAR_OPERATORS = new Set(["=", "+", "-", "*", "/", "%", "<", ">", "!", "~", "&", "|", "^", "@"]);
const PREFIX_UNARY_OPERATORS = new Set(["+", "-", "!", "~", "@", "*", "&", "++", "--", "not"]);
const NO_SPACE_AROUND_OPERATORS = new Set(["::", ".", "->"]);
const formatterDirectivePattern = /^\s*\/\/\s*opfmt-(disable-next-line|disable-start|disable-end|disable|enable)\b/i;

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentifierStart(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
}

function isIdentifierPart(ch: string): boolean {
  return isIdentifierStart(ch) || isDigit(ch);
}

function consumeNewline(text: string, index: number): number {
  if (text[index] === "\r" && text[index + 1] === "\n") return index + 2;
  return index + 1;
}

function consumeQuotedLiteral(text: string, quoteIndex: number): number {
  const quote = text[quoteIndex];
  let i = quoteIndex + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (ch === "\r" || ch === "\n") return i;
    i++;
  }
  return text.length;
}

function consumeNumberLiteral(text: string, start: number): number {
  let i = start;

  if (text[i] === "." && isDigit(text[i + 1] ?? "")) {
    i++;
    while (i < text.length && (isDigit(text[i]) || text[i] === "_")) i++;
  } else if (text[i] === "0" && (text[i + 1] === "x" || text[i + 1] === "X")) {
    i += 2;
    while (i < text.length && /[0-9A-Fa-f_]/.test(text[i])) i++;
  } else if (text[i] === "0" && (text[i + 1] === "b" || text[i + 1] === "B")) {
    i += 2;
    while (i < text.length && /[01_]/.test(text[i])) i++;
  } else {
    while (i < text.length && (isDigit(text[i]) || text[i] === "_")) i++;
    if (text[i] === "." && isDigit(text[i + 1] ?? "")) {
      i++;
      while (i < text.length && (isDigit(text[i]) || text[i] === "_")) i++;
    }
  }

  if (text[i] === "e" || text[i] === "E") {
    let j = i + 1;
    if (text[j] === "+" || text[j] === "-") j++;
    if (isDigit(text[j] ?? "")) {
      i = j + 1;
      while (i < text.length && (isDigit(text[i]) || text[i] === "_")) i++;
    }
  }

  while (i < text.length && /[uUlLfFdD]/.test(text[i])) i++;
  return i;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let lineBreaksBefore = 0;
  let lineStart = true;

  while (i < text.length) {
    const ch = text[i];

    if (ch === " " || ch === "\t" || ch === "\v" || ch === "\f") {
      i++;
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      i = consumeNewline(text, i);
      lineBreaksBefore++;
      lineStart = true;
      continue;
    }

    if (lineStart && ch === "#") {
      let j = i;
      while (j < text.length && text[j] !== "\r" && text[j] !== "\n") j++;
      tokens.push({
        kind: "preprocessor",
        value: text.slice(i, j).trimEnd(),
        lineBreaksBefore,
      });
      lineBreaksBefore = 0;
      lineStart = false;
      i = j;
      continue;
    }

    if (lineStart) lineStart = false;

    if (ch === "/" && text[i + 1] === "/") {
      let j = i + 2;
      while (j < text.length && text[j] !== "\r" && text[j] !== "\n") j++;
      tokens.push({
        kind: "lineComment",
        value: text.slice(i, j).trimEnd(),
        lineBreaksBefore,
      });
      lineBreaksBefore = 0;
      i = j;
      continue;
    }

    if (ch === "/" && text[i + 1] === "*") {
      let j = i + 2;
      while (j < text.length) {
        if (text[j] === "*" && text[j + 1] === "/") {
          j += 2;
          break;
        }
        j++;
      }
      tokens.push({
        kind: "blockComment",
        value: text.slice(i, j),
        lineBreaksBefore,
      });
      lineBreaksBefore = 0;
      i = j;
      continue;
    }

    if (
      (ch === "n" || ch === "f") &&
      text[i + 1] === "\"" &&
      !isIdentifierPart(text[i - 1] ?? "")
    ) {
      const end = consumeQuotedLiteral(text, i + 1);
      tokens.push({
        kind: "string",
        value: text.slice(i, end),
        lineBreaksBefore,
      });
      lineBreaksBefore = 0;
      i = end;
      continue;
    }

    if (ch === "\"" || ch === "'") {
      const end = consumeQuotedLiteral(text, i);
      tokens.push({
        kind: "string",
        value: text.slice(i, end),
        lineBreaksBefore,
      });
      lineBreaksBefore = 0;
      i = end;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(text[i + 1] ?? "") && !isIdentifierPart(text[i - 1] ?? ""))) {
      const end = consumeNumberLiteral(text, i);
      tokens.push({
        kind: "number",
        value: text.slice(i, end),
        lineBreaksBefore,
      });
      lineBreaksBefore = 0;
      i = end;
      continue;
    }

    if (isIdentifierStart(ch)) {
      let j = i + 1;
      while (j < text.length && isIdentifierPart(text[j])) j++;
      const word = text.slice(i, j);
      const kind: TokenKind = OPERATOR_WORDS.has(word)
        ? "operator"
        : KEYWORDS.has(word)
          ? "keyword"
          : "identifier";
      tokens.push({
        kind,
        value: word,
        lineBreaksBefore,
      });
      lineBreaksBefore = 0;
      i = j;
      continue;
    }

    let matchedOperator: string | null = null;
    for (const operator of MULTI_CHAR_OPERATORS) {
      if (text.startsWith(operator, i)) {
        matchedOperator = operator;
        break;
      }
    }
    if (matchedOperator !== null) {
      tokens.push({
        kind: "operator",
        value: matchedOperator,
        lineBreaksBefore,
      });
      lineBreaksBefore = 0;
      i += matchedOperator.length;
      continue;
    }

    if (SINGLE_CHAR_PUNCTUATION.has(ch)) {
      tokens.push({
        kind: "punctuation",
        value: ch,
        lineBreaksBefore,
      });
      lineBreaksBefore = 0;
      i++;
      continue;
    }

    if (SINGLE_CHAR_OPERATORS.has(ch)) {
      tokens.push({
        kind: "operator",
        value: ch,
        lineBreaksBefore,
      });
      lineBreaksBefore = 0;
      i++;
      continue;
    }

    tokens.push({
      kind: "unknown",
      value: ch,
      lineBreaksBefore,
    });
    lineBreaksBefore = 0;
    i++;
  }

  return tokens;
}

function isWordLike(token: Token | null): boolean {
  if (token === null) return false;
  return token.kind === "identifier" || token.kind === "keyword" || token.kind === "number" || token.kind === "string";
}

function isOperatorToken(token: Token | null): boolean {
  return token !== null && token.kind === "operator";
}

function isLikelyTypeToken(token: Token | null): boolean {
  if (token === null) return false;
  if (token.kind === "keyword") return TYPE_KEYWORDS.has(token.value);
  if (token.kind !== "identifier") return false;
  if (token.value.includes("::")) return true;
  return /^[A-Z]/.test(token.value) || TYPE_KEYWORDS.has(token.value);
}

function isLikelyGenericOpenToken(
  previous: Token | null,
  current: Token,
  next: Token | null,
  genericDepth: number,
): boolean {
  if (current.value !== "<") return false;
  if (next === null) return false;
  if (!isLikelyTypeToken(previous) && genericDepth === 0) return false;
  if (previous?.kind === "keyword" && CONTROL_KEYWORDS_WITH_SPACE_BEFORE_PAREN.has(previous.value)) return false;
  if (previous?.value === "return" || previous?.value === "case") return false;
  if (next.value === ">" || next.value === ")" || next.value === ";") return false;
  return isLikelyTypeToken(next) || next.value === "const";
}

function genericCloseCount(token: Token, genericDepth: number): number {
  if (genericDepth <= 0) return 0;
  if (token.value === ">") return 1;
  if (token.value === ">>") return Math.min(2, genericDepth);
  return 0;
}

function isUnaryContext(previous: Token | null): boolean {
  if (previous === null) return true;
  if (isOperatorToken(previous) && previous.value !== "++" && previous.value !== "--") return true;
  return ["(", "[", "{", ",", ";", "?", ":"].includes(previous.value);
}

function isUnaryOperatorToken(token: Token, previous: Token | null): boolean {
  if (!PREFIX_UNARY_OPERATORS.has(token.value)) return false;
  return isUnaryContext(previous);
}

function shouldInsertSpace(
  previous: Token | null,
  current: Token,
  next: Token | null,
  spaceAroundOperators: boolean,
  isUnaryCurrent: boolean,
  previousWasUnary: boolean,
  previousWasGenericOpen: boolean,
  isGenericOpen: boolean,
  genericCloseCountForCurrent: number,
): boolean {
  if (previous === null) return false;
  if (current.kind === "lineComment") return false;
  if (current.value === "," || current.value === ";" || current.value === ")" || current.value === "]" || current.value === "}" || current.value === ".") return false;
  if (previous.value === "(" || previous.value === "[" || previous.value === "{" || previous.value === "." || previous.value === "::") return false;
  if (previous.value === "," || previous.value === ";") return true;
  if (current.value === "::" || current.value === "->") return false;

  if (current.value === "(") {
    return previous.kind === "keyword" && CONTROL_KEYWORDS_WITH_SPACE_BEFORE_PAREN.has(previous.value);
  }

  if (current.value === "[") return false;
  if (current.value === "{") return true;

  if (current.value === ":") {
    if (previous.value === "?") return true;
    if (previous.value === "case" || previous.value === "default") return false;
    return true;
  }

  if (previous.value === "?") return true;
  if (previous.value === ":") return isWordLike(current);

  if (current.value === "?") return true;

  if (previousWasGenericOpen) return false;
  if (isGenericOpen || genericCloseCountForCurrent > 0) return false;
  if (current.value === "@") {
    if (isLikelyTypeToken(previous)) return false;
    if (
      previous !== null &&
      isOperatorToken(previous) &&
      !NO_SPACE_AROUND_OPERATORS.has(previous.value) &&
      previous.value !== "++" &&
      previous.value !== "--"
    ) {
      return spaceAroundOperators && !previousWasUnary;
    }
  }
  if (previous.value === "@") {
    if (isWordLike(current) || current.value === "&") return false;
  }
  if (previous.value === "&" && current.kind === "keyword" && PASS_BY_REFERENCE_MODIFIERS.has(current.value)) {
    return false;
  }
  if (
    current.value === "&" &&
    next?.kind === "keyword" &&
    PASS_BY_REFERENCE_MODIFIERS.has(next.value)
  ) {
    return true;
  }

  if (isOperatorToken(current)) {
    if (!spaceAroundOperators) return false;
    if (NO_SPACE_AROUND_OPERATORS.has(current.value)) return false;
    if (current.value === "++" || current.value === "--") return false;
    if (current.value === "@") return false;
    if (isUnaryCurrent) return false;
    return true;
  }

  if (isOperatorToken(previous)) {
    if (!spaceAroundOperators) return false;
    if (NO_SPACE_AROUND_OPERATORS.has(previous.value)) return false;
    if (previous.value === "++" || previous.value === "--") return false;
    if (previous.value === "@") return false;
    if (previousWasUnary) return false;
    return true;
  }

  if (isWordLike(previous) && isWordLike(current)) return true;
  if (previous.value === ")" && isWordLike(current)) return true;
  if (previous.value === "}" && isWordLike(current)) return true;
  return false;
}

function normalizeOutput(output: string, options: AngelScriptFormatterOptions): string {
  const lines = output.split("\n");
  const normalizedLines: string[] = [];
  let blankRun = 0;

  for (const rawLine of lines) {
    const line = options.trimTrailingWhitespace ? rawLine.replace(/[ \t]+$/g, "") : rawLine;
    const isBlank = line.trim().length === 0;
    if (isBlank) {
      blankRun++;
      if (blankRun <= options.maxBlankLines) normalizedLines.push("");
      continue;
    }
    blankRun = 0;
    normalizedLines.push(line);
  }

  while (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1].trim().length === 0) {
    normalizedLines.pop();
  }

  const joined = normalizedLines.join("\n");
  if (joined.length === 0) return options.insertFinalNewline ? "\n" : "";
  return options.insertFinalNewline ? `${joined}\n` : joined;
}

function countTrailingNewlines(text: string): number {
  let count = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] !== "\n") break;
    count++;
  }
  return count;
}

function isTopLevelDeclarationStart(tokens: Token[], startIndex: number): boolean {
  const first = tokens[startIndex];
  if (first === undefined) return false;
  if (first.kind === "preprocessor") return false;
  if (first.kind === "keyword" && DECLARATION_KEYWORDS.has(first.value)) return true;

  const second = tokens[startIndex + 1];
  const third = tokens[startIndex + 2];
  if (isLikelyTypeToken(first) && second?.kind === "identifier" && third?.value === "(") {
    return true;
  }
  if (first.kind === "identifier" && second?.kind === "identifier" && third?.value === "(") {
    return true;
  }
  return false;
}

function formatAngelScriptCore(
  text: string,
  options: AngelScriptFormatterOptions,
): string {
  if (text.trim().length === 0) {
    return options.insertFinalNewline ? "\n" : "";
  }

  const tokens = tokenize(text);
  const indentUnit = options.useTabs ? "\t" : " ".repeat(options.indentSize);
  let output = "";
  let pendingNewlines = 0;
  let indentLevel = 0;
  let parenDepth = 0;
  let genericDepth = 0;
  const forParenDepths = new Set<number>();
  let pendingForParen = false;
  let previousToken: Token | null = null;
  let previousWasUnary = false;
  let previousWasGenericOpen = false;

  const requestNewlines = (count: number): void => {
    pendingNewlines = Math.max(pendingNewlines, count);
  };

  const flushPendingNewlines = (): void => {
    if (pendingNewlines <= 0) return;
    const trailing = countTrailingNewlines(output);
    const needed = pendingNewlines - trailing;
    if (needed > 0) output += "\n".repeat(needed);
    pendingNewlines = 0;
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const nextToken = index + 1 < tokens.length ? tokens[index + 1] : null;
    const unaryCurrent = isUnaryOperatorToken(token, previousToken);
    const genericOpenCurrent = isLikelyGenericOpenToken(
      previousToken,
      token,
      nextToken,
      genericDepth,
    );
    const genericCloseForCurrent = genericCloseCount(token, genericDepth);

    if (token.lineBreaksBefore > 0) {
      requestNewlines(Math.min(token.lineBreaksBefore, options.maxBlankLines + 1));
    }

    if (
      token.kind === "preprocessor" &&
      /^(#else|#elif|#endif)\b/.test(token.value.trimStart())
    ) {
      requestNewlines(1);
    }

    if (token.value === "}" && previousToken?.value !== "{") {
      requestNewlines(1);
      indentLevel = Math.max(0, indentLevel - 1);
    }

    if (token.kind === "keyword" && (token.value === "case" || token.value === "default")) {
      requestNewlines(1);
    }

    flushPendingNewlines();

    const atLineStart = output.length === 0 || output.endsWith("\n");
    const tokenIndentLevel =
      token.kind === "keyword" && (token.value === "case" || token.value === "default")
        ? Math.max(0, indentLevel - 1)
        : indentLevel;

    if (atLineStart) {
      if (!(options.keepPreprocessorColumnZero && token.kind === "preprocessor")) {
        output += indentUnit.repeat(tokenIndentLevel);
      }
    } else if (token.kind === "lineComment") {
      output += output.endsWith(" ") ? " " : "  ";
    } else {
      if (
        shouldInsertSpace(
          previousToken,
          token,
          nextToken,
          options.spaceAroundOperators,
          unaryCurrent,
          previousWasUnary,
          previousWasGenericOpen,
          genericOpenCurrent,
          genericCloseForCurrent,
        )
      ) {
        output += " ";
      }
    }

    output += token.kind === "preprocessor" ? token.value.trimStart() : token.value;

    if (genericOpenCurrent) {
      genericDepth += 1;
    }
    if (genericCloseForCurrent > 0) {
      genericDepth = Math.max(0, genericDepth - genericCloseForCurrent);
    }

    if (token.value === "for") pendingForParen = true;

    if (token.value === "(") {
      parenDepth++;
      if (pendingForParen) {
        forParenDepths.add(parenDepth);
        pendingForParen = false;
      }
    } else if (token.value === ")") {
      if (forParenDepths.has(parenDepth)) forParenDepths.delete(parenDepth);
      parenDepth = Math.max(0, parenDepth - 1);
    }

    if (token.kind === "preprocessor" || token.kind === "lineComment") {
      requestNewlines(1);
    } else if (token.kind === "blockComment" && token.value.includes("\n")) {
      requestNewlines(1);
    } else if (token.value === "{") {
      indentLevel++;
      requestNewlines(1);
    } else if (token.value === "}") {
      const shouldStayInline =
        nextToken !== null &&
        nextToken.kind === "keyword" &&
        (nextToken.value === "else" || nextToken.value === "catch" || nextToken.value === "while");
      if (!shouldStayInline) {
        const shouldAddDeclarationBlankLine =
          options.blankLineBetweenTopLevelDeclarations &&
          indentLevel === 0 &&
          isTopLevelDeclarationStart(tokens, index + 1);
        requestNewlines(shouldAddDeclarationBlankLine ? 2 : 1);
      }
    } else if (token.value === ";") {
      if (!forParenDepths.has(parenDepth)) requestNewlines(1);
    } else if (
      token.value === ":" &&
      previousToken !== null &&
      (previousToken.value === "case" || previousToken.value === "default")
    ) {
      requestNewlines(1);
    }

    previousWasUnary = unaryCurrent;
    previousWasGenericOpen = genericOpenCurrent;
    previousToken = token;
  }

  flushPendingNewlines();
  return normalizeOutput(output, options);
}

export function formatAngelScript(
  text: string,
  partialOptions: Partial<AngelScriptFormatterOptions> = {},
): string {
  const options = buildFormatterOptions(partialOptions);
  if (text.trim().length === 0) {
    return options.insertFinalNewline ? "\n" : "";
  }

  const suppressionState = computeSuppressionState(text);
  const hasSuppressions = suppressionState.some((value) => value === false);
  if (!hasSuppressions) {
    const formatted = formatAngelScriptCore(text, options);
    return applyPostFormattingPasses(formatted, options);
  }

  return formatWithSuppressions(text, suppressionState, options);
}

export function formatAngelScriptRange(
  text: string,
  startLine: number,
  endLine: number,
  partialOptions: Partial<AngelScriptFormatterOptions> = {},
): string {
  const rangeEdit = formatAngelScriptRangeEdit(text, startLine, endLine, partialOptions);
  const lines = text.replace(/\r/g, "").split("\n");
  if (lines.length === 0) {
    return text;
  }

  const outputLines = [...lines];
  const replacementLines = rangeEdit.replacementText.split("\n");
  outputLines.splice(
    rangeEdit.startLine,
    rangeEdit.endLine - rangeEdit.startLine + 1,
    ...replacementLines
  );

  const hadTrailingNewline = text.endsWith("\n");
  let result = outputLines.join("\n");
  if (hadTrailingNewline && !result.endsWith("\n")) {
    result += "\n";
  }
  return result;
}

export function formatAngelScriptRangeEdit(
  text: string,
  startLine: number,
  endLine: number,
  partialOptions: Partial<AngelScriptFormatterOptions> = {},
): AngelScriptRangeEdit {
  const options = buildFormatterOptions(partialOptions);
  const lines = text.replace(/\r/g, "").split("\n");
  if (lines.length === 0) {
    return {
      startLine: 0,
      endLine: 0,
      replacementText: ""
    };
  }

  const normalizedStart = Math.max(0, Math.min(startLine, lines.length - 1));
  const normalizedEnd = Math.max(normalizedStart, Math.min(endLine, lines.length - 1));
  const rangeText = lines.slice(normalizedStart, normalizedEnd + 1).join("\n");
  const formattedRangeRaw = formatAngelScript(rangeText, {
    ...partialOptions,
    insertFinalNewline: false,
  });
  const replacementText = applyBaseIndentation(
    formattedRangeRaw,
    readLeadingIndentation(lines[normalizedStart] ?? ""),
    options.keepPreprocessorColumnZero,
  );

  return {
    startLine: normalizedStart,
    endLine: normalizedEnd,
    replacementText
  };
}

function buildFormatterOptions(
  partialOptions: Partial<AngelScriptFormatterOptions>,
): AngelScriptFormatterOptions {
  const argumentWrap = readWrapStyle(partialOptions.argumentWrap, DEFAULT_FORMATTER_OPTIONS.argumentWrap);
  const chainWrap = readWrapStyle(partialOptions.chainWrap, DEFAULT_FORMATTER_OPTIONS.chainWrap);
  const chainWrapStyle = readChainWrapStyle(
    partialOptions.chainWrapStyle,
    DEFAULT_FORMATTER_OPTIONS.chainWrapStyle
  );
  const braceStyle = readBraceStyle(partialOptions.braceStyle, DEFAULT_FORMATTER_OPTIONS.braceStyle);
  return {
    ...DEFAULT_FORMATTER_OPTIONS,
    ...partialOptions,
    indentSize: Math.max(1, partialOptions.indentSize ?? DEFAULT_FORMATTER_OPTIONS.indentSize),
    maxBlankLines: Math.max(0, partialOptions.maxBlankLines ?? DEFAULT_FORMATTER_OPTIONS.maxBlankLines),
    maxLineWidth: Math.max(0, partialOptions.maxLineWidth ?? DEFAULT_FORMATTER_OPTIONS.maxLineWidth),
    argumentWrap,
    chainWrap,
    chainWrapStyle,
    braceStyle,
  };
}

function formatWithSuppressions(
  text: string,
  lineFormatMask: boolean[],
  options: AngelScriptFormatterOptions,
): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const segments = buildLineSegments(lineFormatMask);
  const parts: string[] = [];

  for (const segment of segments) {
    const segmentText = lines.slice(segment.startLine, segment.endLine + 1).join("\n");
    if (!segment.shouldFormat) {
      parts.push(segmentText);
      continue;
    }
    const formattedSegment = formatAngelScriptCore(segmentText, {
      ...options,
      insertFinalNewline: false,
    });
    const segmentWithoutBoundaryPadding =
      segment.startLine > 0 ? formattedSegment.replace(/^\n+/g, "") : formattedSegment;
    const postProcessed = applyPostFormattingPasses(segmentWithoutBoundaryPadding, {
      ...options,
      insertFinalNewline: false,
    });
    const baseIndent = readLeadingIndentation(lines[segment.startLine] ?? "");
    parts.push(applyBaseIndentation(postProcessed, baseIndent, options.keepPreprocessorColumnZero));
  }

  let merged = parts.join("\n");
  if (options.insertFinalNewline && !merged.endsWith("\n")) {
    merged += "\n";
  }
  if (!options.insertFinalNewline && merged.endsWith("\n")) {
    merged = merged.replace(/\n+$/g, "");
  }
  return merged;
}

function readLeadingIndentation(text: string): string {
  const match = /^[\t ]*/.exec(text);
  return match?.[0] ?? "";
}

function applyBaseIndentation(
  formattedText: string,
  baseIndent: string,
  keepPreprocessorColumnZero: boolean,
): string {
  if (!baseIndent || formattedText.trim().length === 0) {
    return formattedText;
  }

  const hadTrailingNewline = formattedText.endsWith("\n");
  const lines = formattedText.split("\n");
  let depth = 0;
  const output = lines.map((line) => {
    if (line.trim().length === 0) {
      return line;
    }
    if (keepPreprocessorColumnZero && line.trimStart().startsWith("#")) {
      return line.trimStart();
    }
    const trimmed = line.trimStart();
    const startsWithClosingBrace = trimmed.startsWith("}");
    const shouldSkipBaseIndent = startsWithClosingBrace && depth === 0;
    const lineOutput = shouldSkipBaseIndent ? line : `${baseIndent}${line}`;

    const openCount = countOccurrences(line, "{");
    const closeCount = countOccurrences(line, "}");
    depth = Math.max(0, depth + openCount - closeCount);
    return lineOutput;
  });

  let text = output.join("\n");
  if (hadTrailingNewline && !text.endsWith("\n")) {
    text += "\n";
  }
  return text;
}

function countOccurrences(text: string, character: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch === character) {
      count += 1;
    }
  }
  return count;
}

function computeSuppressionState(text: string): boolean[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const shouldFormat = new Array<boolean>(lines.length).fill(true);
  const disableNextLine = new Set<number>();
  let fileDisabled = false;
  let blockDepth = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineText = lines[lineIndex];
    const directiveMatch = formatterDirectivePattern.exec(lineText);
    const isDirective = directiveMatch !== null;
    if (isDirective) {
      shouldFormat[lineIndex] = false;
    } else if (fileDisabled || blockDepth > 0 || disableNextLine.has(lineIndex)) {
      shouldFormat[lineIndex] = false;
    }

    if (!isDirective) {
      continue;
    }

    const directive = directiveMatch[1].toLowerCase();
    if (directive === "disable-next-line") {
      if (lineIndex + 1 < lines.length) {
        disableNextLine.add(lineIndex + 1);
      }
      continue;
    }
    if (directive === "disable-start") {
      blockDepth += 1;
      continue;
    }
    if (directive === "disable-end") {
      blockDepth = Math.max(0, blockDepth - 1);
      continue;
    }
    if (directive === "disable") {
      fileDisabled = true;
      continue;
    }
    if (directive === "enable") {
      fileDisabled = false;
    }
  }

  return shouldFormat;
}

function buildLineSegments(
  lineFormatMask: boolean[],
): Array<{ startLine: number; endLine: number; shouldFormat: boolean }> {
  if (lineFormatMask.length === 0) {
    return [];
  }
  const segments: Array<{ startLine: number; endLine: number; shouldFormat: boolean }> = [];
  let startLine = 0;
  let currentState = lineFormatMask[0];

  for (let index = 1; index < lineFormatMask.length; index++) {
    if (lineFormatMask[index] === currentState) {
      continue;
    }
    segments.push({
      startLine,
      endLine: index - 1,
      shouldFormat: currentState,
    });
    startLine = index;
    currentState = lineFormatMask[index];
  }

  segments.push({
    startLine,
    endLine: lineFormatMask.length - 1,
    shouldFormat: currentState,
  });
  return segments;
}

function applyPostFormattingPasses(
  text: string,
  options: AngelScriptFormatterOptions,
): string {
  let output = text;
  if (options.braceStyle === "allman") {
    output = applyAllmanBraceStyle(output);
  }
  if (options.maxLineWidth > 0) {
    output = applyLineWrapping(output, options);
  }
  return output;
}

function applyAllmanBraceStyle(text: string): string {
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.replace(/\r/g, "").split("\n");
  const outputLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) {
      outputLines.push(line);
      continue;
    }
    if (trimmed.trim() === "{") {
      outputLines.push(line);
      continue;
    }
    if (trimmed.trimStart().startsWith("#")) {
      outputLines.push(line);
      continue;
    }
    if (!trimmed.endsWith("{")) {
      outputLines.push(line);
      continue;
    }

    const indent = line.match(/^[\t ]*/)?.[0] ?? "";
    const withoutBrace = trimmed.slice(0, -1).trimEnd();
    outputLines.push(withoutBrace);
    outputLines.push(`${indent}{`);
  }

  let output = outputLines.join("\n");
  if (hadTrailingNewline && !output.endsWith("\n")) {
    output += "\n";
  }
  return output;
}

function applyLineWrapping(
  text: string,
  options: AngelScriptFormatterOptions,
): string {
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.replace(/\r/g, "").split("\n");
  const indentUnit = options.useTabs ? "\t" : " ".repeat(options.indentSize);
  const output: string[] = [];

  for (const line of lines) {
    if (line.length <= options.maxLineWidth || options.maxLineWidth <= 0) {
      output.push(line);
      continue;
    }
    if (line.trimStart().startsWith("#")) {
      output.push(line);
      continue;
    }
    if (hasTopLevelTernary(line)) {
      output.push(line);
      continue;
    }

    let wrapped = tryWrapArguments(line, options, indentUnit);
    if (wrapped.length === 1) {
      wrapped = tryWrapChain(line, options, indentUnit);
    }
    output.push(...wrapped);
  }

  let outputText = output.join("\n");
  if (hadTrailingNewline && !outputText.endsWith("\n")) {
    outputText += "\n";
  }
  return outputText;
}

function tryWrapArguments(
  line: string,
  options: AngelScriptFormatterOptions,
  indentUnit: string,
): string[] {
  if (options.argumentWrap === "never") {
    return [line];
  }
  if (options.argumentWrap === "auto" && line.length <= options.maxLineWidth) {
    return [line];
  }
  const candidate = findArgumentWrapCandidate(line);
  if (candidate === null) {
    return [line];
  }
  const { openParen, closeParen } = candidate;

  const indent = line.match(/^[\t ]*/)?.[0] ?? "";
  const prefix = line.slice(0, openParen + 1).trimEnd();
  const argsText = line.slice(openParen + 1, closeParen);
  const suffix = line.slice(closeParen + 1);
  const args = splitTopLevelArguments(argsText);
  if (args.length <= 1) {
    return [line];
  }

  const wrapped: string[] = [prefix];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index].trim();
    const trailing = index < args.length - 1 ? "," : "";
    wrapped.push(`${indent}${indentUnit}${argument}${trailing}`);
  }
  wrapped.push(`${indent})${suffix}`);
  return wrapped;
}

function tryWrapChain(
  line: string,
  options: AngelScriptFormatterOptions,
  indentUnit: string,
): string[] {
  if (options.chainWrap === "never") {
    return [line];
  }
  if (options.chainWrap === "auto" && line.length <= options.maxLineWidth) {
    return [line];
  }
  const indent = line.match(/^[\t ]*/)?.[0] ?? "";
  const trimmed = line.trim();
  const parts = splitTopLevelChain(trimmed);
  if (parts.length <= 1) {
    return [line];
  }

  if (options.chainWrapStyle === "trailingDot") {
    const wrapped: string[] = [`${indent}${parts[0]}.`];
    for (let index = 1; index < parts.length; index++) {
      const trailingDot = index < parts.length - 1 ? "." : "";
      wrapped.push(`${indent}${indentUnit}${parts[index]}${trailingDot}`);
    }
    return wrapped;
  }

  const wrapped: string[] = [`${indent}${parts[0]}`];
  for (let index = 1; index < parts.length; index++) {
    wrapped.push(`${indent}${indentUnit}.${parts[index]}`);
  }
  return wrapped;
}

function hasTopLevelTernary(line: string): boolean {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let inString: "'" | "\"" | null = null;
  let inBlockComment = false;
  let sawQuestion = false;

  for (let index = 0; index < line.length; index++) {
    const ch = line[index];
    const next = line[index + 1] ?? "";

    if (inString !== null) {
      if (ch === "\\") {
        index += 1;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      break;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      inString = ch;
      continue;
    }

    if (ch === "(") {
      parenDepth += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (ch === "{") {
      braceDepth += 1;
      continue;
    }
    if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (ch === "<") {
      angleDepth += 1;
      continue;
    }
    if (ch === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
      continue;
    }

    if (parenDepth !== 0 || bracketDepth !== 0 || braceDepth !== 0 || angleDepth !== 0) {
      continue;
    }

    if (ch === "?") {
      sawQuestion = true;
      continue;
    }
    if (ch === ":" && sawQuestion) {
      return true;
    }
  }

  return false;
}

function splitTopLevelArguments(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let inString: "'" | "\"" | null = null;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    const next = text[index + 1] ?? "";

    if (inString !== null) {
      current += ch;
      if (ch === "\\") {
        const escaped = text[index + 1];
        if (escaped !== undefined) {
          current += escaped;
          index += 1;
        }
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      current += text.slice(index);
      break;
    }
    if (ch === "/" && next === "*") {
      current += "/*";
      index += 1;
      inBlockComment = true;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }

    if (ch === "(") {
      parenDepth += 1;
      current += ch;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      current += ch;
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      current += ch;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += ch;
      continue;
    }
    if (ch === "{") {
      braceDepth += 1;
      current += ch;
      continue;
    }
    if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      current += ch;
      continue;
    }
    if (ch === "<") {
      angleDepth += 1;
      current += ch;
      continue;
    }
    if (ch === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
      current += ch;
      continue;
    }

    if (
      ch === "," &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0 &&
      angleDepth === 0
    ) {
      parts.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  parts.push(current);
  return parts;
}

function findArgumentWrapCandidate(
  line: string,
): { openParen: number; closeParen: number } | null {
  let inString: "'" | "\"" | null = null;
  let inBlockComment = false;
  let lineCommentStart = -1;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;

  for (let index = 0; index < line.length; index++) {
    const ch = line[index];
    const next = line[index + 1] ?? "";

    if (inString !== null) {
      if (ch === "\\") {
        index += 1;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      lineCommentStart = index;
      break;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      inString = ch;
      continue;
    }

    if (ch === "(") {
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0) {
        const previousWord = readPreviousWord(line, index);
        if (
          previousWord.length > 0 &&
          !CONTROL_KEYWORDS_WITH_SPACE_BEFORE_PAREN.has(previousWord)
        ) {
          const closeParen = findMatchingParen(line, index);
          if (closeParen > index) {
            const argsText = line.slice(index + 1, closeParen);
            if (hasTopLevelComma(argsText)) {
              const remainder = line.slice(closeParen + 1);
              if (lineCommentStart < 0 || closeParen < lineCommentStart) {
                return { openParen: index, closeParen };
              }
              if (remainder.trimStart().startsWith("//")) {
                return { openParen: index, closeParen };
              }
            }
          }
        }
      }
      parenDepth += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (ch === "{") {
      braceDepth += 1;
      continue;
    }
    if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (ch === "<") {
      angleDepth += 1;
      continue;
    }
    if (ch === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
      continue;
    }
  }

  return null;
}

function readPreviousWord(line: string, fromIndexExclusive: number): string {
  let index = fromIndexExclusive - 1;
  while (index >= 0 && /\s/.test(line[index])) {
    index -= 1;
  }
  if (index < 0) {
    return "";
  }
  const endExclusive = index + 1;
  while (index >= 0 && /[A-Za-z0-9_]/.test(line[index])) {
    index -= 1;
  }
  return line.slice(index + 1, endExclusive);
}

function findMatchingParen(line: string, openParenIndex: number): number {
  let depth = 0;
  let inString: "'" | "\"" | null = null;
  let inBlockComment = false;

  for (let index = openParenIndex; index < line.length; index++) {
    const ch = line[index];
    const next = line[index + 1] ?? "";

    if (inString !== null) {
      if (ch === "\\") {
        index += 1;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      return -1;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      inString = ch;
      continue;
    }

    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function hasTopLevelComma(text: string): boolean {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let inString: "'" | "\"" | null = null;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    const next = text[index + 1] ?? "";

    if (inString !== null) {
      if (ch === "\\") {
        index += 1;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      break;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      inString = ch;
      continue;
    }

    if (ch === "(") {
      parenDepth += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (ch === "{") {
      braceDepth += 1;
      continue;
    }
    if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (ch === "<") {
      angleDepth += 1;
      continue;
    }
    if (ch === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
      continue;
    }

    if (
      ch === "," &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0 &&
      angleDepth === 0
    ) {
      return true;
    }
  }

  return false;
}

function splitTopLevelChain(line: string): string[] {
  if (!line.includes(".")) {
    return [line];
  }

  const parts: string[] = [];
  let current = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let inString: "'" | "\"" | null = null;
  let inBlockComment = false;

  for (let index = 0; index < line.length; index++) {
    const ch = line[index];
    const next = line[index + 1] ?? "";
    const previous = index > 0 ? line[index - 1] : "";

    if (inString !== null) {
      current += ch;
      if (ch === "\\") {
        const escaped = line[index + 1];
        if (escaped !== undefined) {
          current += escaped;
          index += 1;
        }
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      current += line.slice(index);
      break;
    }
    if (ch === "/" && next === "*") {
      current += "/*";
      index += 1;
      inBlockComment = true;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }

    if (ch === "(") {
      parenDepth += 1;
      current += ch;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      current += ch;
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      current += ch;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += ch;
      continue;
    }
    if (ch === "{") {
      braceDepth += 1;
      current += ch;
      continue;
    }
    if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      current += ch;
      continue;
    }
    if (ch === "<") {
      angleDepth += 1;
      current += ch;
      continue;
    }
    if (ch === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
      current += ch;
      continue;
    }

    if (
      ch === "." &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0 &&
      angleDepth === 0 &&
      !(isDigit(previous) && isDigit(next))
    ) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  parts.push(current.trim());
  const nonEmpty = parts.filter((value) => value.length > 0);
  if (nonEmpty.length <= 1) {
    return [line];
  }
  return nonEmpty;
}

function readWrapStyle(
  value: AngelScriptFormatterOptions["argumentWrap"] | undefined,
  fallback: AngelScriptFormatterOptions["argumentWrap"],
): AngelScriptFormatterOptions["argumentWrap"] {
  switch (value) {
    case "never":
    case "auto":
    case "always":
      return value;
    default:
      return fallback;
  }
}

function readChainWrapStyle(
  value: AngelScriptFormatterOptions["chainWrapStyle"] | undefined,
  fallback: AngelScriptFormatterOptions["chainWrapStyle"],
): AngelScriptFormatterOptions["chainWrapStyle"] {
  switch (value) {
    case "leadingDot":
    case "trailingDot":
      return value;
    default:
      return fallback;
  }
}

function readBraceStyle(
  value: AngelScriptFormatterOptions["braceStyle"] | undefined,
  fallback: AngelScriptFormatterOptions["braceStyle"],
): AngelScriptFormatterOptions["braceStyle"] {
  switch (value) {
    case "kr":
    case "allman":
      return value;
    default:
      return fallback;
  }
}
