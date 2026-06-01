import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { EditorMessage } from '../shared/types';

export class LiveEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly activePanels: Map<vscode.WebviewPanel, vscode.Uri>
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.activePanels.set(webviewPanel, document.uri);
    webviewPanel.onDidDispose(() => this.activePanels.delete(webviewPanel));

    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.getHtml();

    let isApplyingEdit = false;

    const sendContent = () => {
      webviewPanel.webview.postMessage({
        type: 'content',
        text: document.getText(),
      } satisfies EditorMessage);
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

    webviewPanel.webview.onDidReceiveMessage((message: EditorMessage) => {
      switch (message.type) {
        case 'ready':
          sendContent();
          break;
        case 'edit':
          if (typeof message.text === 'string') {
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
      }
    });
  }

  private getHtml(): string {
    const nonce = getNonce();
    const scriptPath = path.join(this.context.extensionPath, 'out', 'webview.js');
    let scriptContent: string;
    try {
      scriptContent = fs.readFileSync(scriptPath, 'utf-8');
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
</style>
</head>
<body>
<div id="pm-toolbar" class="pm-toolbar">
  <button id="pm-undo" title="Undo (Ctrl+Z)">↩</button>
  <button id="pm-redo" title="Redo (Ctrl+Y)">↪</button>
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
  <button id="pm-ul" title="Bullet List">≡</button>
  <button id="pm-ol" title="Numbered List">1.</button>
  <button id="pm-quote" title="Blockquote">❝</button>
  <button id="pm-codeblock" title="Code Block">{ }</button>
  <button id="pm-hr" title="Horizontal Rule">—</button>
  <span class="sep"></span>
  <button id="pm-clear" title="Clear Formatting">T</button>
  <button id="pm-link" title="Insert Link">🔗</button>
  <button id="pm-image" title="Insert Image">🖼</button>
  <span style="flex:1"></span>
  <button id="pm-mode-source" class="mode-btn active">Source</button>
  <button id="pm-mode-visual" class="mode-btn">Visual</button>
</div>
<div id="prosemirror" class="active"></div>
<div id="source-editor"></div>
<script nonce="${nonce}">${scriptContent}</script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
