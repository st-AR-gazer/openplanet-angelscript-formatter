import * as vscode from "vscode";

import { formatAngelScript, type AngelScriptFormatterOptions } from "./formatter";

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
    trimTrailingWhitespace: config.get<boolean>("trimTrailingWhitespace", true),
    insertFinalNewline: overrideFinalNewline ?? insertFinalNewlineConfig,
    spaceAroundOperators: config.get<boolean>("spaceAroundOperators", true),
    keepPreprocessorColumnZero: config.get<boolean>("keepPreprocessorColumnZero", true),
    blankLineBetweenTopLevelDeclarations: config.get<boolean>(
      "blankLineBetweenTopLevelDeclarations",
      true,
    ),
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
        const rangeText = document.getText(normalizedRange);
        const formatted = formatAngelScript(rangeText, settings);
        const baseIndent = readLeadingIndentation(
          document.lineAt(normalizedRange.start.line).text,
        );
        const rebased = applyBaseIndentation(
          formatted,
          baseIndent,
          settings.keepPreprocessorColumnZero,
        );
        if (rebased === rangeText) return [];
        return [vscode.TextEdit.replace(normalizedRange, rebased)];
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

function readLeadingIndentation(lineText: string): string {
  const match = /^[\t ]*/.exec(lineText);
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
  const rebased = lines.map((line) => {
    if (line.trim().length === 0) {
      return line;
    }
    if (keepPreprocessorColumnZero && line.trimStart().startsWith("#")) {
      return line.trimStart();
    }
    return `${baseIndent}${line}`;
  });
  let text = rebased.join("\n");
  if (hadTrailingNewline && !text.endsWith("\n")) {
    text += "\n";
  }
  return text;
}
