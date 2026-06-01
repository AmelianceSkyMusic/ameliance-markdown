export type EditorMessage =
  | { type: 'ready' }
  | { type: 'edit'; text: string }
  | { type: 'content'; text: string }
  | { type: 'toggleSource' }
  | { type: 'requestFileTree' }
  | { type: 'fileTree'; files: string[] }
  | { type: 'openFileFromTree'; path: string };
