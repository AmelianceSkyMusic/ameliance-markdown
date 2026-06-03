import { EditorView, keymap, highlightActiveLine, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { defaultKeymap, history, historyKeymap, undo as cmUndo, redo as cmRedo } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { schema as baseSchema, defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown';
import { Schema } from 'prosemirror-model';
import { EditorState as PmState, TextSelection } from 'prosemirror-state';
import { EditorView as PmEditorView } from 'prosemirror-view';
import { history as pmHistory, undo, redo } from 'prosemirror-history';
import { keymap as pmKeymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';

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
    { tag: tags.tagName, color: 'var(--vscode-symbolIcon-classForeground, #569cd6)' },
    { tag: tags.attributeName, color: 'var(--vscode-symbolIcon-propertyForeground, #9cdcfe)' },
    { tag: tags.angleBracket, color: 'var(--vscode-editor-foreground, #d4d4d4)' },
  ]);

  // ── State ──

  let currentMode: 'visual' | 'source' | 'html' = 'visual';
  let isExternalUpdate = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const editorContainer = document.getElementById('prosemirror')!;
  const sourceContainer = document.getElementById('source-editor')!;
  const htmlContainer = document.getElementById('html-editor')!;
  const modeSource = document.getElementById('pm-mode-source')!;
  const modeVisual = document.getElementById('pm-mode-visual')!;
  const modeHtml = document.getElementById('pm-mode-html')!;
  let pmView: EditorView | null = null;
  let cmView: EditorView | null = null;
  let htmlView: EditorView | null = null;

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
            updateOutline();
        },
        handleDOMEvents: {
          dblclick: () => {
            setTimeout(() => {
              if (!pmView) return;
              const { from, to } = pmView.state.selection;
              const text = pmView.state.doc.textBetween(from, to);
              const trimmed = text.replace(/\s+$/, '');
              if (trimmed.length < text.length) {
                pmView.dispatch(pmView.state.tr.setSelection(TextSelection.create(pmView.state.doc, from, from + trimmed.length)));
              }
            }, 10);
            return false;
          }
        },
      });
    } catch (e) {
      document.body.innerHTML = '<div style="padding:40px;color:red"><h2>Error</h2><pre>' + e + '</pre></div>';
    }
    editorContainer.addEventListener('scroll', updateActiveHeading);
    updateOutline();
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
            updateOutline();
          }),
        ],
        parent: sourceContainer,
      });
      cmView.scrollDOM.addEventListener('scroll', updateActiveHeading);
    }
    return cmView;
  }

  function getHtmlView(): EditorView {
    if (!htmlView) {
      htmlView = new EditorView({
        doc: '',
        extensions: [
          html(),
          lineNumbers(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          syntaxHighlighting(cmHighlight),
          cmTheme,
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
        ],
        parent: htmlContainer,
      });
    }
    return htmlView;
  }

  // ── Toggle ──

  function getCurrentMd(): string {
    if (cmView?.state.doc.length) return cmView.state.doc.toString();
    if (pmView) return serializer.serialize(pmView.state.doc) + '\n';
    return '';
  }

  function setMode(mode: 'visual' | 'source' | 'html') {
    if (mode === 'html') {
      const mdText = getCurrentMd();
      currentMode = mode;
      editorContainer.classList.toggle('active', false);
      sourceContainer.classList.toggle('active', false);
      htmlContainer.classList.toggle('active', true);
      modeVisual.classList.toggle('active', false);
      modeSource.classList.toggle('active', false);
      modeHtml.classList.toggle('active', true);
      const htmlEditor = getHtmlView();
      const generated = md.render(mdText);
      htmlEditor.dispatch({ changes: { from: 0, to: htmlEditor.state.doc.length, insert: generated } });
      updateOutline();
      return;
    }

    currentMode = mode;
    editorContainer.classList.toggle('active', mode === 'visual');
    sourceContainer.classList.toggle('active', mode === 'source');
    htmlContainer.classList.toggle('active', mode === 'html');
    modeVisual.classList.toggle('active', mode === 'visual');
    modeSource.classList.toggle('active', mode === 'source');
    modeHtml.classList.toggle('active', mode === 'html');

    if (mode === 'source' && pmView) {
      const cm = getCmView();
      const text = serializer.serialize(pmView.state.doc) + '\n';
      cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text } });
      setTimeout(() => cm.focus(), 0);
    } else if (mode === 'visual' && cmView) {
      isExternalUpdate = true;
      initProseMirror(cmView.state.doc.toString());
      isExternalUpdate = false;
      setTimeout(() => pmView?.dom.focus({preventScroll: true}), 0);
    }
    updateOutline();
  }

  modeSource.addEventListener('click', () => setMode('source'));
  modeVisual.addEventListener('click', () => setMode('visual'));
  modeHtml.addEventListener('click', () => setMode('html'));

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'm') {
      e.preventDefault();
      const modes: ('visual' | 'source' | 'html')[] = ['visual', 'source', 'html'];
      const idx = modes.indexOf(currentMode);
      setMode(modes[(idx + 1) % modes.length]);
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

  function pmExec(fn: () => boolean | void) {
    if (savedPmSel) {
      pmView!.dispatch(pmView!.state.tr.setSelection(savedPmSel));
      savedPmSel = null;
    }
    fn();
    pmView!.focus();
  }

  function cmToggleWrap(open: string, close: string) {
    const cm = getCmView();
    toggleWrap(cm, open, close);
  }

  function toggleWrap(cm: EditorView, open: string, close: string) {
    const sel = cm.state.selection.main;
    const text = cm.state.sliceDoc(sel.from, sel.to) || '';
    if (text.startsWith(open) && text.endsWith(close)) {
      const inner = text.slice(open.length, -close.length);
      cm.dispatch({
        changes: { from: sel.from, to: sel.to, insert: inner },
        selection: { anchor: sel.from, head: sel.from + inner.length }
      });
    } else {
      cm.dispatch({
        changes: { from: sel.from, to: sel.to, insert: open + text + close },
        selection: { anchor: sel.from + open.length, head: sel.from + open.length + text.length }
      });
    }
    cm.focus();
  }

  function cmTogglePrefix(prefix: string) {
    const cm = getCmView();
    const sel = cm.state.selection.main;
    const line = cm.state.doc.lineAt(sel.from);
    const lineText = cm.state.sliceDoc(line.from, line.to);
    if (lineText.startsWith(prefix)) {
      cm.dispatch({ changes: { from: line.from, to: line.from + prefix.length, insert: '' } });
    } else {
      cm.dispatch({ changes: { from: line.from, to: line.from, insert: prefix } });
    }
    cm.focus();
  }

  function cmInsert(text: string) {
    const cm = getCmView();
    const sel = cm.state.selection.main;
    cm.dispatch({ changes: { from: sel.from, to: sel.to, insert: text } });
    cm.focus();
  }

  function runInMode(pmFn: () => void, cmFn: () => void, htmlFn?: () => void) {
    if (currentMode === 'source') { cmFn(); }
    else if (currentMode === 'visual' && pmView) { pmExec(pmFn); }
    else if (currentMode === 'html' && htmlFn) { htmlFn(); }
  }

  function htmlToggleWrap(open: string, close: string) {
    toggleWrap(getHtmlView(), open, close);
  }

  function htmlInsert(text: string) {
    const hv = getHtmlView();
    const sel = hv.state.selection.main;
    hv.dispatch({ changes: { from: sel.from, to: sel.to, insert: text } });
    hv.focus();
  }

  document.getElementById('pm-undo')?.addEventListener('click', () => {
    if (currentMode === 'source') { cmUndo(getCmView()); getCmView().focus(); }
    else if (currentMode === 'visual' && pmView) { undo(pmView.state, pmView.dispatch); pmView.focus(); }
    else if (currentMode === 'html') { cmUndo(getHtmlView()); getHtmlView().focus(); }
  });
  document.getElementById('pm-redo')?.addEventListener('click', () => {
    if (currentMode === 'source') { cmRedo(getCmView()); getCmView().focus(); }
    else if (currentMode === 'visual' && pmView) { redo(pmView.state, pmView.dispatch); pmView.focus(); }
    else if (currentMode === 'html') { cmRedo(getHtmlView()); getHtmlView().focus(); }
  });
  document.getElementById('pm-bold')?.addEventListener('click', () => runInMode(
    () => toggleMark(schema.marks.strong)(pmView!.state, pmView!.dispatch),
    () => cmToggleWrap('**', '**'),
    () => htmlToggleWrap('<strong>', '</strong>')
  ));
  document.getElementById('pm-italic')?.addEventListener('click', () => runInMode(
    () => toggleMark(schema.marks.em)(pmView!.state, pmView!.dispatch),
    () => cmToggleWrap('*', '*'),
    () => htmlToggleWrap('<em>', '</em>')
  ));
  document.getElementById('pm-strike')?.addEventListener('click', () => runInMode(
    () => toggleMark(schema.marks.strike)(pmView!.state, pmView!.dispatch),
    () => cmToggleWrap('~~', '~~'),
    () => htmlToggleWrap('<s>', '</s>')
  ));
  document.getElementById('pm-code')?.addEventListener('click', () => runInMode(
    () => toggleMark(schema.marks.code)(pmView!.state, pmView!.dispatch),
    () => cmToggleWrap('`', '`'),
    () => htmlToggleWrap('<code>', '</code>')
  ));
  document.getElementById('pm-h1')?.addEventListener('click', () => runInMode(
    () => setBlockType(schema.nodes.heading, { level: 1 })(pmView!.state, pmView!.dispatch),
    () => cmTogglePrefix('# '),
    () => htmlToggleWrap('<h1>', '</h1>')
  ));
  document.getElementById('pm-h2')?.addEventListener('click', () => runInMode(
    () => setBlockType(schema.nodes.heading, { level: 2 })(pmView!.state, pmView!.dispatch),
    () => cmTogglePrefix('## '),
    () => htmlToggleWrap('<h2>', '</h2>')
  ));
  document.getElementById('pm-h3')?.addEventListener('click', () => runInMode(
    () => setBlockType(schema.nodes.heading, { level: 3 })(pmView!.state, pmView!.dispatch),
    () => cmTogglePrefix('### '),
    () => htmlToggleWrap('<h3>', '</h3>')
  ));
  document.getElementById('pm-h4')?.addEventListener('click', () => runInMode(
    () => setBlockType(schema.nodes.heading, { level: 4 })(pmView!.state, pmView!.dispatch),
    () => cmTogglePrefix('#### '),
    () => htmlToggleWrap('<h4>', '</h4>')
  ));
  document.getElementById('pm-h5')?.addEventListener('click', () => runInMode(
    () => setBlockType(schema.nodes.heading, { level: 5 })(pmView!.state, pmView!.dispatch),
    () => cmTogglePrefix('##### '),
    () => htmlToggleWrap('<h5>', '</h5>')
  ));
  document.getElementById('pm-h6')?.addEventListener('click', () => runInMode(
    () => setBlockType(schema.nodes.heading, { level: 6 })(pmView!.state, pmView!.dispatch),
    () => cmTogglePrefix('###### '),
    () => htmlToggleWrap('<h6>', '</h6>')
  ));
  document.getElementById('pm-ul')?.addEventListener('click', () => runInMode(
    () => wrapInList(schema.nodes.bullet_list)(pmView!.state, pmView!.dispatch),
    () => cmTogglePrefix('- '),
    () => htmlToggleWrap('\n<ul>\n<li>', '</li>\n</ul>\n')
  ));
  document.getElementById('pm-ol')?.addEventListener('click', () => runInMode(
    () => wrapInList(schema.nodes.ordered_list)(pmView!.state, pmView!.dispatch),
    () => cmTogglePrefix('1. '),
    () => htmlToggleWrap('\n<ol>\n<li>', '</li>\n</ol>\n')
  ));
  document.getElementById('pm-quote')?.addEventListener('click', () => runInMode(
    () => wrapIn(schema.nodes.blockquote)(pmView!.state, pmView!.dispatch),
    () => cmTogglePrefix('> '),
    () => htmlToggleWrap('<blockquote>', '</blockquote>')
  ));
  document.getElementById('pm-codeblock')?.addEventListener('click', () => runInMode(
    () => setBlockType(schema.nodes.code_block)(pmView!.state, pmView!.dispatch),
    () => cmToggleWrap('```\n', '\n```'),
    () => htmlToggleWrap('<pre><code>', '</code></pre>')
  ));
  document.getElementById('pm-hr')?.addEventListener('click', () => runInMode(
    () => {
      const node = schema.nodes.horizontal_rule.create();
      pmView!.dispatch(pmView!.state.tr.replaceSelectionWith(node).scrollIntoView());
    },
    () => cmInsert('\n\n---\n\n'),
    () => {
      const hv = getHtmlView();
      hv.dispatch({ changes: { from: hv.state.selection.main.from, to: hv.state.selection.main.from, insert: '\n<hr>\n' } });
      hv.focus();
    }
  ));
  document.getElementById('pm-clear')?.addEventListener('click', () => runInMode(
    () => {
      const { state, dispatch } = pmView!;
      dispatch(state.tr.removeMark(state.selection.from, state.selection.to));
      setBlockType(schema.nodes.paragraph)(state, dispatch);
    },
    () => { /* no-op in source mode */ },
    () => { /* no-op in HTML mode */ }
  ));
  document.getElementById('pm-link')?.addEventListener('click', () => {
    const url = prompt('Enter URL:');
    if (!url) return;
    runInMode(
      () => toggleMark(schema.marks.link, { href: url })(pmView!.state, pmView!.dispatch),
      () => cmInsert(`[${url}](${url})`),
      () => htmlToggleWrap(`<a href="${url}">`, '</a>')
    );
  });
  document.getElementById('pm-image')?.addEventListener('click', () => {
    const url = prompt('Enter image URL:');
    const alt = prompt('Enter alt text:') || '';
    if (!url) return;
    runInMode(
      () => {
        const node = schema.nodes.image.create({ src: url, alt });
        pmView!.dispatch(pmView!.state.tr.replaceSelectionWith(node).scrollIntoView());
      },
      () => cmInsert(`![${alt}](${url})`),
      () => {
        const hv = getHtmlView();
        hv.dispatch({ changes: { from: hv.state.selection.main.from, to: hv.state.selection.main.to, insert: `<img src="${url}" alt="${alt}">` } });
        hv.focus();
      }
    );
  });

  document.getElementById('pm-copy')?.addEventListener('click', () => {
    let text = '';
    if (currentMode === 'visual' && pmView) {
      text = pmView.state.doc.textContent;
    } else if (currentMode === 'source') {
      text = cmView?.state.doc.toString() || '';
    } else if (currentMode === 'html') {
      text = htmlView?.state.doc.toString() || '';
    }
    if (text) navigator.clipboard.writeText(text);
  });

  // ── File Tree Panel ──

  let isTreeOpen = false;
  let panelsSwapped = false;
  let treeData: TreeNode[] = [];
  let treeSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let restoreExpanded: string[] | null = null;

  function getExpandedPaths(): string[] {
    const out: string[] = [];
    function walk(nodes: TreeNode[]) {
      for (const n of nodes) {
        if (n.type === 'dir') {
          if (n.expanded) out.push(n.path || n.name);
          walk(n.children);
        }
      }
    }
    walk(treeData);
    return out;
  }

  function getTreeState() {
    return {
      isOpen: isTreeOpen,
      panelsSwapped,
      expanded: getExpandedPaths(),
      gitignore: gitignoreOn,
      searchQuery,
      searchRegex,
      searchCase,
      searchInclude,
      searchExclude,
    };
  }

  function saveTreeState() {
    if (treeSaveTimer) clearTimeout(treeSaveTimer);
    treeSaveTimer = setTimeout(() => {
      vscode.postMessage({ type: 'saveTreeState', state: getTreeState() } satisfies EditorMessage);
    }, 300);
  }

  const treePanel = document.getElementById('file-tree-panel')!;
  const treeContent = document.getElementById('tree-content')!;
  const treeToggle = document.getElementById('pm-tree-toggle')!;
  const treePanelClose = document.getElementById('pm-tree-panel-close')!;
  const treeClose = document.getElementById('pm-tree-close')!;
  const panelSwapBtn = document.getElementById('pm-panel-swap')!;

  const outlinePanel = document.getElementById('outline-panel')!;
  const outlineContent = document.getElementById('outline-content')!;
  const outlineToggle = document.getElementById('pm-outline-toggle')!;
  const outlineClose = document.getElementById('pm-outline-close')!;
  let isOutlineOpen = false;

  interface HeadingItem {
    level: number;
    text: string;
    pos: number;
  }

  function getHeadings(): HeadingItem[] {
    if (currentMode === 'source') {
      const cm = getCmView();
      const text = cm.state.doc.toString();
      const headings: HeadingItem[] = [];
      const re = /^(#{1,6})\s+(.+)$/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const line = text.slice(0, m.index).split('\n').length - 1;
        const lineStart = cm.state.doc.line(line + 1).from;
        headings.push({ level: m[1].length, text: m[2], pos: lineStart });
      }
      return headings;
    }
    if (currentMode === 'html') return [];
    if (!pmView) return [];
    const headings: HeadingItem[] = [];
    pmView.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const text = node.textContent;
        if (text) headings.push({ level: node.attrs.level, text, pos });
      }
    });
    return headings;
  }

  function renderOutline() {
    const headings = getHeadings();
    if (!headings.length) {
      outlineContent.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--vscode-descriptionForeground)">No headings found</div>';
      return;
    }
    let html = '<div style="padding:2px 0">';
    for (const h of headings) {
      const indent = (h.level - 1) * 16;
      html += `<div class="outline-item" data-level="${h.level}" data-pos="${h.pos}">`;
      html += `<span class="indent" style="width:${indent}px"></span>`;
      html += `<span class="label"><span class="heading-tag">H${h.level}</span>${escapeHtml(h.text)}</span></div>`;
    }
    html += '</div>';
    outlineContent.innerHTML = html;
    outlineContent.querySelectorAll('.outline-item').forEach(el => {
      el.addEventListener('click', () => {
        const pos = parseInt((el as HTMLElement).dataset.pos || '0', 10);
        navigateToHeading(pos);
      });
    });
  }

  function navigateToHeading(pos: number) {
    if (currentMode === 'source') {
      const cm = getCmView();
      cm.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      cm.focus();
    } else if (currentMode === 'visual' && pmView) {
      pmView.dispatch(
        pmView.state.tr.setSelection(TextSelection.create(pmView.state.doc, pos)).scrollIntoView()
      );
      pmView.focus();
    }
  }

  function updateOutline() {
    if (isOutlineOpen) {
      renderOutline();
      updateActiveHeading();
    }
  }

  function updateActiveHeading() {
    const items = outlineContent.querySelectorAll('.outline-item');
    if (!items.length) return;

    const headings = getHeadings();
    if (!headings.length) return;

    const editor = currentMode === 'source' ? getCmView().scrollDOM : editorContainer;
    const editorTop = editor.getBoundingClientRect().top;

    let activeIdx = 0;
    for (let i = 0; i < headings.length; i++) {
      const coords = currentMode === 'source'
        ? getCmView().coordsAtPos(headings[i].pos)
        : pmView!.coordsAtPos(headings[i].pos);
      if (!coords) continue;
      if (coords.top <= editorTop + 5) activeIdx = i;
    }

    items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
  }

  outlineToggle.addEventListener('click', () => {
    isOutlineOpen = !isOutlineOpen;
    outlinePanel.classList.toggle('active', isOutlineOpen);
    if (isOutlineOpen) {
      updatePanelPositions();
      updateOutline();
    }
  });

  outlineClose.addEventListener('click', () => {
    isOutlineOpen = false;
    outlinePanel.classList.remove('active');
  });

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  interface TreeNode {
    name: string;
    path: string;
    type: 'file' | 'dir';
    children: TreeNode[];
    expanded: boolean;
  }

  function buildTree(files: string[]): TreeNode[] {
    const root: TreeNode[] = [];
    for (const file of files) {
      const parts = file.split('/');
      let current = root;
      for (let i = 0; i < parts.length; i++) {
        const isFile = i === parts.length - 1;
        const name = parts[i];
        const existing = current.find(n => n.name === name && (isFile ? n.type === 'file' : n.type === 'dir'));
        if (existing) {
          if (isFile) break;
          current = existing.children;
        } else {
          const node: TreeNode = {
            name,
            path: isFile ? file : parts.slice(0, i + 1).join('/'),
            type: isFile ? 'file' : 'dir',
            children: isFile ? [] : [],
            expanded: true,
          };
          current.push(node);
          if (!isFile) current = node.children;
        }
      }
    }
    return root;
  }

  const indentUnit = 16;

  function renderTree(nodes: TreeNode[], depth = 0) {
    let html = '';
    for (const node of nodes) {
      const isDir = node.type === 'dir';
      html += `<div class="tree-item${isDir ? '' : ' file'}" data-type="${node.type}" data-path="${node.path}">`;
      html += `<span class="indent" style="width:${depth * indentUnit}px"></span>`;
      html += `<span class="chevron">${isDir ? `<i class="codicon ${node.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}"></i>` : ''}</span>`;
      html += `<span class="icon codicon ${isDir ? 'codicon-folder' : 'codicon-file'}"></span>`;
      html += `<span class="label">${node.name}</span></div>`;
      if (isDir && node.expanded) {
        html += renderTree(node.children, depth + 1);
      }
    }
    return html;
  }

  function toggleDir(el: HTMLElement) {
    const isDir = el.dataset.type === 'dir';
    if (!isDir) return;
    const path = el.dataset.path || '';
    function toggleNode(nodes: TreeNode[]): boolean {
      for (const n of nodes) {
        if (n.type === 'dir' && n.path === path) {
          n.expanded = !n.expanded;
          return true;
        }
        if (n.children.length && toggleNode(n.children)) return true;
      }
      return false;
    }
    toggleNode(treeData);
    treeContent.innerHTML = renderTree(treeData);
    attachTreeHandlers();
    saveTreeState();
  }

  function attachTreeHandlers() {
    treeContent.querySelectorAll('.tree-item').forEach(el => {
      el.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const type = target.dataset.type;
        if (type === 'dir') {
          toggleDir(target);
        } else if (type === 'file') {
          const path = target.dataset.path;
          if (path) {
            vscode.postMessage({ type: 'openFileFromTree', path } satisfies EditorMessage);
          }
        }
      });
    });
  }

  function updatePanelPositions() {
    outlinePanel.classList.toggle('dock-right', panelsSwapped);
    treePanel.classList.toggle('dock-right', !panelsSwapped);
    const group = document.querySelector('.panel-group')!;
    if (panelsSwapped) {
      group.insertBefore(treeToggle, panelSwapBtn);
      group.insertBefore(outlineToggle, panelSwapBtn.nextSibling);
    } else {
      group.insertBefore(outlineToggle, panelSwapBtn);
      group.insertBefore(treeToggle, panelSwapBtn.nextSibling);
    }
  }

  treeToggle.addEventListener('click', () => {
    isTreeOpen = !isTreeOpen;
    if (isTreeOpen) {
      restoreExpanded = treeData.length ? getExpandedPaths() : null;
      vscode.postMessage({ type: 'requestFileTree' } satisfies EditorMessage);
      treePanel.classList.add('active');
      updatePanelPositions();
    } else {
      treePanel.classList.remove('active');
    }
    saveTreeState();
  });

  treePanelClose.addEventListener('click', () => {
    isTreeOpen = false;
    treePanel.classList.remove('active');
    saveTreeState();
  });

  treeClose.addEventListener('click', () => {
    function collapseAll(nodes: TreeNode[]) {
      for (const n of nodes) {
        if (n.type === 'dir') {
          n.expanded = false;
          collapseAll(n.children);
        }
      }
    }
    collapseAll(treeData);
    treeContent.innerHTML = renderTree(treeData);
    attachTreeHandlers();
    saveTreeState();
  });

  panelSwapBtn.addEventListener('click', () => {
    panelsSwapped = !panelsSwapped;
    updatePanelPositions();
    saveTreeState();
  });

  const resizeHandle = document.getElementById('tree-resize-handle')!;
  let isResizing = false;
  resizeHandle.addEventListener('mousedown', (e) => { isResizing = true; e.preventDefault(); });
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const rect = (treePanel.parentElement as HTMLElement).getBoundingClientRect();
    treePanel.style.width = Math.max(150, Math.min(500, panelsSwapped ? e.clientX - rect.left : rect.right - e.clientX)) + 'px';
  });
  document.addEventListener('mouseup', () => { isResizing = false; });

  const outlineResizeHandle = document.getElementById('outline-resize-handle')!;
  let isOutlineResizing = false;
  outlineResizeHandle.addEventListener('mousedown', (e) => { isOutlineResizing = true; e.preventDefault(); });
  document.addEventListener('mousemove', (e) => {
    if (!isOutlineResizing) return;
    const rect = (outlinePanel.parentElement as HTMLElement).getBoundingClientRect();
    outlinePanel.style.width = Math.max(150, Math.min(500, panelsSwapped ? rect.right - e.clientX : e.clientX - rect.left)) + 'px';
  });
  document.addEventListener('mouseup', () => { isOutlineResizing = false; });

  // ── File Tree Search ──

  let isSearchOpen = false;
  let searchQuery = '';
  let searchRegex = false;
  let searchCase = false;
  let searchInclude = '';
  let searchExclude = '';

  const searchBtn = document.getElementById('pm-tree-search-btn')!;
  const searchBar = document.getElementById('tree-search-bar')!;
  const searchInput = document.getElementById('tree-search-input') as HTMLInputElement;
  const searchRegexBtn = document.getElementById('tree-search-regex')!;
  const searchCaseBtn = document.getElementById('tree-search-case')!;
  const searchIncludeInput = document.getElementById('tree-search-include') as HTMLInputElement;
  const searchExcludeInput = document.getElementById('tree-search-exclude') as HTMLInputElement;
  const searchGitignore = document.getElementById('tree-search-gitignore') as HTMLInputElement;
  let filteredFiles: string[] | null = null;
  let gitignoredFiles: string[] = [];
  let gitignoreOn = false;

  function globToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp('^' + escaped + '$', 'i');
  }

  function matchesFilter(path: string): boolean {
    if (searchInclude) {
      const includes = searchInclude.split(',').map(s => s.trim()).filter(Boolean).map(globToRegex);
      if (includes.length && !includes.some(r => r.test(path))) return false;
    }
    if (searchExclude) {
      const excludes = searchExclude.split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'));
      if (excludes.some(r => path.match(new RegExp('^' + r + '$', 'i')))) return false;
    }
    return true;
  }

  function applySearch() {
    const q = searchQuery.trim();
    let base = treeData;
    if (gitignoreOn && gitignoredFiles.length) {
      const set = new Set(gitignoredFiles);
      const filtered = (nodes: TreeNode[]): TreeNode[] => {
        const out: TreeNode[] = [];
        for (const n of nodes) {
          if (n.type === 'file') {
            if (!set.has(n.path)) out.push({ ...n });
          } else {
            const kids = filtered(n.children);
            if (kids.length) out.push({ ...n, children: kids, expanded: true });
          }
        }
        return out;
      };
      base = filtered(base);
    }
    if (!q) {
      filteredFiles = null;
      treeContent.innerHTML = renderTree(base);
      attachTreeHandlers();
      return;
    }
    const files: string[] = [];
    function collectFiles(nodes: TreeNode[]) {
      for (const n of nodes) {
        if (n.type === 'file') files.push(n.path);
        if (n.children.length) collectFiles(n.children);
      }
    }
    collectFiles(base);
    const matched: string[] = [];
    for (const f of files) {
      const name = f.split('/').pop() || f;
      const testStr = searchCase ? name : name.toLowerCase();
      const testQ = searchCase ? q : q.toLowerCase();
      let ok: boolean;
      if (searchRegex) {
        try { ok = new RegExp(testQ, searchCase ? '' : 'i').test(name); }
        catch { ok = false; }
      } else {
        ok = testStr.includes(testQ);
      }
      if (ok && matchesFilter(f)) matched.push(f);
    }
    filteredFiles = matched;
    const filteredTree = buildTree(matched);
    treeContent.innerHTML = renderTree(filteredTree);
    attachTreeHandlers();
  }

  searchBtn.addEventListener('click', () => {
    isSearchOpen = !isSearchOpen;
    searchBar.classList.toggle('active', isSearchOpen);
    if (isSearchOpen) searchInput.focus();
    else { searchQuery = ''; searchInput.value = ''; searchInclude = ''; searchIncludeInput.value = ''; searchExclude = ''; searchExcludeInput.value = ''; searchGitignore.checked = false; gitignoreOn = false; filteredFiles = null; applySearch(); }
  });

  const saveSearch = () => { applySearch(); saveTreeState(); };
  searchInput.addEventListener('input', () => { searchQuery = searchInput.value; saveSearch(); });
  searchRegexBtn.addEventListener('click', () => { searchRegex = !searchRegex; searchRegexBtn.classList.toggle('active', searchRegex); saveSearch(); });
  searchCaseBtn.addEventListener('click', () => { searchCase = !searchCase; searchCaseBtn.classList.toggle('active', searchCase); saveSearch(); });
  searchIncludeInput.addEventListener('input', () => { searchInclude = searchIncludeInput.value; saveSearch(); });
  searchExcludeInput.addEventListener('input', () => { searchExclude = searchExcludeInput.value; saveSearch(); });
  searchGitignore.addEventListener('change', () => { gitignoreOn = searchGitignore.checked; saveSearch(); });

  // ── Extension Messages ──

  window.addEventListener('message', (event: MessageEvent<EditorMessage>) => {
    const msg = event.data;
    if (msg.type === 'toggleSource') {
      const modes: ('visual' | 'source' | 'html')[] = ['visual', 'source', 'html'];
      const idx = modes.indexOf(currentMode);
      setMode(modes[(idx + 1) % modes.length]);
      return;
    }
    if (msg.type === 'content' && typeof msg.text === 'string') {
      isExternalUpdate = true;
      if (currentMode === 'source') {
        const cm = getCmView();
        cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: msg.text } });
      } else if (!pmView) {
        initProseMirror(msg.text);
        setTimeout(() => pmView?.dom.focus({preventScroll: true}), 0);
      } else {
        const doc = parser.parse(msg.text) || schema.topNodeType.create();
        pmView.dispatch(
          pmView.state.tr.replaceWith(0, pmView.state.doc.content.size, doc.content).scrollIntoView()
        );
      }
      if (currentMode === 'html') {
        const htmlEditor = getHtmlView();
        const generated = md.render(msg.text);
        htmlEditor.dispatch({ changes: { from: 0, to: htmlEditor.state.doc.length, insert: generated } });
      }
      updateOutline();
      isExternalUpdate = false;
    }
    if (msg.type === 'fileTree') {
      treeData = buildTree(msg.files);
      gitignoredFiles = msg.gitignored ?? [];
      if (restoreExpanded) {
        function expandSaved(nodes: TreeNode[]) {
          for (const n of nodes) {
            if (n.type === 'dir') {
              if (restoreExpanded!.includes(n.path || n.name)) {
                n.expanded = true;
                expandSaved(n.children);
              } else {
                n.expanded = false;
              }
            }
          }
        }
        expandSaved(treeData);
        restoreExpanded = null;
      }
      applySearch();
    }
    if (msg.type === 'treeState' && msg.state) {
      const s = msg.state;
      isTreeOpen = s.isOpen;
      panelsSwapped = s.panelsSwapped ?? false;
      gitignoreOn = s.gitignore;
      searchQuery = s.searchQuery;
      searchRegex = s.searchRegex;
      searchCase = s.searchCase;
      searchInclude = s.searchInclude;
      searchExclude = s.searchExclude;
      restoreExpanded = s.expanded;
      searchInput.value = searchQuery;
      searchIncludeInput.value = searchInclude;
      searchExcludeInput.value = searchExclude;
      searchRegexBtn.classList.toggle('active', searchRegex);
      searchCaseBtn.classList.toggle('active', searchCase);
      searchGitignore.checked = gitignoreOn;
      if (isTreeOpen) {
        vscode.postMessage({ type: 'requestFileTree' } satisfies EditorMessage);
        treePanel.classList.add('active');
        searchBar.classList.toggle('active', !!searchQuery);
        updatePanelPositions();
      }
      saveTreeState();
    }
  });

  vscode.postMessage({ type: 'ready' } satisfies EditorMessage);
})();
