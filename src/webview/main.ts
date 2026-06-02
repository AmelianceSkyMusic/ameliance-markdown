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
        setTimeout(() => pmView?.dom.focus({preventScroll: true}), 0);
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

  // ── File Tree Panel ──

  let isTreeOpen = false;
  let treeDock: 'left' | 'right' = 'right';
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
      dock: treeDock,
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
    if (!isTreeOpen) return;
    if (treeSaveTimer) clearTimeout(treeSaveTimer);
    treeSaveTimer = setTimeout(() => {
      vscode.postMessage({ type: 'saveTreeState', state: getTreeState() } satisfies EditorMessage);
    }, 300);
  }

  const treePanel = document.getElementById('file-tree-panel')!;
  const treeContent = document.getElementById('tree-content')!;
  const treeToggle = document.getElementById('pm-tree-toggle')!;
  const treeClose = document.getElementById('pm-tree-close')!;
  const treeDockBtn = document.getElementById('pm-tree-dock')!;

  function updateTreeToggleIcon() {
    const icon = treeToggle.querySelector('.codicon')!;
    icon.className = `codicon codicon-layout-sidebar-${treeDock}`;
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
            path: isFile ? file : '',
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
    const parts = path.split('/');
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

  treeToggle.addEventListener('click', () => {
    isTreeOpen = !isTreeOpen;
    if (isTreeOpen) {
      vscode.postMessage({ type: 'requestFileTree' } satisfies EditorMessage);
      treePanel.classList.add('active');
      if (treeDock === 'right') treePanel.classList.add('dock-right');
    } else {
      treePanel.classList.remove('active');
    }
    saveTreeState();
  });

  treeClose.addEventListener('click', () => {
    isTreeOpen = false;
    treePanel.classList.remove('active');
    saveTreeState();
  });

  treeDockBtn.addEventListener('click', () => {
    treeDock = treeDock === 'left' ? 'right' : 'left';
    treePanel.classList.toggle('dock-right', treeDock === 'right');
    updateTreeToggleIcon();
    saveTreeState();
  });

  const resizeHandle = document.getElementById('tree-resize-handle')!;
  let isResizing = false;
  resizeHandle.addEventListener('mousedown', (e) => { isResizing = true; e.preventDefault(); });
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const rect = (treePanel.parentElement as HTMLElement).getBoundingClientRect();
    treePanel.style.width = Math.max(150, Math.min(500, treeDock === 'left' ? e.clientX - rect.left : rect.right - e.clientX)) + 'px';
  });
  document.addEventListener('mouseup', () => { isResizing = false; });

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
        setTimeout(() => pmView?.dom.focus({preventScroll: true}), 0);
      } else {
        const doc = parser.parse(msg.text) || schema.topNodeType.create();
        pmView.dispatch(
          pmView.state.tr.replaceWith(0, pmView.state.doc.content.size, doc.content).scrollIntoView()
        );
      }
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
      treeDock = s.dock;
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
        if (treeDock === 'right') treePanel.classList.add('dock-right');
      }
      updateTreeToggleIcon();
      saveTreeState();
    }
  });

  updateTreeToggleIcon();
  vscode.postMessage({ type: 'ready' } satisfies EditorMessage);
})();
