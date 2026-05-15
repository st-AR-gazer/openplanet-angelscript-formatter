import {
  parseGrammarPipeline,
  type GrammarDeclarationNode,
  type GrammarProgramNode,
  type GrammarStatementNode,
  type GrammarToken,
} from "openplanet-angelscript-core";

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
  lineWrapBaseIndentWidth?: number;
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
  lineWrapBaseIndentWidth: 0,
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
  startOffset: number;
  endOffset: number;
}

const KEYWORDS = new Set<string>([
  "if",
  "else",
  "for",
  "foreach",
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
  "using",
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
  "explicit",
  "abstract",
  "property",
  "mixin",
  "delete",
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
  "wstring",
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
  "foreach",
  "while",
  "switch",
  "catch",
]);
const CONTROL_KEYWORDS_WITH_UNBRACED_BODY = new Set<string>(["if", "for", "foreach", "while"]);

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
  "wstring",
  "array",
  "dictionary",
  "void"
]);

const DECLARATION_KEYWORDS = new Set<string>([
  "namespace",
  "using",
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
  "...",
  "<<=",
  ">>=",
  ">>>",
  "++",
  "--",
  "==",
  "!=",
  "!is",
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
const EXPRESSION_PREFIX_KEYWORDS = new Set(["return", "throw", "delete"]);
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

function requiresIdentifierBoundaryAfterOperator(operator: string): boolean {
  return isIdentifierPart(operator[operator.length - 1] ?? "");
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

  const pushToken = (
    kind: TokenKind,
    value: string,
    startOffset: number,
    endOffset: number,
  ): void => {
    tokens.push({
      kind,
      value,
      lineBreaksBefore,
      startOffset,
      endOffset,
    });
    lineBreaksBefore = 0;
  };

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
      const value = text.slice(i, j).trimEnd();
      pushToken("preprocessor", value, i, i + value.length);
      lineStart = false;
      i = j;
      continue;
    }

    if (lineStart) lineStart = false;

    if (ch === "/" && text[i + 1] === "/") {
      let j = i + 2;
      while (j < text.length && text[j] !== "\r" && text[j] !== "\n") j++;
      const value = text.slice(i, j).trimEnd();
      pushToken("lineComment", value, i, i + value.length);
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
      pushToken("blockComment", text.slice(i, j), i, j);
      i = j;
      continue;
    }

    if (
      (ch === "n" || ch === "f") &&
      text[i + 1] === "\"" &&
      !isIdentifierPart(text[i - 1] ?? "")
    ) {
      const end = consumeQuotedLiteral(text, i + 1);
      pushToken("string", text.slice(i, end), i, end);
      i = end;
      continue;
    }

    if (ch === "\"" || ch === "'") {
      const end = consumeQuotedLiteral(text, i);
      pushToken("string", text.slice(i, end), i, end);
      i = end;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(text[i + 1] ?? "") && !isIdentifierPart(text[i - 1] ?? ""))) {
      const end = consumeNumberLiteral(text, i);
      pushToken("number", text.slice(i, end), i, end);
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
      pushToken(kind, word, i, j);
      i = j;
      continue;
    }

    let matchedOperator: string | null = null;
    for (const operator of MULTI_CHAR_OPERATORS) {
      if (
        text.startsWith(operator, i) &&
        (
          !requiresIdentifierBoundaryAfterOperator(operator) ||
          !isIdentifierPart(text[i + operator.length] ?? "")
        )
      ) {
        matchedOperator = operator;
        break;
      }
    }
    if (matchedOperator !== null) {
      pushToken("operator", matchedOperator, i, i + matchedOperator.length);
      i += matchedOperator.length;
      continue;
    }

    if (SINGLE_CHAR_PUNCTUATION.has(ch)) {
      pushToken("punctuation", ch, i, i + 1);
      i++;
      continue;
    }

    if (SINGLE_CHAR_OPERATORS.has(ch)) {
      pushToken("operator", ch, i, i + 1);
      i++;
      continue;
    }

    pushToken("unknown", ch, i, i + 1);
    i++;
  }

  return tokens;
}

function isWordLike(token: Token | null): boolean {
  if (token === null) return false;
  return token.kind === "identifier" || token.kind === "keyword" || token.kind === "number" || token.kind === "string";
}

function canStartDeclarationAttributeToken(token: Token | null): boolean {
  return token !== null && (token.kind === "identifier" || token.kind === "keyword");
}

function isDeclarationAttributeOpenToken(
  previous: Token | null,
  current: Token,
  next: Token | null,
  previousClosedDeclarationAttribute: boolean,
): boolean {
  if (current.value !== "[") return false;
  if (!canStartDeclarationAttributeToken(next)) return false;
  if (previousClosedDeclarationAttribute) return true;
  return previous === null || current.lineBreaksBefore > 0;
}

function isOperatorToken(token: Token | null): boolean {
  return token !== null && token.kind === "operator";
}

function shouldIndentLeadingOperatorContinuation(
  previous: Token | null,
  current: Token,
  isUnaryCurrent: boolean,
): boolean {
  if (previous === null) return false;
  if (!isOperatorToken(current)) return false;
  if (current.lineBreaksBefore <= 0) return false;
  if (isUnaryCurrent) return false;
  if (NO_SPACE_AROUND_OPERATORS.has(current.value)) return false;
  if (current.value === "@" || current.value === "++" || current.value === "--") return false;
  return isWordLike(previous) || previous.value === ")" || previous.value === "]" || previous.value === "}";
}

const ASSIGNMENT_OPERATORS = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<=",
  ">>=",
  ">>>=",
]);

function getHangingAssignmentOperandPaddingWidth(
  tokens: Token[],
  currentIndex: number,
  previous: Token | null,
  current: Token,
): number {
  if (previous === null || current.lineBreaksBefore <= 0) return 0;
  if (!isOperatorToken(previous) || !ASSIGNMENT_OPERATORS.has(previous.value)) return 0;
  if (isOperatorToken(current)) return 0;

  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;

  for (let index = currentIndex + 1; index < tokens.length; index++) {
    const token = tokens[index];
    const tokenPrevious = tokens[index - 1] ?? null;

    if (
      token.lineBreaksBefore > 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0 &&
      angleDepth === 0 &&
      isOperatorToken(token) &&
      !NO_SPACE_AROUND_OPERATORS.has(token.value) &&
      token.value !== "@" &&
      token.value !== "++" &&
      token.value !== "--" &&
      !isUnaryOperatorToken(token, tokenPrevious)
    ) {
      return token.value.length + 1;
    }

    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0) {
      if (token.value === ";") {
        break;
      }
    }

    if (token.value === "(") {
      parenDepth += 1;
      continue;
    }
    if (token.value === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (token.value === "[") {
      bracketDepth += 1;
      continue;
    }
    if (token.value === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (token.value === "{") {
      braceDepth += 1;
      continue;
    }
    if (token.value === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (token.value === "<") {
      angleDepth += 1;
      continue;
    }
    if (token.value === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
      continue;
    }
  }

  return 0;
}

function isLikelyTypeToken(token: Token | null): boolean {
  if (token === null) return false;
  if (token.kind === "keyword") return TYPE_KEYWORDS.has(token.value);
  if (token.kind !== "identifier") return false;
  if (token.value.includes("::")) return true;
  return /^[A-Z]/.test(token.value) || TYPE_KEYWORDS.has(token.value);
}

function canStartTypeArgumentToken(token: Token | null): boolean {
  if (token === null) return false;
  if (token.value === "?" || token.value === "const") return true;
  if (token.kind === "identifier") return true;
  return token.kind === "keyword" && TYPE_KEYWORDS.has(token.value);
}

function isLikelyGenericOpenToken(
  tokenBeforePrevious: Token | null,
  previous: Token | null,
  current: Token,
  next: Token | null,
  genericDepth: number,
): boolean {
  if (current.value !== "<") return false;
  if (next === null) return false;
  const isCastTypeParameterOpen = previous?.kind === "keyword" && previous.value === "cast";
  const isMemberAccessComparison =
    previous?.kind === "identifier" && tokenBeforePrevious?.value === ".";
  if (isMemberAccessComparison) return false;
  if (!isCastTypeParameterOpen && !isLikelyTypeToken(previous) && genericDepth === 0) return false;
  if (previous?.kind === "keyword" && CONTROL_KEYWORDS_WITH_SPACE_BEFORE_PAREN.has(previous.value)) return false;
  if (previous?.value === "return" || previous?.value === "case") return false;
  if (next.value === ">" || next.value === ")" || next.value === ";") return false;
  return canStartTypeArgumentToken(next);
}

function genericCloseCount(token: Token, genericDepth: number): number {
  if (genericDepth <= 0) return 0;
  if (token.value === ">") return 1;
  if (token.value === ">>") return Math.min(2, genericDepth);
  return 0;
}

function isUnaryContext(previous: Token | null): boolean {
  if (previous === null) return true;
  if (previous.kind === "keyword" && EXPRESSION_PREFIX_KEYWORDS.has(previous.value)) return true;
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
  previousInDeclarationAttribute: boolean,
  currentInDeclarationAttribute: boolean,
  isUnaryCurrent: boolean,
  previousWasUnary: boolean,
  previousWasGenericOpen: boolean,
  previousWasGenericClose: boolean,
  isGenericOpen: boolean,
  genericCloseCountForCurrent: number,
): boolean {
  if (previous === null) return false;
  if (current.kind === "lineComment") return false;
  if (
    (currentInDeclarationAttribute && current.value === "=") ||
    (previousInDeclarationAttribute && previous.value === "=")
  ) {
    return false;
  }
  if (current.value === "," || current.value === ";" || current.value === ")" || current.value === "]" || current.value === "}" || current.value === ".") return false;
  if (previous.value === "(" || previous.value === "[" || previous.value === "{" || previous.value === "." || previous.value === "::") return false;
  if (previous.value === "," || previous.value === ";") return true;
  if (current.value === "::" || current.value === "->") return false;
  if (previous.value === "]" && isWordLike(current)) return true;

  if (current.value === "(") {
    if (previous.value === "?" || previous.value === ":") {
      return true;
    }
    if (
      isOperatorToken(previous) &&
      !previousWasGenericClose &&
      !NO_SPACE_AROUND_OPERATORS.has(previous.value) &&
      previous.value !== "++" &&
      previous.value !== "--" &&
      previous.value !== "@" &&
      !previousWasUnary
    ) {
      return spaceAroundOperators;
    }
    return previous.kind === "keyword" && CONTROL_KEYWORDS_WITH_SPACE_BEFORE_PAREN.has(previous.value);
  }

  if (current.value === "[") return false;
  if (current.value === "{") return true;

  if (current.value === ":") {
    if (previous.value === "?") return true;
    if (previous.value === "case" || previous.value === "default") return false;
    return true;
  }

  if (previous.value === "?" && current.value === "&") return false;
  if (previous.value === "?") return true;
  if (previous.value === ":") return isWordLike(current);

  if (current.value === "?" && next?.value === "&") return false;
  if (current.value === "...") return false;
  if (current.value === "?") return true;

  if (previousWasGenericOpen) return false;
  if (isGenericOpen || genericCloseCountForCurrent > 0) return false;
  if (current.value === "@") {
    if (isLikelyTypeToken(previous)) return false;
    if (
      isUnaryCurrent &&
      previous.kind === "keyword" &&
      EXPRESSION_PREFIX_KEYWORDS.has(previous.value)
    ) {
      return true;
    }
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
    if (current.value === "&") return false;
    if (isWordLike(current)) return !previousWasUnary;
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

  if (
    isUnaryCurrent &&
    previous.kind === "keyword" &&
    EXPRESSION_PREFIX_KEYWORDS.has(previous.value)
  ) {
    return true;
  }

  if (
    isUnaryCurrent &&
    isOperatorToken(previous) &&
    !NO_SPACE_AROUND_OPERATORS.has(previous.value) &&
    previous.value !== "++" &&
    previous.value !== "--" &&
    previous.value !== "@" &&
    !previousWasUnary
  ) {
    return spaceAroundOperators;
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

function detectPreferredEol(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function restorePreferredEol(text: string, preferredEol: "\n" | "\r\n"): string {
  if (preferredEol === "\n") {
    return text.replace(/\r\n/g, "\n");
  }
  return text.replace(/\r?\n/g, "\r\n");
}

interface FormattingStructure {
  structuralOpenBraces: Set<number>;
  structuralCloseBraces: Set<number>;
  doWhileCloseBraces: Set<number>;
  multilineEmptyFunctionOpenBraces: Set<number>;
  inlineEmptyStructuralOpenBraces: Set<number>;
  parseErrors: boolean;
}

interface MultilineBraceSets {
  openBraces: Set<number>;
  closeBraces: Set<number>;
}

function buildFormattingStructure(text: string): FormattingStructure {
  const parsed = parseGrammarPipeline(text);
  const structure: FormattingStructure = {
    structuralOpenBraces: new Set<number>(),
    structuralCloseBraces: new Set<number>(),
    doWhileCloseBraces: new Set<number>(),
    multilineEmptyFunctionOpenBraces: new Set<number>(),
    inlineEmptyStructuralOpenBraces: new Set<number>(),
    parseErrors: parsed.errors.length > 0,
  };
  const symbolTokens = parsed.tokens.filter((token) => token.kind === "symbol");

  const addBracePair = (openOffset: number | undefined, closeOffset: number | undefined): void => {
    if (openOffset === undefined || closeOffset === undefined) return;
    structure.structuralOpenBraces.add(openOffset);
    structure.structuralCloseBraces.add(closeOffset);
  };

  const findFirstSymbol = (
    symbol: string,
    startInclusive: number,
    endExclusive: number,
  ): GrammarToken | undefined =>
    symbolTokens.find((token) =>
      token.text === symbol &&
      token.start >= startInclusive &&
      token.end <= endExclusive
    );

  const findLastSymbol = (
    symbol: string,
    startInclusive: number,
    endExclusive: number,
  ): GrammarToken | undefined => {
    for (let index = symbolTokens.length - 1; index >= 0; index--) {
      const token = symbolTokens[index];
      if (
        token.text === symbol &&
        token.start >= startInclusive &&
        token.end <= endExclusive
      ) {
        return token;
      }
    }
    return undefined;
  };

  const visitProgram = (program: GrammarProgramNode): void => {
    for (const declaration of program.declarations) {
      visitDeclaration(declaration);
    }
  };

  const visitDeclaration = (declaration: GrammarDeclarationNode): void => {
    if (declaration.kind === "namespace") {
      const openBrace = findFirstSymbol("{", declaration.nameEnd, declaration.end);
      const closeBrace = findLastSymbol("}", declaration.start, declaration.end);
      addBracePair(openBrace?.start, closeBrace?.start);
      for (const child of declaration.body) visitDeclaration(child);
      return;
    }

    if (declaration.kind === "type") {
      const openBrace = findFirstSymbol("{", declaration.nameEnd, declaration.end);
      const closeBrace = findLastSymbol("}", declaration.start, declaration.end);
      addBracePair(openBrace?.start, closeBrace?.start);
      for (const child of declaration.body) visitDeclaration(child);
      return;
    }

    if (declaration.kind === "function") {
      addBracePair(declaration.openBrace, declaration.closeBrace);
      if (
        declaration.openBrace !== undefined &&
        declaration.closeBrace !== undefined &&
        declaration.returnTypeText.trim().length === 0
      ) {
        structure.inlineEmptyStructuralOpenBraces.add(declaration.openBrace);
      } else if (
        declaration.openBrace !== undefined &&
        declaration.closeBrace !== undefined &&
        declaration.name === "Main" &&
        declaration.body?.kind === "block" &&
        declaration.body.statements.length === 0
      ) {
        structure.multilineEmptyFunctionOpenBraces.add(declaration.openBrace);
      }
      if (declaration.body) visitStatement(declaration.body);
      return;
    }

    if (
      declaration.kind === "block" ||
      declaration.kind === "if" ||
      declaration.kind === "else" ||
      declaration.kind === "for" ||
      declaration.kind === "foreach" ||
      declaration.kind === "while" ||
      declaration.kind === "do" ||
      declaration.kind === "switch" ||
      declaration.kind === "try" ||
      declaration.kind === "catch" ||
      declaration.kind === "case" ||
      declaration.kind === "default" ||
      declaration.kind === "variable-declaration" ||
      declaration.kind === "statement"
    ) {
      visitStatement(declaration);
    }
  };

  const visitStatement = (statement: GrammarStatementNode): void => {
    if (statement.kind === "block") {
      addBracePair(statement.start, statement.end - 1);
      for (const child of statement.statements) visitStatement(child);
      return;
    }

    if (
      statement.kind === "if" ||
      statement.kind === "else" ||
      statement.kind === "for" ||
      statement.kind === "foreach" ||
      statement.kind === "while" ||
      statement.kind === "do" ||
      statement.kind === "switch" ||
      statement.kind === "try" ||
      statement.kind === "catch" ||
      statement.kind === "case" ||
      statement.kind === "default"
    ) {
      if (statement.kind === "do" && statement.body?.kind === "block") {
        structure.doWhileCloseBraces.add(statement.body.end - 1);
      }
      if (statement.body) visitStatement(statement.body);
    }
  };

  visitProgram(parsed.program);
  addHeuristicStructuralBraces(parsed.tokens, structure);
  return structure;
}

function addHeuristicStructuralBraces(
  tokens: GrammarToken[],
  structure: FormattingStructure,
): void {
  const significantTokens = tokens.filter((token) => token.kind !== "eof");
  const structuralControlKeywords = new Set([
    "if",
    "for",
    "foreach",
    "while",
    "switch",
    "catch",
    "else",
    "do",
    "try",
  ]);
  const braceStack: GrammarToken[] = [];
  const matchingCloseBraceByOpenStart = new Map<number, number>();

  for (const token of significantTokens) {
    if (token.text === "{") {
      braceStack.push(token);
      continue;
    }
    if (token.text === "}") {
      const open = braceStack.pop();
      if (open) {
        matchingCloseBraceByOpenStart.set(open.start, token.start);
      }
    }
  }

  for (let index = 0; index < significantTokens.length; index++) {
    const token = significantTokens[index];
    if (token.text !== "{" || structure.structuralOpenBraces.has(token.start)) {
      continue;
    }

    const previous = significantTokens[index - 1];
    let shouldTreatAsStructural =
      previous?.kind === "keyword" && structuralControlKeywords.has(previous.text);

    if (!shouldTreatAsStructural && previous?.text === ")") {
      const openParenIndex = findMatchingOpenParenIndex(significantTokens, index - 1);
      const beforeParen = openParenIndex > 0 ? significantTokens[openParenIndex - 1] : undefined;
      shouldTreatAsStructural =
        openParenIndex < 0 ||
        (beforeParen?.kind === "keyword" && structuralControlKeywords.has(beforeParen.text));
    }

    if (!shouldTreatAsStructural) {
      continue;
    }

    const closeOffset = matchingCloseBraceByOpenStart.get(token.start);
    structure.structuralOpenBraces.add(token.start);
    if (closeOffset !== undefined) {
      structure.structuralCloseBraces.add(closeOffset);
    }
  }
}

function findMatchingOpenParenIndex(tokens: GrammarToken[], closeParenIndex: number): number {
  let depth = 0;
  for (let index = closeParenIndex; index >= 0; index--) {
    const token = tokens[index];
    if (token.text === ")") {
      depth += 1;
      continue;
    }
    if (token.text === "(") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function buildMultilineInitializerBraceSets(
  text: string,
  tokens: Token[],
  structure: FormattingStructure,
): MultilineBraceSets {
  const openBraces = new Set<number>();
  const closeBraces = new Set<number>();
  const braceStack: Array<{ token: Token; structural: boolean }> = [];

  for (const token of tokens) {
    if (token.value === "{") {
      braceStack.push({
        token,
        structural: structure.structuralOpenBraces.has(token.startOffset),
      });
      continue;
    }

    if (token.value !== "}") {
      continue;
    }

    const open = braceStack.pop();
    if (open === undefined) {
      continue;
    }

    const closeIsStructural = structure.structuralCloseBraces.has(token.startOffset);
    if (open.structural || closeIsStructural) {
      continue;
    }

    if (!containsLineBreak(text, open.token.endOffset, token.startOffset)) {
      continue;
    }

    openBraces.add(open.token.startOffset);
    closeBraces.add(token.startOffset);
  }

  return { openBraces, closeBraces };
}

function containsLineBreak(text: string, startInclusive: number, endExclusive: number): boolean {
  for (let index = startInclusive; index < endExclusive; index++) {
    const ch = text[index];
    if (ch === "\n" || ch === "\r") {
      return true;
    }
  }
  return false;
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
  const structure = buildFormattingStructure(text);
  const multilineInitializerBraces = buildMultilineInitializerBraceSets(text, tokens, structure);
  const indentUnit = options.useTabs ? "\t" : " ".repeat(options.indentSize);
  let output = "";
  let pendingNewlines = 0;
  let indentLevel = 0;
  let multilineInitializerBraceDepth = 0;
  let parenDepth = 0;
  let genericDepth = 0;
  const forParenDepths = new Set<number>();
  let pendingForParen = false;
  let pendingControlParenKeyword: string | null = null;
  const controlParenDepths = new Map<number, string>();
  let pendingInlineControlBody = false;
  let previousToken: Token | null = null;
  let previousTokenInDeclarationAttribute = false;
  let previousClosedDeclarationAttribute = false;
  let previousWasUnary = false;
  let previousWasGenericOpen = false;
  let previousWasGenericClose = false;
  let declarationAttributeDepth = 0;

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
    const tokenBeforePrevious = index >= 2 ? tokens[index - 2] : null;
    const unaryCurrent = isUnaryOperatorToken(token, previousToken);
    const genericOpenCurrent = isLikelyGenericOpenToken(
      tokenBeforePrevious,
      previousToken,
      token,
      nextToken,
      genericDepth,
    );
    const declarationAttributeOpenCurrent = isDeclarationAttributeOpenToken(
      previousToken,
      token,
      nextToken,
      previousClosedDeclarationAttribute,
    );
    const currentInDeclarationAttribute =
      declarationAttributeDepth > 0 || declarationAttributeOpenCurrent;
    const genericCloseForCurrent = genericCloseCount(token, genericDepth);
    const isStructuralOpenBrace =
      token.value === "{" && structure.structuralOpenBraces.has(token.startOffset);
    const isStructuralCloseBrace =
      token.value === "}" && structure.structuralCloseBraces.has(token.startOffset);
    const isMultilineInitializerOpenBrace =
      token.value === "{" && multilineInitializerBraces.openBraces.has(token.startOffset);
    const isMultilineInitializerCloseBrace =
      token.value === "}" && multilineInitializerBraces.closeBraces.has(token.startOffset);
    const isCuddledStructuralOpenBrace =
      isStructuralOpenBrace &&
      previousToken?.kind !== "lineComment" &&
      previousToken?.kind !== "blockComment";
    const isDoWhileContinuation =
      token.kind === "keyword" &&
      token.value === "while" &&
      previousToken?.value === "}" &&
      structure.doWhileCloseBraces.has(previousToken.startOffset);
    const isCuddledContinuationKeyword =
      token.kind === "keyword" &&
      (token.value === "else" || token.value === "catch" || isDoWhileContinuation) &&
      previousToken?.value === "}" &&
      structure.structuralCloseBraces.has(previousToken.startOffset);
    const isInlineControlBodyStart = pendingInlineControlBody;

    const shouldPreserveInputNewline =
      (
        !isCuddledStructuralOpenBrace &&
        !isCuddledContinuationKeyword &&
        !isInlineControlBodyStart &&
        (parenDepth === 0 || multilineInitializerBraceDepth > 0)
      ) ||
      token.kind === "lineComment" ||
      token.kind === "blockComment" ||
      token.kind === "preprocessor" ||
      previousToken?.kind === "lineComment" ||
      previousToken?.kind === "blockComment";
    if (token.lineBreaksBefore > 0 && shouldPreserveInputNewline) {
      requestNewlines(Math.min(token.lineBreaksBefore, options.maxBlankLines + 1));
    }

    if (
      token.kind === "preprocessor" &&
      /^(#else|#elif|#endif)\b/.test(token.value.trimStart())
    ) {
      requestNewlines(1);
    }

    if (isStructuralCloseBrace || isMultilineInitializerCloseBrace) {
      if (previousToken?.value !== "{") {
        requestNewlines(1);
      }
      indentLevel = Math.max(0, indentLevel - 1);
      if (isMultilineInitializerCloseBrace) {
        multilineInitializerBraceDepth = Math.max(0, multilineInitializerBraceDepth - 1);
      }
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
    const hangingAssignmentOperandPaddingWidth =
      atLineStart
        ? getHangingAssignmentOperandPaddingWidth(tokens, index, previousToken, token)
        : 0;
    const lineIndentLevel =
      atLineStart && shouldIndentLeadingOperatorContinuation(previousToken, token, unaryCurrent)
        ? tokenIndentLevel + 1
        : hangingAssignmentOperandPaddingWidth > 0
          ? tokenIndentLevel + 1
        : tokenIndentLevel;

    if (atLineStart) {
      if (!(options.keepPreprocessorColumnZero && token.kind === "preprocessor")) {
        output += indentUnit.repeat(lineIndentLevel);
        if (hangingAssignmentOperandPaddingWidth > 0) {
          output += " ".repeat(hangingAssignmentOperandPaddingWidth);
        }
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
          previousTokenInDeclarationAttribute,
          currentInDeclarationAttribute,
          unaryCurrent,
          previousWasUnary,
          previousWasGenericOpen,
          previousWasGenericClose,
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
    if (token.value === "[" && currentInDeclarationAttribute) {
      declarationAttributeDepth += 1;
    }
    const closedDeclarationAttribute =
      token.value === "]" && currentInDeclarationAttribute && declarationAttributeDepth > 0;
    if (closedDeclarationAttribute) {
      declarationAttributeDepth = Math.max(0, declarationAttributeDepth - 1);
    }

    if (token.value === "for") pendingForParen = true;
    if (
      token.kind === "keyword" &&
      CONTROL_KEYWORDS_WITH_UNBRACED_BODY.has(token.value)
    ) {
      pendingControlParenKeyword = token.value;
    }

    if (token.value === "(") {
      parenDepth++;
      if (pendingForParen) {
        forParenDepths.add(parenDepth);
        pendingForParen = false;
      }
      if (pendingControlParenKeyword !== null) {
        controlParenDepths.set(parenDepth, pendingControlParenKeyword);
        pendingControlParenKeyword = null;
      }
    } else if (token.value === ")") {
      const controlKeyword = controlParenDepths.get(parenDepth);
      if (controlKeyword !== undefined) {
        controlParenDepths.delete(parenDepth);
      }
      if (forParenDepths.has(parenDepth)) forParenDepths.delete(parenDepth);
      parenDepth = Math.max(0, parenDepth - 1);
      if (
        controlKeyword !== undefined &&
        nextToken !== null &&
        nextToken.value !== "{" &&
        nextToken.value !== ";" &&
        nextToken.kind !== "lineComment" &&
        nextToken.kind !== "blockComment"
      ) {
        pendingInlineControlBody = true;
      }
    }

    if (token.kind === "preprocessor" || token.kind === "lineComment") {
      requestNewlines(1);
    } else if (token.kind === "blockComment" && token.value.includes("\n")) {
      requestNewlines(1);
    } else if (isStructuralOpenBrace || isMultilineInitializerOpenBrace) {
      indentLevel++;
      if (isMultilineInitializerOpenBrace) {
        multilineInitializerBraceDepth++;
      }
      requestNewlines(1);
    } else if (isStructuralCloseBrace) {
      const shouldStayInline =
        nextToken !== null &&
        nextToken.kind === "keyword" &&
        (
          nextToken.value === "else" ||
          nextToken.value === "catch" ||
          (nextToken.value === "while" && structure.doWhileCloseBraces.has(token.startOffset))
        );
      if (!shouldStayInline) {
        const shouldAddDeclarationBlankLine =
          options.blankLineBetweenTopLevelDeclarations &&
          indentLevel === 0 &&
          isTopLevelDeclarationStart(tokens, index + 1);
        requestNewlines(shouldAddDeclarationBlankLine ? 2 : 1);
      }
    } else if (isMultilineInitializerCloseBrace) {
      const shouldStayInline =
        nextToken !== null &&
        (nextToken.value === ";" ||
          nextToken.value === "," ||
          nextToken.value === ")" ||
          nextToken.value === "]");
      if (!shouldStayInline) {
        requestNewlines(1);
      }
    } else if (token.value === ";") {
      const hasTrailingLineComment =
        nextToken?.kind === "lineComment" && nextToken.lineBreaksBefore === 0;
      if (!forParenDepths.has(parenDepth) && !hasTrailingLineComment) requestNewlines(1);
    } else if (
      token.value === ":" &&
      previousToken !== null &&
      (previousToken.value === "case" || previousToken.value === "default")
    ) {
      requestNewlines(1);
    }

    previousTokenInDeclarationAttribute = currentInDeclarationAttribute;
    previousClosedDeclarationAttribute = closedDeclarationAttribute;
    previousWasUnary = unaryCurrent;
    previousWasGenericOpen = genericOpenCurrent;
    previousWasGenericClose = genericCloseForCurrent > 0;
    previousToken = token;
    if (isInlineControlBodyStart) {
      pendingInlineControlBody = false;
    }
  }

  flushPendingNewlines();
  return normalizeOutput(output, options);
}

export function formatAngelScript(
  text: string,
  partialOptions: Partial<AngelScriptFormatterOptions> = {},
): string {
  return formatAngelScriptInternal(text, partialOptions, true);
}

function formatAngelScriptInternal(
  text: string,
  partialOptions: Partial<AngelScriptFormatterOptions>,
  preserveFragmentBaseIndent: boolean,
): string {
  const options = buildFormatterOptions(partialOptions);
  const preferredEol = detectPreferredEol(text);
  if (text.trim().length === 0) {
    return options.insertFinalNewline ? preferredEol : "";
  }

  const fragmentBaseIndent = preserveFragmentBaseIndent
    ? readCommonFragmentBaseIndent(text, options.keepPreprocessorColumnZero)
    : "";
  const textForFormatting =
    fragmentBaseIndent.length > 0
      ? stripFragmentBaseIndentation(text, fragmentBaseIndent)
      : text;
  const formattingOptions = {
    ...options,
    lineWrapBaseIndentWidth: measureIndentWidth(fragmentBaseIndent, options.indentSize),
  };

  const suppressionState = computeSuppressionState(textForFormatting);
  const hasSuppressions = suppressionState.some((value) => value === false);
  let formatted: string;
  if (!hasSuppressions) {
    formatted = applyPostFormattingPasses(
      formatAngelScriptCore(textForFormatting, formattingOptions),
      formattingOptions,
    );
  } else {
    formatted = formatWithSuppressions(textForFormatting, suppressionState, formattingOptions);
  }

  if (fragmentBaseIndent.length > 0) {
    formatted = restoreFragmentBaseIndentation(
      formatted,
      fragmentBaseIndent,
      options.keepPreprocessorColumnZero,
    );
  }

  return restorePreferredEol(formatted, preferredEol);
}

export function formatAngelScriptRange(
  text: string,
  startLine: number,
  endLine: number,
  partialOptions: Partial<AngelScriptFormatterOptions> = {},
): string {
  const preferredEol = detectPreferredEol(text);
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
  return restorePreferredEol(result, preferredEol);
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
  const rangeBaseIndent = readLeadingIndentation(lines[normalizedStart] ?? "");
  const formattedRangeRaw = formatAngelScriptInternal(
    rangeText,
    {
      ...partialOptions,
      insertFinalNewline: false,
      lineWrapBaseIndentWidth: measureIndentWidth(rangeBaseIndent, options.indentSize),
    },
    false,
  );
  const replacementText = applyBaseIndentation(
    formattedRangeRaw,
    rangeBaseIndent,
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

function measureIndentWidth(indent: string, indentSize: number): number {
  let width = 0;
  for (const ch of indent) {
    width += ch === "\t" ? indentSize : 1;
  }
  return width;
}

function readCommonFragmentBaseIndent(
  text: string,
  keepPreprocessorColumnZero: boolean,
): string {
  const lines = text.replace(/\r/g, "").split("\n");
  let commonIndent: string | null = null;

  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    if (keepPreprocessorColumnZero && line.trimStart().startsWith("#")) {
      continue;
    }

    const indent = readLeadingIndentation(line);
    if (indent.length === 0) {
      return "";
    }

    commonIndent =
      commonIndent === null ? indent : readSharedIndentPrefix(commonIndent, indent);
    if (commonIndent.length === 0) {
      return "";
    }
  }

  return commonIndent ?? "";
}

function readSharedIndentPrefix(left: string, right: string): string {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;
  while (index < maxLength && left[index] === right[index]) {
    index++;
  }
  return left.slice(0, index);
}

function stripFragmentBaseIndentation(text: string, baseIndent: string): string {
  if (baseIndent.length === 0) {
    return text;
  }

  const hadTrailingNewline = text.endsWith("\n") || text.endsWith("\r\n");
  const lines = text.replace(/\r/g, "").split("\n");
  const stripped = lines.map((line) =>
    line.startsWith(baseIndent) ? line.slice(baseIndent.length) : line,
  );
  let output = stripped.join("\n");
  if (hadTrailingNewline && !output.endsWith("\n")) {
    output += "\n";
  }
  return output;
}

function restoreFragmentBaseIndentation(
  formattedText: string,
  baseIndent: string,
  keepPreprocessorColumnZero: boolean,
): string {
  if (baseIndent.length === 0 || formattedText.trim().length === 0) {
    return formattedText;
  }

  const hadTrailingNewline = formattedText.endsWith("\n");
  const lines = formattedText.split("\n");
  const restored = lines.map((line) => {
    if (line.trim().length === 0) {
      return line;
    }
    if (keepPreprocessorColumnZero && line.trimStart().startsWith("#")) {
      return line.trimStart();
    }
    return `${baseIndent}${line}`;
  });

  let output = restored.join("\n");
  if (hadTrailingNewline && !output.endsWith("\n")) {
    output += "\n";
  }
  return output;
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
  let output = applyHandleAssignmentControlBlocks(text, options);
  output = addBracesToIfElseChains(output, options);
  output = normalizeHandleAssignmentTargetSpacing(output);
  output = normalizeSpacedScopeResolution(output);
  output = joinLeadingDotContinuations(output);
  output = normalizeLeadingTernaryContinuations(output, options);
  if (options.braceStyle === "allman") {
    output = applyAllmanBraceStyle(output);
  }
  output = collapseEmptyStructuralBlocks(output);
  if (
    options.maxLineWidth > 0 ||
    options.argumentWrap === "always" ||
    options.chainWrap === "always"
  ) {
    output = applyLineWrapping(output, options);
    output = normalizeRepeatedReceiverConcatenationContinuations(output);
  }
  return output;
}

function isScopeResolutionOperandToken(token: Token | null): boolean {
  return token !== null && (token.kind === "identifier" || token.kind === "keyword");
}

function normalizeSpacedScopeResolution(text: string): string {
  const tokens = tokenize(text);
  const replacements: Array<{ start: number; end: number }> = [];

  for (let index = 1; index + 2 < tokens.length; index++) {
    const previous = tokens[index - 1];
    const firstColon = tokens[index];
    const secondColon = tokens[index + 1];
    const next = tokens[index + 2];

    if (!isScopeResolutionOperandToken(previous)) continue;
    if (firstColon.value !== ":" || secondColon.value !== ":") continue;
    if (!isScopeResolutionOperandToken(next)) continue;

    const between = text.slice(previous.endOffset, next.startOffset);
    if (/[\r\n]/.test(between)) continue;
    if (!/^\s*:\s*:\s*$/.test(between)) continue;

    replacements.push({ start: previous.endOffset, end: next.startOffset });
    index += 1;
  }

  if (replacements.length === 0) {
    return text;
  }

  let output = "";
  let cursor = 0;
  for (const replacement of replacements) {
    output += text.slice(cursor, replacement.start);
    output += "::";
    cursor = replacement.end;
  }
  output += text.slice(cursor);
  return output;
}

function normalizeLeadingTernaryContinuations(
  text: string,
  options: AngelScriptFormatterOptions,
): string {
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.replace(/\r/g, "").split("\n");
  const indentUnit = options.useTabs ? "\t" : " ".repeat(options.indentSize);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmedStart = line.trimStart();
    const previousIndex = output.length - 1;
    const previous = previousIndex >= 0 ? output[previousIndex] : undefined;

    if (
      previous !== undefined &&
      trimmedStart.startsWith(":") &&
      previous.trim().length > 0 &&
      !previous.trimStart().startsWith("#") &&
      !previous.includes("//")
    ) {
      const questionIndex = findTopLevelUnmatchedQuestionIndex(previous.trim());
      if (questionIndex >= 0) {
        const previousTrimmed = previous.trim();
        const condition = previousTrimmed.slice(0, questionIndex).trimEnd();
        const trueBranch = previousTrimmed.slice(questionIndex + 1).trimStart();
        const falseBranch = trimmedStart.slice(1).trimStart();

        if (condition.length > 0 && trueBranch.length > 0 && falseBranch.length > 0) {
          const indent = readLeadingIndentation(previous);
          const singleLine = `${condition} ? ${trueBranch} : ${falseBranch}`;
          const effectiveSingleLineLength =
            singleLine.length + (options.lineWrapBaseIndentWidth ?? 0);
          if (options.maxLineWidth <= 0 || effectiveSingleLineLength <= options.maxLineWidth) {
            output[previousIndex] = `${indent}${singleLine}`;
          } else {
            output[previousIndex] = `${indent}${condition} ?`;
            output.push(`${indent}${indentUnit}${trueBranch} : ${falseBranch}`);
          }
          continue;
        }
      }
    }

    if (
      previous !== undefined &&
      trimmedStart.startsWith("?") &&
      previous.trim().length > 0 &&
      !previous.trimStart().startsWith("#") &&
      !previous.includes("//")
    ) {
      const condition = previous.trimEnd();
      const indent = readLeadingIndentation(previous);
      const questionPayload = trimmedStart.slice(1).trimStart();
      let trueBranch = questionPayload;
      let falseBranch: string | null = null;

      const colonInQuestionPayload = findTopLevelColonInFragment(questionPayload);
      if (colonInQuestionPayload >= 0) {
        trueBranch = questionPayload.slice(0, colonInQuestionPayload).trimEnd();
        falseBranch = questionPayload.slice(colonInQuestionPayload + 1).trimStart();
      } else {
        const nextLine = lines[index + 1];
        const nextTrimmedStart = nextLine?.trimStart() ?? "";
        if (nextLine !== undefined && nextTrimmedStart.startsWith(":")) {
          falseBranch = nextTrimmedStart.slice(1).trimStart();
          index += 1;
        }
      }

      if (trueBranch.length > 0 && falseBranch !== null && falseBranch.length > 0) {
        const singleLine = `${condition} ? ${trueBranch} : ${falseBranch}`;
        const effectiveSingleLineLength =
          singleLine.length + (options.lineWrapBaseIndentWidth ?? 0);
        if (options.maxLineWidth <= 0 || effectiveSingleLineLength <= options.maxLineWidth) {
          output[previousIndex] = singleLine;
        } else {
          output[previousIndex] = `${condition} ?`;
          output.push(`${indent}${indentUnit}${trueBranch} : ${falseBranch}`);
        }
        continue;
      }
    }

    output.push(line);
  }

  let outputText = output.join("\n");
  if (hadTrailingNewline && !outputText.endsWith("\n")) {
    outputText += "\n";
  }
  return outputText;
}

function collapseEmptyStructuralBlocks(text: string): string {
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.replace(/\r/g, "").split("\n");
  const structure = buildFormattingStructure(text);
  const lineStartOffsets: number[] = [];
  let nextLineStartOffset = 0;

  for (const line of lines) {
    lineStartOffsets.push(nextLineStartOffset);
    nextLineStartOffset += line.length + 1;
  }

  const outputLines: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const nextLine = lines[index + 1];
    const trimmedEnd = line.trimEnd();
    const trimmed = trimmedEnd.trim();

    if (
      nextLine !== undefined &&
      trimmedEnd.endsWith("{") &&
      nextLine.trim() === "}"
    ) {
      const openBraceColumn = trimmedEnd.lastIndexOf("{");
      const closeTrimmedEnd = nextLine.trimEnd();
      const closeBraceColumn = closeTrimmedEnd.lastIndexOf("}");
      const openBraceOffset = lineStartOffsets[index] + openBraceColumn;
      const closeBraceOffset = lineStartOffsets[index + 1] + closeBraceColumn;

      if (
        structure.structuralOpenBraces.has(openBraceOffset) &&
        structure.structuralCloseBraces.has(closeBraceOffset) &&
        structure.inlineEmptyStructuralOpenBraces.has(openBraceOffset)
      ) {
        if (trimmed === "{") {
          outputLines.push(`${readLeadingIndentation(line)}{ }`);
        } else {
          outputLines.push(`${trimmedEnd} }`);
        }
        index += 1;
        continue;
      }

      if (
        structure.structuralOpenBraces.has(openBraceOffset) &&
        structure.structuralCloseBraces.has(closeBraceOffset) &&
        structure.multilineEmptyFunctionOpenBraces.has(openBraceOffset)
      ) {
        outputLines.push(line);
        outputLines.push("");
        outputLines.push(nextLine);
        index += 1;
        continue;
      }
    }

    outputLines.push(line);
  }

  let output = outputLines.join("\n");
  if (hadTrailingNewline && !output.endsWith("\n")) {
    output += "\n";
  }
  return output;
}

function normalizeHandleAssignmentTargetSpacing(text: string): string {
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.replace(/\r/g, "").split("\n");
  const normalized = lines.map(normalizeHandleAssignmentTargetSpacingLine);
  let outputText = normalized.join("\n");
  if (hadTrailingNewline && !outputText.endsWith("\n")) {
    outputText += "\n";
  }
  return outputText;
}

function normalizeHandleAssignmentTargetSpacingLine(line: string): string {
  let output = "";
  let inString: "'" | "\"" | null = null;
  let inBlockComment = false;

  for (let index = 0; index < line.length; index++) {
    const ch = line[index];
    const next = line[index + 1] ?? "";

    if (inString !== null) {
      output += ch;
      if (ch === "\\") {
        const escaped = line[index + 1];
        if (escaped !== undefined) {
          output += escaped;
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
      output += ch;
      if (ch === "*" && next === "/") {
        output += next;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      output += line.slice(index);
      break;
    }
    if (ch === "/" && next === "*") {
      output += "/*";
      index += 1;
      inBlockComment = true;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      inString = ch;
      output += ch;
      continue;
    }

    if (
      ch === "@" &&
      /\s/.test(next) &&
      shouldCollapseHandleAssignmentTargetSpace(line, index)
    ) {
      output += "@";
      while (/\s/.test(line[index + 1] ?? "")) {
        index += 1;
      }
      continue;
    }

    output += ch;
  }

  return output;
}

function shouldCollapseHandleAssignmentTargetSpace(line: string, atIndex: number): boolean {
  const previousNonSpace = findPreviousNonSpaceCharacter(line, atIndex - 1);
  if (
    previousNonSpace !== null &&
    !HANDLE_ASSIGNMENT_PREFIX_CHARACTERS.has(previousNonSpace)
  ) {
    return false;
  }

  let cursor = atIndex + 1;
  while (/\s/.test(line[cursor] ?? "")) {
    cursor++;
  }
  if (!isIdentifierStart(line[cursor] ?? "")) {
    return false;
  }

  const statementEnd = findStatementEndOnLine(line, cursor);
  const statementText = line.slice(cursor, statementEnd);
  return /(?:^|[\w\]\)])\s*(?:=|[+\-*/%&|^]?=)/.test(statementText);
}

const HANDLE_ASSIGNMENT_PREFIX_CHARACTERS = new Set([
  "(",
  "[",
  "{",
  "=",
  ",",
  ":",
  "?",
  ";",
  "!",
  "&",
  "|",
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "~",
  ")",
]);

function findPreviousNonSpaceCharacter(line: string, startIndex: number): string | null {
  for (let index = startIndex; index >= 0; index--) {
    if (!/\s/.test(line[index])) {
      return line[index];
    }
  }
  return null;
}

function findStatementEndOnLine(line: string, startIndex: number): number {
  for (let index = startIndex; index < line.length; index++) {
    const ch = line[index];
    const next = line[index + 1] ?? "";
    if (ch === ";" || (ch === "/" && next === "/")) {
      return index;
    }
  }
  return line.length;
}

function addBracesToIfElseChains(
  text: string,
  options: AngelScriptFormatterOptions,
): string {
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.replace(/\r/g, "").split("\n");
  const indentUnit = options.useTabs ? "\t" : " ".repeat(options.indentSize);
  const output: string[] = [];
  let pendingInlineChainIndent: string | null = null;

  const closePendingInlineChain = (): void => {
    if (pendingInlineChainIndent !== null) {
      output.push(`${pendingInlineChainIndent}}`);
      pendingInlineChainIndent = null;
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (pendingInlineChainIndent !== null) {
      const elseIfControl = parseInlineElseIfBranch(line);
      if (elseIfControl && elseIfControl.indent === pendingInlineChainIndent) {
        output.push(`${elseIfControl.indent}} ${elseIfControl.header} {`);
        output.push(`${elseIfControl.indent}${indentUnit}${elseIfControl.body}`);
        continue;
      }

      const elseControl = parseInlineElseBranch(line);
      if (elseControl && elseControl.indent === pendingInlineChainIndent) {
        output.push(`${elseControl.indent}} else {`);
        output.push(`${elseControl.indent}${indentUnit}${elseControl.body}`);
        output.push(`${elseControl.indent}}`);
        pendingInlineChainIndent = null;
        continue;
      }

      const bracedElse = parseBracedElseBranch(line);
      if (bracedElse && bracedElse.indent === pendingInlineChainIndent) {
        output.push(`${bracedElse.indent}} ${bracedElse.header} {`);
        pendingInlineChainIndent = null;
        continue;
      }

      closePendingInlineChain();
    }

    const cuddledElseIfControl = parseInlineElseIfBranch(line, true);
    if (cuddledElseIfControl?.hasLeadingCloseBrace) {
      output.push(`${cuddledElseIfControl.indent}} ${cuddledElseIfControl.header} {`);
      output.push(`${cuddledElseIfControl.indent}${indentUnit}${cuddledElseIfControl.body}`);
      pendingInlineChainIndent = cuddledElseIfControl.indent;
      continue;
    }

    const cuddledElseControl = parseInlineElseBranch(line, true);
    if (cuddledElseControl?.hasLeadingCloseBrace) {
      output.push(`${cuddledElseControl.indent}} else {`);
      output.push(`${cuddledElseControl.indent}${indentUnit}${cuddledElseControl.body}`);
      output.push(`${cuddledElseControl.indent}}`);
      continue;
    }

    const previousOutputIndex = output.length - 1;
    const previousOutput = previousOutputIndex >= 0 ? output[previousOutputIndex] : undefined;
    const elseIfControl = parseInlineElseIfBranch(line);
    if (
      elseIfControl &&
      previousOutput === `${elseIfControl.indent}}`
    ) {
      output[previousOutputIndex] = `${elseIfControl.indent}} ${elseIfControl.header} {`;
      output.push(`${elseIfControl.indent}${indentUnit}${elseIfControl.body}`);
      pendingInlineChainIndent = elseIfControl.indent;
      continue;
    }

    const elseControl = parseInlineElseBranch(line);
    if (
      elseControl &&
      previousOutput === `${elseControl.indent}}`
    ) {
      output[previousOutputIndex] = `${elseControl.indent}} else {`;
      output.push(`${elseControl.indent}${indentUnit}${elseControl.body}`);
      output.push(`${elseControl.indent}}`);
      continue;
    }

    const bracedElse = parseBracedElseBranch(line);
    if (
      bracedElse &&
      previousOutput === `${bracedElse.indent}}`
    ) {
      output[previousOutputIndex] = `${bracedElse.indent}} ${bracedElse.header} {`;
      continue;
    }

    const ifControl = parseInlineIfBranch(line);
    if (ifControl && nextLineStartsElse(lines, index, ifControl.indent)) {
      output.push(`${ifControl.indent}${ifControl.header} {`);
      output.push(`${ifControl.indent}${indentUnit}${ifControl.body}`);
      pendingInlineChainIndent = ifControl.indent;
      continue;
    }

    output.push(line);
  }

  closePendingInlineChain();
  let outputText = output.join("\n");
  if (hadTrailingNewline && !outputText.endsWith("\n")) {
    outputText += "\n";
  }
  return outputText;
}

function nextLineStartsElse(lines: string[], index: number, indent: string): boolean {
  const nextLine = lines[index + 1];
  if (nextLine === undefined) {
    return false;
  }
  return readLeadingIndentation(nextLine) === indent && nextLine.trimStart().startsWith("else");
}

type InlineIfElseBranch = {
  indent: string;
  header: string;
  body: string;
  hasLeadingCloseBrace?: boolean;
};

function parseInlineIfBranch(line: string): InlineIfElseBranch | null {
  const indent = readLeadingIndentation(line);
  let cursor = indent.length;
  if (!line.startsWith("if", cursor)) {
    return null;
  }
  cursor += "if".length;
  return parseInlineConditionBranchTail(line, indent, indent.length, cursor);
}

function parseInlineElseIfBranch(
  line: string,
  allowLeadingCloseBrace = false,
): InlineIfElseBranch | null {
  const indent = readLeadingIndentation(line);
  let cursor = indent.length;
  let hasLeadingCloseBrace = false;
  if (allowLeadingCloseBrace && line.startsWith("}", cursor)) {
    cursor++;
    if (!/\s/.test(line[cursor] ?? "")) {
      return null;
    }
    while (/\s/.test(line[cursor] ?? "")) {
      cursor++;
    }
    hasLeadingCloseBrace = true;
  }
  const headerStart = cursor;
  if (!line.startsWith("else", cursor)) {
    return null;
  }
  cursor += "else".length;
  if (!/\s/.test(line[cursor] ?? "")) {
    return null;
  }
  while (/\s/.test(line[cursor] ?? "")) {
    cursor++;
  }
  if (!line.startsWith("if", cursor)) {
    return null;
  }
  cursor += "if".length;
  const parsed = parseInlineConditionBranchTail(line, indent, headerStart, cursor);
  return parsed === null ? null : { ...parsed, hasLeadingCloseBrace };
}

function parseInlineConditionBranchTail(
  line: string,
  indent: string,
  headerStart: number,
  cursor: number,
): InlineIfElseBranch | null {
  if (!/\s|\(/.test(line[cursor] ?? "")) {
    return null;
  }
  while (/\s/.test(line[cursor] ?? "")) {
    cursor++;
  }
  if (line[cursor] !== "(") {
    return null;
  }

  const closeParen = findMatchingParen(line, cursor);
  if (closeParen < 0) {
    return null;
  }

  const body = line.slice(closeParen + 1).trim();
  if (!isInlineStatementBody(body)) {
    return null;
  }

  return {
    indent,
    header: line.slice(headerStart, closeParen + 1).trimEnd(),
    body,
  };
}

function parseInlineElseBranch(
  line: string,
  allowLeadingCloseBrace = false,
): InlineIfElseBranch | null {
  const indent = readLeadingIndentation(line);
  let cursor = indent.length;
  let hasLeadingCloseBrace = false;
  if (allowLeadingCloseBrace && line.startsWith("}", cursor)) {
    cursor++;
    if (!/\s/.test(line[cursor] ?? "")) {
      return null;
    }
    while (/\s/.test(line[cursor] ?? "")) {
      cursor++;
    }
    hasLeadingCloseBrace = true;
  }
  if (!line.startsWith("else", cursor)) {
    return null;
  }
  cursor += "else".length;
  if (!/\s/.test(line[cursor] ?? "")) {
    return null;
  }
  while (/\s/.test(line[cursor] ?? "")) {
    cursor++;
  }
  if (line.startsWith("if", cursor) || line[cursor] === "{") {
    return null;
  }

  const body = line.slice(cursor).trim();
  if (!isInlineStatementBody(body)) {
    return null;
  }

  return { indent, header: "else", body, hasLeadingCloseBrace };
}

function parseBracedElseBranch(line: string): { indent: string; header: string } | null {
  const indent = readLeadingIndentation(line);
  const trimmed = line.slice(indent.length).trim();
  if (trimmed === "else {") {
    return { indent, header: "else" };
  }
  if (/^else\s+if\b.*\{\s*$/.test(trimmed)) {
    return { indent, header: trimmed.slice(0, -1).trimEnd() };
  }
  return null;
}

function isInlineStatementBody(body: string): boolean {
  if (body.length === 0 || body.startsWith("{")) {
    return false;
  }
  return /;\s*(?:(?:\/\/.*)|(?:\/\*.*\*\/\s*))?$/.test(body);
}

function joinLeadingDotContinuations(text: string): string {
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.replace(/\r/g, "").split("\n");
  const output: string[] = [];

  for (const line of lines) {
    const trimmedStart = line.trimStart();
    const previousIndex = output.length - 1;
    const previous = previousIndex >= 0 ? output[previousIndex] : undefined;
    if (
      previous !== undefined &&
      trimmedStart.startsWith(".") &&
      !trimmedStart.startsWith("...") &&
      !isDigit(trimmedStart[1] ?? "") &&
      previous.trim().length > 0 &&
      !previous.trimStart().startsWith("#") &&
      !previous.includes("//")
    ) {
      output[previousIndex] = `${previous.trimEnd()}${trimmedStart}`;
      continue;
    }

    output.push(line);
  }

  let outputText = output.join("\n");
  if (hadTrailingNewline && !outputText.endsWith("\n")) {
    outputText += "\n";
  }
  return outputText;
}

function applyHandleAssignmentControlBlocks(
  text: string,
  options: AngelScriptFormatterOptions,
): string {
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.replace(/\r/g, "").split("\n");
  const indentUnit = options.useTabs ? "\t" : " ".repeat(options.indentSize);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const ifControl = parseUnbracedHandleAssignmentIf(line);
    if (ifControl) {
      const nextElse = parseUnbracedHandleAssignmentElse(lines[index + 1] ?? "");
      if (nextElse && nextElse.indent === ifControl.indent) {
        output.push(`${ifControl.indent}${ifControl.header} {`);
        output.push(`${ifControl.indent}${indentUnit}@${ifControl.body}`);
        output.push(`${ifControl.indent}} else {`);
        output.push(`${ifControl.indent}${indentUnit}@${nextElse.body}`);
        output.push(`${ifControl.indent}}`);
        index += 1;
      } else {
        output.push(`${ifControl.indent}${ifControl.header} @${ifControl.body}`);
      }
      continue;
    }

    const elseIfControl = parseUnbracedHandleAssignmentElseIf(line);
    if (elseIfControl) {
      output.push(`${elseIfControl.indent}${elseIfControl.header} @${elseIfControl.body}`);
      continue;
    }

    const elseControl = parseUnbracedHandleAssignmentElse(line);
    if (elseControl) {
      const previousOutputIndex = output.length - 1;
      if (previousOutputIndex >= 0 && output[previousOutputIndex] === `${elseControl.indent}}`) {
        output[previousOutputIndex] = `${elseControl.indent}} else {`;
      } else {
        output.push(`${elseControl.indent}else {`);
      }
      output.push(`${elseControl.indent}${indentUnit}@${elseControl.body}`);
      output.push(`${elseControl.indent}}`);
      continue;
    }

    output.push(line);
  }

  let outputText = output.join("\n");
  if (hadTrailingNewline && !outputText.endsWith("\n")) {
    outputText += "\n";
  }
  return outputText;
}

function parseUnbracedHandleAssignmentIf(
  line: string,
): { indent: string; header: string; body: string } | null {
  const indent = line.match(/^[\t ]*/)?.[0] ?? "";
  let cursor = indent.length;
  if (!line.startsWith("if", cursor)) {
    return null;
  }
  cursor += "if".length;
  if (!/\s|\(/.test(line[cursor] ?? "")) {
    return null;
  }
  while (/\s/.test(line[cursor] ?? "")) {
    cursor++;
  }
  if (line[cursor] !== "(") {
    return null;
  }

  const closeParen = findMatchingParen(line, cursor);
  if (closeParen < 0) {
    return null;
  }

  cursor = closeParen + 1;
  while (/\s/.test(line[cursor] ?? "")) {
    cursor++;
  }
  if (line[cursor] !== "@") {
    return null;
  }

  const body = line.slice(cursor + 1).trim();
  if (!body.endsWith(";")) {
    return null;
  }

  return {
    indent,
    header: line.slice(indent.length, closeParen + 1).trimEnd(),
    body,
  };
}

function parseUnbracedHandleAssignmentElseIf(
  line: string,
): { indent: string; header: string; body: string } | null {
  const indent = line.match(/^[\t ]*/)?.[0] ?? "";
  let cursor = indent.length;
  if (!line.startsWith("else", cursor)) {
    return null;
  }
  cursor += "else".length;
  if (!/\s/.test(line[cursor] ?? "")) {
    return null;
  }
  while (/\s/.test(line[cursor] ?? "")) {
    cursor++;
  }
  if (!line.startsWith("if", cursor)) {
    return null;
  }
  cursor += "if".length;
  if (!/\s|\(/.test(line[cursor] ?? "")) {
    return null;
  }
  while (/\s/.test(line[cursor] ?? "")) {
    cursor++;
  }
  if (line[cursor] !== "(") {
    return null;
  }

  const closeParen = findMatchingParen(line, cursor);
  if (closeParen < 0) {
    return null;
  }

  cursor = closeParen + 1;
  while (/\s/.test(line[cursor] ?? "")) {
    cursor++;
  }
  if (line[cursor] !== "@") {
    return null;
  }

  const body = line.slice(cursor + 1).trim();
  if (!body.endsWith(";")) {
    return null;
  }

  return {
    indent,
    header: line.slice(indent.length, closeParen + 1).trimEnd(),
    body,
  };
}

function parseUnbracedHandleAssignmentElse(
  line: string,
): { indent: string; body: string } | null {
  const indent = line.match(/^[\t ]*/)?.[0] ?? "";
  let cursor = indent.length;
  if (!line.startsWith("else", cursor)) {
    return null;
  }
  cursor += "else".length;
  if (!/\s|@/.test(line[cursor] ?? "")) {
    return null;
  }
  while (/\s/.test(line[cursor] ?? "")) {
    cursor++;
  }
  if (line[cursor] !== "@") {
    return null;
  }

  const body = line.slice(cursor + 1).trim();
  if (!body.endsWith(";")) {
    return null;
  }

  return { indent, body };
}

function applyAllmanBraceStyle(text: string): string {
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.replace(/\r/g, "").split("\n");
  const structure = buildFormattingStructure(text);
  const outputLines: string[] = [];
  let lineStartOffset = 0;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) {
      outputLines.push(line);
      lineStartOffset += line.length + 1;
      continue;
    }
    if (trimmed.trim() === "{") {
      outputLines.push(line);
      lineStartOffset += line.length + 1;
      continue;
    }
    if (trimmed.trimStart().startsWith("#")) {
      outputLines.push(line);
      lineStartOffset += line.length + 1;
      continue;
    }
    if (!trimmed.endsWith("{")) {
      outputLines.push(line);
      lineStartOffset += line.length + 1;
      continue;
    }
    const braceOffset = lineStartOffset + trimmed.length - 1;
    if (!structure.structuralOpenBraces.has(braceOffset)) {
      outputLines.push(line);
      lineStartOffset += line.length + 1;
      continue;
    }

    const indent = line.match(/^[\t ]*/)?.[0] ?? "";
    const withoutBrace = trimmed.slice(0, -1).trimEnd();
    outputLines.push(withoutBrace);
    outputLines.push(`${indent}{`);
    lineStartOffset += line.length + 1;
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
    const forceWrap =
      options.argumentWrap === "always" || options.chainWrap === "always";
    if (!forceWrap && (line.length <= options.maxLineWidth || options.maxLineWidth <= 0)) {
      output.push(line);
      continue;
    }
    if (line.trimStart().startsWith("#")) {
      output.push(line);
      continue;
    }
    if (hasTopLevelTernary(line)) {
      output.push(...tryWrapTernary(line, options, indentUnit));
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

function normalizeRepeatedReceiverConcatenationContinuations(text: string): string {
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.replace(/\r/g, "").split("\n");
  const output: string[] = [];
  let activeReceiver: string | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const previousIndex = output.length - 1;
    const previous = previousIndex >= 0 ? output[previousIndex] : undefined;
    const trimmedStart = line.trimStart();

    if (
      (activeReceiver !== null || previous !== undefined) &&
      trimmedStart.startsWith(".")
    ) {
      if (activeReceiver === null && previous !== undefined) {
        const previousMatch = /^(.*\+\s*)([A-Za-z_]\w*)$/.exec(previous);
        if (previousMatch !== null) {
          activeReceiver = previousMatch[2];
          output[previousIndex] = previousMatch[1].trimEnd();
        }
      }

      if (activeReceiver !== null) {
        const nextLine = lines[index + 1];
        const nextTrimmedStart = nextLine?.trimStart() ?? "";
        let rewritten = `${readLeadingIndentation(line)}${activeReceiver}${trimmedStart}`;

        const trailingReceiverPattern = new RegExp(`^(.*\\+\\s*)${activeReceiver}$`);
        if (nextLine !== undefined && nextTrimmedStart.startsWith(".")) {
          const rewrittenMatch = trailingReceiverPattern.exec(rewritten);
          if (rewrittenMatch !== null) {
            rewritten = rewrittenMatch[1].trimEnd();
          } else {
            activeReceiver = null;
          }
        } else {
          activeReceiver = null;
        }

        output.push(rewritten);
        continue;
      }
    }

    activeReceiver = null;
    output.push(line);
  }

  let outputText = output.join("\n");
  if (hadTrailingNewline && !outputText.endsWith("\n")) {
    outputText += "\n";
  }
  return outputText;
}

function tryWrapTernary(
  line: string,
  options: AngelScriptFormatterOptions,
  indentUnit: string,
): string[] {
  const effectiveLineLength = line.length + (options.lineWrapBaseIndentWidth ?? 0);
  if (options.maxLineWidth <= 0 || effectiveLineLength <= options.maxLineWidth) {
    return [line];
  }

  const indent = line.match(/^[\t ]*/)?.[0] ?? "";
  const trimmed = line.trim();
  const ternaryRange = findTopLevelTernaryRange(trimmed);
  if (ternaryRange === null) {
    return [line];
  }

  const condition = trimmed.slice(0, ternaryRange.questionIndex).trimEnd();
  const trueExpression = trimmed
    .slice(ternaryRange.questionIndex + 1, ternaryRange.colonIndex)
    .trim();
  const falseExpression = trimmed.slice(ternaryRange.colonIndex + 1).trim();

  if (
    condition.length === 0 ||
    trueExpression.length === 0 ||
    falseExpression.length === 0 ||
    trueExpression.includes("?") ||
    falseExpression.includes("?") ||
    !trueExpression.startsWith("(") ||
    !falseExpression.startsWith("(")
  ) {
    return [line];
  }

  return [
    `${indent}${condition} ?`,
    `${indent}${indentUnit}${trueExpression} : ${falseExpression}`,
  ];
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
  if (parts.length <= 2) {
    return [line];
  }
  if (options.chainWrap === "auto" && parts.length <= 3) {
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
  return findTopLevelTernaryRange(line) !== null;
}

function isScopeResolutionAt(text: string, index: number): boolean {
  return text[index] === ":" && (text[index - 1] === ":" || text[index + 1] === ":");
}

function findTopLevelTernaryRange(line: string): { questionIndex: number; colonIndex: number } | null {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let inString: "'" | "\"" | null = null;
  let inBlockComment = false;
  let firstQuestionIndex = -1;
  let ternaryDepth = 0;

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
      if (ternaryDepth === 0) {
        firstQuestionIndex = index;
      }
      ternaryDepth += 1;
      continue;
    }
    if (isScopeResolutionAt(line, index)) {
      continue;
    }
    if (ch === ":" && ternaryDepth > 0) {
      ternaryDepth -= 1;
      if (ternaryDepth === 0 && firstQuestionIndex >= 0) {
        return { questionIndex: firstQuestionIndex, colonIndex: index };
      }
    }
  }

  return null;
}

function findTopLevelUnmatchedQuestionIndex(line: string): number {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let inString: "'" | "\"" | null = null;
  let inBlockComment = false;
  let firstQuestionIndex = -1;
  let ternaryDepth = 0;

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
      if (ternaryDepth === 0) {
        firstQuestionIndex = index;
      }
      ternaryDepth += 1;
      continue;
    }
    if (isScopeResolutionAt(line, index)) {
      continue;
    }
    if (ch === ":" && ternaryDepth > 0) {
      ternaryDepth -= 1;
      if (ternaryDepth === 0) {
        firstQuestionIndex = -1;
      }
    }
  }

  return ternaryDepth > 0 ? firstQuestionIndex : -1;
}

function findTopLevelColonInFragment(text: string): number {
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
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0 &&
      angleDepth === 0 &&
      ch === ":" &&
      !isScopeResolutionAt(text, index)
    ) {
      return index;
    }
  }

  return -1;
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
