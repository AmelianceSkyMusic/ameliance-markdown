import * as vscode from 'vscode';
import { LiveEditorProvider } from './editor/liveEditorProvider';

const activePanels = new Set<vscode.WebviewPanel>();

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'ameliance-markdown.preview',
      new LiveEditorProvider(context, activePanels),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ameliance-markdown.toggleSource', () => {
      for (const panel of activePanels) {
        if (panel.visible) {
          panel.webview.postMessage({ type: 'toggleSource' });
          return;
        }
      }
    })
  );
}

export function deactivate() {}