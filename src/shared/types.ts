export interface TreePanelState {
  isOpen: boolean;
  dock: 'left' | 'right';
  expanded: string[];
  gitignore: boolean;
  searchQuery: string;
  searchRegex: boolean;
  searchCase: boolean;
  searchInclude: string;
  searchExclude: string;
}

export type EditorMessage =
  | { type: 'ready' }
  | { type: 'edit'; text: string }
  | { type: 'content'; text: string }
  | { type: 'toggleSource' }
  | { type: 'requestFileTree' }
  | { type: 'fileTree'; files: string[]; gitignored?: string[] }
  | { type: 'openFileFromTree'; path: string }
  | { type: 'saveTreeState'; state: TreePanelState }
  | { type: 'treeState'; state?: TreePanelState };
