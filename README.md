# Openplanet AngelScript Formatter

Standalone formatter extension for `openplanet-angelscript`.

What it provides:
- `Format Document` support
- `Format Selection` support
- Deterministic formatting for braces, indentation, statement line breaks, comments, and common operator spacing
- Preprocessor-aware formatting (`#if`, `#endif`, etc.) with optional column-0 enforcement
- Range-formatting that normalizes to full lines and preserves base indentation context

Config:
- `openplanetAngelscriptFormatter.maxBlankLines`
- `openplanetAngelscriptFormatter.trimTrailingWhitespace`
- `openplanetAngelscriptFormatter.insertFinalNewline`
- `openplanetAngelscriptFormatter.spaceAroundOperators`
- `openplanetAngelscriptFormatter.keepPreprocessorColumnZero`
- `openplanetAngelscriptFormatter.blankLineBetweenTopLevelDeclarations`

Development:
- `npm run compile`
- `npm test`
