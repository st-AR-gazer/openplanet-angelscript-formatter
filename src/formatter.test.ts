import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  formatAngelScript,
  formatAngelScriptRange,
  formatAngelScriptRangeEdit,
  type AngelScriptFormatterOptions
} from "./formatter";

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
  const expected = fs.readFileSync(expectedPath, "utf8");
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
  const expected = fs.readFileSync(expectedPath, "utf8");

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
      "  MyType@handle = @GetHandle();",
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
    "argument-wrap-does-not-wrap-for-header",
    "void Main(){for(int i=0,j=10;i<j;i++,j--){DoThing(i,j);}}",
    [
      "void Main() {",
      "  for (int i = 0, j = 10; i < j; i++, j--) {",
      "    DoThing(i, j);",
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
  testMediumCorpusIdempotence();
  testMediumCorpusSnapshot();
  testEdgeCorpusSnapshot();

  console.log("Formatter regression tests passed.");
}

main();
