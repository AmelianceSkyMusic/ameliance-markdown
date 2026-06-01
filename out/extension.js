"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/ignore/index.js
var require_ignore = __commonJS({
  "node_modules/ignore/index.js"(exports2, module2) {
    function makeArray(subject) {
      return Array.isArray(subject) ? subject : [subject];
    }
    var UNDEFINED = void 0;
    var EMPTY = "";
    var SPACE = " ";
    var ESCAPE = "\\";
    var REGEX_TEST_BLANK_LINE = /^\s+$/;
    var REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
    var REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION = /^\\!/;
    var REGEX_REPLACE_LEADING_EXCAPED_HASH = /^\\#/;
    var REGEX_SPLITALL_CRLF = /\r?\n/g;
    var REGEX_TEST_INVALID_PATH = /^\.{0,2}\/|^\.{1,2}$/;
    var REGEX_TEST_TRAILING_SLASH = /\/$/;
    var SLASH = "/";
    var TMP_KEY_IGNORE = "node-ignore";
    if (typeof Symbol !== "undefined") {
      TMP_KEY_IGNORE = Symbol.for("node-ignore");
    }
    var KEY_IGNORE = TMP_KEY_IGNORE;
    var define = (object, key, value) => {
      Object.defineProperty(object, key, { value });
      return value;
    };
    var REGEX_REGEXP_RANGE = /([0-z])-([0-z])/g;
    var RETURN_FALSE = () => false;
    var sanitizeRange = (range) => range.replace(
      REGEX_REGEXP_RANGE,
      (match, from, to) => from.charCodeAt(0) <= to.charCodeAt(0) ? match : EMPTY
    );
    var cleanRangeBackSlash = (slashes) => {
      const { length } = slashes;
      return slashes.slice(0, length - length % 2);
    };
    var REPLACERS = [
      [
        // Remove BOM
        // TODO:
        // Other similar zero-width characters?
        /^\uFEFF/,
        () => EMPTY
      ],
      // > Trailing spaces are ignored unless they are quoted with backslash ("\")
      [
        // (a\ ) -> (a )
        // (a  ) -> (a)
        // (a ) -> (a)
        // (a \ ) -> (a  )
        /((?:\\\\)*?)(\\?\s+)$/,
        (_, m1, m2) => m1 + (m2.indexOf("\\") === 0 ? SPACE : EMPTY)
      ],
      // Replace (\ ) with ' '
      // (\ ) -> ' '
      // (\\ ) -> '\\ '
      // (\\\ ) -> '\\ '
      [
        /(\\+?)\s/g,
        (_, m1) => {
          const { length } = m1;
          return m1.slice(0, length - length % 2) + SPACE;
        }
      ],
      // Escape metacharacters
      // which is written down by users but means special for regular expressions.
      // > There are 12 characters with special meanings:
      // > - the backslash \,
      // > - the caret ^,
      // > - the dollar sign $,
      // > - the period or dot .,
      // > - the vertical bar or pipe symbol |,
      // > - the question mark ?,
      // > - the asterisk or star *,
      // > - the plus sign +,
      // > - the opening parenthesis (,
      // > - the closing parenthesis ),
      // > - and the opening square bracket [,
      // > - the opening curly brace {,
      // > These special characters are often called "metacharacters".
      [
        /[\\$.|*+(){^]/g,
        (match) => `\\${match}`
      ],
      [
        // > a question mark (?) matches a single character
        /(?!\\)\?/g,
        () => "[^/]"
      ],
      // leading slash
      [
        // > A leading slash matches the beginning of the pathname.
        // > For example, "/*.c" matches "cat-file.c" but not "mozilla-sha1/sha1.c".
        // A leading slash matches the beginning of the pathname
        /^\//,
        () => "^"
      ],
      // replace special metacharacter slash after the leading slash
      [
        /\//g,
        () => "\\/"
      ],
      [
        // > A leading "**" followed by a slash means match in all directories.
        // > For example, "**/foo" matches file or directory "foo" anywhere,
        // > the same as pattern "foo".
        // > "**/foo/bar" matches file or directory "bar" anywhere that is directly
        // >   under directory "foo".
        // Notice that the '*'s have been replaced as '\\*'
        /^\^*\\\*\\\*\\\//,
        // '**/foo' <-> 'foo'
        () => "^(?:.*\\/)?"
      ],
      // starting
      [
        // there will be no leading '/'
        //   (which has been replaced by section "leading slash")
        // If starts with '**', adding a '^' to the regular expression also works
        /^(?=[^^])/,
        function startingReplacer() {
          return !/\/(?!$)/.test(this) ? "(?:^|\\/)" : "^";
        }
      ],
      // two globstars
      [
        // Use lookahead assertions so that we could match more than one `'/**'`
        /\\\/\\\*\\\*(?=\\\/|$)/g,
        // Zero, one or several directories
        // should not use '*', or it will be replaced by the next replacer
        // Check if it is not the last `'/**'`
        (_, index, str) => index + 6 < str.length ? "(?:\\/[^\\/]+)*" : "\\/.+"
      ],
      // normal intermediate wildcards
      [
        // Never replace escaped '*'
        // ignore rule '\*' will match the path '*'
        // 'abc.*/' -> go
        // 'abc.*'  -> skip this rule,
        //    coz trailing single wildcard will be handed by [trailing wildcard]
        /(^|[^\\]+)(\\\*)+(?=.+)/g,
        // '*.js' matches '.js'
        // '*.js' doesn't match 'abc'
        (_, p1, p2) => {
          const unescaped = p2.replace(/\\\*/g, "[^\\/]*");
          return p1 + unescaped;
        }
      ],
      [
        // unescape, revert step 3 except for back slash
        // For example, if a user escape a '\\*',
        // after step 3, the result will be '\\\\\\*'
        /\\\\\\(?=[$.|*+(){^])/g,
        () => ESCAPE
      ],
      [
        // '\\\\' -> '\\'
        /\\\\/g,
        () => ESCAPE
      ],
      [
        // > The range notation, e.g. [a-zA-Z],
        // > can be used to match one of the characters in a range.
        // `\` is escaped by step 3
        /(\\)?\[([^\]/]*?)(\\*)($|\])/g,
        (match, leadEscape, range, endEscape, close) => leadEscape === ESCAPE ? `\\[${range}${cleanRangeBackSlash(endEscape)}${close}` : close === "]" ? endEscape.length % 2 === 0 ? `[${sanitizeRange(range)}${endEscape}]` : "[]" : "[]"
      ],
      // ending
      [
        // 'js' will not match 'js.'
        // 'ab' will not match 'abc'
        /(?:[^*])$/,
        // WTF!
        // https://git-scm.com/docs/gitignore
        // changes in [2.22.1](https://git-scm.com/docs/gitignore/2.22.1)
        // which re-fixes #24, #38
        // > If there is a separator at the end of the pattern then the pattern
        // > will only match directories, otherwise the pattern can match both
        // > files and directories.
        // 'js*' will not match 'a.js'
        // 'js/' will not match 'a.js'
        // 'js' will match 'a.js' and 'a.js/'
        (match) => /\/$/.test(match) ? `${match}$` : `${match}(?=$|\\/$)`
      ]
    ];
    var REGEX_REPLACE_TRAILING_WILDCARD = /(^|\\\/)?\\\*$/;
    var MODE_IGNORE = "regex";
    var MODE_CHECK_IGNORE = "checkRegex";
    var UNDERSCORE = "_";
    var TRAILING_WILD_CARD_REPLACERS = {
      [MODE_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]+` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      },
      [MODE_CHECK_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]*` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      }
    };
    var makeRegexPrefix = (pattern) => REPLACERS.reduce(
      (prev, [matcher, replacer]) => prev.replace(matcher, replacer.bind(pattern)),
      pattern
    );
    var isString = (subject) => typeof subject === "string";
    var checkPattern = (pattern) => pattern && isString(pattern) && !REGEX_TEST_BLANK_LINE.test(pattern) && !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern) && pattern.indexOf("#") !== 0;
    var splitPattern = (pattern) => pattern.split(REGEX_SPLITALL_CRLF).filter(Boolean);
    var IgnoreRule = class {
      constructor(pattern, mark, body, ignoreCase, negative, prefix) {
        this.pattern = pattern;
        this.mark = mark;
        this.negative = negative;
        define(this, "body", body);
        define(this, "ignoreCase", ignoreCase);
        define(this, "regexPrefix", prefix);
      }
      get regex() {
        const key = UNDERSCORE + MODE_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_IGNORE, key);
      }
      get checkRegex() {
        const key = UNDERSCORE + MODE_CHECK_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_CHECK_IGNORE, key);
      }
      _make(mode, key) {
        const str = this.regexPrefix.replace(
          REGEX_REPLACE_TRAILING_WILDCARD,
          // It does not need to bind pattern
          TRAILING_WILD_CARD_REPLACERS[mode]
        );
        const regex = this.ignoreCase ? new RegExp(str, "i") : new RegExp(str);
        return define(this, key, regex);
      }
    };
    var createRule = ({
      pattern,
      mark
    }, ignoreCase) => {
      let negative = false;
      let body = pattern;
      if (body.indexOf("!") === 0) {
        negative = true;
        body = body.substr(1);
      }
      body = body.replace(REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION, "!").replace(REGEX_REPLACE_LEADING_EXCAPED_HASH, "#");
      const regexPrefix = makeRegexPrefix(body);
      return new IgnoreRule(
        pattern,
        mark,
        body,
        ignoreCase,
        negative,
        regexPrefix
      );
    };
    var RuleManager = class {
      constructor(ignoreCase) {
        this._ignoreCase = ignoreCase;
        this._rules = [];
      }
      _add(pattern) {
        if (pattern && pattern[KEY_IGNORE]) {
          this._rules = this._rules.concat(pattern._rules._rules);
          this._added = true;
          return;
        }
        if (isString(pattern)) {
          pattern = {
            pattern
          };
        }
        if (checkPattern(pattern.pattern)) {
          const rule = createRule(pattern, this._ignoreCase);
          this._added = true;
          this._rules.push(rule);
        }
      }
      // @param {Array<string> | string | Ignore} pattern
      add(pattern) {
        this._added = false;
        makeArray(
          isString(pattern) ? splitPattern(pattern) : pattern
        ).forEach(this._add, this);
        return this._added;
      }
      // Test one single path without recursively checking parent directories
      //
      // - checkUnignored `boolean` whether should check if the path is unignored,
      //   setting `checkUnignored` to `false` could reduce additional
      //   path matching.
      // - check `string` either `MODE_IGNORE` or `MODE_CHECK_IGNORE`
      // @returns {TestResult} true if a file is ignored
      test(path2, checkUnignored, mode) {
        let ignored = false;
        let unignored = false;
        let matchedRule;
        this._rules.forEach((rule) => {
          const { negative } = rule;
          if (unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored) {
            return;
          }
          const matched = rule[mode].test(path2);
          if (!matched) {
            return;
          }
          ignored = !negative;
          unignored = negative;
          matchedRule = negative ? UNDEFINED : rule;
        });
        const ret = {
          ignored,
          unignored
        };
        if (matchedRule) {
          ret.rule = matchedRule;
        }
        return ret;
      }
    };
    var throwError = (message, Ctor) => {
      throw new Ctor(message);
    };
    var checkPath = (path2, originalPath, doThrow) => {
      if (!isString(path2)) {
        return doThrow(
          `path must be a string, but got \`${originalPath}\``,
          TypeError
        );
      }
      if (!path2) {
        return doThrow(`path must not be empty`, TypeError);
      }
      if (checkPath.isNotRelative(path2)) {
        const r = "`path.relative()`d";
        return doThrow(
          `path should be a ${r} string, but got "${originalPath}"`,
          RangeError
        );
      }
      return true;
    };
    var isNotRelative = (path2) => REGEX_TEST_INVALID_PATH.test(path2);
    checkPath.isNotRelative = isNotRelative;
    checkPath.convert = (p) => p;
    var Ignore = class {
      constructor({
        ignorecase = true,
        ignoreCase = ignorecase,
        allowRelativePaths = false
      } = {}) {
        define(this, KEY_IGNORE, true);
        this._rules = new RuleManager(ignoreCase);
        this._strictPathCheck = !allowRelativePaths;
        this._initCache();
      }
      _initCache() {
        this._ignoreCache = /* @__PURE__ */ Object.create(null);
        this._testCache = /* @__PURE__ */ Object.create(null);
      }
      add(pattern) {
        if (this._rules.add(pattern)) {
          this._initCache();
        }
        return this;
      }
      // legacy
      addPattern(pattern) {
        return this.add(pattern);
      }
      // @returns {TestResult}
      _test(originalPath, cache, checkUnignored, slices) {
        const path2 = originalPath && checkPath.convert(originalPath);
        checkPath(
          path2,
          originalPath,
          this._strictPathCheck ? throwError : RETURN_FALSE
        );
        return this._t(path2, cache, checkUnignored, slices);
      }
      checkIgnore(path2) {
        if (!REGEX_TEST_TRAILING_SLASH.test(path2)) {
          return this.test(path2);
        }
        const slices = path2.split(SLASH).filter(Boolean);
        slices.pop();
        if (slices.length) {
          const parent = this._t(
            slices.join(SLASH) + SLASH,
            this._testCache,
            true,
            slices
          );
          if (parent.ignored) {
            return parent;
          }
        }
        return this._rules.test(path2, false, MODE_CHECK_IGNORE);
      }
      _t(path2, cache, checkUnignored, slices) {
        if (path2 in cache) {
          return cache[path2];
        }
        if (!slices) {
          slices = path2.split(SLASH).filter(Boolean);
        }
        slices.pop();
        if (!slices.length) {
          return cache[path2] = this._rules.test(path2, checkUnignored, MODE_IGNORE);
        }
        const parent = this._t(
          slices.join(SLASH) + SLASH,
          cache,
          checkUnignored,
          slices
        );
        return cache[path2] = parent.ignored ? parent : this._rules.test(path2, checkUnignored, MODE_IGNORE);
      }
      ignores(path2) {
        return this._test(path2, this._ignoreCache, false).ignored;
      }
      createFilter() {
        return (path2) => !this.ignores(path2);
      }
      filter(paths) {
        return makeArray(paths).filter(this.createFilter());
      }
      // @returns {TestResult}
      test(path2) {
        return this._test(path2, this._testCache, true);
      }
    };
    var factory = (options) => new Ignore(options);
    var isPathValid = (path2) => checkPath(path2 && checkPath.convert(path2), path2, RETURN_FALSE);
    var setupWindows = () => {
      const makePosix = (str) => /^\\\\\?\\/.test(str) || /["<>|\u0000-\u001F]+/u.test(str) ? str : str.replace(/\\/g, "/");
      checkPath.convert = makePosix;
      const REGEX_TEST_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;
      checkPath.isNotRelative = (path2) => REGEX_TEST_WINDOWS_PATH_ABSOLUTE.test(path2) || isNotRelative(path2);
    };
    if (
      // Detect `process` so that it can run in browsers.
      typeof process !== "undefined" && process.platform === "win32"
    ) {
      setupWindows();
    }
    module2.exports = factory;
    factory.default = factory;
    module2.exports.isPathValid = isPathValid;
    define(module2.exports, Symbol.for("setupWindows"), setupWindows);
  }
});

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode2 = __toESM(require("vscode"));

// src/editor/liveEditorProvider.ts
var vscode = __toESM(require("vscode"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_ignore = __toESM(require_ignore());
var LiveEditorProvider = class {
  constructor(context, activePanels2) {
    this.context = context;
    this.activePanels = activePanels2;
  }
  async resolveCustomTextEditor(document, webviewPanel, _token) {
    this.activePanels.set(webviewPanel, document.uri);
    webviewPanel.onDidDispose(() => this.activePanels.delete(webviewPanel));
    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.getHtml();
    let isApplyingEdit = false;
    const sendContent = () => {
      webviewPanel.webview.postMessage({
        type: "content",
        text: document.getText()
      });
    };
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (isApplyingEdit) {
        isApplyingEdit = false;
        return;
      }
      sendContent();
    });
    webviewPanel.onDidDispose(() => changeSubscription.dispose());
    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      const wf = vscode.workspace.workspaceFolders;
      switch (message.type) {
        case "ready":
          sendContent();
          break;
        case "edit":
          if (typeof message.text === "string") {
            isApplyingEdit = true;
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
              document.positionAt(0),
              document.positionAt(document.getText().length)
            );
            edit.replace(document.uri, fullRange, message.text);
            vscode.workspace.applyEdit(edit);
          }
          break;
        case "requestFileTree":
          if (!wf) {
            webviewPanel.webview.postMessage({ type: "fileTree", files: [] });
            break;
          }
          const root = wf[0].uri;
          const files = await vscode.workspace.findFiles("**/*.md", "**/node_modules/**");
          const relPaths = files.map((f) => path.relative(root.fsPath, f.fsPath).replace(/\\/g, "/")).sort();
          let gitignoredPaths = [];
          try {
            const gitignorePath = path.join(root.fsPath, ".gitignore");
            if (fs.existsSync(gitignorePath)) {
              const ig = (0, import_ignore.default)();
              const content = fs.readFileSync(gitignorePath, "utf-8");
              ig.add(content);
              gitignoredPaths = relPaths.filter((f) => ig.ignores(f));
            }
          } catch {
          }
          webviewPanel.webview.postMessage({ type: "fileTree", files: relPaths, gitignored: gitignoredPaths });
          break;
        case "openFileFromTree":
          if (wf) {
            const absPath = path.join(wf[0].uri.fsPath, message.path);
            const uri = vscode.Uri.file(absPath);
            const doc = await vscode.workspace.openTextDocument(uri);
            vscode.window.showTextDocument(doc);
          }
          break;
      }
    });
  }
  getHtml() {
    const nonce = getNonce();
    const scriptPath = path.join(this.context.extensionPath, "out", "webview.js");
    let scriptContent;
    try {
      scriptContent = fs.readFileSync(scriptPath, "utf-8");
    } catch {
      scriptContent = 'console.error("webview.js not found. Run npm run build first.")';
    }
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data: https:;">
<style nonce="${nonce}">
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{
  display:flex;flex-direction:column;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
  background:var(--vscode-editor-background);
  color:var(--vscode-editor-foreground)
}
.pm-toolbar{
  display:flex;flex-shrink:0;gap:2px;padding:4px 8px;
  background:var(--vscode-editorWidget-background);
  border-bottom:1px solid var(--vscode-panel-border)
}
.pm-toolbar button{
  padding:3px 8px;border:none;background:transparent;
  color:var(--vscode-editor-foreground);cursor:pointer;
  font-size:13px;border-radius:4px;line-height:1;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif
}
.pm-toolbar button:hover{background:var(--vscode-toolbar-hoverBackground)}
.pm-toolbar button.active{color:var(--vscode-textLink-foreground)}
.pm-toolbar .sep{width:1px;margin:2px 4px;background:var(--vscode-panel-border);display:inline-block}
#prosemirror{display:none;flex:1;overflow-y:auto}
#prosemirror.active{display:block}
.ProseMirror{
  outline:none;min-height:100%;
  font-size:var(--vscode-editor-font-size,15px);
  color:var(--vscode-editor-foreground);
  padding:32px 40px;line-height:1.7;
  max-width:900px;margin:0 auto
}
.ProseMirror h1,.ProseMirror h2,.ProseMirror h3,.ProseMirror h4,.ProseMirror h5,.ProseMirror h6{
  margin-top:28px;margin-bottom:16px;font-weight:600;line-height:1.3
}
.ProseMirror h1{font-size:2em;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:8px}
.ProseMirror h2{font-size:1.5em;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:6px}
.ProseMirror h3{font-size:1.25em}.ProseMirror h4{font-size:1em}
.ProseMirror h5{font-size:.875em}.ProseMirror h6{font-size:.85em;color:var(--vscode-textPreformat-foreground)}
.ProseMirror p{margin-bottom:20px;line-height:1.7}
.ProseMirror strong{font-weight:600}.ProseMirror em{font-style:italic}
.ProseMirror a{color:var(--vscode-textLink-foreground)}.ProseMirror a:hover{text-decoration:underline}
.ProseMirror code{
  font-family:var(--vscode-editor-font-family,monospace);
  background:var(--vscode-textCodeBlock-background);padding:2px 6px;
  border-radius:3px;font-size:.9em;color:var(--vscode-textPreformat-foreground)
}
.ProseMirror pre{
  margin-bottom:20px;background:var(--vscode-textCodeBlock-background);
  border:1px solid var(--vscode-panel-border);border-radius:6px;padding:16px;overflow-x:auto
}
.ProseMirror pre code{background:none;padding:0;border-radius:0;font-size:.9em;color:var(--vscode-editor-foreground)}
.ProseMirror blockquote{
  border-left:4px solid var(--vscode-textBlockQuote-border);padding:4px 16px;
  color:var(--vscode-textBlockQuote-foreground);
  background:var(--vscode-textBlockQuote-background);margin-bottom:20px
}
.ProseMirror ul,.ProseMirror ol{margin-bottom:20px;padding-left:28px}
.ProseMirror ul{list-style-type:disc}.ProseMirror ol{list-style-type:decimal}
.ProseMirror li{margin-bottom:6px}.ProseMirror li>p{margin-bottom:4px}
.ProseMirror hr{border:none;border-top:1px solid var(--vscode-panel-border);margin:28px 0}
.ProseMirror table{border-collapse:collapse;margin-bottom:20px;width:100%}
.ProseMirror th,.ProseMirror td{border:1px solid var(--vscode-panel-border);padding:8px 12px;text-align:left}
.ProseMirror th{background:var(--vscode-panelSectionHeader-background);font-weight:600}
.ProseMirror img{max-width:100%;border-radius:4px}
.ProseMirror-gapcursor{display:none;pointer-events:none;position:relative}
.ProseMirror-gapcursor:after{content:'';display:block;position:absolute;top:-2px;width:20px;border-top:1px solid var(--vscode-editorCursor-foreground)}
.ProseMirror-focused .ProseMirror-gapcursor{display:block}
#source-editor{display:none;flex:1;overflow:hidden}
#source-editor.active{display:block}
#source-editor .cm-editor{height:100%}
#source-editor .cm-scroller{overflow:auto}
#source-editor .cm-gutters{background:var(--vscode-editor-background);border-right:1px solid var(--vscode-panel-border);color:var(--vscode-editorLineNumber-foreground);user-select:none}
#source-editor .cm-activeLineGutter{background:var(--vscode-editor-lineHighlightBackground)}
.pm-toolbar .mode-btn{padding:3px 12px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.pm-toolbar .mode-btn.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.editor-body{display:flex;flex:1;overflow:hidden}
.editor-area{display:flex;flex:1;overflow:hidden;flex-direction:column}
#file-tree-panel{display:none;width:260px;flex-shrink:0;overflow-y:auto;background:var(--vscode-sideBar-background);border-right:1px solid var(--vscode-panel-border);font-size:13px}
#file-tree-panel.active{display:flex;flex-direction:column}
#file-tree-panel.dock-right{order:1;border-right:none;border-left:1px solid var(--vscode-panel-border)}
.tree-header{display:flex;align-items:center;padding:8px 12px;text-transform:uppercase;font-size:11px;font-weight:600;letter-spacing:.8px;color:var(--vscode-editor-foreground);border-bottom:1px solid var(--vscode-panel-border);flex-shrink:0}
.tree-header span{flex:1}
.tree-header button{padding:2px 6px;border:none;background:transparent;color:var(--vscode-editor-foreground);cursor:pointer;border-radius:4px;font-size:13px;line-height:1}
.tree-header button:hover{background:var(--vscode-toolbar-hoverBackground)}
.tree-search-bar{display:none;flex-direction:column;padding:4px 8px;border-bottom:1px solid var(--vscode-panel-border);gap:3px;flex-shrink:0}
.tree-search-bar.active{display:flex}
.tree-search-bar input{padding:3px 6px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:2px;font-size:12px;font-family:inherit;outline:none}
.tree-search-bar input:focus{border-color:var(--vscode-focusBorder)}
.tree-search-options{display:flex;gap:2px;align-items:center}
.tree-search-options .search-option{padding:2px 6px;border:1px solid transparent;background:transparent;color:var(--vscode-editor-foreground);cursor:pointer;border-radius:3px;font-size:11px;font-weight:600;line-height:1;font-family:inherit}
.tree-search-options .search-option:hover{border-color:var(--vscode-panel-border)}
.tree-search-options .search-option.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:var(--vscode-button-background)}
.tree-gitignore-label{display:flex;align-items:center;gap:3px;font-size:11px;cursor:pointer;white-space:nowrap;color:var(--vscode-editor-foreground);user-select:none}
.tree-gitignore-label input{margin:0;cursor:pointer}
.tree-content{flex:1;overflow-y:auto;padding:4px 0}
.tree-item{display:flex;align-items:center;padding:2px 8px;cursor:pointer;white-space:nowrap;user-select:none}
.tree-item:hover{background:var(--vscode-list-hoverBackground)}
.tree-item .indent{display:inline-block;flex-shrink:0}
.tree-item .chevron{display:inline-block;width:16px;text-align:center;flex-shrink:0;font-size:10px;color:var(--vscode-editor-foreground);opacity:.6}
.tree-item .icon{display:inline-block;width:16px;text-align:center;flex-shrink:0;margin-right:4px;font-size:14px}
.tree-item .label{overflow:hidden;text-overflow:ellipsis}
.tree-item.file{padding-left:calc(8px + 16px + 4px)}
</style>
</head>
<body>
<div id="pm-toolbar" class="pm-toolbar">
  <button id="pm-undo" title="Undo (Ctrl+Z)">\u21A9</button>
  <button id="pm-redo" title="Redo (Ctrl+Y)">\u21AA</button>
  <span class="sep"></span>
  <button id="pm-bold" title="Bold (Ctrl+B)"><strong>B</strong></button>
  <button id="pm-italic" title="Italic (Ctrl+I)"><em>I</em></button>
  <button id="pm-strike" title="Strikethrough"><s>S</s></button>
  <button id="pm-code" title="Inline Code">&lt;/&gt;</button>
  <span class="sep"></span>
  <button id="pm-h1" title="Heading 1">H1</button>
  <button id="pm-h2" title="Heading 2">H2</button>
  <button id="pm-h3" title="Heading 3">H3</button>
  <button id="pm-h4" title="Heading 4">H4</button>
  <button id="pm-h5" title="Heading 5">H5</button>
  <button id="pm-h6" title="Heading 6">H6</button>
  <span class="sep"></span>
  <button id="pm-ul" title="Bullet List">\u2261</button>
  <button id="pm-ol" title="Numbered List">1.</button>
  <button id="pm-quote" title="Blockquote">\u275D</button>
  <button id="pm-codeblock" title="Code Block">{ }</button>
  <button id="pm-hr" title="Horizontal Rule">\u2014</button>
  <span class="sep"></span>
  <button id="pm-clear" title="Clear Formatting">T</button>
  <button id="pm-link" title="Insert Link">\u{1F517}</button>
  <button id="pm-image" title="Insert Image">\u{1F5BC}</button>
  <span style="flex:1"></span>
  <button id="pm-tree-toggle" title="File Explorer">\u{1F4C2}</button>
  <button id="pm-mode-visual" class="mode-btn active">Visual</button>
  <button id="pm-mode-source" class="mode-btn">Source</button>
</div>
<div class="editor-body">
  <div id="file-tree-panel">
    <div class="tree-header">
      <span>Explorer</span>
      <button id="pm-tree-search-btn" title="Search files">\u{1F50D}</button>
      <button id="pm-tree-dock" title="Move to other side">\u21D4</button>
      <button id="pm-tree-close" title="Close panel">\u2715</button>
    </div>
    <div id="tree-search-bar" class="tree-search-bar">
      <input id="tree-search-input" type="text" placeholder="Search files..." spellcheck="false">
      <div class="tree-search-options">
        <button id="tree-search-regex" class="search-option" title="Use Regex">.*</button>
        <button id="tree-search-case" class="search-option" title="Match Case">Aa</button>
        <label class="tree-gitignore-label" title="Respect .gitignore"><input type="checkbox" id="tree-search-gitignore"> .gitignore</label>
        <input id="tree-search-include" type="text" placeholder="include" style="flex:1;min-width:0">
        <input id="tree-search-exclude" type="text" placeholder="exclude" style="flex:1;min-width:0">
      </div>
    </div>
    <div id="tree-content" class="tree-content"></div>
  </div>
  <div class="editor-area">
    <div id="prosemirror" class="active"></div>
    <div id="source-editor"></div>
  </div>
</div>
<script nonce="${nonce}">${scriptContent}</script>
</body>
</html>`;
  }
};
function getNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// src/extension.ts
var activePanels = /* @__PURE__ */ new Map();
function activate(context) {
  context.subscriptions.push(
    vscode2.window.registerCustomEditorProvider(
      "ameliance-markdown.preview",
      new LiveEditorProvider(context, activePanels),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
  context.subscriptions.push(
    vscode2.commands.registerCommand("ameliance-markdown.toggleSource", async () => {
      const customPanel = Array.from(activePanels.keys()).find((p) => p.active);
      const textEditor = vscode2.window.activeTextEditor;
      if (customPanel) {
        await vscode2.commands.executeCommand("vscode.openWith", activePanels.get(customPanel), "default");
      } else if (textEditor) {
        await vscode2.commands.executeCommand("vscode.openWith", textEditor.document.uri, "ameliance-markdown.preview");
      }
    })
  );
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
