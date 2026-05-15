import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import {
  formatAngelScript,
  formatAngelScriptRange,
  formatAngelScriptRangeEdit,
  type AngelScriptFormatterOptions
} from "./formatter";

type GrammarDeclarationNode = {
  kind: string;
  name?: string;
  typeKind?: string;
  declarationKind?: string;
  body?: GrammarDeclarationNode[] | unknown;
};

type GrammarParseResult = {
  program: {
    declarations: GrammarDeclarationNode[];
  };
  errors: Array<{
    message: string;
    start: number;
    end: number;
  }>;
};

type GrammarParser = (text: string) => GrammarParseResult;

const requireFromCompiledTest = createRequire(__filename);
let cachedGrammarParser: GrammarParser | null | undefined;

function loadGrammarParser(): GrammarParser | null {
  if (cachedGrammarParser !== undefined) {
    return cachedGrammarParser;
  }

  try {
    const parserModule = requireFromCompiledTest(
      "openplanet-angelscript-core"
    ) as { parseGrammarPipeline?: unknown };
    cachedGrammarParser =
      typeof parserModule.parseGrammarPipeline === "function"
        ? parserModule.parseGrammarPipeline as GrammarParser
        : null;
  } catch {
    cachedGrammarParser = null;
  }

  return cachedGrammarParser;
}

function runCase(
  name: string,
  input: string,
  expected: string,
  options: Partial<AngelScriptFormatterOptions> = {},
): void {
  const actual = formatAngelScript(input, { insertFinalNewline: false, ...options });
  assert.equal(actual, expected, `${name} failed.\n--- actual ---\n${actual}\n--- expected ---\n${expected}`);
}

function runIdempotenceCase(
  name: string,
  input: string,
  options: Partial<AngelScriptFormatterOptions> = {},
): void {
  const once = formatAngelScript(input, { insertFinalNewline: false, ...options });
  const twice = formatAngelScript(once, { insertFinalNewline: false, ...options });
  assert.equal(once, twice, `${name} is not idempotent.`);
}

function collectDeclarationSummary(
  declarations: GrammarDeclarationNode[],
  into: string[] = [],
): string[] {
  for (const declaration of declarations) {
    if (declaration.kind !== "statement") {
      const label =
        declaration.name ??
        declaration.typeKind ??
        declaration.declarationKind ??
        "";
      into.push(`${declaration.kind}:${label}`);
    }
    if (Array.isArray(declaration.body)) {
      collectDeclarationSummary(declaration.body, into);
    }
  }
  return into;
}

function assertParserAccepts(name: string, code: string): string[] {
  const parser = loadGrammarParser();
  if (parser === null) {
    assert.doesNotMatch(
      code,
      /(?:\{\s*$)|(?:\(\s*$)|(?:\[\s*$)/,
      `${name} parser oracle unavailable and fallback syntax smoke found a dangling opener.`
    );
    return [];
  }

  const result = parser(code);
  assert.deepEqual(
    result.errors,
    [],
    `${name} parser errors:\n${result.errors.map((error) => `${error.message} @ ${error.start}-${error.end}`).join("\n")}`
  );
  return collectDeclarationSummary(result.program.declarations);
}

function runParserBackedAcceptanceCase(
  name: string,
  input: string,
  options: Partial<AngelScriptFormatterOptions> = {},
): void {
  const inputSummary = assertParserAccepts(`${name} input`, input);
  const actual = formatAngelScript(input, { insertFinalNewline: false, ...options });
  const outputSummary = assertParserAccepts(`${name} formatted output`, actual);
  if (inputSummary.length > 0) {
    assert.deepEqual(outputSummary, inputSummary, `${name} changed parser-visible declarations.`);
  }

  const twice = formatAngelScript(actual, { insertFinalNewline: false, ...options });
  assert.equal(actual, twice, `${name} is not idempotent after formatting.`);
}

function testRangeFormattingDoesNotChangeOutsideRange(): void {
  const input = [
    "void Main(){",
    "  int a=1+2;",
    "  int b=3+4;",
    "}"
  ].join("\n");
  const output = formatAngelScriptRange(input, 1, 1, { insertFinalNewline: false });
  const inputLines = input.split("\n");
  const outputLines = output.split("\n");
  assert.equal(outputLines[0], inputLines[0], "Range format changed line 0.");
  assert.equal(outputLines[2], inputLines[2], "Range format changed line 2.");
  assert.equal(outputLines[3], inputLines[3], "Range format changed line 3.");
  assert.equal(outputLines[1], "  int a = 1 + 2;", "Range format did not format selected line.");
}

function testRangeFormattingEditPayload(): void {
  const input = [
    "void Main() {",
    "  int a=1+2;",
    "  int b=3+4;",
    "}"
  ].join("\n");
  const edit = formatAngelScriptRangeEdit(input, 1, 1, { insertFinalNewline: false });
  assert.equal(edit.startLine, 1);
  assert.equal(edit.endLine, 1);
  assert.equal(edit.replacementText, "  int a = 1 + 2;");
}

function testRangeFormattingAcceptanceFixture(): void {
  const input = readAcceptanceFixture("wrapping-options-range.as");
  const output = formatAngelScriptRange(input, 3, 5, {
    insertFinalNewline: false,
    maxLineWidth: 42,
    argumentWrap: "always",
    chainWrap: "always",
    chainWrapStyle: "trailingDot",
  });
  const inputLines = input.split("\n");
  const outputLines = output.split("\n");

  assert.equal(outputLines[0], inputLines[0], "Range fixture changed line 0.");
  assert.equal(outputLines[1], inputLines[1], "Range fixture changed line 1.");
  assert.equal(outputLines[2], inputLines[2], "Range fixture changed line 2.");
  assert.equal(
    outputLines.slice(-2).join("\n"),
    inputLines.slice(-2).join("\n"),
    "Range fixture changed trailing unselected lines."
  );
  assert.match(output, /DoSomethingLong\(/, "Range fixture did not keep selected call.");
  assertParserAccepts("range acceptance fixture", output);
}

function readAcceptanceFixture(fileName: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), "test-files", "formatter-acceptance", fileName),
    "utf8"
  ).replace(/\r\n/g, "\n").replace(/\n$/, "");
}

function readSnapshotExpected(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").replace(/\r?\n$/, "");
}

function testParserBackedFormatterAcceptanceFixtures(): void {
  const options: Partial<AngelScriptFormatterOptions> = {
    maxLineWidth: 80,
    argumentWrap: "auto",
    chainWrap: "auto",
  };

  for (const fixtureName of [
    "syntax-surface.as",
    "openplanet-attributes-imports.as",
    "initializers.as",
    "comments-preprocessor-suppression.as",
  ]) {
    runParserBackedAcceptanceCase(
      `parser-backed acceptance ${fixtureName}`,
      readAcceptanceFixture(fixtureName),
      options
    );
  }
}

function testConformanceSmokeFormatsToParserAcceptedCode(): void {
  const smokePath = path.join(
    process.cwd(),
    "test-files",
    "formatter-acceptance",
    "conformance-smoke.jsonl"
  );
  const lines = fs.readFileSync(smokePath, "utf8").split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    const entry = JSON.parse(line) as {
      id: string;
      expect: string;
      code: string;
    };
    if (entry.expect !== "compile_success") {
      continue;
    }
    runParserBackedAcceptanceCase(`conformance smoke ${entry.id}`, entry.code, {
      maxLineWidth: 100,
      argumentWrap: "auto",
      chainWrap: "auto",
    });
  }
}

function testMediumCorpusIdempotence(): void {
  const corpusPath = path.join(
    process.cwd(),
    "test-files",
    "formatter-corpus",
    "medium-corpus.as"
  );
  const corpus = fs.readFileSync(corpusPath, "utf8");
  runIdempotenceCase("medium-corpus-idempotence", corpus, {
    maxLineWidth: 100,
    argumentWrap: "auto",
    chainWrap: "auto",
  });
}

function testMediumCorpusSnapshot(): void {
  const corpusPath = path.join(
    process.cwd(),
    "test-files",
    "formatter-corpus",
    "medium-corpus.as"
  );
  const expectedPath = path.join(
    process.cwd(),
    "test-files",
    "formatter-corpus",
    "medium-corpus.expected.as"
  );
  const corpus = fs.readFileSync(corpusPath, "utf8");
  const expected = readSnapshotExpected(expectedPath);
  const actual = formatAngelScript(corpus, {
    insertFinalNewline: false,
    maxLineWidth: 100,
    argumentWrap: "auto",
    chainWrap: "auto",
  });
  assert.equal(actual, expected, "Medium corpus snapshot mismatch.");
}

function testEdgeCorpusSnapshot(): void {
  const corpusPath = path.join(
    process.cwd(),
    "test-files",
    "formatter-corpus",
    "edge-cases.as"
  );
  const expectedPath = path.join(
    process.cwd(),
    "test-files",
    "formatter-corpus",
    "edge-cases.expected.as"
  );

  const options: Partial<AngelScriptFormatterOptions> = {
    insertFinalNewline: false,
    maxLineWidth: 30,
    argumentWrap: "always",
    chainWrap: "always",
    chainWrapStyle: "trailingDot",
    braceStyle: "allman"
  };

  const corpus = fs.readFileSync(corpusPath, "utf8");
  const expected = readSnapshotExpected(expectedPath);

  const actual = formatAngelScript(corpus, options);
  assert.equal(actual, expected, "Edge corpus snapshot mismatch.");
}

function main(): void {
  runCase(
    "basic-blocks",
    'void  Main(){int a=1+2;if(a>0){print("x");}else{a--;}}',
    [
      "void Main() {",
      "  int a = 1 + 2;",
      "  if (a > 0) {",
      '    print("x");',
      "  } else {",
      "    a--;",
      "  }",
      "}",
    ].join("\n"),
  );

  runCase(
    "else-if-chain-cuddles-with-closing-brace",
    [
      "                    if (lk == \"text\") {",
      "                        node.typed.text = v;",
      "                        consumed = true;",
      "                    }",
      "                    else if (lk == \"textsize\") {",
      "                        node.typed.textSize = _ParseFloat(v, node.typed.textSize);",
      "                        consumed = true;",
      "                    }",
      "                    else if (lk == \"textfont\") {",
      "                        node.typed.textFont = v;",
      "                        consumed = true;",
      "                    }",
    ].join("\n"),
    [
      "                    if (lk == \"text\") {",
      "                        node.typed.text = v;",
      "                        consumed = true;",
      "                    } else if (lk == \"textsize\") {",
      "                        node.typed.textSize = _ParseFloat(v, node.typed.textSize);",
      "                        consumed = true;",
      "                    } else if (lk == \"textfont\") {",
      "                        node.typed.textFont = v;",
      "                        consumed = true;",
      "                    }",
    ].join("\n"),
    { indentSize: 4, maxLineWidth: 80 },
  );

  runCase(
    "preprocessor-comments-prefix-string",
    "   #if TMNEXT\nvoid Main(){//x\nprint(n\"abc\");\n}\n#endif\n",
    [
      "#if TMNEXT",
      "void Main() {",
      "  //x",
      '  print(n"abc");',
      "}",
      "#endif",
    ].join("\n"),
  );

  runCase(
    "for-header-stays-inline",
    "void Main(){for(int i=0;i<3;i++){print(i);}}",
    [
      "void Main() {",
      "  for (int i = 0; i < 3; i++) {",
      "    print(i);",
      "  }",
      "}",
    ].join("\n"),
  );

  runCase(
    "generic-spacing-and-reference-modifiers",
    "void Main(const string&in name,string&out outName){array<array<int>>vals;dictionary<string,array<uint>>map;MyType@handle=@GetHandle();}",
    [
      "void Main(const string &in name, string &out outName) {",
      "  array<array<int>> vals;",
      "  dictionary<string, array<uint>> map;",
      "  MyType@ handle = @GetHandle();",
      "}",
    ].join("\n"),
  );

  runCase(
    "generic-type-arguments-allow-custom-type-starts",
    "array < _SelectorTok@ > @_ParseSelectorChain(const string &in selector, bool allowClass) {return {};}",
    [
      "array<_SelectorTok@> @_ParseSelectorChain(const string &in selector, bool allowClass) {",
      "  return {};",
      "}",
    ].join("\n"),
  );

  runCase(
    "multiline-signature-opening-brace-cuddles",
    [
      "CGameManialinkControl@ Resolve(",
      "    CGameManialinkControl@ cur,",
      "    UiNav::_SelectorTok@ tok,",
      "    bool allowSelf",
      ")",
      "{",
      "    if (cur is null || tok is null) return cur;",
      "    return cur;",
      "}",
    ].join("\n"),
    [
      "CGameManialinkControl@ Resolve(",
      "    CGameManialinkControl@ cur,",
      "    UiNav::_SelectorTok@ tok,",
      "    bool allowSelf",
      ") {",
      "    if (cur is null || tok is null) return cur;",
      "    return cur;",
      "}",
    ].join("\n"),
    { indentSize: 4, maxLineWidth: 80 },
  );

  runCase(
    "partial-signature-tail-opening-brace-cuddles",
    [
      "            UiNav::_SelectorTok@ tok,",
      "            bool allowSelf",
      "        )",
      "        {",
      "            if (cur is null || tok is null) return;",
    ].join("\n"),
    [
      "        UiNav::_SelectorTok@ tok,",
      "        bool allowSelf",
      "        ) {",
      "            if (cur is null || tok is null) return;",
    ].join("\n"),
    { indentSize: 4 },
  );

  runCase(
    "cast-type-parameter-spacing",
    [
      "void Main(){",
      "if(cast < CControlQuad >(ch)!is null)return ch;",
      "if(cast < CControlButton >(ch)!is null)return ch;",
      "if(cast < CGameControlCardGeneric >(ch)!is null)return ch;",
      "}",
    ].join("\n"),
    [
      "void Main() {",
      "  if (cast<CControlQuad>(ch) !is null) return ch;",
      "  if (cast<CControlButton>(ch) !is null) return ch;",
      "  if (cast<CGameControlCardGeneric>(ch) !is null) return ch;",
      "}",
    ].join("\n"),
  );

  runCase(
    "handle-declarators-space-before-name",
    [
      "void Main(){",
      "ManiaLinkSource source=ManiaLinkSource::CurrentApp;",
      "CGameManiaApp@maniaApp=null;",
      "CGameManialinkPage@localPage=null;",
      "CGameUILayer@layer=null;",
      "int layerIx=-1;",
      "CGameManialinkControl@ml=null;",
      "auto current=@GetHandle();",
      "}",
    ].join("\n"),
    [
      "void Main() {",
      "  ManiaLinkSource source = ManiaLinkSource::CurrentApp;",
      "  CGameManiaApp@ maniaApp = null;",
      "  CGameManialinkPage@ localPage = null;",
      "  CGameUILayer@ layer = null;",
      "  int layerIx = -1;",
      "  CGameManialinkControl@ ml = null;",
      "  auto current = @GetHandle();",
      "}",
    ].join("\n"),
  );

  runCase(
    "handle-assignment-prefix-at-statement-start",
    "@ app = GetManiaApp();",
    "@app = GetManiaApp();",
  );

  runCase(
    "handle-assignment-member-target-prefix-at-statement-start",
    [
      "    @ st.cachedMl = null;",
      "    CGameManiaApp@ maniaApp = null;",
    ].join("\n"),
    [
      "    @st.cachedMl = null;",
      "    CGameManiaApp@ maniaApp = null;",
    ].join("\n"),
  );

  runCase(
    "handle-assignment-prefix-after-return",
    "void Main(){return @ app;return -1;return !ok;}",
    [
      "void Main() {",
      "  return @app;",
      "  return -1;",
      "  return !ok;",
      "}",
    ].join("\n"),
  );

  runCase(
    "handle-assignment-control-bodies-become-blocks",
    [
      "void Main(){",
      "if(n.prev !is null)@ n.prev.next=n.next;",
      "else@ g_SelectorTokCacheHead=n.next;",
      "",
      "if(n.next !is null)@ n.next.prev=n.prev;",
      "else@ g_SelectorTokCacheTail=n.prev;",
      "}",
    ].join("\n"),
    [
      "void Main() {",
      "  if (n.prev !is null) {",
      "    @n.prev.next = n.next;",
      "  } else {",
      "    @g_SelectorTokCacheHead = n.next;",
      "  }",
      "",
      "  if (n.next !is null) {",
      "    @n.next.prev = n.prev;",
      "  } else {",
      "    @g_SelectorTokCacheTail = n.prev;",
      "  }",
      "}",
    ].join("\n"),
  );

  runCase(
    "standalone-handle-assignment-control-body-stays-inline",
    "if (g_SelectorTokCacheHead !is null)@ g_SelectorTokCacheHead.prev = n;",
    "if (g_SelectorTokCacheHead !is null) @g_SelectorTokCacheHead.prev = n;",
  );

  runCase(
    "identifier-after-bang-is-operator-prefix-stays-intact",
    [
      "bool isSelf=(i==0);",
      "if(!isSelf){",
      "}",
    ].join("\n"),
    [
      "bool isSelf = (i == 0);",
      "if (!isSelf) {",
      "}",
    ].join("\n"),
  );

  runCase(
    "if-else-handle-assignment-chain-adds-braces",
    [
      "            if (appKind == 1) @app = UiNav::Layers::GetManiaAppMenu();",
      "            else if (appKind == 0)@ app = UiNav::Layers::GetManiaAppPlayground();",
      "            else {",
      "                @app = UiNav::Layers::GetManiaApp();",
      "            }",
    ].join("\n"),
    [
      "            if (appKind == 1) {",
      "                @app = UiNav::Layers::GetManiaAppMenu();",
      "            } else if (appKind == 0) {",
      "                @app = UiNav::Layers::GetManiaAppPlayground();",
      "            } else {",
      "                @app = UiNav::Layers::GetManiaApp();",
      "            }",
    ].join("\n"),
    { indentSize: 4 },
  );

  runCase(
    "if-else-return-chain-adds-braces",
    [
      "if (kind == 1) return first;",
      "else if (kind == 2) return second;",
      "else return fallback;",
    ].join("\n"),
    [
      "if (kind == 1) {",
      "  return first;",
      "} else if (kind == 2) {",
      "  return second;",
      "} else {",
      "  return fallback;",
      "}",
    ].join("\n"),
  );

  runCase(
    "while-after-if-block-does-not-cuddle-like-do-while",
    [
      "    if (_fnName.Length > logging::S_maxFunctionNameLength) {",
      "        _fnName = _fnName.SubStr(0, logging::S_maxFunctionNameLength);",
      "    } while (_fnName.Length<logging::S_maxFunctionNameLength) _fnName += \" \";",
      "    if (!logging::S_showFunctionNameInLogs) _fnName = \"\";",
    ].join("\n"),
    [
      "    if (_fnName.Length > logging::S_maxFunctionNameLength) {",
      "        _fnName = _fnName.SubStr(0, logging::S_maxFunctionNameLength);",
      "    }",
      "    while (_fnName.Length < logging::S_maxFunctionNameLength) _fnName += \" \";",
      "    if (!logging::S_showFunctionNameInLogs) _fnName = \"\";",
    ].join("\n"),
    { indentSize: 4 },
  );

  runCase(
    "real-do-while-stays-cuddled",
    [
      "void Main(){",
      "do{",
      "Tick();",
      "}while(Ready());",
      "}",
    ].join("\n"),
    [
      "void Main() {",
      "  do {",
      "    Tick();",
      "  } while (Ready());",
      "}",
    ].join("\n"),
  );

  runCase(
    "unary-after-binary-operator-spacing",
    "void Main(){int lastIx=-1;float scaled=value*-1.0;bool ok=flag&&!bad;}",
    [
      "void Main() {",
      "  int lastIx = -1;",
      "  float scaled = value * -1.0;",
      "  bool ok = flag && !bad;",
      "}",
    ].join("\n"),
  );

  runCase(
    "binary-operator-before-parenthesized-expression-spacing",
    'if (controlTreeType.Length > 0) line += " controlTree=" + controlTreeType + " controlTreeVis=" +(controlTreeVis ? "true" : "false") + " controlTreeHiddenExt=" +(controlTreeHiddenExt ? "true" : "false");',
    'if (controlTreeType.Length > 0) line += " controlTree=" + controlTreeType + " controlTreeVis=" + (controlTreeVis ? "true" : "false") + " controlTreeHiddenExt=" + (controlTreeHiddenExt ? "true" : "false");',
  );

  runCase(
    "leading-plus-continuation-indents-one-level-deeper",
    [
      '            g_Status = "Cloned live tree: " + g_Doc.nodes.Length + " nodes across " + appendedRoots + " root(s)."',
      '            + (strippedClip > 0 ?(" Stripped clipping on " + strippedClip + " frame(s).") : "")',
      '            + (S_CenterImportedLiveCopy ?(centered ? " Centered." : " Centering skipped.") : "");',
    ].join("\n"),
    [
      '            g_Status = "Cloned live tree: " + g_Doc.nodes.Length + " nodes across " + appendedRoots + " root(s)."',
      '                + (strippedClip > 0 ? (" Stripped clipping on " + strippedClip + " frame(s).") : "")',
      '                + (S_CenterImportedLiveCopy ? (centered ? " Centered." : " Centering skipped.") : "");',
    ].join("\n"),
    { indentSize: 4 },
  );

  runCase(
    "leading-logical-operator-continuation-indents-one-level-deeper",
    [
      "  bool ok = first",
      "  && second;",
    ].join("\n"),
    [
      "  bool ok = first",
      "    && second;",
    ].join("\n"),
  );

  runCase(
    "leading-or-operator-continuation-indents-one-level-deeper",
    [
      "            bool wantClone = S_PreviewDebugOverlayEnabled",
      "            || S_PreviewSelectedBoundsOverlayEnabled",
      "            || S_PreviewSelectedParentBoundsOverlayEnabled",
      "            || (S_BuilderStickySnapGuidesEnabled && g_BuilderStickyGuides.active)",
      "            || S_PreviewSanitizeInvalidTags",
      "            || S_PreviewOmitGenericCommonAttrs",
      "            || g_PreviewForceFitOnce;",
    ].join("\n"),
    [
      "            bool wantClone = S_PreviewDebugOverlayEnabled",
      "                || S_PreviewSelectedBoundsOverlayEnabled",
      "                || S_PreviewSelectedParentBoundsOverlayEnabled",
      "                || (S_BuilderStickySnapGuidesEnabled && g_BuilderStickyGuides.active)",
      "                || S_PreviewSanitizeInvalidTags",
      "                || S_PreviewOmitGenericCommonAttrs",
      "                || g_PreviewForceFitOnce;",
    ].join("\n"),
    { indentSize: 4 },
  );

  runCase(
    "hanging-assignment-first-operand-aligns-with-plus-operands",
    [
      "                string header =",
      '                "Layer[" + i + "]"',
      '                    + " vis=" + (layer.IsVisible ? "true" : "false")',
      '                    + " local=" + (hasLocal ? "true" : "false")',
      '                    + " rootId=" + rootId;',
    ].join("\n"),
    [
      "                string header =",
      '                      "Layer[" + i + "]"',
      '                    + " vis=" + (layer.IsVisible ? "true" : "false")',
      '                    + " local=" + (hasLocal ? "true" : "false")',
      '                    + " rootId=" + rootId;',
    ].join("\n"),
    { indentSize: 4 },
  );

  runCase(
    "repeated-receiver-concatenation-wraps-by-plus-not-dot",
    '                string snippetKey = "" + g_SelectedMlLayerIx + "|" + ctx.rootId + "|" + ctx.idChain + "|" + ctx.mixedChain;',
    [
      '                string snippetKey = "" + g_SelectedMlLayerIx + "|" +',
      '                    ctx.rootId + "|" +',
      '                    ctx.idChain + "|" +',
      '                    ctx.mixedChain;',
    ].join("\n"),
    { indentSize: 4, maxLineWidth: 80 },
  );

  runCase(
    "prebroken-repeated-receiver-concatenation-normalizes-by-plus",
    [
      '                string snippetKey = "" + g_SelectedMlLayerIx + "|" + ctx',
      '                    .rootId + "|" + ctx',
      '                    .idChain + "|" + ctx',
      '                    .mixedChain;',
    ].join("\n"),
    [
      '                string snippetKey = "" + g_SelectedMlLayerIx + "|" +',
      '                    ctx.rootId + "|" +',
      '                    ctx.idChain + "|" +',
      '                    ctx.mixedChain;',
    ].join("\n"),
    { indentSize: 4, maxLineWidth: 80 },
  );

  runCase(
    "leading-ternary-continuation-wraps-into-two-lines-when-long",
    [
      "            g_Status = ok",
      '            ?("Destroyed preview layer: " + key)',
      '            :("Preview layer not found or could not be destroyed: " + key);',
    ].join("\n"),
    [
      "            g_Status = ok ?",
      '                ("Destroyed preview layer: " + key) : ("Preview layer not found or could not be destroyed: " + key);',
    ].join("\n"),
    { indentSize: 4, maxLineWidth: 120 },
  );

  runCase(
    "leading-ternary-continuation-collapses-to-one-line-when-short",
    [
      "  g_Status = ok",
      '  ?("Destroyed: " + key)',
      '  :("Missing: " + key);',
    ].join("\n"),
    '  g_Status = ok ? ("Destroyed: " + key) : ("Missing: " + key);',
  );

  runCase(
    "single-line-parenthesized-ternary-branches-get-spaces",
    'g_MlValueLocksStatus = ok ?(hasExisting ? "Updated value lock." : "Added value lock.") :("Could not lock selected value.");',
    'g_MlValueLocksStatus = ok ? (hasExisting ? "Updated value lock." : "Added value lock.") : ("Could not lock selected value.");',
  );

  runCase(
    "ternary-false-branch-continuation-wraps-and-preserves-scope-resolution",
    [
      '                string prevDiagIndicator = S_PreviewDiagnosticsEnabled ? "  \\$9fd" + Icons::Play + "\\$z"',
      '                : "  \\$888" + Icons::Stop + "\\$z";',
    ].join("\n"),
    [
      "                string prevDiagIndicator = S_PreviewDiagnosticsEnabled ?",
      '                    "  \\$9fd" + Icons::Play + "\\$z" : "  \\$888" + Icons::Stop + "\\$z";',
    ].join("\n"),
    { indentSize: 4, maxLineWidth: 120 },
  );

  runCase(
    "broken-spaced-scope-resolution-in-ternary-is-repaired",
    [
      '            string bcIndicator = S_DiagBreadcrumbFile ? " \\$9fd" + Icons : : Play + "\\$z"',
      '            : " \\$888" + Icons::Stop + "\\$z";',
      '            string trIndicator = UiNav::Trace::Enabled() ? " \\$9fd" + Icons : : Play + "\\$z"',
      '            : " \\$888" + Icons::Stop + "\\$z";',
      '            string slIndicator = S_DiagStepLogs ? " \\$9fd" + Icons : : Play + "\\$z"',
      '            : " \\$888" + Icons::Stop + "\\$z";',
    ].join("\n"),
    [
      '            string bcIndicator = S_DiagBreadcrumbFile ? " \\$9fd" + Icons::Play + "\\$z" : " \\$888" + Icons::Stop + "\\$z";',
      "            string trIndicator = UiNav::Trace::Enabled() ?",
      '                " \\$9fd" + Icons::Play + "\\$z" : " \\$888" + Icons::Stop + "\\$z";',
      '            string slIndicator = S_DiagStepLogs ? " \\$9fd" + Icons::Play + "\\$z" : " \\$888" + Icons::Stop + "\\$z";',
    ].join("\n"),
    { indentSize: 4, maxLineWidth: 120 },
  );

  runCase(
    "openplanet-metadata-assignments-stay-compact",
    '    [Setting category = "z~DEV" name = "Show default OP logs" min = -1 max = 100 hidden]bool S_showDefaultLogs = true;',
    '    [Setting category="z~DEV" name="Show default OP logs" min=-1 max=100 hidden] bool S_showDefaultLogs = true;',
  );

  runCase(
    "unbraced-if-body-collapses-to-inline",
    [
      "                if (sev == \"error\")",
      "                    return BuilderDiagnosticSeverity::Error;",
    ].join("\n"),
    [
      "                if (sev == \"error\") return BuilderDiagnosticSeverity::Error;",
    ].join("\n"),
    { indentSize: 4 },
  );

  runCase(
    "initializer-braces-stay-inline",
    "void Main(){array<array<int>> values={{1,2},{3,4}};DoThing({1,2,3}, otherArg);}",
    [
      "void Main() {",
      "  array<array<int>> values = {{1, 2}, {3, 4}};",
      "  DoThing({1, 2, 3}, otherArg);",
      "}",
    ].join("\n"),
  );

  runCase(
    "empty-constructor-block-stays-inline",
    "class StatusLine{StatusLine(){}}",
    [
      "class StatusLine {",
      "  StatusLine() { }",
      "}",
    ].join("\n"),
  );

  runCase(
    "empty-constructor-block-stays-inline-allman",
    "class StatusLine{StatusLine(){}}",
    [
      "class StatusLine",
      "{",
      "  StatusLine()",
      "  { }",
      "}",
    ].join("\n"),
    { braceStyle: "allman" },
  );

  runCase(
    "empty-regular-function-block-gets-blank-line",
    "void Main(){}",
    [
      "void Main() {",
      "",
      "}",
    ].join("\n"),
  );

  runCase(
    "multiline-initializer-braces-indent-contents",
    [
      "void Main() {",
      "    array<bool> enabled = {",
      "    logging::DEV_S_sDebug, logging::DEV_S_sInfo, logging::DEV_S_sNotice,",
      "    logging::DEV_S_sWarning, logging::DEV_S_sError, logging::DEV_S_sCritical",
      "    };",
      "}",
    ].join("\n"),
    [
      "void Main() {",
      "    array<bool> enabled = {",
      "        logging::DEV_S_sDebug, logging::DEV_S_sInfo, logging::DEV_S_sNotice,",
      "        logging::DEV_S_sWarning, logging::DEV_S_sError, logging::DEV_S_sCritical",
      "    };",
      "}",
    ].join("\n"),
    { indentSize: 4 },
  );

  runCase(
    "multiline-initializer-braces-indent-inside-call",
    [
      "void Main() {",
      "  DoThing({",
      "  first,",
      "  second",
      "  });",
      "}",
    ].join("\n"),
    [
      "void Main() {",
      "  DoThing({",
      "    first,",
      "    second",
      "  });",
      "}",
    ].join("\n"),
  );

  runCase(
    "keyword-parity-foreach-using-variadic",
    'using namespace UI;void Log(const string &in fmt, ?&in... args){}void Main(){foreach(auto item in items){Use(item);}delete obj;wstring label="x";}',
    [
      "using namespace UI;",
      "void Log(const string &in fmt, ?&in... args) {",
      "}",
      "",
      "void Main() {",
      "  foreach (auto item in items) {",
      "    Use(item);",
      "  }",
      "  delete obj;",
      '  wstring label = "x";',
      "}",
    ].join("\n"),
  );

  runCase(
    "preserves-crlf-document-eol",
    "void Main(){\r\nint a=1+2;\r\n}",
    "void Main() {\r\n  int a = 1 + 2;\r\n}",
  );

  runCase(
    "preserves-trailing-line-comments-after-statements",
    "shared class BuilderFidelity{int level=0;  // 0 = full, 1 = partial, 2 = raw_only\narray<string> reasons;}",
    [
      "shared class BuilderFidelity {",
      "  int level = 0;  // 0 = full, 1 = partial, 2 = raw_only",
      "  array<string> reasons;",
      "}",
    ].join("\n"),
  );

  runCase(
    "top-level-blank-line-between-declarations-enabled",
    "void A(){int x=1;}void B(){int y=2;}",
    [
      "void A() {",
      "  int x = 1;",
      "}",
      "",
      "void B() {",
      "  int y = 2;",
      "}",
    ].join("\n"),
  );

  runCase(
    "top-level-blank-line-between-declarations-disabled",
    "void A(){int x=1;}void B(){int y=2;}",
    [
      "void A() {",
      "  int x = 1;",
      "}",
      "void B() {",
      "  int y = 2;",
      "}",
    ].join("\n"),
    { blankLineBetweenTopLevelDeclarations: false },
  );

  runCase(
    "allman-brace-style",
    "void Main(){if(true){DoIt();}}",
    [
      "void Main()",
      "{",
      "  if (true)",
      "  {",
      "    DoIt();",
      "  }",
      "}",
    ].join("\n"),
    { braceStyle: "allman" },
  );

  runCase(
    "argument-wrap-always",
    "void Main(){DoSomething(a,b,c,d,e);}",
    [
      "void Main() {",
      "  DoSomething(",
      "    a,",
      "    b,",
      "    c,",
      "    d,",
      "    e",
      "  );",
      "}",
    ].join("\n"),
    {
      argumentWrap: "always",
      maxLineWidth: 20,
    },
  );

  runCase(
    "import-declaration-parameter-wraps",
    [
      "import bool SaveSnapshotToFile(CGameManialinkControl@ n, const string &in path,",
      "bool includeChildren = false, int maxDepth = 1) from \"UiNav\";",
    ].join("\n"),
    [
      "import bool SaveSnapshotToFile(",
      "    CGameManialinkControl@ n,",
      "    const string &in path,",
      "    bool includeChildren = false,",
      "    int maxDepth = 1",
      ") from \"UiNav\";",
    ].join("\n"),
    {
      indentSize: 4,
      maxLineWidth: 80,
    },
  );

  runCase(
    "indented-fragment-import-declaration-parameter-wraps",
    [
      "        import bool SaveSnapshotToFile(CGameManialinkControl@ n, const string &in path,",
      "        bool includeChildren = false, int maxDepth = 1) from \"UiNav\";",
    ].join("\n"),
    [
      "        import bool SaveSnapshotToFile(",
      "            CGameManialinkControl@ n,",
      "            const string &in path,",
      "            bool includeChildren = false,",
      "            int maxDepth = 1",
      "        ) from \"UiNav\";",
    ].join("\n"),
    {
      indentSize: 4,
      maxLineWidth: 80,
    },
  );

  runCase(
    "argument-wrap-does-not-wrap-for-header",
    "void Main(){for(int i=0,j=10;i<j;i++,j--){DoThing(i,j);}}",
    [
      "void Main() {",
      "  for (int i = 0, j = 10; i < j; i++, j--) {",
      "    DoThing(",
      "      i,",
      "      j",
      "    );",
      "  }",
      "}",
    ].join("\n"),
    {
      argumentWrap: "always",
      maxLineWidth: 20,
    },
  );

  runCase(
    "chain-wrap-keeps-float-literals",
    "void Main(){float ratio=1.25f;obj.Manager.Component.Run().Apply();}",
    [
      "void Main() {",
      "  float ratio = 1.25f;",
      "  obj",
      "    .Manager",
      "    .Component",
      "    .Run()",
      "    .Apply();",
      "}",
    ].join("\n"),
    {
      chainWrap: "always",
      maxLineWidth: 10,
    },
  );

  runCase(
    "simple-receiver-call-does-not-chain-wrap",
    '            lines.InsertLast("options: include_ml=" + tostring(includeMl) + ", include_control_tree=" + tostring(includeControlTree));',
    '            lines.InsertLast("options: include_ml=" + tostring(includeMl) + ", include_control_tree=" + tostring(includeControlTree));',
    {
      indentSize: 4,
      maxLineWidth: 40,
    },
  );

  runCase(
    "leading-dot-simple-receiver-call-joins",
    [
      "            lines",
      '                .InsertLast("options: include_ml=" + tostring(includeMl) + ", include_control_tree=" + tostring(includeControlTree));',
    ].join("\n"),
    '            lines.InsertLast("options: include_ml=" + tostring(includeMl) + ", include_control_tree=" + tostring(includeControlTree));',
    {
      indentSize: 4,
      maxLineWidth: 40,
    },
  );

  runCase(
    "nested-receiver-call-does-not-chain-wrap",
    '            doc.nodes.InsertLast(_MakeOverlayQuad(uidPrefix + "top", vec2(center.x, maxP.y), vec2(size.x, t), color, lineOpacity, zBase + 0.1f));',
    '            doc.nodes.InsertLast(_MakeOverlayQuad(uidPrefix + "top", vec2(center.x, maxP.y), vec2(size.x, t), color, lineOpacity, zBase + 0.1f));',
    {
      indentSize: 4,
      maxLineWidth: 80,
    },
  );

  runCase(
    "leading-dot-nested-receiver-call-joins",
    [
      "            doc",
      "                .nodes",
      '                .InsertLast(_MakeOverlayQuad(uidPrefix + "top", vec2(center.x, maxP.y), vec2(size.x, t), color, lineOpacity, zBase + 0.1f));',
    ].join("\n"),
    '            doc.nodes.InsertLast(_MakeOverlayQuad(uidPrefix + "top", vec2(center.x, maxP.y), vec2(size.x, t), color, lineOpacity, zBase + 0.1f));',
    {
      indentSize: 4,
      maxLineWidth: 80,
    },
  );

  runCase(
    "chain-wrap-trailing-dot-style",
    "void Main(){obj.Manager.Component.Run().Apply();}",
    [
      "void Main() {",
      "  obj.",
      "    Manager.",
      "    Component.",
      "    Run().",
      "    Apply();",
      "}",
    ].join("\n"),
    {
      chainWrap: "always",
      chainWrapStyle: "trailingDot",
      maxLineWidth: 10,
    },
  );

  runCase(
    "ternary-lines-are-not-wrapped-by-chain-logic",
    "void Main(){auto result=cond?veryLongValue.WithChain().DoThing():fallback.WithChain().DoThing();}",
    [
      "void Main() {",
      "  auto result = cond ? veryLongValue.WithChain().DoThing() : fallback.WithChain().DoThing();",
      "}",
    ].join("\n"),
    {
      chainWrap: "always",
      maxLineWidth: 20,
    },
  );

  runCase(
    "suppression-directives-preserve-disabled-lines",
    [
      "void Main(){",
      "  // opfmt-disable-start",
      "  if(true){print(\"x\");}",
      "  // opfmt-disable-end",
      "  if(true){print(\"y\");}",
      "}",
    ].join("\n"),
    [
      "void Main() {",
      "  // opfmt-disable-start",
      "  if(true){print(\"x\");}",
      "  // opfmt-disable-end",
      "  if (true) {",
      '    print("y");',
      "  }",
      "}",
    ].join("\n"),
  );

  runIdempotenceCase(
    "idempotence-complex",
    [
      "namespace N{",
      "void Render(){if(true){UI::Text(f\"x={1}\");}else{warn(\"bad\");}}",
      "}",
    ].join("\n"),
  );

  runIdempotenceCase(
    "idempotence-generics-preprocessor",
    [
      "#if TMNEXT",
      "void Main(){array<array<int>>vals;/*x",
      "y*/dictionary<string,array<uint>>map;}",
      "#else",
      "void Main(){return;}",
      "#endif",
    ].join("\n"),
  );

  testRangeFormattingDoesNotChangeOutsideRange();
  testRangeFormattingEditPayload();
  testRangeFormattingAcceptanceFixture();
  testParserBackedFormatterAcceptanceFixtures();
  testConformanceSmokeFormatsToParserAcceptedCode();
  testMediumCorpusIdempotence();
  testMediumCorpusSnapshot();
  testEdgeCorpusSnapshot();

  console.log("Formatter regression tests passed.");
}

main();
