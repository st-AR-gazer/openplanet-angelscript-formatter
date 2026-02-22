import * as vscode from "vscode";

import {
  formatAngelScript,
  formatAngelScriptRangeEdit,
  type AngelScriptFormatterOptions,
} from "./formatter";

const CONFIG_ROOT = "openplanetAngelscriptFormatter";
const LANGUAGE_ID = "openplanet-angelscript";

function readFormatterSettings(
  formatting: vscode.FormattingOptions,
  overrideFinalNewline?: boolean,
): AngelScriptFormatterOptions {
  const config = vscode.workspace.getConfiguration(CONFIG_ROOT);
  const insertFinalNewlineConfig = config.get<boolean>("insertFinalNewline", true);

  return {
    indentSize: Math.max(1, Math.floor(formatting.tabSize)),
    useTabs: !formatting.insertSpaces,
    maxBlankLines: Math.max(0, config.get<number>("maxBlankLines", 1)),
    maxLineWidth: Math.max(0, config.get<number>("maxLineWidth", 120)),
    trimTrailingWhitespace: config.get<boolean>("trimTrailingWhitespace", true),
    insertFinalNewline: overrideFinalNewline ?? insertFinalNewlineConfig,
    spaceAroundOperators: config.get<boolean>("spaceAroundOperators", true),
    keepPreprocessorColumnZero: config.get<boolean>("keepPreprocessorColumnZero", true),
    blankLineBetweenTopLevelDeclarations: config.get<boolean>(
      "blankLineBetweenTopLevelDeclarations",
      true,
    ),
    argumentWrap: readWrapStyle(config.get<string>("argumentWrap"), "auto"),
    chainWrap: readWrapStyle(config.get<string>("chainWrap"), "auto"),
    chainWrapStyle: readChainWrapStyle(config.get<string>("chainWrapStyle"), "leadingDot"),
    braceStyle: readBraceStyle(config.get<string>("braceStyle"), "kr"),
  };
}

function makeFullDocumentEdit(document: vscode.TextDocument, text: string): vscode.TextEdit {
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  return vscode.TextEdit.replace(fullRange, text);
}

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = [{ language: LANGUAGE_ID }];

  const formattingProvider: vscode.DocumentFormattingEditProvider &
    vscode.DocumentRangeFormattingEditProvider = {
      provideDocumentFormattingEdits(document, options) {
        const settings = readFormatterSettings(options);
        const formatted = formatAngelScript(document.getText(), settings);
        if (formatted === document.getText()) return [];
        return [makeFullDocumentEdit(document, formatted)];
      },

      provideDocumentRangeFormattingEdits(document, range, options) {
        const settings = readFormatterSettings(options, false);
        const normalizedRange = normalizeRangeForFormatting(document, range);
        const startLine = normalizedRange.start.line;
        const endLine =
          normalizedRange.end.character === 0 && normalizedRange.end.line > startLine
            ? normalizedRange.end.line - 1
            : normalizedRange.end.line;
        const documentText = document.getText();
        const rangeEdit = formatAngelScriptRangeEdit(
          documentText,
          startLine,
          endLine,
          settings,
        );
        const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
        let replacementText = rangeEdit.replacementText.replace(/\n/g, eol);
        if (endLine < document.lineCount - 1 && !replacementText.endsWith(eol)) {
          replacementText += eol;
        }
        if (replacementText === document.getText(normalizedRange)) {
          return [];
        }
        return [vscode.TextEdit.replace(normalizedRange, replacementText)];
      },
    };

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(selector, formattingProvider),
    vscode.languages.registerDocumentRangeFormattingEditProvider(selector, formattingProvider),
  );
}

export function deactivate(): void {
  // no-op
}

function readWrapStyle(
  value: string | undefined,
  fallback: "never" | "auto" | "always",
): "never" | "auto" | "always" {
  switch (value) {
    case "never":
    case "auto":
    case "always":
      return value;
    default:
      return fallback;
  }
}

function readBraceStyle(
  value: string | undefined,
  fallback: "kr" | "allman",
): "kr" | "allman" {
  switch (value) {
    case "kr":
    case "allman":
      return value;
    default:
      return fallback;
  }
}

function readChainWrapStyle(
  value: string | undefined,
  fallback: "leadingDot" | "trailingDot",
): "leadingDot" | "trailingDot" {
  switch (value) {
    case "leadingDot":
    case "trailingDot":
      return value;
    default:
      return fallback;
  }
}

function normalizeRangeForFormatting(
  document: vscode.TextDocument,
  range: vscode.Range,
): vscode.Range {
  const startLine = Math.max(0, Math.min(range.start.line, document.lineCount - 1));
  let endLine = range.end.line;
  if (range.end.character === 0 && endLine > startLine) {
    endLine -= 1;
  }
  endLine = Math.max(startLine, Math.min(endLine, document.lineCount - 1));

  const start = new vscode.Position(startLine, 0);
  const end = document.lineAt(endLine).rangeIncludingLineBreak.end;
  return new vscode.Range(start, end);
}
