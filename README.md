# Openplanet AngelScript Formatter

Standalone formatter extension for `openplanet-angelscript`.

The formatter shares the suite parser/core dependency used by the other AngelScript tools for package parity, while its formatting pass remains deterministic and conservative around incomplete code.

What it provides:
- `Format Document` support
- `Format Selection` support
- `Openplanet AngelScript Formatter: Format .as Files in Workspace or Plugin` command for project-wide, `.code-workspace`, or single-plugin/folder formatting
- Deterministic formatting for braces, indentation, statement line breaks, comments, and common operator spacing
- Preprocessor-aware formatting (`#if`, `#endif`, etc.) with optional column-0 enforcement
- Range-formatting that normalizes to full lines and preserves base indentation context
- Optional brace-style and line-wrapping passes (`kr`/`allman`, argument wrapping, chain wrapping, leading/trailing-dot chain style)
- Formatter suppression directives:
  - `// opfmt-disable`
  - `// opfmt-enable`
  - `// opfmt-disable-next-line`
  - `// opfmt-disable-start`
  - `// opfmt-disable-end`

Config:
- `openplanetAngelscriptFormatter.maxBlankLines`
- `openplanetAngelscriptFormatter.maxLineWidth`
- `openplanetAngelscriptFormatter.trimTrailingWhitespace`
- `openplanetAngelscriptFormatter.insertFinalNewline`
- `openplanetAngelscriptFormatter.spaceAroundOperators`
- `openplanetAngelscriptFormatter.keepPreprocessorColumnZero`
- `openplanetAngelscriptFormatter.blankLineBetweenTopLevelDeclarations`
- `openplanetAngelscriptFormatter.argumentWrap`
- `openplanetAngelscriptFormatter.chainWrap`
- `openplanetAngelscriptFormatter.chainWrapStyle`
- `openplanetAngelscriptFormatter.braceStyle`

Development:
- `npm run compile`
- `npm test`
- `npm run release:package`

Checked-in formatter corpus:
- source fixture: `test-files/formatter-corpus/medium-corpus.as`
- snapshot expectation: `test-files/formatter-corpus/medium-corpus.expected.as`
