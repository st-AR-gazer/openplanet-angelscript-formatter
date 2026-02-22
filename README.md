# Openplanet AngelScript Formatter

Standalone formatter extension for `openplanet-angelscript`.

What it provides:
- `Format Document` support
- `Format Selection` support
- Deterministic formatting for braces, indentation, statement line breaks, comments, and common operator spacing
- Preprocessor-aware formatting (`#if`, `#endif`, etc.) with optional column-0 enforcement
- Range-formatting that normalizes to full lines and preserves base indentation context
- Optional brace-style and line-wrapping passes (`kr`/`allman`, argument wrapping, chain wrapping)
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
- `openplanetAngelscriptFormatter.braceStyle`

Development:
- `npm run compile`
- `npm test`

Checked-in formatter corpus:
- source fixture: `test-files/formatter-corpus/medium-corpus.as`
- snapshot expectation: `test-files/formatter-corpus/medium-corpus.expected.as`
