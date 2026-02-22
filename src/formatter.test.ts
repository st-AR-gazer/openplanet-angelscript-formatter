import assert from "node:assert/strict";

import { formatAngelScript, type AngelScriptFormatterOptions } from "./formatter";

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

  console.log("Formatter regression tests passed.");
}

main();
