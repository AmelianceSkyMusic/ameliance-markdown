import * as vscode from 'vscode';
import { LiveEditorProvider } from './editor/liveEditorProvider';

const activePanels = new Map<vscode.WebviewPanel, vscode.Uri>();

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'ameliance-markdown.preview',
      new LiveEditorProvider(context, activePanels),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ameliance-markdown.toggleSource', async () => {
      const customPanel = Array.from(activePanels.keys()).find(p => p.active);
      const textEditor = vscode.window.activeTextEditor;

      if (customPanel) {
        await vscode.commands.executeCommand('vscode.openWith', activePanels.get(customPanel)!, 'default');
      } else if (textEditor) {
        await vscode.commands.executeCommand('vscode.openWith', textEditor.document.uri, 'ameliance-markdown.preview');
      }
    })
  );
}

export function deactivate() {}