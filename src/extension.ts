import * as path from "node:path";
import * as vscode from "vscode";

import {
  formatAngelScript,
  formatAngelScriptRangeEdit,
  type AngelScriptFormatterOptions,
} from "./formatter";

const CONFIG_ROOT = "openplanetAngelscriptFormatter";
const LANGUAGE_ID = "openplanet-angelscript";
const FORMAT_WORKSPACE_COMMAND = "openplanetAngelscriptFormatter.formatWorkspace";

interface WorkspaceFormatFailure {
  uri: vscode.Uri;
  message: string;
}

interface WorkspaceFormatResult {
  targetLabel: string;
  total: number;
  changed: number;
  unchanged: number;
  failed: WorkspaceFormatFailure[];
  cancelled: boolean;
}

interface WorkspaceFormatTarget {
  label: string;
  description: string;
  detail: string;
  fileUris: vscode.Uri[];
}

interface WorkspaceFormatSource {
  label: string;
  description: string;
  detail: string;
  kind: "currentWorkspace" | "codeWorkspaceFile";
  workspaceFileUri?: vscode.Uri;
}

interface CodeWorkspaceFolder {
  label: string;
  rootUri: vscode.Uri;
  configuredPath: string;
}

interface DiscoveredPluginRoot {
  label: string;
  rootUri: vscode.Uri;
  source: "registry" | "info";
}

type WorkspaceFormatQuickPickItem = vscode.QuickPickItem & {
  target?: WorkspaceFormatTarget;
};

type WorkspaceFormatSourceQuickPickItem = vscode.QuickPickItem & {
  source?: WorkspaceFormatSource;
};

function readFormatterSettings(
  formatting: vscode.FormattingOptions,
  overrideFinalNewline?: boolean,
  resource?: vscode.Uri,
): AngelScriptFormatterOptions {
  const config = vscode.workspace.getConfiguration(CONFIG_ROOT, resource);
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
        const settings = readFormatterSettings(options, undefined, document.uri);
        const formatted = formatAngelScript(document.getText(), settings);
        if (formatted === document.getText()) return [];
        return [makeFullDocumentEdit(document, formatted)];
      },

      provideDocumentRangeFormattingEdits(document, range, options) {
        const settings = readFormatterSettings(options, false, document.uri);
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
    vscode.commands.registerCommand(FORMAT_WORKSPACE_COMMAND, async () => {
      await formatWorkspaceAngelScriptFiles();
    }),
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

async function formatWorkspaceAngelScriptFiles(): Promise<void> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    void vscode.window.showWarningMessage(
      "Open a workspace folder before formatting AngelScript files.",
    );
    return;
  }

  const source = await selectWorkspaceFormatSource();
  if (source === undefined) {
    return;
  }

  const target = await selectWorkspaceFormatTarget(source);
  if (target === undefined) {
    return;
  }

  const confirmLabel = "Format Files";
  const fileLabel = formatFileCount(target.fileUris.length);
  const selection = await vscode.window.showWarningMessage(
    `Format ${fileLabel} in ${target.description}? This will update files on disk.`,
    { modal: true },
    confirmLabel,
  );
  if (selection !== confirmLabel) {
    return;
  }

  const result = await vscode.window.withProgress(
    {
      cancellable: true,
      location: vscode.ProgressLocation.Notification,
      title: `Formatting Openplanet AngelScript files: ${target.label}`,
    },
    async (progress, token) => {
      const formatResult: WorkspaceFormatResult = {
        targetLabel: target.label,
        total: target.fileUris.length,
        changed: 0,
        unchanged: 0,
        failed: [],
        cancelled: false,
      };
      const increment = 100 / target.fileUris.length;

      for (let index = 0; index < target.fileUris.length; index += 1) {
        if (token.isCancellationRequested) {
          formatResult.cancelled = true;
          break;
        }

        const uri = target.fileUris[index];
        progress.report({
          message: `${index + 1}/${target.fileUris.length}: ${vscode.workspace.asRelativePath(uri)}`,
        });

        try {
          const status = await formatWorkspaceFile(uri);
          if (status === "changed") {
            formatResult.changed += 1;
          } else {
            formatResult.unchanged += 1;
          }
        } catch (error: unknown) {
          formatResult.failed.push({
            uri,
            message: error instanceof Error ? error.message : String(error),
          });
        }

        progress.report({ increment });
      }

      return formatResult;
    },
  );

  showWorkspaceFormatResult(result);
}

async function selectWorkspaceFormatSource(): Promise<WorkspaceFormatSource | undefined> {
  const currentWorkspaceSource: WorkspaceFormatSource = {
    label: "Current VS Code Workspace",
    description: "currently open folders",
    detail: "Use the folders already opened in VS Code",
    kind: "currentWorkspace",
  };
  const codeWorkspaceUris = await findCodeWorkspaceFileUris();

  if (codeWorkspaceUris.length === 0) {
    return currentWorkspaceSource;
  }

  const items: WorkspaceFormatSourceQuickPickItem[] = [
    {
      label: "$(root-folder) Current VS Code Workspace",
      description: "open folders",
      detail: currentWorkspaceSource.detail,
      source: currentWorkspaceSource,
    },
    {
      label: ".code-workspace files",
      kind: vscode.QuickPickItemKind.Separator,
    },
    ...codeWorkspaceUris.map((uri): WorkspaceFormatSourceQuickPickItem => ({
      label: path.basename(uri.fsPath),
      description: vscode.workspace.asRelativePath(uri),
      detail: uri.fsPath,
      source: {
        label: path.basename(uri.fsPath),
        description: ".code-workspace file",
        detail: uri.fsPath,
        kind: "codeWorkspaceFile",
        workspaceFileUri: uri,
      },
    })),
  ];

  const selected = await vscode.window.showQuickPick(items, {
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: "Choose the workspace definition to format from",
    title: "Openplanet AngelScript Formatter",
  });
  return selected?.source;
}

async function findCodeWorkspaceFileUris(): Promise<vscode.Uri[]> {
  const byKey = new Map<string, vscode.Uri>();
  const currentWorkspaceFile = vscode.workspace.workspaceFile;
  if (currentWorkspaceFile?.scheme === "file") {
    byKey.set(getUriIdentity(currentWorkspaceFile), currentWorkspaceFile);
  }

  const discovered = await vscode.workspace.findFiles("**/*.code-workspace");
  for (const uri of discovered) {
    if (uri.scheme !== "file") {
      continue;
    }
    byKey.set(getUriIdentity(uri), uri);
  }

  return [...byKey.values()].sort((left, right) => left.fsPath.localeCompare(right.fsPath));
}

async function selectWorkspaceFormatTarget(
  source: WorkspaceFormatSource,
): Promise<WorkspaceFormatTarget | undefined> {
  if (source.kind === "codeWorkspaceFile") {
    return selectCodeWorkspaceFormatTarget(source);
  }

  return selectCurrentWorkspaceFormatTarget();
}

async function selectCurrentWorkspaceFormatTarget(): Promise<WorkspaceFormatTarget | undefined> {
  const allFileUris = await findCurrentWorkspaceAngelScriptFiles();
  if (allFileUris.length === 0) {
    void vscode.window.showInformationMessage(
      "No .as files found in the current workspace.",
    );
    return undefined;
  }

  const allTarget: WorkspaceFormatTarget = {
    label: "All",
    description: "the workspace",
    detail: "Every .as file in the current workspace",
    fileUris: allFileUris,
  };
  const pluginTargets = await discoverPluginFormatTargets(allFileUris);
  return selectFormatTarget(allTarget, pluginTargets, "Plugins");
}

async function selectCodeWorkspaceFormatTarget(
  source: WorkspaceFormatSource,
): Promise<WorkspaceFormatTarget | undefined> {
  if (source.workspaceFileUri === undefined) {
    return undefined;
  }

  const folders = await readCodeWorkspaceFolders(source.workspaceFileUri);
  if (folders.length === 0) {
    void vscode.window.showWarningMessage(
      `No folders were found in ${path.basename(source.workspaceFileUri.fsPath)}.`,
    );
    return undefined;
  }

  const folderTargets: WorkspaceFormatTarget[] = [];
  const allFileUris: vscode.Uri[] = [];
  const workspaceFileName = path.basename(source.workspaceFileUri.fsPath);

  for (const folder of folders) {
    const fileUris = await findAngelScriptFilesInDirectory(folder.rootUri);
    if (fileUris.length === 0) {
      continue;
    }

    allFileUris.push(...fileUris);
    folderTargets.push({
      label: folder.label,
      description: `"${folder.label}"`,
      detail: `${workspaceFileName}: ${folder.configuredPath}`,
      fileUris,
    });
  }

  const deduplicatedAllFileUris = uniqueSortedUris(allFileUris);
  if (deduplicatedAllFileUris.length === 0) {
    void vscode.window.showInformationMessage(
      `No .as files found in ${workspaceFileName}.`,
    );
    return undefined;
  }

  const allTarget: WorkspaceFormatTarget = {
    label: "All",
    description: `all folders in ${workspaceFileName}`,
    detail: `Every .as file in ${workspaceFileName}`,
    fileUris: deduplicatedAllFileUris,
  };
  return selectFormatTarget(allTarget, folderTargets, "Workspace folders");
}

async function findCurrentWorkspaceAngelScriptFiles(): Promise<vscode.Uri[]> {
  const uris = await vscode.workspace.findFiles("**/*.as");
  return uniqueSortedUris(
    uris.filter((uri) => uri.scheme === "file" && uri.fsPath.toLowerCase().endsWith(".as")),
  );
}

async function selectFormatTarget(
  allTarget: WorkspaceFormatTarget,
  scopedTargets: WorkspaceFormatTarget[],
  separatorLabel: string,
): Promise<WorkspaceFormatTarget | undefined> {
  const sortedScopedTargets = scopedTargets.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
  );

  if (sortedScopedTargets.length === 0) {
    return allTarget;
  }

  const items: WorkspaceFormatQuickPickItem[] = [
    {
      label: "$(globe) All",
      description: formatFileCount(allTarget.fileUris.length),
      detail: allTarget.detail,
      target: allTarget,
    },
    {
      label: separatorLabel,
      kind: vscode.QuickPickItemKind.Separator,
    },
    ...sortedScopedTargets.map((target): WorkspaceFormatQuickPickItem => ({
      label: target.label,
      description: formatFileCount(target.fileUris.length),
      detail: target.detail,
      target,
    })),
  ];

  const selected = await vscode.window.showQuickPick(items, {
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: "Choose whether to format every .as file or one folder/plugin",
    title: "Openplanet AngelScript Formatter",
  });
  return selected?.target;
}

async function readCodeWorkspaceFolders(
  workspaceFileUri: vscode.Uri,
): Promise<CodeWorkspaceFolder[]> {
  const text = await tryReadTextFile(workspaceFileUri);
  if (text === undefined) {
    void vscode.window.showWarningMessage(
      `Could not read ${path.basename(workspaceFileUri.fsPath)}.`,
    );
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(text));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showWarningMessage(
      `Could not parse ${path.basename(workspaceFileUri.fsPath)}: ${message}`,
    );
    return [];
  }

  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }

  const foldersValue = (parsed as { folders?: unknown }).folders;
  if (!Array.isArray(foldersValue)) {
    return [];
  }

  const workspaceFileDirectoryUri = vscode.Uri.file(path.dirname(workspaceFileUri.fsPath));
  const byKey = new Map<string, CodeWorkspaceFolder>();

  for (const folderValue of foldersValue) {
    if (typeof folderValue !== "object" || folderValue === null) {
      continue;
    }

    const folder = folderValue as { name?: unknown; path?: unknown; uri?: unknown };
    const configuredPath =
      typeof folder.path === "string"
        ? folder.path
        : typeof folder.uri === "string"
          ? folder.uri
          : undefined;
    if (configuredPath === undefined) {
      continue;
    }

    const rootUri = resolveCodeWorkspaceFolderUri(folder, workspaceFileDirectoryUri);
    if (rootUri === undefined) {
      continue;
    }

    const label =
      typeof folder.name === "string" && folder.name.trim().length > 0
        ? folder.name.trim()
        : path.basename(rootUri.fsPath);
    byKey.set(getUriIdentity(rootUri), {
      label,
      rootUri,
      configuredPath,
    });
  }

  return [...byKey.values()];
}

function resolveCodeWorkspaceFolderUri(
  folder: { path?: unknown; uri?: unknown },
  workspaceFileDirectoryUri: vscode.Uri,
): vscode.Uri | undefined {
  if (typeof folder.uri === "string") {
    try {
      return vscode.Uri.parse(folder.uri);
    } catch {
      return undefined;
    }
  }

  if (typeof folder.path !== "string") {
    return undefined;
  }

  return resolveConfiguredPath(folder.path, workspaceFileDirectoryUri);
}

function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    const next = text[index + 1] ?? "";

    if (inString) {
      output += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      output += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") {
        index += 1;
      }
      index -= 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      index += 2;
      while (index < text.length) {
        if (text[index] === "*" && text[index + 1] === "/") {
          index += 1;
          break;
        }
        if (text[index] === "\n" || text[index] === "\r") {
          output += text[index];
        }
        index += 1;
      }
      continue;
    }

    output += ch;
  }

  return output;
}

const FORMAT_SCAN_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "out",
]);

async function findAngelScriptFilesInDirectory(rootUri: vscode.Uri): Promise<vscode.Uri[]> {
  const found: vscode.Uri[] = [];

  const visitDirectory = async (directoryUri: vscode.Uri): Promise<void> => {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(directoryUri);
    } catch {
      return;
    }

    for (const [name, type] of entries) {
      const childUri = vscode.Uri.joinPath(directoryUri, name);
      if ((type & vscode.FileType.Directory) !== 0) {
        if (FORMAT_SCAN_IGNORED_DIRECTORY_NAMES.has(name)) {
          continue;
        }
        await visitDirectory(childUri);
        continue;
      }

      if (
        (type & vscode.FileType.File) !== 0 &&
        childUri.scheme === "file" &&
        childUri.fsPath.toLowerCase().endsWith(".as")
      ) {
        found.push(childUri);
      }
    }
  };

  await visitDirectory(rootUri);
  return uniqueSortedUris(found);
}

function uniqueSortedUris(uris: vscode.Uri[]): vscode.Uri[] {
  const byKey = new Map<string, vscode.Uri>();
  for (const uri of uris) {
    byKey.set(getUriIdentity(uri), uri);
  }
  return [...byKey.values()].sort((left, right) =>
    getSortableUriText(left).localeCompare(getSortableUriText(right))
  );
}

function getSortableUriText(uri: vscode.Uri): string {
  return uri.scheme === "file" ? uri.fsPath : uri.toString();
}

async function discoverPluginFormatTargets(
  allFileUris: vscode.Uri[],
): Promise<WorkspaceFormatTarget[]> {
  const roots = new Map<string, DiscoveredPluginRoot>();
  await addRegistryPluginRoots(roots);
  await addInfoTomlPluginRoots(roots);

  const targets: WorkspaceFormatTarget[] = [];
  for (const plugin of roots.values()) {
    const fileUris = allFileUris.filter((uri) => isUriInsideDirectory(uri, plugin.rootUri));
    if (fileUris.length === 0) {
      continue;
    }

    targets.push({
      label: plugin.label,
      description: `"${plugin.label}"`,
      detail: formatPluginRootDetail(plugin.rootUri, plugin.source),
      fileUris,
    });
  }

  return targets.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
  );
}

async function addRegistryPluginRoots(
  roots: Map<string, DiscoveredPluginRoot>,
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of workspaceFolders) {
    const registryUri = vscode.Uri.joinPath(folder.uri, "registry.toml");
    const registryText = await tryReadTextFile(registryUri);
    if (registryText === undefined) {
      continue;
    }

    for (const entry of parseRegistryPluginEntries(registryText)) {
      const rootPath = entry.path ?? entry.srcDir;
      if (rootPath === undefined) {
        continue;
      }

      const rootUri = resolveConfiguredPath(rootPath, folder.uri);
      setDiscoveredPluginRoot(roots, {
        label: entry.name,
        rootUri,
        source: "registry",
      });
    }
  }
}

async function addInfoTomlPluginRoots(
  roots: Map<string, DiscoveredPluginRoot>,
): Promise<void> {
  const infoUris = await vscode.workspace.findFiles("**/info.toml");
  for (const infoUri of infoUris) {
    if (infoUri.scheme !== "file") {
      continue;
    }

    const rootUri = vscode.Uri.file(path.dirname(infoUri.fsPath));
    const rootKey = getUriIdentity(rootUri);
    if (roots.has(rootKey)) {
      continue;
    }

    const infoText = await tryReadTextFile(infoUri);
    const label = readInfoTomlPluginName(infoText ?? "") ?? path.basename(rootUri.fsPath);
    setDiscoveredPluginRoot(roots, {
      label,
      rootUri,
      source: "info",
    });
  }
}

function setDiscoveredPluginRoot(
  roots: Map<string, DiscoveredPluginRoot>,
  plugin: DiscoveredPluginRoot,
): void {
  const key = getUriIdentity(plugin.rootUri);
  const existing = roots.get(key);
  if (existing !== undefined && existing.source === "registry") {
    return;
  }
  roots.set(key, plugin);
}

async function tryReadTextFile(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

function parseRegistryPluginEntries(text: string): Array<{
  name: string;
  path?: string;
  srcDir?: string;
}> {
  const entries: Array<{ name: string; path?: string; srcDir?: string }> = [];
  let current: { name: string; path?: string; srcDir?: string } | null = null;

  const finishCurrent = (): void => {
    if (current !== null) {
      entries.push(current);
      current = null;
    }
  };

  for (const rawLine of text.split(/\r?\n/g)) {
    const line = stripTomlInlineComment(rawLine.trim());
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      finishCurrent();
      const pluginName = parseRegistryPluginSectionName(line);
      current = pluginName === null ? null : { name: pluginName };
      continue;
    }

    if (current === null) {
      continue;
    }

    const assignment = parseTomlAssignment(line);
    if (assignment === null) {
      continue;
    }

    if (assignment.key === "path") {
      current.path = assignment.value;
    } else if (assignment.key === "src_dir") {
      current.srcDir = assignment.value;
    }
  }

  finishCurrent();
  return entries;
}

function parseRegistryPluginSectionName(line: string): string | null {
  const section = line.slice(1, -1).trim();
  const prefix = "plugins.";
  if (!section.startsWith(prefix)) {
    return null;
  }

  const namePart = section.slice(prefix.length).trim();
  return parseTomlKeyPart(namePart);
}

function parseTomlAssignment(line: string): { key: string; value: string } | null {
  const equalsIndex = line.indexOf("=");
  if (equalsIndex < 0) {
    return null;
  }

  const key = line.slice(0, equalsIndex).trim();
  const value = parseTomlStringValue(line.slice(equalsIndex + 1).trim());
  if (key.length === 0 || value === undefined) {
    return null;
  }
  return { key, value };
}

function parseTomlKeyPart(text: string): string | null {
  if (text.startsWith("\"") || text.startsWith("'")) {
    return parseTomlStringValue(text) ?? null;
  }
  return text.length > 0 ? text : null;
}

function parseTomlStringValue(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith("\"")) {
    const literal = readQuotedTomlLiteral(trimmed, "\"");
    if (literal === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(literal) as string;
    } catch {
      return literal.slice(1, -1);
    }
  }

  if (trimmed.startsWith("'")) {
    const literal = readQuotedTomlLiteral(trimmed, "'");
    return literal === undefined ? undefined : literal.slice(1, -1);
  }

  return stripTomlInlineComment(trimmed);
}

function readQuotedTomlLiteral(text: string, quote: "\"" | "'"): string | undefined {
  let escaped = false;
  for (let index = 1; index < text.length; index += 1) {
    const ch = text[index];
    if (quote === "\"" && escaped) {
      escaped = false;
      continue;
    }
    if (quote === "\"" && ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === quote) {
      return text.slice(0, index + 1);
    }
  }
  return undefined;
}

function stripTomlInlineComment(text: string): string {
  let inSingleQuotedString = false;
  let inDoubleQuotedString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inDoubleQuotedString && ch === "\\") {
      escaped = true;
      continue;
    }
    if (!inSingleQuotedString && ch === "\"") {
      inDoubleQuotedString = !inDoubleQuotedString;
      continue;
    }
    if (!inDoubleQuotedString && ch === "'") {
      inSingleQuotedString = !inSingleQuotedString;
      continue;
    }
    if (!inSingleQuotedString && !inDoubleQuotedString && ch === "#") {
      return text.slice(0, index).trim();
    }
  }

  return text.trim();
}

function readInfoTomlPluginName(text: string): string | undefined {
  let inMetaSection = false;
  for (const rawLine of text.split(/\r?\n/g)) {
    const line = stripTomlInlineComment(rawLine.trim());
    if (line.startsWith("[") && line.endsWith("]")) {
      inMetaSection = line === "[meta]";
      continue;
    }
    if (!inMetaSection) {
      continue;
    }

    const assignment = parseTomlAssignment(line);
    if (assignment?.key === "name" && assignment.value.length > 0) {
      return assignment.value;
    }
  }
  return undefined;
}

function resolveConfiguredPath(configuredPath: string, workspaceFolderUri: vscode.Uri): vscode.Uri {
  if (path.isAbsolute(configuredPath)) {
    return vscode.Uri.file(path.normalize(configuredPath));
  }

  if (workspaceFolderUri.scheme === "file") {
    return vscode.Uri.file(path.resolve(workspaceFolderUri.fsPath, configuredPath));
  }

  return vscode.Uri.joinPath(
    workspaceFolderUri,
    ...configuredPath.split(/[\\/]+/g).filter((part) => part.length > 0),
  );
}

function isUriInsideDirectory(uri: vscode.Uri, directoryUri: vscode.Uri): boolean {
  if (uri.scheme !== directoryUri.scheme) {
    return false;
  }

  if (uri.scheme === "file") {
    const relativePath = path.relative(directoryUri.fsPath, uri.fsPath);
    return (
      relativePath.length > 0 &&
      !relativePath.startsWith("..") &&
      !path.isAbsolute(relativePath)
    );
  }

  const directoryPath = directoryUri.path.endsWith("/")
    ? directoryUri.path
    : `${directoryUri.path}/`;
  return uri.path.startsWith(directoryPath);
}

function getUriIdentity(uri: vscode.Uri): string {
  if (uri.scheme === "file") {
    return path.normalize(uri.fsPath).toLowerCase();
  }
  return uri.toString().toLowerCase();
}

function formatPluginRootDetail(rootUri: vscode.Uri, source: DiscoveredPluginRoot["source"]): string {
  const prefix = source === "registry" ? "registry.toml" : "info.toml";
  return `${prefix}: ${vscode.workspace.asRelativePath(rootUri)}`;
}

function formatFileCount(count: number): string {
  return `${count} .as file${count === 1 ? "" : "s"}`;
}

async function formatWorkspaceFile(uri: vscode.Uri): Promise<"changed" | "unchanged"> {
  const document = await vscode.workspace.openTextDocument(uri);
  const originalText = document.getText();
  const settings = readFormatterSettings(
    getFormattingOptionsForDocument(document),
    undefined,
    uri,
  );
  const formattedText = formatAngelScript(originalText, settings);

  if (formattedText === originalText) {
    return "unchanged";
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(document.positionAt(0), document.positionAt(originalText.length)),
    formattedText,
  );

  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    throw new Error("VS Code rejected the formatter edit.");
  }

  const saved = await document.save();
  if (!saved) {
    throw new Error("VS Code could not save the formatted file.");
  }

  return "changed";
}

function getFormattingOptionsForDocument(document: vscode.TextDocument): vscode.FormattingOptions {
  const visibleEditor = vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.toString() === document.uri.toString(),
  );
  const editorConfig = vscode.workspace.getConfiguration("editor", document.uri);

  return {
    tabSize:
      normalizeTabSize(visibleEditor?.options.tabSize) ??
      normalizeTabSize(editorConfig.get("tabSize")) ??
      2,
    insertSpaces:
      normalizeInsertSpaces(visibleEditor?.options.insertSpaces) ??
      normalizeInsertSpaces(editorConfig.get("insertSpaces")) ??
      true,
  };
}

function normalizeTabSize(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : undefined;
}

function normalizeInsertSpaces(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function showWorkspaceFormatResult(result: WorkspaceFormatResult): void {
  const processed = result.changed + result.unchanged + result.failed.length;
  const targetDescription = result.targetLabel === "All"
    ? "the workspace"
    : `"${result.targetLabel}"`;
  const prefix = result.cancelled
    ? `Cancelled ${targetDescription} after ${processed}/${result.total} files.`
    : `Formatted ${formatFileCount(result.total)} in ${targetDescription}.`;
  const summary = `${prefix} Changed: ${result.changed}. Unchanged: ${result.unchanged}. Failed: ${result.failed.length}.`;

  if (result.failed.length === 0) {
    const showMessage = result.cancelled
      ? vscode.window.showWarningMessage
      : vscode.window.showInformationMessage;
    void showMessage(summary);
    return;
  }

  const failedPreview = result.failed
    .slice(0, 3)
    .map((failure) => `${vscode.workspace.asRelativePath(failure.uri)} (${failure.message})`)
    .join("; ");
  const suffix = result.failed.length > 3 ? `; plus ${result.failed.length - 3} more` : "";
  void vscode.window.showErrorMessage(`${summary} ${failedPreview}${suffix}`);
}
