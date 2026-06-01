import { EditorView, keymap, highlightActiveLine, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { schema as baseSchema, defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown';
import { Schema } from 'prosemirror-model';
import { EditorState as PmState } from 'prosemirror-state';
import { EditorView as PmEditorView } from 'prosemirror-view';
import { history as pmHistory, undo, redo } from 'prosemirror-history';
import { keymap as pmKeymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import { gapCursor } from 'prosemirror-gapcursor';
import MarkdownIt from 'markdown-it';
import { MarkdownParser } from 'prosemirror-markdown';
import type { EditorMessage } from '../shared/types';

(function () {
  let vscode: ReturnType<typeof acquireVsCodeApi>;
  try { vscode = acquireVsCodeApi(); } catch { return; }

  // ── ProseMirror Schema (with strikethrough) ──

  const strikeSpec = {
    parseDOM: [
      { tag: 's' },
      { tag: 'del' },
      { tag: 'strike' },
      { style: 'text-decoration', getAttrs: (v: string) => v === 'line-through' && null },
    ],
    toDOM() { return ['s', 0] as const; },
  };

  const schema = new Schema({
    nodes: baseSchema.spec.nodes,
    marks: (baseSchema.spec.marks as any).addToEnd('strike', strikeSpec),
  });

  const md = MarkdownIt('default', { breaks: true, html: true }).enable('strikethrough');
  const parser = new MarkdownParser(schema, md, {
    ...(defaultMarkdownParser as any).tokens,
    s: { mark: 'strike' },
  });

  const serializer = defaultMarkdownSerializer as any;
  serializer.marks.strike = {
    open: '~~',
    close: '~~',
    mixable: true,
    expelEnclosingWhitespace: true,
  };

  // ── CodeMirror Theme & Highlight ──

  const cmTheme = EditorView.theme({
    '&': { height: '100%', backgroundColor: 'var(--vscode-editor-background)', color: 'var(--vscode-editor-foreground)' },
    '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family, Consolas, monospace)', fontSize: 'var(--vscode-editor-font-size, 14px)', lineHeight: '1.7' },
    '.cm-content': { caretColor: 'var(--vscode-editorCursor-foreground)', padding: '16px 20px' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--vscode-editor-selectionBackground) !important' },
    '&.cm-focused .cm-cursor, .cm-cursor': { borderLeftColor: 'var(--vscode-editorCursor-foreground)' },
    '.cm-activeLine': { backgroundColor: 'var(--vscode-editor-lineHighlightBackground)' },
  });

  const cmHighlight = HighlightStyle.define([
    { tag: tags.heading, color: 'var(--vscode-symbolIcon-classForeground, #569cd6)', fontWeight: 'bold' },
    { tag: tags.quote, color: 'var(--vscode-textBlockQuote-foreground, #6a9955)' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.link, color: 'var(--vscode-textLink-foreground, #3794ff)' },
    { tag: tags.url, color: 'var(--vscode-textLink-foreground, #3794ff)', textDecoration: 'underline' },
    { tag: tags.monospace, color: 'var(--vscode-textPreformat-foreground, #d7ba7d)' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.comment, color: 'var(--vscode-editorComments-foreground, #6a9955)', fontStyle: 'italic' },
    { tag: tags.keyword, color: 'var(--vscode-symbolIcon-keywordForeground, #569cd6)' },
    { tag: tags.atom, color: 'var(--vscode-symbolIcon-constantForeground, #4fc1ff)' },
    { tag: tags.number, color: 'var(--vscode-symbolIcon-numberForeground, #b5cea8)' },
    { tag: tags.definition(tags.typeName), color: 'var(--vscode-symbolIcon-typeParameterForeground, #4ec9b0)' },
    { tag: tags.string, color: 'var(--vscode-symbolIcon-stringForeground, #ce9178)' },
    { tag: tags.bool, color: 'var(--vscode-symbolIcon-booleanForeground, #569cd6)' },
    { tag: tags.function(tags.variableName), color: 'var(--vscode-symbolIcon-functionForeground, #dcdcaa)' },
  ]);

  // ── State ──

  let isSourceMode = false;
  let isExternalUpdate = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const editorContainer = document.getElementById('prosemirror')!;
  const sourceContainer = document.getElementById('source-editor')!;
  const modeSource = document.getElementById('pm-mode-source')!;
  const modeVisual = document.getElementById('pm-mode-visual')!;
  let pmView: EditorView | null = null;
  let cmView: EditorView | null = null;

  // ── ProseMirror ──

  function initProseMirror(markdownText: string) {
    try {
      const doc = parser.parse(markdownText) || schema.topNodeType.create();
      const state = PmState.create({
        doc,
        schema,
        plugins: [
          pmHistory(),
          pmKeymap(baseKeymap),
          pmKeymap({
            'Mod-z': () => undo(pmView!.state, pmView!.dispatch) as boolean,
            'Mod-y': () => redo(pmView!.state, pmView!.dispatch) as boolean,
            'Mod-Shift-z': () => redo(pmView!.state, pmView!.dispatch) as boolean,
          }),
          gapCursor(),
        ],
      });

      if (pmView) pmView.destroy();

      pmView = new PmEditorView(editorContainer, {
        state,
        dispatchTransaction(tr) {
          if (!pmView) return;
          const newState = pmView.state.apply(tr);
          pmView.updateState(newState);
          if (tr.docChanged && !isExternalUpdate) {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              vscode.postMessage({ type: 'edit', text: serializer.serialize(newState.doc) + '\n' } satisfies EditorMessage);
            }, 200);
          }
        },
      });
    } catch (e) {
      document.body.innerHTML = '<div style="padding:40px;color:red"><h2>Error</h2><pre>' + e + '</pre></div>';
    }
  }

  // ── CodeMirror ──

  function getCmView(): EditorView {
    if (!cmView) {
      cmView = new EditorView({
        doc: '',
        extensions: [
          markdown(),
          lineNumbers(),
          EditorView.lineWrapping,
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          syntaxHighlighting(cmHighlight),
          cmTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !isExternalUpdate) {
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                vscode.postMessage({ type: 'edit', text: update.state.doc.toString() } satisfies EditorMessage);
              }, 200);
            }
          }),
        ],
        parent: sourceContainer,
      });
    }
    return cmView;
  }

  // ── Toggle ──

  function setMode(source: boolean) {
    isSourceMode = source;
    editorContainer.classList.toggle('active', !source);
    sourceContainer.classList.toggle('active', source);
    modeSource.classList.toggle('active', source);
    modeVisual.classList.toggle('active', !source);

    if (source) {
      if (pmView) {
        const cm = getCmView();
        const text = serializer.serialize(pmView.state.doc) + '\n';
        cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text } });
        setTimeout(() => cm.focus(), 0);
      }
    } else {
      if (cmView) {
        isExternalUpdate = true;
        initProseMirror(cmView.state.doc.toString());
        isExternalUpdate = false;
        setTimeout(() => pmView?.focus(), 0);
      }
    }
  }

  modeSource.addEventListener('click', () => setMode(true));
  modeVisual.addEventListener('click', () => setMode(false));

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'm') {
      e.preventDefault();
      setMode(!isSourceMode);
    }
  });

  // ── Toolbar Commands ──

  let savedPmSel: any = null;

  document.querySelectorAll('.pm-toolbar button').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      if (pmView) savedPmSel = pmView.state.selection;
    });
  });

  function cmd(fn: () => boolean) {
    return () => {
      if (!pmView) return;
      if (savedPmSel) {
        pmView.dispatch(pmView.state.tr.setSelection(savedPmSel));
        savedPmSel = null;
      }
      fn();
    };
  }

  document.getElementById('pm-undo')?.addEventListener('click', cmd(() => undo(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-redo')?.addEventListener('click', cmd(() => redo(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-bold')?.addEventListener('click', cmd(() => toggleMark(schema.marks.strong)(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-italic')?.addEventListener('click', cmd(() => toggleMark(schema.marks.em)(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-strike')?.addEventListener('click', cmd(() => toggleMark(schema.marks.strike)(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-code')?.addEventListener('click', cmd(() => toggleMark(schema.marks.code)(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-h1')?.addEventListener('click', cmd(() => setBlockType(schema.nodes.heading, { level: 1 })(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-h2')?.addEventListener('click', cmd(() => setBlockType(schema.nodes.heading, { level: 2 })(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-h3')?.addEventListener('click', cmd(() => setBlockType(schema.nodes.heading, { level: 3 })(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-h4')?.addEventListener('click', cmd(() => setBlockType(schema.nodes.heading, { level: 4 })(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-h5')?.addEventListener('click', cmd(() => setBlockType(schema.nodes.heading, { level: 5 })(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-h6')?.addEventListener('click', cmd(() => setBlockType(schema.nodes.heading, { level: 6 })(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-ul')?.addEventListener('click', cmd(() => wrapInList(schema.nodes.bullet_list)(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-ol')?.addEventListener('click', cmd(() => wrapInList(schema.nodes.ordered_list)(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-quote')?.addEventListener('click', cmd(() => wrapIn(schema.nodes.blockquote)(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-codeblock')?.addEventListener('click', cmd(() => setBlockType(schema.nodes.code_block)(pmView!.state, pmView!.dispatch)));
  document.getElementById('pm-hr')?.addEventListener('click', () => {
    if (!pmView) return;
    const node = schema.nodes.horizontal_rule.create();
    pmView.dispatch(pmView.state.tr.replaceSelectionWith(node).scrollIntoView());
    pmView.focus();
  });
  document.getElementById('pm-clear')?.addEventListener('click', () => {
    if (!pmView) return;
    const { state, dispatch } = pmView;
    dispatch(state.tr.removeMark(state.selection.from, state.selection.to));
    setBlockType(schema.nodes.paragraph)(state, dispatch);
    pmView.focus();
  });
  document.getElementById('pm-link')?.addEventListener('click', () => {
    if (!pmView) return;
    const url = prompt('Enter URL:');
    if (url) {
      toggleMark(schema.marks.link, { href: url })(pmView.state, pmView.dispatch);
      pmView.focus();
    }
  });
  document.getElementById('pm-image')?.addEventListener('click', () => {
    if (!pmView) return;
    const url = prompt('Enter image URL:');
    const alt = prompt('Enter alt text:') || '';
    if (url) {
      const node = schema.nodes.image.create({ src: url, alt });
      pmView.dispatch(pmView.state.tr.replaceSelectionWith(node).scrollIntoView());
      pmView.focus();
    }
  });

  // ── Extension Messages ──

  window.addEventListener('message', (event: MessageEvent<EditorMessage>) => {
    const msg = event.data;
    if (msg.type === 'toggleSource') {
      setMode(!isSourceMode);
      return;
    }
    if (msg.type === 'content' && typeof msg.text === 'string') {
      isExternalUpdate = true;
      if (isSourceMode) {
        const cm = getCmView();
        cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: msg.text } });
      } else if (!pmView) {
        initProseMirror(msg.text);
      } else {
        const doc = parser.parse(msg.text) || schema.topNodeType.create();
        pmView.dispatch(
          pmView.state.tr.replaceWith(0, pmView.state.doc.content.size, doc.content).scrollIntoView()
        );
      }
      isExternalUpdate = false;
    }
  });

  vscode.postMessage({ type: 'ready' } satisfies EditorMessage);
})();
